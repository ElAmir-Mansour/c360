package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/suiteapi"
)

// runbookRequest is the create body for a runbook: a name and an ordered list of
// steps. Step indices are server-assigned from list position (the repository sets
// Index = i), so a client need not number them.
type runbookRequest struct {
	Name  string              `json:"name"`
	Steps []model.RunbookStep `json:"steps"`
}

// CreateRunbook handles POST /runbooks (automation:write).
func (h *Handler) CreateRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req runbookRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	created, err := h.svc.CreateRunbook(r.Context(), tenantID, &model.Runbook{Name: req.Name, Steps: req.Steps})
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, created)
}

// GetRunbook handles GET /runbooks/{id} (automation:read): the runbook header
// plus its ordered steps.
func (h *Handler) GetRunbook(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing runbook id", nil)
		return
	}
	rb, err := h.svc.GetRunbookByID(r.Context(), tenantID, id)
	if err != nil {
		h.writeErr(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, rb)
}

// Webhook handles POST /webhooks/{token} — the inbound webhook trigger. This
// route is mounted OUTSIDE the JWT/RBAC group: the path token is the credential,
// resolved cross-tenant by the WebhookSource. There is NO Auth/Tenant middleware
// and NO permission gate. The WebhookSource writes the response itself (202 on
// accept, 404 for an unknown token, 400 for a bad body).
func (h *Handler) Webhook(w http.ResponseWriter, r *http.Request) {
	if h.webhook == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "UNAVAILABLE", "inbound webhooks are not enabled", nil)
		return
	}
	token := chi.URLParam(r, "token")
	if token == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "missing webhook token", nil)
		return
	}
	h.webhook.HandleToken(w, r, token)
}
