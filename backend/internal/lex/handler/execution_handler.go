package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// ExecutionHandler exposes the Execution-Rules engine (CAP-022..029): the
// per-request requirement checklist, provider completeness confirmation (which
// STARTS the execution clock), return-incomplete review rounds, the
// delivery-confirmation handshake, and the execution-state read model. Routes are
// wired by the integrator in routes.go.
type ExecutionHandler struct {
	baseHandler
	execution  *service.ExecutionRuleService
	deliveries *service.DeliveryConfirmationService
}

func NewExecutionHandler(execution *service.ExecutionRuleService, deliveries *service.DeliveryConfirmationService, logger zerolog.Logger) *ExecutionHandler {
	return &ExecutionHandler{
		baseHandler: baseHandler{logger: logger},
		execution:   execution,
		deliveries:  deliveries,
	}
}

// GetState returns the aggregate execution-state read model for a request.
func (h *ExecutionHandler) GetState(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	view, err := h.execution.GetState(r.Context(), tenantID, requestID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	for i := range view.DeliveryConfirmations {
		redactDeliveryLateJustification(&view.DeliveryConfirmations[i], rolesFromContext(r))
	}
	suiteapi.WriteData(w, http.StatusOK, view)
}

// AddRequirement adds a required attachment/data item to the request checklist.
func (h *ExecutionHandler) AddRequirement(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateRequirementItemRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.execution.AddRequirement(r.Context(), tenantID, userID, requestID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// UpdateRequirement patches a requirement item and/or marks it satisfied.
func (h *ExecutionHandler) UpdateRequirement(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	itemID, err := suiteapi.UUIDParam(r, "itemId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateRequirementItemRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	canManage := auth.HasPermissionForTenant(
		r.Context(), tenantID.String(), rolesFromContext(r), auth.PermLexWrite,
	)
	item, err := h.execution.UpdateRequirement(
		r.Context(), tenantID, userID, requestID, itemID, req, canManage,
	)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// DeleteRequirement removes a requirement item from the request checklist.
func (h *ExecutionHandler) DeleteRequirement(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	itemID, err := suiteapi.UUIDParam(r, "itemId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.execution.DeleteRequirement(r.Context(), tenantID, requestID, itemID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ConfirmCompleteness is the provider's confirmation that the request is COMPLETE
// — this STARTS the execution clock (CAP-022/CAP-023).
func (h *ExecutionHandler) ConfirmCompleteness(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ConfirmCompletenessRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		req = dto.ConfirmCompletenessRequest{}
	}
	state, err := h.execution.ConfirmCompleteness(r.Context(), tenantID, userID, requestID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

// ReturnIncomplete returns the request to the requester as incomplete (CAP-025);
// the second return auto-closes + clones (CAP-026).
func (h *ExecutionHandler) ReturnIncomplete(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ReturnIncompleteRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	state, err := h.execution.ReturnIncomplete(r.Context(), tenantID, userID, requestID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, state)
}

// RequestDeliveryConfirmation opens the post-delivery confirmation handshake
// (CAP-027) with a working-calendar auto-close deadline (CAP-028).
func (h *ExecutionHandler) RequestDeliveryConfirmation(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RequestDeliveryConfirmationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		req = dto.RequestDeliveryConfirmationRequest{}
	}
	dc, err := h.deliveries.Request(r.Context(), tenantID, userID, requestID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactDeliveryLateJustification(dc, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusCreated, dc)
}

// RespondDeliveryConfirmation records the requester's confirm/deny decision
// (CAP-027).
func (h *ExecutionHandler) RespondDeliveryConfirmation(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	confirmationID, err := suiteapi.UUIDParam(r, "confirmationId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RespondDeliveryConfirmationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	dc, err := h.deliveries.Respond(r.Context(), tenantID, userID, requestID, confirmationID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactDeliveryLateJustification(dc, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, dc)
}

// AchieveDeliveryConfirmation marks a contract associate's legal work achieved
// without closing the request. Router-level contract:edit authorization and
// service-level requester separation of duties both apply; the requester owns
// the later final-note and close action.
func (h *ExecutionHandler) AchieveDeliveryConfirmation(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	confirmationID, err := suiteapi.UUIDParam(r, "confirmationId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	dc, err := h.deliveries.Achieve(r.Context(), tenantID, userID, requestID, confirmationID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactDeliveryLateJustification(dc, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, dc)
}
