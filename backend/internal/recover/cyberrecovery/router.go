package cyberrecovery

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

// flowService is the surface the router needs; *Service satisfies it. The
// interface keeps the router unit-testable without a database or live composed
// services.
type flowService interface {
	Overview(ctx context.Context, tenantID uuid.UUID) (*Overview, error)
	ListCleanPoints(ctx context.Context, tenantID uuid.UUID, limit int) ([]CleanPoint, error)
	ListFlows(ctx context.Context, tenantID uuid.UUID, limit int) ([]Flow, error)
	GetFlow(ctx context.Context, tenantID, flowID uuid.UUID) (*Flow, []FlowEvent, error)
	SelectCleanPoint(ctx context.Context, tenantID uuid.UUID, actor Actor, in SelectCleanPointInput) (*Flow, error)
	Provision(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error)
	RunRecovery(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor, runbookRunID string) (*Flow, error)
	RunIntegrityCheck(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error)
	RequestApproval(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error)
	Approve(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor, note string) (*Flow, error)
	ReturnToProduction(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error)
	Abort(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor, reason string) (*Flow, error)
}

// Router serves the Cyber Recovery workspace HTTP surface. It is Mounted under
// /api/recover/cyber-recovery (behind the same Auth+Tenant middleware as the
// rest of /api/recover) and self-gates each route with RequirePermission (paths
// below are shown with their full /api/recover/cyber-recovery prefix):
//
//	GET  /api/recover/cyber-recovery/overview                       (dr:read)
//	GET  /api/recover/cyber-recovery/clean-points                   (dr:read)
//	GET  /api/recover/cyber-recovery/flows                          (dr:read)
//	POST /api/recover/cyber-recovery/flows                          (dr:write)  select clean point
//	GET  /api/recover/cyber-recovery/flows/{id}                     (dr:read)
//	POST /api/recover/cyber-recovery/flows/{id}/provision           (dr:write)
//	POST /api/recover/cyber-recovery/flows/{id}/run-recovery        (dr:write)
//	POST /api/recover/cyber-recovery/flows/{id}/integrity-check     (dr:write)  MANDATORY gate
//	POST /api/recover/cyber-recovery/flows/{id}/request-approval    (dr:write)
//	POST /api/recover/cyber-recovery/flows/{id}/approve             (dr:admin)  sign-off (provenance)
//	POST /api/recover/cyber-recovery/flows/{id}/return-to-production (dr:failover) HARD-gated
//	POST /api/recover/cyber-recovery/flows/{id}/abort               (dr:write)
type Router struct {
	svc    flowService
	logger zerolog.Logger
}

// NewRouter constructs the Cyber Recovery router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "recover-cyber-recovery").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc flowService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns the chi.Router for the Cyber Recovery workspace. It is intended
// to be Mounted under "/cyber-recovery" (the product router does this), so the
// paths here are RELATIVE to that prefix. Reads require dr:read; flow actions
// require dr:write; the approval sign-off requires dr:admin (an elevated approver
// role) and the terminal return-to-production requires dr:failover (the step-up,
// gated action), matching the DR API's convention that the most consequential
// recovery action carries the highest permission.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/overview", h.overview)
		r.Get("/clean-points", h.cleanPoints)
		r.Get("/flows", h.listFlows)
		r.Get("/flows/{id}", h.getFlow)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/flows", h.selectCleanPoint)
		r.Post("/flows/{id}/provision", h.provision)
		r.Post("/flows/{id}/run-recovery", h.runRecovery)
		r.Post("/flows/{id}/integrity-check", h.integrityCheck)
		r.Post("/flows/{id}/request-approval", h.requestApproval)
		r.Post("/flows/{id}/abort", h.abort)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/flows/{id}/approve", h.approve)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRFailover))
		r.Post("/flows/{id}/return-to-production", h.returnToProduction)
	})

	return r
}

func (h *Router) overview(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	ov, err := h.svc.Overview(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, ov)
}

func (h *Router) cleanPoints(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	points, err := h.svc.ListCleanPoints(r.Context(), tenantID, 50)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, points)
}

func (h *Router) listFlows(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	flows, err := h.svc.ListFlows(r.Context(), tenantID, 100)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, flows)
}

// flowDetail bundles the flow with its append-only transition history.
type flowDetail struct {
	Flow   *Flow       `json:"flow"`
	Events []FlowEvent `json:"events"`
}

func (h *Router) getFlow(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	flowID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	flow, events, err := h.svc.GetFlow(r.Context(), tenantID, flowID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, flowDetail{Flow: flow, Events: events})
}

// selectCleanPointRequest starts a flow from a clean point.
type selectCleanPointRequest struct {
	CleanPointID string `json:"clean_point_id"`
	TargetLabel  string `json:"target_label"`
	TargetKind   string `json:"target_kind"`
}

func (h *Router) selectCleanPoint(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req selectCleanPointRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	cpID, err := uuid.Parse(req.CleanPointID)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "clean_point_id must be a valid uuid", nil)
		return
	}
	flow, err := h.svc.SelectCleanPoint(r.Context(), tenantID, h.actor(r), SelectCleanPointInput{
		CleanPointID: cpID,
		TargetLabel:  req.TargetLabel,
		TargetKind:   TargetKind(req.TargetKind),
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, flow)
}

func (h *Router) provision(w http.ResponseWriter, r *http.Request) {
	h.actOnFlow(w, r, func(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
		return h.svc.Provision(ctx, tenantID, flowID, actor)
	})
}

// runRecoveryRequest optionally links the composed runbook run that executed.
type runRecoveryRequest struct {
	RunbookRunID string `json:"runbook_run_id"`
}

func (h *Router) runRecovery(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	flowID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var req runRecoveryRequest
	// Body is optional; an empty body is a valid "no linked runbook" request.
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	flow, err := h.svc.RunRecovery(r.Context(), tenantID, flowID, h.actor(r), req.RunbookRunID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, flow)
}

func (h *Router) integrityCheck(w http.ResponseWriter, r *http.Request) {
	h.actOnFlow(w, r, func(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
		return h.svc.RunIntegrityCheck(ctx, tenantID, flowID, actor)
	})
}

func (h *Router) requestApproval(w http.ResponseWriter, r *http.Request) {
	h.actOnFlow(w, r, func(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
		return h.svc.RequestApproval(ctx, tenantID, flowID, actor)
	})
}

// approveRequest carries the approver's optional sign-off note.
type approveRequest struct {
	Note string `json:"note"`
}

func (h *Router) approve(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	flowID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var req approveRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	flow, err := h.svc.Approve(r.Context(), tenantID, flowID, h.actor(r), req.Note)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, flow)
}

func (h *Router) returnToProduction(w http.ResponseWriter, r *http.Request) {
	h.actOnFlow(w, r, func(ctx context.Context, tenantID, flowID uuid.UUID, actor Actor) (*Flow, error) {
		return h.svc.ReturnToProduction(ctx, tenantID, flowID, actor)
	})
}

// abortRequest carries the abort reason.
type abortRequest struct {
	Reason string `json:"reason"`
}

func (h *Router) abort(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	flowID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var req abortRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	flow, err := h.svc.Abort(r.Context(), tenantID, flowID, h.actor(r), req.Reason)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, flow)
}

// actOnFlow is the shared shell for the no-body flow actions: resolve tenant +
// flow id + actor, invoke the action, and map errors.
func (h *Router) actOnFlow(w http.ResponseWriter, r *http.Request, fn func(context.Context, uuid.UUID, uuid.UUID, Actor) (*Flow, error)) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	flowID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	flow, err := fn(r.Context(), tenantID, flowID, h.actor(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, flow)
}

// tenant resolves the tenant id or writes a 401 and returns ok=false.
func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

// actor builds the provenance actor from the authenticated request context.
func (h *Router) actor(r *http.Request) Actor {
	u := auth.UserFromContext(r.Context())
	if u == nil {
		return Actor{}
	}
	var id *uuid.UUID
	if parsed, err := uuid.Parse(u.ID); err == nil {
		id = &parsed
	}
	return Actor{ID: id, Email: u.Email}
}

// writeError maps cyberrecovery sentinel errors to HTTP statuses; an unexpected
// error is logged and returned as a generic 500 with no stack trace leaked.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrFlowNotFound), errors.Is(err, ErrCleanPointNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrCleanPointNotClean):
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "clean_point_not_clean", err.Error(), nil)
	case errors.Is(err, ErrIntegrityGateNotPassed):
		// The HARD gate refusal: 409 Conflict — the action is structurally blocked
		// until the mandatory integrity scan passes.
		suiteapi.WriteError(w, r, http.StatusConflict, "integrity_gate_not_passed", err.Error(), nil)
	case errors.Is(err, ErrApprovalRequired):
		suiteapi.WriteError(w, r, http.StatusConflict, "approval_required", err.Error(), nil)
	case errors.Is(err, ErrSelfApproval):
		suiteapi.WriteError(w, r, http.StatusForbidden, "self_approval_forbidden", err.Error(), nil)
	case errors.Is(err, ErrInvalidTransition):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_transition", err.Error(), nil)
	case errors.Is(err, ErrVersionConflict):
		suiteapi.WriteError(w, r, http.StatusConflict, "version_conflict", "the flow was modified concurrently; reload and retry", nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("cyber-recovery request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
