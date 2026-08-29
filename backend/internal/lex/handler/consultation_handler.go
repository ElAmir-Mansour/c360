package handler

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var consultationSortColumns = map[string]string{
	"consultation_number": "lc.consultation_number",
	"status":              "lc.status",
	"type":                "lc.type",
	"priority":            "lc.priority",
	"updated_at":          "lc.updated_at",
	"created_at":          "lc.created_at",
}

// ConsultationHandler is the transport shell over ConsultationService +
// ConsultationApprovalService (CAP-126..132). It resolves tenant/user from the
// request context, decodes payloads, and delegates. Route wiring (permission
// tiers, paths) is owned by the integrator in handler/routes.go.
type ConsultationHandler struct {
	baseHandler
	service  *service.ConsultationService
	approval *service.ConsultationApprovalService
}

func NewConsultationHandler(svc *service.ConsultationService, approval *service.ConsultationApprovalService, logger zerolog.Logger) *ConsultationHandler {
	return &ConsultationHandler{baseHandler: baseHandler{logger: logger}, service: svc, approval: approval}
}

// Submit POST /consultations (CAP-126).
func (h *ConsultationHandler) Submit(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.SubmitConsultationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Submit(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactConsultationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// List GET /consultations.
func (h *ConsultationHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseConsultationListFilters(r)
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
		redactConsultationLateJustification(&items[i], rolesFromContext(r))
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

// Count GET /consultations/count.
func (h *ConsultationHandler) Count(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseConsultationListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	_, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]int{"count": total})
}

// Stats GET /consultations/stats. Aggregate KPI rollup over the SAME filter set as
// List (so the cards reflect the active filters, not the unfiltered tenant total).
func (h *ConsultationHandler) Stats(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseConsultationListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	stats, err := h.service.Stats(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, stats)
}

// Tags GET /consultations/tags. Distinct tag set for autocomplete + filter chips.
func (h *ConsultationHandler) Tags(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	tags, err := h.service.DistinctTags(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string][]string{"tags": tags})
}

// AdvisorWorkload GET /consultations/advisor-workload. Open-consultation counts by advisor.
func (h *ConsultationHandler) AdvisorWorkload(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	rows, err := h.service.AdvisorWorkload(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"advisors": rows})
}

// Bulk POST /consultations/bulk. Applies one action over many ids; partial outcomes.
func (h *ConsultationHandler) Bulk(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.BulkConsultationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.BulkApply(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

// LegalHold GET /consultations/{id}/legal-hold. Active legal holds on the consultation.
func (h *ConsultationHandler) LegalHold(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	onHold, holds, err := h.service.LegalHoldStatus(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"on_hold": onHold, "holds": holds})
}

// DraftResponse POST /consultations/{id}/respond/draft. AI draft preview, no FSM move.
func (h *ConsultationHandler) DraftResponse(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.DraftConsultationResponseRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		// Body is optional (locale only); tolerate an empty body.
		req = dto.DraftConsultationResponseRequest{}
	}
	draft, err := h.service.DraftResponse(r.Context(), tenantID, id, req.Locale)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{"draft": draft, "generated_by": "ai"})
}

// Get GET /consultations/{id}.
func (h *ConsultationHandler) Get(w http.ResponseWriter, r *http.Request) {
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
	redactConsultationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Classify POST /consultations/{id}/classify (CAP-127).
func (h *ConsultationHandler) Classify(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ClassifyConsultationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Classify(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactConsultationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Route POST /consultations/{id}/route (CAP-129).
func (h *ConsultationHandler) Route(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RouteConsultationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Route(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactConsultationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Respond POST /consultations/{id}/respond (CAP-130).
func (h *ConsultationHandler) Respond(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RespondConsultationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Respond(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactConsultationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Archive POST /consultations/{id}/archive (CAP-132).
func (h *ConsultationHandler) Archive(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ArchiveConsultationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		// Archive body is optional (reason only); tolerate an empty body.
		req = dto.ArchiveConsultationRequest{}
	}
	item, err := h.service.Archive(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	redactConsultationLateJustification(item, rolesFromContext(r))
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Delete DELETE /consultations/{id}.
func (h *ConsultationHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

// --- documents (CAP-128) ----------------------------------------------------

// AttachDocument POST /consultations/{id}/documents.
func (h *ConsultationHandler) AttachDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.AttachConsultationDocumentRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.AttachDocument(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// ListDocuments GET /consultations/{id}/documents.
func (h *ConsultationHandler) ListDocuments(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.ListDocuments(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// DetachDocument DELETE /consultations/{id}/documents/{documentId}.
func (h *ConsultationHandler) DetachDocument(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	documentID, err := suiteapi.UUIDParam(r, "documentId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DetachDocument(r.Context(), tenantID, userID, id, documentID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ListAudit GET /consultations/{id}/audit.
func (h *ConsultationHandler) ListAudit(w http.ResponseWriter, r *http.Request) {
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

// --- response approval (CAP-131) --------------------------------------------

// StartApproval POST /consultations/{id}/approval/start.
func (h *ConsultationHandler) StartApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.approval.StartApproval(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ListApprovalTasks GET /consultations/{id}/approval/tasks.
func (h *ConsultationHandler) ListApprovalTasks(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	tasks, err := h.approval.ListTasks(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, tasks)
}

// DecideApprovalTask POST /consultations/{id}/approval/{workflowInstanceId}/tasks/{taskId}/decision.
func (h *ConsultationHandler) DecideApprovalTask(w http.ResponseWriter, r *http.Request) {
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
	outcome, err := h.approval.DecideTask(r.Context(), tenantID, userID, id, workflowInstanceID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

func parseConsultationListFilters(r *http.Request) (model.ConsultationListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, consultationSortColumns, "updated_at", "desc")
	requesterUserID, err := parseOptionalUUID(r.URL.Query().Get("requester_user_id"))
	if err != nil {
		return model.ConsultationListFilters{}, fmt.Errorf("invalid requester_user_id")
	}
	advisorID, err := parseOptionalUUID(r.URL.Query().Get("advisor_id"))
	if err != nil {
		return model.ConsultationListFilters{}, fmt.Errorf("invalid advisor_id")
	}
	legalRequestID, err := parseOptionalUUID(r.URL.Query().Get("legal_request_id"))
	if err != nil {
		return model.ConsultationListFilters{}, fmt.Errorf("invalid legal_request_id")
	}
	filters := model.ConsultationListFilters{
		Page:            page,
		PerPage:         perPage,
		Search:          strings.TrimSpace(r.URL.Query().Get("search")),
		RequesterUserID: requesterUserID,
		AdvisorID:       advisorID,
		LegalRequestID:  legalRequestID,
		Department:      strings.TrimSpace(r.URL.Query().Get("department")),
		Tag:             strings.TrimSpace(r.URL.Query().Get("tag")),
		SortColumn:      sortCol,
		SortDirection:   sortDir,
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		parts := strings.Split(status, ",")
		if len(parts) == 1 {
			value := model.ConsultationStatus(status)
			filters.Status = &value
		} else {
			for _, part := range parts {
				if value := strings.TrimSpace(part); value != "" {
					filters.Statuses = append(filters.Statuses, model.ConsultationStatus(value))
				}
			}
		}
	}
	if cType := strings.TrimSpace(r.URL.Query().Get("type")); cType != "" {
		value := model.ConsultationType(cType)
		filters.Type = &value
	}
	if priority := strings.TrimSpace(r.URL.Query().Get("priority")); priority != "" {
		value := model.LegalPriority(priority)
		filters.Priority = &value
	}
	// SLA-risk filter (allowlist-validated).
	if slaRisk := strings.TrimSpace(r.URL.Query().Get("sla_risk")); slaRisk != "" {
		if !model.ValidConsultationSLARisk(slaRisk) {
			return model.ConsultationListFilters{}, fmt.Errorf("invalid sla_risk (allowed: breached, due_soon, on_track)")
		}
		filters.SLARisk = slaRisk
	}
	// Date-range filters (RFC3339).
	if filters.CreatedFrom, err = parseOptionalRFC3339(r.URL.Query().Get("created_from")); err != nil {
		return model.ConsultationListFilters{}, fmt.Errorf("invalid created_from (RFC3339)")
	}
	if filters.CreatedTo, err = parseOptionalRFC3339(r.URL.Query().Get("created_to")); err != nil {
		return model.ConsultationListFilters{}, fmt.Errorf("invalid created_to (RFC3339)")
	}
	if filters.RespondedFrom, err = parseOptionalRFC3339(r.URL.Query().Get("responded_from")); err != nil {
		return model.ConsultationListFilters{}, fmt.Errorf("invalid responded_from (RFC3339)")
	}
	if filters.RespondedTo, err = parseOptionalRFC3339(r.URL.Query().Get("responded_to")); err != nil {
		return model.ConsultationListFilters{}, fmt.Errorf("invalid responded_to (RFC3339)")
	}
	return filters, nil
}

// parseOptionalRFC3339 parses an optional RFC3339 timestamp query param. An empty
// string yields (nil, nil); a malformed value yields an error.
func parseOptionalRFC3339(raw string) (*time.Time, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return nil, err
	}
	utc := t.UTC()
	return &utc, nil
}
