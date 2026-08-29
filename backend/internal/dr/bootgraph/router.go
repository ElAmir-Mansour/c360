package bootgraph

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

// bootService is the surface the HTTP router needs. *Manager satisfies it; an
// interface keeps the router unit-testable without a database.
type bootService interface {
	DefineServices(ctx context.Context, tenantID uuid.UUID, groupID string, specs []ServiceSpec) (BootPlan, error)
	GetPlan(ctx context.Context, tenantID uuid.UUID, groupID string) (BootPlan, error)
	StartRun(ctx context.Context, tenantID uuid.UUID, groupID, policy string, initiatedBy *string) (RunDetail, error)
	GetRun(ctx context.Context, tenantID uuid.UUID, runID string) (RunDetail, error)
}

// Router serves the dependency-aware boot-orchestration HTTP surface. It is
// mounted by the integration phase under /api/v1/dr so the four endpoints become:
//
//	POST /api/v1/dr/groups/{groupID}/boot-services  (dr:write) — define DAG; 409 on cycle
//	GET  /api/v1/dr/groups/{groupID}/boot-plan       (dr:read)  — computed tiers
//	POST /api/v1/dr/groups/{groupID}/boot-runs       (dr:failover) — execute tier-by-tier
//	GET  /api/v1/dr/boot-runs/{runID}                (dr:read)  — run + per-service status
type Router struct {
	svc    bootService
	logger zerolog.Logger
}

// NewRouter constructs the boot-orchestration HTTP router over a Manager.
func NewRouter(svc *Manager, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-bootgraph").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc bootService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the boot-orchestration endpoints,
// permission-gated to match the rest of the DR API: reads require dr:read,
// defining the DAG requires dr:write, and executing a boot run (a recovery
// action) requires dr:failover.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/groups/{groupID}/boot-plan", h.getPlan)
		r.Get("/boot-runs/{runID}", h.getRun)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/groups/{groupID}/boot-services", h.defineServices)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRFailover))
		r.Post("/groups/{groupID}/boot-runs", h.startRun)
	})

	return r
}

// defineServicesRequest is the POST body for defining a group's boot DAG.
type defineServicesRequest struct {
	Services []serviceSpecRequest `json:"services"`
}

type serviceSpecRequest struct {
	Name               string   `json:"name"`
	Kind               string   `json:"kind,omitempty"`
	BootAction         string   `json:"boot_action,omitempty"`
	SiteID             string   `json:"site_id,omitempty"`
	ProbeKind          string   `json:"probe_kind"`
	ProbeTarget        string   `json:"probe_target"`
	ProbeExpectStatus  int      `json:"probe_expect_status,omitempty"`
	BootTimeoutSeconds int      `json:"boot_timeout_seconds,omitempty"`
	HealthRetries      int      `json:"health_retries,omitempty"`
	DependsOn          []string `json:"depends_on,omitempty"`
}

// defineServices upserts the group's boot services + dependency edges and
// returns the computed plan. 409 when the DAG would contain a cycle.
func (h *Router) defineServices(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.groupParams(w, r)
	if !ok {
		return
	}
	var req defineServicesRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if len(req.Services) == 0 {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "services is required and must be non-empty", nil)
		return
	}
	specs := make([]ServiceSpec, len(req.Services))
	for i, s := range req.Services {
		specs[i] = ServiceSpec{
			Name:               s.Name,
			Kind:               s.Kind,
			BootAction:         s.BootAction,
			SiteID:             s.SiteID,
			ProbeKind:          s.ProbeKind,
			ProbeTarget:        s.ProbeTarget,
			ProbeExpectStatus:  s.ProbeExpectStatus,
			BootTimeoutSeconds: s.BootTimeoutSeconds,
			HealthRetries:      s.HealthRetries,
			DependsOn:          s.DependsOn,
		}
	}
	plan, err := h.svc.DefineServices(r.Context(), tenantID, groupID.String(), specs)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, planResponse(plan))
}

// getPlan returns the group's computed boot plan (tiers).
func (h *Router) getPlan(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.groupParams(w, r)
	if !ok {
		return
	}
	plan, err := h.svc.GetPlan(r.Context(), tenantID, groupID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, planResponse(plan))
}

// startRunRequest is the POST body for executing a boot run.
type startRunRequest struct {
	// Policy is halt (default) or rollback.
	Policy string `json:"policy,omitempty"`
}

// startRun creates and executes a boot run tier by tier, returning the terminal
// run detail.
func (h *Router) startRun(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.groupParams(w, r)
	if !ok {
		return
	}
	var req startRunRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	var initiatedBy *string
	if uid, err := suiteapi.UserID(r); err == nil && uid != nil {
		s := uid.String()
		initiatedBy = &s
	}
	detail, err := h.svc.StartRun(r.Context(), tenantID, groupID.String(), req.Policy, initiatedBy)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, detail)
}

// getRun returns a boot run plus its per-service statuses.
func (h *Router) getRun(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	runID, err := suiteapi.UUIDParam(r, "runID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	detail, err := h.svc.GetRun(r.Context(), tenantID, runID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, detail)
}

// planResponse shapes a BootPlan for the API, surfacing both the full tier
// structure and a compact name-only view.
func planResponse(plan BootPlan) map[string]any {
	return map[string]any{
		"group_id":   plan.GroupID,
		"tiers":      plan.Tiers,
		"tier_names": plan.ServiceNames(),
		"tier_count": len(plan.Tiers),
	}
}

// groupParams extracts the tenant from context and the group ID from the path.
func (h *Router) groupParams(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	groupID, err := suiteapi.UUIDParam(r, "groupID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, groupID, true
}

// writeError maps bootgraph sentinel errors to HTTP statuses. A cycle is the
// load-bearing one: it must be 409 Conflict so a client distinguishes "this
// dependency graph loops" from a generic bad request.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrCycle):
		suiteapi.WriteError(w, r, http.StatusConflict, "cycle", err.Error(), nil)
	case errors.Is(err, ErrGroupNotFound), errors.Is(err, ErrServiceNotFound), errors.Is(err, ErrRunNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrSelfDependency), errors.Is(err, ErrUnknownDependency),
		errors.Is(err, ErrInvalidProbe), errors.Is(err, ErrInvalidPolicy),
		errors.Is(err, ErrDuplicateService), errors.Is(err, ErrNoServices):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr bootgraph request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// compile-time check.
var _ bootService = (*Manager)(nil)
