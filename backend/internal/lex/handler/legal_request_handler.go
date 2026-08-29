package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var legalRequestSortColumns = map[string]string{
	"request_number": "lr.request_number",
	"status":         "lr.status",
	"priority":       "lr.priority",
	"request_type":   "lr.request_type",
	"updated_at":     "lr.updated_at",
	"created_at":     "lr.created_at",
}

// LegalRequestHandler exposes the canonical request spine (CAP-009): CRUD,
// submit, FSM transition, and the audited priority reclassification + history
// (CAP-010/CAP-011). Routes are wired by the integrator in routes.go.
type LegalRequestHandler struct {
	baseHandler
	service *service.LegalRequestService
}

func NewLegalRequestHandler(service *service.LegalRequestService, logger zerolog.Logger) *LegalRequestHandler {
	return &LegalRequestHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *LegalRequestHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateLegalRequestRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Create(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LegalRequestHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contextUser := auth.UserFromContext(r.Context())
	roles := []string(nil)
	if contextUser != nil && contextUser.ID == userID.String() {
		roles = contextUser.Roles
	}
	filters, err := parseLegalRequestListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var (
		items []model.LegalRequest
		total int
	)
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("approval_mine")), "true") {
		items, total, err = h.service.ListForApprovalActor(r.Context(), tenantID, userID, roles, filters)
	} else {
		items, total, err = h.service.ListForActor(r.Context(), tenantID, userID, roles, filters)
	}
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *LegalRequestHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contextUser := auth.UserFromContext(r.Context())
	roles := []string(nil)
	if contextUser != nil && contextUser.ID == userID.String() {
		roles = contextUser.Roles
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetForActor(r.Context(), tenantID, userID, roles, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalRequestHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateLegalRequestRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Update(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Revise applies a substantive edit to an in-execution request and runs the
// CAP-024 substantial-edit re-evaluation; the response carries the edited
// request plus the change decision (whether it was substantial and why).
func (h *LegalRequestHandler) Revise(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateLegalRequestRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, decision, err := h.service.Revise(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"request": item, "change": decision})
}

// Route advances an approved request to routed and auto-spawns the downstream
// subject (litigation case / consultation). Normally fired automatically on
// approval completion or no-approval submit; this endpoint is the explicit /
// retry entrypoint. Idempotent: a request already routed returns its current row.
func (h *LegalRequestHandler) Route(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Route(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalRequestHandler) Submit(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SubmitLegalRequestRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		// Submit body is optional; tolerate an empty/absent payload.
		req = dto.SubmitLegalRequestRequest{}
	}
	item, err := h.service.Submit(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalRequestHandler) ReclassifyPriority(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ReclassifyPriorityRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.ReclassifyPriority(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalRequestHandler) PriorityHistory(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.PriorityHistory(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// GetFeedback returns the request's real satisfaction response or JSON null
// when no response has been submitted.
func (h *LegalRequestHandler) GetFeedback(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	feedback, err := h.service.GetFeedback(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, feedback)
}

// SubmitFeedback appends the requester's one-time 1..5 response.
func (h *LegalRequestHandler) SubmitFeedback(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SubmitLegalRequestFeedbackRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	feedback, err := h.service.SubmitFeedback(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, feedback)
}

// Audit returns the append-only spine governance trail for a request, newest-first,
// for the read-only activity timeline (feature #8).
func (h *LegalRequestHandler) Audit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	entries, err := h.service.RequestAudit(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, entries)
}

func (h *LegalRequestHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.Delete(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseLegalRequestListFilters(r *http.Request) (model.LegalRequestListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, legalRequestSortColumns, "updated_at", "desc")
	requesterUserID, err := parseOptionalUUID(r.URL.Query().Get("requester_user_id"))
	if err != nil {
		return model.LegalRequestListFilters{}, fmt.Errorf("invalid requester_user_id")
	}
	beneficiaryEntityID, err := parseOptionalUUID(r.URL.Query().Get("beneficiary_entity_id"))
	if err != nil {
		return model.LegalRequestListFilters{}, fmt.Errorf("invalid beneficiary_entity_id")
	}
	serviceID, err := parseOptionalUUID(r.URL.Query().Get("service_id"))
	if err != nil {
		return model.LegalRequestListFilters{}, fmt.Errorf("invalid service_id")
	}
	updatedFrom, err := parseOptionalDate(r.URL.Query().Get("updated_from"))
	if err != nil {
		return model.LegalRequestListFilters{}, fmt.Errorf("invalid updated_from")
	}
	updatedTo, err := parseOptionalDate(r.URL.Query().Get("updated_to"))
	if err != nil {
		return model.LegalRequestListFilters{}, fmt.Errorf("invalid updated_to")
	}
	filters := model.LegalRequestListFilters{
		Page:                page,
		PerPage:             perPage,
		Search:              strings.TrimSpace(r.URL.Query().Get("search")),
		RequestType:         strings.TrimSpace(r.URL.Query().Get("request_type")),
		RequesterUserID:     requesterUserID,
		BeneficiaryEntityID: beneficiaryEntityID,
		ServiceID:           serviceID,
		Department:          strings.TrimSpace(r.URL.Query().Get("department")),
		SubjectType:         strings.TrimSpace(r.URL.Query().Get("subject_type")),
		SortColumn:          sortCol,
		SortDirection:       sortDir,
		UpdatedFrom:         updatedFrom,
		UpdatedTo:           updatedTo,
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		parts := strings.Split(status, ",")
		if len(parts) == 1 {
			value := model.RequestStatus(status)
			filters.Status = &value
		} else {
			for _, part := range parts {
				if value := strings.TrimSpace(part); value != "" {
					filters.Statuses = append(filters.Statuses, model.RequestStatus(value))
				}
			}
		}
	}
	if priority := strings.TrimSpace(r.URL.Query().Get("priority")); priority != "" {
		value := model.RequestPriority(priority)
		filters.Priority = &value
	}
	return filters, nil
}
