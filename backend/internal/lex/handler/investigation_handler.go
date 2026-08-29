package handler

import (
	"context"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var investigationSortColumns = map[string]string{
	"investigation_number": "li.investigation_number",
	"status":               "li.status",
	"priority":             "li.priority",
	"updated_at":           "li.updated_at",
	"created_at":           "li.created_at",
}

// InvestigationHandler exposes the legal-investigations vertical (CAP-077..083):
// register/CRUD, parties, statements, evidence, results, recommendations and the
// results-approval chain. Mirrors MatterHandler / LegalCaseHandler conventions.
type InvestigationHandler struct {
	baseHandler
	service *service.InvestigationService
}

func NewInvestigationHandler(service *service.InvestigationService, logger zerolog.Logger) *InvestigationHandler {
	return &InvestigationHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// --- CAP-077: register / CRUD ------------------------------------------------

func (h *InvestigationHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateInvestigationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Create(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactInvestigationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *InvestigationHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseInvestigationListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	for i := range items {
		redactInvestigationLateJustification(&items[i], rolesFromContext(r))
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *InvestigationHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactInvestigationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *InvestigationHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateInvestigationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Update(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactInvestigationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *InvestigationHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateInvestigationStatusRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	// FSM-status-route bypass guard (design v2 §4.4): a close-class target
	// (closed / cancelled) is re-gated on lex:investigation:close and an
	// approve/decision-class target (approved / rejected) on lex:investigation:approve,
	// each with NO coarse lex:write/edit fallback, plus the dynamic-SoD (author !=
	// actor) parity check — so an edit-tier / lex:write holder cannot close or decide
	// an investigation via /status.
	if !enforceStatusElevation(w, r, investigationStatusElevation, string(req.Status), h.investigationAuthorLookup) {
		return
	}
	item, err := h.service.UpdateStatus(r.Context(), tenantID, userID, id, req.Status, req.Reason, req.LateJustification)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactInvestigationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ScheduleDeadlineReminder exposes the obligation-backed reminder facility that
// was previously only callable in-process.
func (h *InvestigationHandler) ScheduleDeadlineReminder(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ScheduleInvestigationReminderRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	item, err := h.service.ScheduleDeadlineReminder(r.Context(), tenantID, userID, id, req.Deadline, req.LeadDays, req.Title)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// investigationAuthorLookup resolves an investigation's author for the dynamic-SoD
// parity check on a close/approve-class /status transition (design v2 §4.2). A
// not-found / nil author yields (uuid.Nil, false, nil) so the guard fails CLOSED.
func (h *InvestigationHandler) investigationAuthorLookup(ctx context.Context, tenantID, recordID uuid.UUID) (uuid.UUID, bool, error) {
	rec, err := h.service.Get(ctx, tenantID, recordID)
	if err != nil {
		if apperrors.IsNotFound(err) {
			return uuid.Nil, false, nil
		}
		return uuid.Nil, false, err
	}
	if rec == nil {
		return uuid.Nil, false, nil
	}
	return rec.CreatedBy, true, nil
}

func (h *InvestigationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.Delete(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- CAP-078: parties --------------------------------------------------------

func (h *InvestigationHandler) AddParty(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.AddInvestigationPartyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.AddParty(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *InvestigationHandler) UpdateParty(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	partyID, err := suiteapi.UUIDParam(r, "partyId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateInvestigationPartyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateParty(r.Context(), tenantID, userID, id, partyID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *InvestigationHandler) DeleteParty(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	partyID, err := suiteapi.UUIDParam(r, "partyId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteParty(r.Context(), tenantID, userID, id, partyID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- CAP-079: statements / testimonies --------------------------------------

func (h *InvestigationHandler) RecordStatement(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RecordInvestigationStatementRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.RecordStatement(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *InvestigationHandler) DeleteStatement(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	statementID, err := suiteapi.UUIDParam(r, "statementId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteStatement(r.Context(), tenantID, userID, id, statementID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- CAP-080: evidence upload ------------------------------------------------

func (h *InvestigationHandler) UploadEvidence(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UploadInvestigationEvidenceRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UploadEvidence(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *InvestigationHandler) DeleteEvidence(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	evidenceID, err := suiteapi.UUIDParam(r, "evidenceId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteEvidence(r.Context(), tenantID, userID, id, evidenceID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- CAP-081: results / findings --------------------------------------------

func (h *InvestigationHandler) RecordResults(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RecordInvestigationResultsRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.RecordResults(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactInvestigationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// --- CAP-082: final recommendations -----------------------------------------

func (h *InvestigationHandler) RecordRecommendations(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RecordInvestigationRecommendationsRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.RecordRecommendations(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactInvestigationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// --- CAP-083: approve results -----------------------------------------------

func (h *InvestigationHandler) StartApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.StartInvestigationApprovalRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.StartApproval(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactInvestigationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *InvestigationHandler) DecideApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	workflowInstanceID, err := suiteapi.UUIDParam(r, "workflowInstanceId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	taskID, err := suiteapi.UUIDParam(r, "taskId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.WorkflowDecisionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	outcome, err := h.service.DecideApproval(r.Context(), tenantID, userID, id, workflowInstanceID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

func (h *InvestigationHandler) ListApprovalTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	tasks, err := h.service.ListApprovalTasks(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, tasks)
}

// --- governance audit --------------------------------------------------------

func (h *InvestigationHandler) ListAudit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	entries, err := h.service.ListAudit(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, entries)
}

func parseInvestigationListFilters(r *http.Request) (model.InvestigationListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, investigationSortColumns, "updated_at", "desc")
	caseID, err := parseOptionalUUID(r.URL.Query().Get("case_id"))
	if err != nil {
		return model.InvestigationListFilters{}, err
	}
	filters := model.InvestigationListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		CaseID:        caseID,
		Department:    strings.TrimSpace(r.URL.Query().Get("department")),
		CaseType:      strings.TrimSpace(r.URL.Query().Get("case_type")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		parts := strings.Split(status, ",")
		if len(parts) == 1 {
			value := model.InvestigationStatus(status)
			filters.Status = &value
		} else {
			for _, part := range parts {
				if value := strings.TrimSpace(part); value != "" {
					filters.Statuses = append(filters.Statuses, model.InvestigationStatus(value))
				}
			}
		}
	}
	if priority := strings.TrimSpace(r.URL.Query().Get("priority")); priority != "" {
		value := model.LegalPriority(priority)
		filters.Priority = &value
	}
	return filters, nil
}
