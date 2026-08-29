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

// SettlementHandler exposes the Settlements / ADR vertical (CAP-089..093). It
// mirrors MatterHandler conventions and uses {id} for the settlement primary param
// (chi convention) and distinct sub-params for nested resources.
type SettlementHandler struct {
	baseHandler
	service *service.SettlementService
}

func NewSettlementHandler(svc *service.SettlementService, logger zerolog.Logger) *SettlementHandler {
	return &SettlementHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// Open POST /settlements  (CAP-089)
func (h *SettlementHandler) Open(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.OpenReconciliationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.OpenReconciliation(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// List GET /settlements
func (h *SettlementHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseSettlementListFilters(r)
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

// Report GET /reports/settlements (FEATURES 1 + 3). Returns the Settlements / ADR
// analytics roll-up (counts by status/method, value by status, settled value,
// value at risk, average value, create->execute cycle-time stats) honouring the
// same filters as List. Supports ?format=csv for the line-item export. Mirrors
// MatterHandler.Report.
func (h *SettlementHandler) Report(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseSettlementListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	report, err := h.service.Report(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("format")), "csv") {
		writeSettlementReportCSV(w, report)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

// parseSettlementListFilters parses the shared settlement list/report filter set
// (matter_id, status, method, search, pagination, sort) off the request.
func parseSettlementListFilters(r *http.Request) (model.SettlementListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.SettlementListFilters{
		Page:    page,
		PerPage: perPage,
		Search:  strings.TrimSpace(r.URL.Query().Get("search")),
		SortDir: strings.TrimSpace(r.URL.Query().Get("sort_dir")),
	}
	matterID, err := parseOptionalUUID(r.URL.Query().Get("matter_id"))
	if err != nil {
		return model.SettlementListFilters{}, fmt.Errorf("invalid matter_id")
	}
	filters.MatterID = matterID
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		value := model.SettlementStatus(status)
		filters.Status = &value
	}
	if method := strings.TrimSpace(r.URL.Query().Get("method")); method != "" {
		value := model.SettlementMethod(method)
		filters.Method = &value
	}
	return filters, nil
}

func writeSettlementReportCSV(w http.ResponseWriter, report *model.SettlementReport) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-settlement-report.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"id", "reference", "matter_id", "title", "status", "method", "value", "currency", "approved_at", "executed_at", "created_at"})
	for _, item := range report.Settlements {
		value := ""
		if item.Value != nil {
			value = strconv.FormatFloat(*item.Value, 'f', -1, 64)
		}
		currency := ""
		if item.Currency != nil {
			currency = *item.Currency
		}
		approvedAt := ""
		if item.ApprovedAt != nil {
			approvedAt = item.ApprovedAt.UTC().Format(time.RFC3339)
		}
		executedAt := ""
		if item.ExecutedAt != nil {
			executedAt = item.ExecutedAt.UTC().Format(time.RFC3339)
		}
		_ = writer.Write([]string{
			item.ID.String(),
			item.Reference,
			item.MatterID.String(),
			item.Title,
			string(item.Status),
			string(item.Method),
			value,
			currency,
			approvedAt,
			executedAt,
			item.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	writer.Flush()
}

// Get GET /settlements/{id}
func (h *SettlementHandler) Get(w http.ResponseWriter, r *http.Request) {
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

// Record PUT /settlements/{id}  (CAP-090)
func (h *SettlementHandler) Record(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RecordSettlementRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.RecordSettlement(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// AddRound POST /settlements/{id}/rounds  (CAP-091)
func (h *SettlementHandler) AddRound(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.AddNegotiationRoundRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.AddNegotiationRound(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// SubmitForApproval POST /settlements/{id}/submit  (CAP-092)
func (h *SettlementHandler) SubmitForApproval(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.SubmitForApproval(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// Decide POST /settlements/{id}/workflows/{workflowId}/tasks/{taskId}/decision (CAP-092)
func (h *SettlementHandler) Decide(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	workflowID, err := suiteapi.UUIDParam(r, "workflowId")
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
	outcome, err := h.service.Decide(r.Context(), tenantID, userID, id, workflowID, taskID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, outcome)
}

// CloseByReconciliation POST /settlements/{id}/close  (CAP-093)
func (h *SettlementHandler) CloseByReconciliation(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.CloseByReconciliation(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ListAudit GET /settlements/{id}/audit
func (h *SettlementHandler) ListAudit(w http.ResponseWriter, r *http.Request) {
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

// Delete DELETE /settlements/{id}
func (h *SettlementHandler) Delete(w http.ResponseWriter, r *http.Request) {
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
