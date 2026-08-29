package handler

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var legalCaseSortColumns = map[string]string{
	"case_number":              "lc.case_number",
	"status":                   "lc.status",
	"priority":                 "lc.priority",
	"case_type":                "lc.case_type",
	"company_status":           "lc.company_status",
	"expected_resolution_date": "lc.expected_resolution_date",
	"updated_at":               "lc.updated_at",
	"created_at":               "lc.created_at",
}

// LegalCaseHandler is the transport shell over the litigation-case aggregate
// (CAP-032..051): case CRUD, the management actions, the two-phase intake
// transitions and the parties/hearings/tasks sub-resources. Route wiring
// (permission tiers, paths) is owned by the integrator in handler/routes.go.
type LegalCaseHandler struct {
	baseHandler
	cases  *service.LegalCaseService
	intake *service.LegalCaseIntakeService
}

func NewLegalCaseHandler(cases *service.LegalCaseService, intake *service.LegalCaseIntakeService, logger zerolog.Logger) *LegalCaseHandler {
	return &LegalCaseHandler{baseHandler: baseHandler{logger: logger}, cases: cases, intake: intake}
}

// --- case CRUD --------------------------------------------------------------

func (h *LegalCaseHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateLegalCaseRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	// Interactive/API creation always enters the governed intake pipeline. Later
	// states and team assignments must use the audited intake, handoff, status,
	// and assignment endpoints (with their stronger permission/SoD gates).
	req.Status = model.CaseStatusIntake
	req.SectionManagerID = nil
	req.SupervisorID = nil
	req.HandlingOfficerID = nil
	req.ResponsibleLawyer = nil
	item, err := h.cases.Create(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LegalCaseHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseLegalCaseListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.cases.ListWithSummary(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	for i := range items {
		redactLegalCaseLateJustification(&items[i].LegalCase, rolesFromContext(r))
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *LegalCaseHandler) Get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.cases.GetWithComputed(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item.LegalCase, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateLegalCaseRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.Update(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.cases.Delete(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- management actions -----------------------------------------------------

func (h *LegalCaseHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateCaseStatusRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	// FSM-status-route bypass guard (design v2 §4.4): when this transition targets a
	// close-class terminal state (closed / cancelled) it is re-gated on lex:case:close
	// with NO coarse lex:write/edit fallback, plus the dynamic-SoD (author != actor)
	// parity check — so an edit-tier / lex:write holder cannot close a case via /status.
	if !enforceStatusElevation(w, r, caseStatusElevation, string(req.Status), h.caseAuthorLookup) {
		return
	}
	item, err := h.cases.UpdateStatus(r.Context(), tenantID, userID, id, req.Status, req.Reason, req.Category, req.LateJustification)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// caseAuthorLookup resolves a case's author for the dynamic-SoD parity check on a
// close/approve-class /status transition (design v2 §4.2). A not-found / nil
// author yields (uuid.Nil, false, nil) so the guard fails CLOSED.
func (h *LegalCaseHandler) caseAuthorLookup(ctx context.Context, tenantID, recordID uuid.UUID) (uuid.UUID, bool, error) {
	rec, err := h.cases.Get(ctx, tenantID, recordID)
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

func (h *LegalCaseHandler) SetStrength(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SetCaseStrengthRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.SetStrength(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) SetRiskRating(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SetCaseRiskRatingRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.SetRiskRating(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) SetPriority(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SetCasePriorityRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.SetPriority(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) TransferToSectionManager(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.TransferToSectionManagerRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.TransferToSectionManager(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) AssignSupervisor(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.AssignSupervisorRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.AssignSupervisor(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) AssignOfficer(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.AssignOfficerRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.AssignOfficer(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactLegalCaseLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// --- governance audit + version ---------------------------------------------

func (h *LegalCaseHandler) ListAudit(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	entries, err := h.cases.ListAudit(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, entries)
}

func (h *LegalCaseHandler) ListVersions(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	versions, err := h.cases.ListVersions(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, versions)
}

// --- intake (two-phase) -----------------------------------------------------

// ListIntakeTasks returns the current actor's pending/current case-directive
// approval queue from the Lex database. It intentionally does not proxy the
// independently deployed workflow-engine task API: case intake workflows and
// their task rows are owned by lex_db.
func (h *LegalCaseHandler) ListIntakeTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	roles := []string(nil)
	if user := auth.UserFromContext(r.Context()); user != nil {
		roles = user.Roles
	} else if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		roles = claims.Roles
	}
	page, perPage := suiteapi.ParsePagination(r)
	if perPage > 100 {
		perPage = 100
	}
	items, total, err := h.intake.ListCurrentTasks(r.Context(), tenantID, userID, roles, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

func (h *LegalCaseHandler) GetIntake(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.intake.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) StartIntake(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.StartCaseIntakeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.intake.StartPhase1(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) DecideIntake(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
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
	outcome, err := h.intake.Decide(r.Context(), tenantID, userID, id, workflowInstanceID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

func (h *LegalCaseHandler) CompleteIntakeHandoff(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.HandoffCaseIntakeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.intake.CompletePhase2(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// --- parties ----------------------------------------------------------------

func (h *LegalCaseHandler) AddParty(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateCasePartyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.AddParty(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// BulkAddParties creates several parties on a case in one request (WS9). Returns
// 201 with the created parties. A partial failure returns the underlying error
// (the already-created parties are committed by their own transactions).
func (h *LegalCaseHandler) BulkAddParties(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.BulkCreateCasePartiesRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	items, err := h.cases.BulkAddParties(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, items)
}

func (h *LegalCaseHandler) UpdateParty(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	partyID, err := suiteapi.UUIDParam(r, "partyId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateCasePartyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.UpdateParty(r.Context(), tenantID, userID, caseID, partyID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) DeleteParty(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	partyID, err := suiteapi.UUIDParam(r, "partyId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.cases.DeleteParty(r.Context(), tenantID, userID, caseID, partyID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- hearings ---------------------------------------------------------------

func (h *LegalCaseHandler) AddHearing(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateCaseHearingRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.AddHearing(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LegalCaseHandler) UpdateHearing(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	hearingID, err := suiteapi.UUIDParam(r, "hearingId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateCaseHearingRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.UpdateHearing(r.Context(), tenantID, userID, caseID, hearingID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) DeleteHearing(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	hearingID, err := suiteapi.UUIDParam(r, "hearingId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.cases.DeleteHearing(r.Context(), tenantID, userID, caseID, hearingID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- tasks ------------------------------------------------------------------

func (h *LegalCaseHandler) DefineTask(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateCaseTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.DefineTask(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// BulkDefineTasks defines several tasks on a case in one request (WS9). Returns
// 201 with the created tasks. A partial failure returns the underlying error
// (the already-created tasks are committed by their own transactions).
func (h *LegalCaseHandler) BulkDefineTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.BulkCreateCaseTasksRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	items, err := h.cases.BulkDefineTasks(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, items)
}

func (h *LegalCaseHandler) UpdateTask(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	taskID, err := suiteapi.UUIDParam(r, "taskId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateCaseTaskRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.UpdateTask(r.Context(), tenantID, userID, caseID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) DeleteTask(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	taskID, err := suiteapi.UUIDParam(r, "taskId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.cases.DeleteTask(r.Context(), tenantID, userID, caseID, taskID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- persisted timeline milestones -----------------------------------------

func (h *LegalCaseHandler) ListMilestones(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.cases.ListMilestones(r.Context(), tenantID, caseID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *LegalCaseHandler) AddMilestone(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateCaseMilestoneRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.AddMilestone(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LegalCaseHandler) UpdateMilestone(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	milestoneID, err := suiteapi.UUIDParam(r, "milestoneId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateCaseMilestoneRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.UpdateMilestone(r.Context(), tenantID, userID, caseID, milestoneID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) DeleteMilestone(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	milestoneID, err := suiteapi.UUIDParam(r, "milestoneId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.cases.DeleteMilestone(r.Context(), tenantID, userID, caseID, milestoneID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- collaboration comments -------------------------------------------------

func (h *LegalCaseHandler) ListComments(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.cases.ListComments(r.Context(), tenantID, caseID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *LegalCaseHandler) AddComment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateCaseCommentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.AddComment(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LegalCaseHandler) UpdateComment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	commentID, err := suiteapi.UUIDParam(r, "commentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateCaseCommentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.UpdateComment(r.Context(), tenantID, userID, caseID, commentID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) DeleteComment(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	commentID, err := suiteapi.UUIDParam(r, "commentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.cases.DeleteComment(r.Context(), tenantID, userID, caseID, commentID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- document registry links ------------------------------------------------

func (h *LegalCaseHandler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.cases.ListDocuments(r.Context(), tenantID, caseID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *LegalCaseHandler) AddDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateCaseDocumentLinkRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.AddDocument(r.Context(), tenantID, userID, caseID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *LegalCaseHandler) UpdateDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	documentLinkID, err := suiteapi.UUIDParam(r, "documentLinkId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateCaseDocumentLinkRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.cases.UpdateDocument(r.Context(), tenantID, userID, caseID, documentLinkID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *LegalCaseHandler) DeleteDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	caseID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	documentLinkID, err := suiteapi.UUIDParam(r, "documentLinkId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.cases.DeleteDocument(r.Context(), tenantID, userID, caseID, documentLinkID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- filter parsing ---------------------------------------------------------

func parseLegalCaseListFilters(r *http.Request) (model.LegalCaseListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, legalCaseSortColumns, "updated_at", "desc")
	classificationID, err := parseOptionalUUID(r.URL.Query().Get("classification_id"))
	if err != nil {
		return model.LegalCaseListFilters{}, fmt.Errorf("invalid classification_id")
	}
	sectionManagerID, err := parseOptionalUUID(r.URL.Query().Get("section_manager_id"))
	if err != nil {
		return model.LegalCaseListFilters{}, fmt.Errorf("invalid section_manager_id")
	}
	supervisorID, err := parseOptionalUUID(r.URL.Query().Get("supervisor_id"))
	if err != nil {
		return model.LegalCaseListFilters{}, fmt.Errorf("invalid supervisor_id")
	}
	handlingOfficerID, err := parseOptionalUUID(r.URL.Query().Get("handling_officer_id"))
	if err != nil {
		return model.LegalCaseListFilters{}, fmt.Errorf("invalid handling_officer_id")
	}
	requestID, err := parseOptionalUUID(r.URL.Query().Get("request_id"))
	if err != nil {
		return model.LegalCaseListFilters{}, fmt.Errorf("invalid request_id")
	}
	expectedResolutionFrom, err := parseOptionalDate(r.URL.Query().Get("expected_resolution_from"))
	if err != nil {
		return model.LegalCaseListFilters{}, fmt.Errorf("invalid expected_resolution_from")
	}
	expectedResolutionTo, err := parseOptionalDate(r.URL.Query().Get("expected_resolution_to"))
	if err != nil {
		return model.LegalCaseListFilters{}, fmt.Errorf("invalid expected_resolution_to")
	}
	filters := model.LegalCaseListFilters{
		Page:                      page,
		PerPage:                   perPage,
		Search:                    strings.TrimSpace(r.URL.Query().Get("search")),
		CaseType:                  strings.TrimSpace(r.URL.Query().Get("case_type")),
		CaseTypeUnassigned:        r.URL.Query().Get("case_type_unassigned") == "true",
		ClassificationID:          classificationID,
		SectionManagerID:          sectionManagerID,
		SupervisorID:              supervisorID,
		HandlingOfficerID:         handlingOfficerID,
		HandlingOfficerUnassigned: r.URL.Query().Get("handling_officer_unassigned") == "true",
		Department:                strings.TrimSpace(r.URL.Query().Get("department")),
		RequestID:                 requestID,
		ExpectedResolutionFrom:    expectedResolutionFrom,
		ExpectedResolutionTo:      expectedResolutionTo,
		SortColumn:                sortCol,
		SortDirection:             sortDir,
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		parts := strings.Split(status, ",")
		if len(parts) == 1 {
			value := model.CaseStatus(status)
			filters.Status = &value
		} else {
			for _, part := range parts {
				if value := strings.TrimSpace(part); value != "" {
					filters.Statuses = append(filters.Statuses, model.CaseStatus(value))
				}
			}
		}
	}
	if companyStatus := strings.TrimSpace(r.URL.Query().Get("company_status")); companyStatus != "" {
		value := model.CaseCompanyStatus(companyStatus)
		filters.CompanyStatus = &value
	}
	if strength := strings.TrimSpace(r.URL.Query().Get("strength")); strength != "" {
		value := model.CaseStrength(strength)
		filters.Strength = &value
	}
	if priority := strings.TrimSpace(r.URL.Query().Get("priority")); priority != "" {
		value := model.LegalPriority(priority)
		filters.Priority = &value
	}
	// `expand` is an opt-in, comma-separated set of child collections to hydrate on
	// each returned list row (e.g. expand=parties,hearings). Absent/empty => no
	// hydration (the response stays byte-for-byte identical, no N+1). Unknown tokens
	// are ignored.
	for _, token := range strings.Split(r.URL.Query().Get("expand"), ",") {
		switch strings.TrimSpace(token) {
		case "parties":
			filters.ExpandParties = true
		case "hearings":
			filters.ExpandHearings = true
		}
	}
	return filters, nil
}
