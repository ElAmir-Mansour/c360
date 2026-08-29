package handler

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

var obligationSortColumns = map[string]string{
	"title":      "o.title",
	"status":     "o.status",
	"type":       "o.type",
	"priority":   "o.priority",
	"due_date":   "o.due_date",
	"updated_at": "o.updated_at",
	"created_at": "o.created_at",
}

type ObligationHandler struct {
	baseHandler
	service *service.ObligationService
}

func NewObligationHandler(service *service.ObligationService, logger zerolog.Logger) *ObligationHandler {
	return &ObligationHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *ObligationHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateObligationRequest
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

func (h *ObligationHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseObligationListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *ObligationHandler) Report(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseObligationListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("per_page")) == "" {
		filters.PerPage = 1000
	}
	report, err := h.service.ObligationReport(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format"))) {
	case "csv":
		writeObligationReportCSV(w, report)
		return
	case "xlsx":
		writeSimpleXLSX(w, "lex-obligation-report.xlsx", "Obligations", obligationReportHeaders(), obligationReportRows(report))
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

func (h *ObligationHandler) ListByContract(w http.ResponseWriter, r *http.Request) {
	h.listByScopedID(w, r, "contract")
}

func (h *ObligationHandler) ListByMatter(w http.ResponseWriter, r *http.Request) {
	h.listByScopedID(w, r, "matter")
}

func (h *ObligationHandler) ExtractFromContract(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ExtractObligationsRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.ExtractFromContract(r.Context(), tenantID, userID, contractID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, result)
}

func (h *ObligationHandler) ReminderPlan(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	asOfDate, err := parseOptionalDate(r.URL.Query().Get("as_of"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid as_of", nil)
		return
	}
	var asOfTime time.Time
	if asOfDate != nil {
		asOfTime = *asOfDate
	}
	horizonDays := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("horizon_days")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid horizon_days", nil)
			return
		}
		horizonDays = parsed
	}
	includeEscalations := true
	if raw := strings.TrimSpace(r.URL.Query().Get("include_escalations")); raw != "" {
		parsed, err := strconv.ParseBool(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid include_escalations", nil)
			return
		}
		includeEscalations = parsed
	}
	plan, err := h.service.PlanNotifications(r.Context(), tenantID, asOfTime, horizonDays, includeEscalations)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

func (h *ObligationHandler) EnqueueReminders(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.EnqueueObligationRemindersRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	result, err := h.service.EnqueueDueReminderOutbox(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, result)
}

func (h *ObligationHandler) DispatchReminderOutbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.DispatchObligationReminderOutboxRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	result, err := h.service.DispatchReminderOutbox(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *ObligationHandler) DispatchReminderOutboxItem(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	outboxID, err := suiteapi.UUIDParam(r, "outboxId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.DispatchObligationReminderOutboxRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	result, err := h.service.DispatchReminderOutboxItem(r.Context(), tenantID, userID, outboxID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *ObligationHandler) MarkReminderDelivery(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	outboxID, err := suiteapi.UUIDParam(r, "outboxId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.MarkObligationReminderDeliveryRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.MarkReminderDelivery(r.Context(), tenantID, userID, outboxID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ObligationHandler) listByScopedID(w http.ResponseWriter, r *http.Request, scope string) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	filters, err := parseObligationListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if scope == "contract" {
		filters.ContractID = &id
	} else {
		filters.MatterID = &id
	}
	items, total, err := h.service.List(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *ObligationHandler) Get(w http.ResponseWriter, r *http.Request) {
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
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ObligationHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateObligationRequest
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

func (h *ObligationHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateObligationStatusRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateStatus(r.Context(), tenantID, userID, id, req.Status)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ObligationHandler) MarkReminderSent(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.MarkObligationReminderSentRequest
	if r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
			return
		}
	}
	item, err := h.service.MarkReminderSent(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *ObligationHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

func parseObligationListFilters(r *http.Request) (model.ObligationListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, obligationSortColumns, "due_date", "asc")
	ownerUserID, err := parseOptionalUUID(r.URL.Query().Get("owner_user_id"))
	if err != nil {
		return model.ObligationListFilters{}, fmt.Errorf("invalid owner_user_id")
	}
	contractID, err := parseOptionalUUID(r.URL.Query().Get("contract_id"))
	if err != nil {
		return model.ObligationListFilters{}, fmt.Errorf("invalid contract_id")
	}
	matterID, err := parseOptionalUUID(r.URL.Query().Get("matter_id"))
	if err != nil {
		return model.ObligationListFilters{}, fmt.Errorf("invalid matter_id")
	}
	dueBefore, err := parseOptionalDate(r.URL.Query().Get("due_before"))
	if err != nil {
		return model.ObligationListFilters{}, fmt.Errorf("invalid due_before")
	}
	dueAfter, err := parseOptionalDate(r.URL.Query().Get("due_after"))
	if err != nil {
		return model.ObligationListFilters{}, fmt.Errorf("invalid due_after")
	}
	overdue := false
	if raw := strings.TrimSpace(r.URL.Query().Get("overdue")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return model.ObligationListFilters{}, fmt.Errorf("invalid overdue")
		}
		overdue = value
	}
	filters := model.ObligationListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		OwnerUserID:   ownerUserID,
		ContractID:    contractID,
		MatterID:      matterID,
		DueBefore:     dueBefore,
		DueAfter:      dueAfter,
		Overdue:       overdue,
		Tag:           strings.TrimSpace(r.URL.Query().Get("tag")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		value := model.ObligationStatus(status)
		filters.Status = &value
	}
	if obligationType := strings.TrimSpace(r.URL.Query().Get("type")); obligationType != "" {
		value := model.ObligationType(obligationType)
		filters.Type = &value
	}
	if priority := strings.TrimSpace(r.URL.Query().Get("priority")); priority != "" {
		value := model.LegalPriority(priority)
		filters.Priority = &value
	}
	return filters, nil
}

func writeObligationReportCSV(w http.ResponseWriter, report *model.ObligationReport) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-obligation-report.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write(obligationReportHeaders())
	for _, row := range obligationReportRows(report) {
		_ = writer.Write(row)
	}
	writer.Flush()
}

func obligationReportHeaders() []string {
	return []string{"id", "title", "type", "status", "priority", "owner_user_id", "owner_name", "contract_id", "contract_title", "matter_id", "matter_title", "due_date", "days_until_due", "completed_at", "created_at"}
}

func obligationReportRows(report *model.ObligationReport) [][]string {
	rows := make([][]string, 0, len(report.Obligations))
	for _, item := range report.Obligations {
		contractID := ""
		if item.ContractID != nil {
			contractID = item.ContractID.String()
		}
		contractTitle := ""
		if item.ContractTitle != nil {
			contractTitle = *item.ContractTitle
		}
		matterID := ""
		if item.MatterID != nil {
			matterID = item.MatterID.String()
		}
		matterTitle := ""
		if item.MatterTitle != nil {
			matterTitle = *item.MatterTitle
		}
		completedAt := ""
		if item.CompletedAt != nil {
			completedAt = item.CompletedAt.UTC().Format(time.RFC3339)
		}
		rows = append(rows, []string{
			item.ID.String(),
			item.Title,
			string(item.Type),
			string(item.Status),
			string(item.Priority),
			item.OwnerUserID.String(),
			item.OwnerName,
			contractID,
			contractTitle,
			matterID,
			matterTitle,
			item.DueDate.UTC().Format("2006-01-02"),
			fmt.Sprintf("%d", item.DaysUntilDue),
			completedAt,
			item.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return rows
}
