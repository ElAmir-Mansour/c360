package handler

import (
	"context"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/model"
)

// incidentService is the engine surface the incident handler drives. It mirrors
// the EngineService incident methods (GAP 4) so the handler can be unit-tested
// against a double.
type incidentService interface {
	ListIncidents(ctx context.Context, tenantID, instanceID string) ([]*model.Incident, error)
	GetOpenIncident(ctx context.Context, tenantID, instanceID string) (*model.Incident, error)
	RetryIncident(ctx context.Context, tenantID, instanceID, operatorID string) error
	SkipIncidentStep(ctx context.Context, tenantID, instanceID, operatorID, overrideID string) error
	ModifyVariablesAndRetryIncident(ctx context.Context, tenantID, instanceID, operatorID, overrideID string) error
	AbandonIncident(ctx context.Context, tenantID, instanceID, operatorID, reason string) error
	RequestOverride(ctx context.Context, tenantID, instanceID, requesterID, kind, reason string, newVars map[string]interface{}) (*model.IncidentOverride, error)
	ApproveOverride(ctx context.Context, tenantID, overrideID, approverID string) (*model.IncidentOverride, error)
	RejectOverride(ctx context.Context, tenantID, overrideID, rejecterID, reason string) error
	ListDeadLetters(ctx context.Context, tenantID string, limit int) ([]*model.DeadLetter, error)
}

// IncidentHandler exposes governed operator intervention on workflow incidents.
// All routes are gated by the workflow:incident RBAC verb (see incidentRBAC in
// cmd/workflow-engine/rbac.go).
type IncidentHandler struct {
	engine incidentService
	logger zerolog.Logger
}

// NewIncidentHandler creates a new IncidentHandler.
func NewIncidentHandler(engine incidentService, logger zerolog.Logger) *IncidentHandler {
	return &IncidentHandler{
		engine: engine,
		logger: logger.With().Str("handler", "workflow_incident").Logger(),
	}
}

// Routes mounts the incident + override + dead-letter routes.
//
//	GET  /instances/{id}                       -> list incidents for an instance
//	GET  /instances/{id}/open                  -> current open incident
//	POST /instances/{id}/retry                 -> operator retry (no override)
//	POST /instances/{id}/skip                  -> operator skip (needs approved override)
//	POST /instances/{id}/modify-retry          -> modify-vars retry (needs approved override)
//	POST /instances/{id}/abandon               -> dead-letter + fail instance
//	POST /instances/{id}/overrides             -> request a maker-checker override
//	POST /overrides/{overrideId}/approve       -> distinct checker approves
//	POST /overrides/{overrideId}/reject        -> checker rejects
//	GET  /dead-letter                          -> list dead-letter rows
func (h *IncidentHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/instances/{id}", h.List)
	r.Get("/instances/{id}/open", h.GetOpen)
	r.Post("/instances/{id}/retry", h.Retry)
	r.Post("/instances/{id}/skip", h.Skip)
	r.Post("/instances/{id}/modify-retry", h.ModifyRetry)
	r.Post("/instances/{id}/abandon", h.Abandon)
	r.Post("/instances/{id}/overrides", h.RequestOverride)

	r.Post("/overrides/{overrideId}/approve", h.ApproveOverride)
	r.Post("/overrides/{overrideId}/reject", h.RejectOverride)

	r.Get("/dead-letter", h.ListDeadLetter)

	return r
}

// List handles GET /instances/{id} — lists incidents for an instance.
func (h *IncidentHandler) List(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "instance id is required")
		return
	}
	incidents, err := h.engine.ListIncidents(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": incidents})
}

// GetOpen handles GET /instances/{id}/open — returns the current open incident.
func (h *IncidentHandler) GetOpen(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	inc, err := h.engine.GetOpenIncident(r.Context(), user.TenantID, id)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, inc)
}

// Retry handles POST /instances/{id}/retry — re-runs the failed step (no override).
func (h *IncidentHandler) Retry(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	if err := h.engine.RetryIncident(r.Context(), user.TenantID, id, user.ID); err != nil {
		h.logger.Error().Err(err).Str("instance_id", id).Msg("incident retry failed")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "incident retry initiated"})
}

// Skip handles POST /instances/{id}/skip — marks the step done + advances. Body
// must carry override_id (an APPROVED maker-checker override for this incident).
func (h *IncidentHandler) Skip(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	var req struct {
		OverrideID string `json:"override_id"`
	}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := h.engine.SkipIncidentStep(r.Context(), user.TenantID, id, user.ID, req.OverrideID); err != nil {
		h.logger.Warn().Err(err).Str("instance_id", id).Msg("incident skip rejected")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "incident step skipped"})
}

// ModifyRetry handles POST /instances/{id}/modify-retry — applies the approved
// variable change then re-runs the step. Body must carry override_id.
func (h *IncidentHandler) ModifyRetry(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	var req struct {
		OverrideID string `json:"override_id"`
	}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := h.engine.ModifyVariablesAndRetryIncident(r.Context(), user.TenantID, id, user.ID, req.OverrideID); err != nil {
		h.logger.Warn().Err(err).Str("instance_id", id).Msg("incident modify-retry rejected")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "variables modified, incident step retried"})
}

// Abandon handles POST /instances/{id}/abandon — dead-letters the incident.
func (h *IncidentHandler) Abandon(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	var req struct {
		Reason string `json:"reason"`
	}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := h.engine.AbandonIncident(r.Context(), user.TenantID, id, user.ID, req.Reason); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "incident abandoned and dead-lettered"})
}

// RequestOverride handles POST /instances/{id}/overrides — a MAKER requests a
// sensitive override (skip / modify_variables_retry).
func (h *IncidentHandler) RequestOverride(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	id := urlParam(r, "id")
	var req struct {
		Kind         string                 `json:"kind"`
		Reason       string                 `json:"reason"`
		NewVariables map[string]interface{} `json:"new_variables"`
	}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if !model.RequiresMakerChecker(req.Kind) {
		writeError(w, http.StatusBadRequest, "INVALID_KIND", "kind must be 'skip' or 'modify_variables_retry'")
		return
	}
	ov, err := h.engine.RequestOverride(r.Context(), user.TenantID, id, user.ID, req.Kind, req.Reason, req.NewVariables)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ov)
}

// ApproveOverride handles POST /overrides/{overrideId}/approve — a DISTINCT
// checker approves. Fail-closed if the checker is the maker (SoD).
func (h *IncidentHandler) ApproveOverride(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	overrideID := urlParam(r, "overrideId")
	ov, err := h.engine.ApproveOverride(r.Context(), user.TenantID, overrideID, user.ID)
	if err != nil {
		h.logger.Warn().Err(err).Str("override_id", overrideID).Str("approver", user.ID).Msg("override approval failed")
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ov)
}

// RejectOverride handles POST /overrides/{overrideId}/reject.
func (h *IncidentHandler) RejectOverride(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	overrideID := urlParam(r, "overrideId")
	var req struct {
		Reason string `json:"reason"`
	}
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error())
		return
	}
	if err := h.engine.RejectOverride(r.Context(), user.TenantID, overrideID, user.ID, req.Reason); err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "override rejected"})
}

// ListDeadLetter handles GET /dead-letter.
func (h *IncidentHandler) ListDeadLetter(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	_, pageSize := parsePagination(r)
	items, err := h.engine.ListDeadLetters(r.Context(), user.TenantID, pageSize)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": items})
}
