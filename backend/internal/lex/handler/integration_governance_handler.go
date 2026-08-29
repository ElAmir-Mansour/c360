package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// IntegrationGovernanceHandler exposes the integration GOVERNANCE surfaces over the
// registry service:
//   - #13 maker-checker: the pending-changes list, propose-change (protected ->
//     parked pending change; else applied immediately), approve, reject.
//   - #15 data residency / field egress: get + put the egress policy.
//
// Reads gate read tier (lex:integration:read OR coarse lex:read/write); proposing,
// approving, rejecting and updating the egress policy gate manage. It mirrors
// IntegrationResilienceHandler's shape: a thin handler over
// service.IntegrationRegistryService that resolves tenant/user from context and writes
// secret-free DTOs. A pending change's diff is already secret-masked at write time, so
// nothing here can leak a secret.
type IntegrationGovernanceHandler struct {
	baseHandler
	service *service.IntegrationRegistryService
}

// NewIntegrationGovernanceHandler wires the registry service (which owns the change
// gate + egress enforcer via WithChangeGate / WithEgress).
func NewIntegrationGovernanceHandler(svc *service.IntegrationRegistryService, logger zerolog.Logger) *IntegrationGovernanceHandler {
	return &IntegrationGovernanceHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// PendingChanges lists the tenant's pending integration config changes
// (GET /integrations/pending-changes?status=&limit=). Read tier.
func (h *IntegrationGovernanceHandler) PendingChanges(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	items, err := h.service.ListPendingChanges(
		r.Context(), tenantID,
		strings.TrimSpace(r.URL.Query().Get("status")),
		govLimit(r),
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// ProposeChange submits a proposed config for an endpoint
// (POST /integrations/{id}/changes, body = proposed config map). For a PROTECTED
// endpoint it returns a parked PendingChange (201, status=pending, applied=false);
// for a non-protected endpoint it applies immediately and returns the endpoint (200).
// Manage tier.
func (h *IntegrationGovernanceHandler) ProposeChange(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var proposed map[string]any
	if err := suiteapi.DecodeJSON(r, &proposed); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.ProposeChange(r.Context(), tenantID, userID, id, proposed)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	// A parked pending change is 201 Created; an immediate apply returns the endpoint
	// at 200 OK.
	if result.Change != nil {
		suiteapi.WriteData(w, http.StatusCreated, result.Change)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result.Endpoint)
}

// ApproveChange approves + applies a pending change
// (POST /integrations/changes/{changeId}/approve, body {note?}). Returns the applied
// endpoint. Manage tier; SoD enforced where configured.
func (h *IntegrationGovernanceHandler) ApproveChange(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	changeID, err := suiteapi.UUIDParam(r, "changeId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	note := decodeNote(r)
	endpoint, err := h.service.ApprovePendingChange(r.Context(), tenantID, userID, changeID, note)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, endpoint)
}

// RejectChange rejects a pending change
// (POST /integrations/changes/{changeId}/reject, body {note}). Returns the rejected
// PendingChange. Manage tier; note required.
func (h *IntegrationGovernanceHandler) RejectChange(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	changeID, err := suiteapi.UUIDParam(r, "changeId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	note := decodeNote(r)
	change, err := h.service.RejectPendingChange(r.Context(), tenantID, userID, changeID, note)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, change)
}

// EgressPolicyGet returns the endpoint's data-residency / field-egress policy
// (GET /integrations/{id}/egress-policy). Read tier.
func (h *IntegrationGovernanceHandler) EgressPolicyGet(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	policy, err := h.service.GetEgressPolicy(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, policy)
}

// EgressPolicyPut replaces the endpoint's data-residency / field-egress policy
// (PUT /integrations/{id}/egress-policy, body {allowed_regions,allowed_egress_fields}).
// Returns the updated policy. Manage tier.
func (h *IntegrationGovernanceHandler) EgressPolicyPut(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req struct {
		AllowedRegions      []string `json:"allowed_regions"`
		AllowedEgressFields []string `json:"allowed_egress_fields"`
	}
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	policy, err := h.service.UpdateEgressPolicy(r.Context(), tenantID, userID, id, req.AllowedRegions, req.AllowedEgressFields)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, policy)
}

// decodeNote reads the optional {note} body field. A missing/invalid body yields "".
func decodeNote(r *http.Request) string {
	var body struct {
		Note string `json:"note"`
	}
	_ = suiteapi.DecodeJSON(r, &body)
	return strings.TrimSpace(body.Note)
}

// govLimit reads the optional ?limit= query param (defaulted by the service).
func govLimit(r *http.Request) int {
	if v := strings.TrimSpace(r.URL.Query().Get("limit")); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0
}
