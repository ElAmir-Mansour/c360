package failback

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// HandlerService is the failback contract the HTTP adapter calls. *Service
// satisfies it.
type HandlerService interface {
	PlanFailback(ctx context.Context, tenantID uuid.UUID, in PlanFailbackInput) (*FailbackRun, error)
	GetFailback(ctx context.Context, tenantID, id uuid.UUID) (*FailbackRun, error)
	ListFailbacks(ctx context.Context, tenantID uuid.UUID) ([]*FailbackRun, error)
	ListSteps(ctx context.Context, tenantID, id uuid.UUID) ([]*FailbackStep, error)
	ApproveCutback(ctx context.Context, tenantID, id, approvedBy uuid.UUID) (*FailbackRun, error)
	Advance(ctx context.Context, tenantID, id uuid.UUID) (*FailbackRun, error)
}

// Handler maps HTTP to the failback service. It is mounted by the integrate phase
// under /api/v1/dr (so its routes are /api/v1/dr/failback-runs...).
type Handler struct {
	svc    HandlerService
	logger zerolog.Logger
}

// NewHandler constructs a failback HTTP handler.
func NewHandler(svc HandlerService, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr-failback").Logger()}
}

// Routes returns the failback router. Reads require dr:read; planning/advancing/
// approving the gated cutback require dr:failover (the step-up DR action, §9).
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/failback-runs", h.list)
		r.Get("/failback-runs/{id}", h.get)
		r.Get("/failback-runs/{id}/steps", h.listSteps)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRFailover))
		r.Post("/failback-runs", h.plan)
		r.Post("/failback-runs/{id}/approve-cutback", h.approveCutback)
		r.Post("/failback-runs/{id}/advance", h.advance)
	})

	return r
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", ve.Error(), ve)
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrNotApproved):
		suiteapi.WriteError(w, r, http.StatusConflict, "not_approved", err.Error(), nil)
	case errors.Is(err, ErrInvalidState):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_state", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("failback request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func (h *Handler) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) runID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) currentUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	userID, err := suiteapi.UserID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "bad_user", err.Error(), nil)
		return uuid.Nil, false
	}
	if userID == nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_user", "authenticated user context required", nil)
		return uuid.Nil, false
	}
	return *userID, true
}

type planRequest struct {
	GroupID                string  `json:"group_id"`
	FromSite               string  `json:"from_site"`
	ToSite                 string  `json:"to_site"`
	FailoverRunID          *string `json:"failover_run_id"`
	ConvergeThresholdBytes int64   `json:"converge_threshold_bytes"`
}

// plan: POST /failback-runs — plan a failback (create the run in PLANNING).
func (h *Handler) plan(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	userID, ok := h.currentUser(w, r)
	if !ok {
		return
	}
	var req planRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	groupID, err := uuid.Parse(req.GroupID)
	if err != nil {
		h.writeError(w, r, invalid("group_id", "must be a UUID"))
		return
	}
	fromSite, err := uuid.Parse(req.FromSite)
	if err != nil {
		h.writeError(w, r, invalid("from_site", "must be a UUID"))
		return
	}
	toSite, err := uuid.Parse(req.ToSite)
	if err != nil {
		h.writeError(w, r, invalid("to_site", "must be a UUID"))
		return
	}
	var failoverRunID *uuid.UUID
	if req.FailoverRunID != nil && *req.FailoverRunID != "" {
		parsed, perr := uuid.Parse(*req.FailoverRunID)
		if perr != nil {
			h.writeError(w, r, invalid("failover_run_id", "must be a UUID"))
			return
		}
		failoverRunID = &parsed
	}
	run, err := h.svc.PlanFailback(r.Context(), tenantID, PlanFailbackInput{
		GroupID:                groupID,
		FromSite:               fromSite,
		ToSite:                 toSite,
		FailoverRunID:          failoverRunID,
		ConvergeThresholdBytes: req.ConvergeThresholdBytes,
		InitiatedBy:            userID,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, run)
}

// get: GET /failback-runs/{id}.
func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, ok := h.runID(w, r)
	if !ok {
		return
	}
	run, err := h.svc.GetFailback(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, run)
}

// list: GET /failback-runs.
func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	runs, err := h.svc.ListFailbacks(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, runs)
}

// listSteps: GET /failback-runs/{id}/steps — the step timeline.
func (h *Handler) listSteps(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, ok := h.runID(w, r)
	if !ok {
		return
	}
	steps, err := h.svc.ListSteps(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, steps)
}

// approveCutback: POST /failback-runs/{id}/approve-cutback — the human cutback
// gate. The ONLY way past AWAITING_CUTBACK_APPROVAL.
func (h *Handler) approveCutback(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	userID, ok := h.currentUser(w, r)
	if !ok {
		return
	}
	id, ok := h.runID(w, r)
	if !ok {
		return
	}
	run, err := h.svc.ApproveCutback(r.Context(), tenantID, id, userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, run)
}

// advance: POST /failback-runs/{id}/advance — operator-driven single FSM step
// through the same gated driver (the Loop normally drives runs).
func (h *Handler) advance(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, ok := h.runID(w, r)
	if !ok {
		return
	}
	run, err := h.svc.Advance(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, run)
}
