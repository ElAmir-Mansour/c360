package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/suiteapi"
)

// automationRequest is the create/update body for an automation. It carries the
// author-supplied fields only; id/tenant/timestamps are server-assigned. The
// shape mirrors model.Automation so a client round-trips a GET response back into
// a PUT with minimal reshaping.
type automationRequest struct {
	Name      string              `json:"name"`
	Enabled   bool                `json:"enabled"`
	Trigger   model.TriggerConfig `json:"trigger"`
	Rules     []model.Rule        `json:"rules,omitempty"`
	RunbookID string              `json:"runbook_id"`
}

// toModel converts the request into a domain automation; createdBy is the
// authenticated user (recorded on create, ignored on update).
func (req automationRequest) toModel(createdBy string) *model.Automation {
	return &model.Automation{
		Name:      req.Name,
		Enabled:   req.Enabled,
		Trigger:   req.Trigger,
		Rules:     req.Rules,
		RunbookID: req.RunbookID,
		CreatedBy: createdBy,
	}
}

// CreateAutomation handles POST /automations (automation:write).
func (h *Handler) CreateAutomation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	var req automationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	created, err := h.svc.CreateAutomation(r.Context(), tenantID, req.toModel(userID))
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, created)
}

// ListAutomations handles GET /automations (automation:read).
func (h *Handler) ListAutomations(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	items, err := h.svc.ListAutomations(r.Context(), tenantID)
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, orEmptyAutomations(items))
}

// GetAutomation handles GET /automations/{id} (automation:read).
func (h *Handler) GetAutomation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing automation id", nil)
		return
	}
	a, err := h.svc.GetAutomationByID(r.Context(), tenantID, id)
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, a)
}

// UpdateAutomation handles PUT /automations/{id} (automation:write).
func (h *Handler) UpdateAutomation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing automation id", nil)
		return
	}
	var req automationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	updated, err := h.svc.UpdateAutomation(r.Context(), tenantID, id, req.toModel(""))
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, updated)
}

// DeleteAutomation handles DELETE /automations/{id} (automation:write).
func (h *Handler) DeleteAutomation(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing automation id", nil)
		return
	}
	if err := h.svc.DeleteAutomation(r.Context(), tenantID, id); err != nil {
		h.writeErr(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// invokeRequest is the optional body for a manual invocation: the trigger data
// passed verbatim to the run as its recorded payload. Any JSON object is accepted.
type invokeRequest struct {
	Data map[string]any `json:"data,omitempty"`
}

// InvokeAutomation handles POST /automations/{id}/invoke (automation:write): a
// manual trigger fired through the ManualSource so it flows through the same
// exactly-once dispatcher → rule engine → run-creation path as every other
// trigger. Returns 202 Accepted (the run is created asynchronously by the
// dispatcher; the leader driver then advances it).
func (h *Handler) InvokeAutomation(w http.ResponseWriter, r *http.Request) {
	if h.invoker == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "UNAVAILABLE", "manual invocation is not enabled", nil)
		return
	}
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	userID, ok := h.userID(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing automation id", nil)
		return
	}
	// The body is optional; an empty/absent body is a no-data manual trigger.
	var req invokeRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	if err := h.invoker.Invoke(r.Context(), tenantID, id, userID, req.Data); err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, map[string]any{"accepted": true, "automation_id": id})
}

func orEmptyAutomations(in []*model.Automation) []*model.Automation {
	if in == nil {
		return []*model.Automation{}
	}
	return in
}
