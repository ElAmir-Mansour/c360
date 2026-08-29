package handler

import (
	"encoding/csv"
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

var matterSortColumns = map[string]string{
	"title":      "m.title",
	"status":     "m.status",
	"type":       "m.type",
	"priority":   "m.priority",
	"due_date":   "m.due_date",
	"updated_at": "m.updated_at",
	"created_at": "m.created_at",
}

type MatterHandler struct {
	baseHandler
	service *service.MatterService
}

func NewMatterHandler(service *service.MatterService, logger zerolog.Logger) *MatterHandler {
	return &MatterHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

func (h *MatterHandler) Create(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateMatterRequest
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

func (h *MatterHandler) List(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseMatterListFilters(r)
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

func (h *MatterHandler) Report(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseMatterListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if strings.TrimSpace(r.URL.Query().Get("per_page")) == "" {
		filters.PerPage = 1000
	}
	report, err := h.service.MatterReport(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	switch strings.ToLower(strings.TrimSpace(r.URL.Query().Get("format"))) {
	case "csv":
		writeMatterReportCSV(w, report)
		return
	case "xlsx":
		writeSimpleXLSX(w, "lex-matter-report.xlsx", "Matters", matterReportHeaders(), matterReportRows(report))
		return
	}
	suiteapi.WriteData(w, http.StatusOK, report)
}

func (h *MatterHandler) ConflictCheck(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	var req dto.MatterConflictCheckRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.ConflictCheck(r.Context(), tenantID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *MatterHandler) Get(w http.ResponseWriter, r *http.Request) {
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

func (h *MatterHandler) Update(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateMatterRequest
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

func (h *MatterHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateMatterStatusRequest
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

func (h *MatterHandler) Triage(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.TriageMatterRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Triage(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *MatterHandler) Delete(w http.ResponseWriter, r *http.Request) {
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

func (h *MatterHandler) LinkContract(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.LinkMatterContractRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.LinkContract(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *MatterHandler) UnlinkContract(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	contractID, err := suiteapi.UUIDParam(r, "contractId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.UnlinkContract(r.Context(), tenantID, id, contractID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseMatterListFilters(r *http.Request) (model.MatterListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, matterSortColumns, "updated_at", "desc")
	ownerUserID, err := parseOptionalUUID(r.URL.Query().Get("owner_user_id"))
	if err != nil {
		return model.MatterListFilters{}, fmt.Errorf("invalid owner_user_id")
	}
	contractID, err := parseOptionalUUID(r.URL.Query().Get("contract_id"))
	if err != nil {
		return model.MatterListFilters{}, fmt.Errorf("invalid contract_id")
	}
	dueBefore, err := parseOptionalDate(r.URL.Query().Get("due_before"))
	if err != nil {
		return model.MatterListFilters{}, fmt.Errorf("invalid due_before")
	}
	dueAfter, err := parseOptionalDate(r.URL.Query().Get("due_after"))
	if err != nil {
		return model.MatterListFilters{}, fmt.Errorf("invalid due_after")
	}
	filters := model.MatterListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		OwnerUserID:   ownerUserID,
		ContractID:    contractID,
		Department:    strings.TrimSpace(r.URL.Query().Get("department")),
		DueBefore:     dueBefore,
		DueAfter:      dueAfter,
		Tag:           strings.TrimSpace(r.URL.Query().Get("tag")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if status := strings.TrimSpace(r.URL.Query().Get("status")); status != "" {
		value := model.MatterStatus(status)
		filters.Status = &value
	}
	if matterType := strings.TrimSpace(r.URL.Query().Get("type")); matterType != "" {
		value := model.MatterType(matterType)
		filters.Type = &value
	}
	if priority := strings.TrimSpace(r.URL.Query().Get("priority")); priority != "" {
		value := model.LegalPriority(priority)
		filters.Priority = &value
	}
	return filters, nil
}

func writeMatterReportCSV(w http.ResponseWriter, report *model.MatterReport) {
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="lex-matter-report.csv"`)
	w.WriteHeader(http.StatusOK)
	writer := csv.NewWriter(w)
	_ = writer.Write(matterReportHeaders())
	for _, row := range matterReportRows(report) {
		_ = writer.Write(row)
	}
	writer.Flush()
}

func matterReportHeaders() []string {
	return []string{"id", "matter_number", "title", "type", "status", "priority", "owner_user_id", "owner_name", "department", "opened_at", "due_date", "closed_at", "created_at"}
}

func matterReportRows(report *model.MatterReport) [][]string {
	rows := make([][]string, 0, len(report.Matters))
	for _, item := range report.Matters {
		department := ""
		if item.Department != nil {
			department = *item.Department
		}
		dueDate := ""
		if item.DueDate != nil {
			dueDate = item.DueDate.UTC().Format("2006-01-02")
		}
		closedAt := ""
		if item.ClosedAt != nil {
			closedAt = item.ClosedAt.UTC().Format(time.RFC3339)
		}
		rows = append(rows, []string{
			item.ID.String(),
			item.MatterNumber,
			item.Title,
			string(item.Type),
			string(item.Status),
			string(item.Priority),
			item.OwnerUserID.String(),
			item.OwnerName,
			department,
			item.OpenedAt.UTC().Format(time.RFC3339),
			dueDate,
			closedAt,
			item.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	return rows
}
