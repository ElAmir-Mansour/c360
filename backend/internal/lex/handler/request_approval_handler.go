package handler

import (
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// RequestApprovalHandler exposes the two-stage requester→provider approval
// surface for a legal request (CAP-030, CAP-031). It is a thin transport shell
// over RequestApprovalService: it resolves tenant/user from the request context,
// decodes the payload, and delegates to the service. Route wiring (permission
// tiers, paths) is owned by the integrator in handler/routes.go.
type RequestApprovalHandler struct {
	baseHandler
	service *service.RequestApprovalService
}

func NewRequestApprovalHandler(service *service.RequestApprovalService, logger zerolog.Logger) *RequestApprovalHandler {
	return &RequestApprovalHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// StartApproval opens the approval pipeline for a submitted legal request.
// POST /requests/{id}/approval/start
func (h *RequestApprovalHandler) StartApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.StartApproval(r.Context(), tenantID, userID, requestID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// DecideTask records one approver decision on a request's approval task.
// POST /requests/{id}/approval/{workflowInstanceID}/tasks/{taskID}/decision
func (h *RequestApprovalHandler) DecideTask(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	workflowInstanceID, err := suiteapi.UUIDParam(r, "workflowInstanceID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	taskID, err := suiteapi.UUIDParam(r, "taskID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.WorkflowDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	outcome, err := h.service.DecideTask(r.Context(), tenantID, userID, requestID, workflowInstanceID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

// ListTasks returns the open approver tasks for a request's current workflow.
// GET /requests/{id}/approval/tasks
func (h *RequestApprovalHandler) ListTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	tasks, err := h.service.ListTasks(r.Context(), tenantID, userID, requestID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, tasks)
}

// Get returns the current request row (with its workflow link + status).
// GET /requests/{id}/approval
func (h *RequestApprovalHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, requestID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}
