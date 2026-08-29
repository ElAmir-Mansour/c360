package drillsched

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// scheduleService is the surface the HTTP router needs. *Service satisfies it;
// an interface keeps the router unit-testable without a database.
type scheduleService interface {
	CreateSchedule(ctx context.Context, tenantID uuid.UUID, in CreateScheduleInput) (*Schedule, error)
	ListSchedules(ctx context.Context, tenantID uuid.UUID) ([]*Schedule, error)
	NextRuns(ctx context.Context, tenantID, id uuid.UUID, n int) ([]time.Time, error)
	ListResultsByGroup(ctx context.Context, tenantID, groupID uuid.UUID) ([]*DrillResult, error)
	DiffResult(ctx context.Context, tenantID, resultID uuid.UUID) (DrillDiff, error)
}

// Router serves the scheduled-drills HTTP surface. It is mounted by the
// integration phase under /api/v1/dr (alongside the main DR handler) so the
// endpoints become:
//
//	POST /api/v1/dr/drill-schedules                  (dr:write)
//	GET  /api/v1/dr/drill-schedules                  (dr:read)
//	GET  /api/v1/dr/drill-schedules/{id}/next-runs   (dr:read)  — proves the cron engine
//	GET  /api/v1/dr/groups/{groupID}/drill-results   (dr:read)
//	GET  /api/v1/dr/drill-results/{id}/diff          (dr:read)  — vs previous
type Router struct {
	svc    scheduleService
	logger zerolog.Logger
}

// NewRouter constructs the router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-drillsched").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc scheduleService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the scheduled-drill endpoints, permission-gated
// to match the rest of the DR API: reads require dr:read, creating/deleting a
// schedule requires dr:write.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/drill-schedules", h.listSchedules)
		r.Get("/drill-schedules/{id}/next-runs", h.nextRuns)
		r.Get("/groups/{groupID}/drill-results", h.listResults)
		r.Get("/drill-results/{id}/diff", h.diffResult)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/drill-schedules", h.createSchedule)
	})

	return r
}

// createScheduleRequest is the POST /drill-schedules body.
type createScheduleRequest struct {
	GroupID             string `json:"group_id"`
	Name                string `json:"name"`
	CronExpr            string `json:"cron_expr"`
	Profile             string `json:"profile,omitempty"`
	RTOObjectiveSeconds int    `json:"rto_objective_seconds,omitempty"`
	Enabled             *bool  `json:"enabled,omitempty"`
}

func (h *Router) createSchedule(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	var req createScheduleRequest
	if derr := suiteapi.DecodeJSON(r, &req); derr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", derr.Error(), nil)
		return
	}
	groupID, perr := uuid.Parse(req.GroupID)
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group_id must be a valid UUID", nil)
		return
	}
	sc, cerr := h.svc.CreateSchedule(r.Context(), tenantID, CreateScheduleInput{
		GroupID:             groupID,
		Name:                req.Name,
		CronExpr:            req.CronExpr,
		Profile:             req.Profile,
		RTOObjectiveSeconds: req.RTOObjectiveSeconds,
		Enabled:             req.Enabled,
	})
	if cerr != nil {
		h.writeError(w, r, cerr)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, sc)
}

func (h *Router) listSchedules(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	schedules, lerr := h.svc.ListSchedules(r.Context(), tenantID)
	if lerr != nil {
		h.writeError(w, r, lerr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, schedules)
}

// nextRuns renders the next N fire times for a schedule, proving the cron engine.
// ?n= selects the count (default 5, clamped by the service to [1,100]).
func (h *Router) nextRuns(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	id, perr := suiteapi.UUIDParam(r, "id")
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", perr.Error(), nil)
		return
	}
	n := 5
	if raw := r.URL.Query().Get("n"); raw != "" {
		parsed, cerr := strconv.Atoi(raw)
		if cerr != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "n must be an integer", nil)
			return
		}
		n = parsed
	}
	runs, nerr := h.svc.NextRuns(r.Context(), tenantID, id, n)
	if nerr != nil {
		h.writeError(w, r, nerr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"schedule_id": id.String(),
		"next_runs":   runs,
		"count":       len(runs),
	})
}

func (h *Router) listResults(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	groupID, perr := suiteapi.UUIDParam(r, "groupID")
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", perr.Error(), nil)
		return
	}
	results, lerr := h.svc.ListResultsByGroup(r.Context(), tenantID, groupID)
	if lerr != nil {
		h.writeError(w, r, lerr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, results)
}

// diffResult returns the structured diff of a result against its predecessor. A
// first result (no predecessor) is a 404 with a clear code so the UI can show
// "no prior drill to compare".
func (h *Router) diffResult(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	id, perr := suiteapi.UUIDParam(r, "id")
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", perr.Error(), nil)
		return
	}
	diff, derr := h.svc.DiffResult(r.Context(), tenantID, id)
	if derr != nil {
		h.writeError(w, r, derr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, diff)
}

// writeError maps package sentinel errors to HTTP statuses.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrValidation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_failed", err.Error(), nil)
	case errors.Is(err, ErrGroupNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "group_not_found", err.Error(), nil)
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrNoPrevious):
		suiteapi.WriteError(w, r, http.StatusNotFound, "no_previous_result", err.Error(), nil)
	case errors.Is(err, ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_exists", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr drill-schedule request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ scheduleService = (*Service)(nil)
