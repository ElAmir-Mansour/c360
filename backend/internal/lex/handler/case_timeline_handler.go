package handler

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// CaseTimelineHandler exposes the Case Timelines vertical (CAP-084..088): the
// per-matter timeline projection, external-pending state, and the classified
// delay-event register. It mirrors MatterHandler conventions exactly.
type CaseTimelineHandler struct {
	baseHandler
	service *service.CaseTimelineService
}

func NewCaseTimelineHandler(svc *service.CaseTimelineService, logger zerolog.Logger) *CaseTimelineHandler {
	return &CaseTimelineHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// GetTimeline GET /matters/{id}/timeline
func (h *CaseTimelineHandler) GetTimeline(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetTimeline(r.Context(), tenantID, matterID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// UpdateTimeline PUT /matters/{id}/timeline
func (h *CaseTimelineHandler) UpdateTimeline(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateMatterTimelineRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateTimeline(r.Context(), tenantID, userID, matterID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// SetExternalHold POST /matters/{id}/timeline/external-hold
func (h *CaseTimelineHandler) SetExternalHold(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.SetExternalHoldRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.SetExternalHold(r.Context(), tenantID, userID, matterID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ListDelayEvents GET /matters/{id}/delay-events
func (h *CaseTimelineHandler) ListDelayEvents(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.DelayEventListFilters{
		MatterID:   matterID,
		Page:       page,
		PerPage:    perPage,
		OpenOnly:   strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("open")), "true"),
		Search:     strings.TrimSpace(r.URL.Query().Get("q")),
		SortColumn: strings.TrimSpace(r.URL.Query().Get("sort")),
		SortDir:    strings.TrimSpace(r.URL.Query().Get("sort_dir")),
	}
	if category := strings.TrimSpace(r.URL.Query().Get("category")); category != "" {
		value := model.DelayCategory(category)
		filters.Category = &value
	}
	items, total, err := h.service.ListDelayEvents(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

// RecordDelayEvent POST /matters/{id}/delay-events
func (h *CaseTimelineHandler) RecordDelayEvent(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.RecordDelayEventRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.RecordDelayEvent(r.Context(), tenantID, userID, matterID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// UpdateDelayEvent PATCH /matters/{id}/delay-events/{eventId}
func (h *CaseTimelineHandler) UpdateDelayEvent(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	eventID, err := suiteapi.UUIDParam(r, "eventId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateDelayEventRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateDelayEvent(r.Context(), tenantID, userID, matterID, eventID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ReopenDelayEvent POST /matters/{id}/delay-events/{eventId}/reopen
func (h *CaseTimelineHandler) ReopenDelayEvent(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	eventID, err := suiteapi.UUIDParam(r, "eventId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.ReopenDelayEvent(r.Context(), tenantID, userID, matterID, eventID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ListTimelineSummaries GET /matters/timelines
func (h *CaseTimelineHandler) ListTimelineSummaries(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.MatterTimelineSummaryFilters{
		Page:       page,
		PerPage:    perPage,
		SortColumn: strings.TrimSpace(r.URL.Query().Get("sort")),
		SortDir:    strings.TrimSpace(r.URL.Query().Get("sort_dir")),
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("on_hold")); raw != "" {
		held := strings.EqualFold(raw, "true")
		filters.OnHold = &held
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("min_open_delay_days")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 0 {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "min_open_delay_days must be a non-negative integer", nil)
			return
		}
		filters.MinOpenDelayDays = value
	}
	items, total, err := h.service.ListMatterTimelineSummaries(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

// ListHoldHistory GET /matters/{id}/hold-history
func (h *CaseTimelineHandler) ListHoldHistory(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, err := h.service.ListHoldHistory(r.Context(), tenantID, matterID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

// CreateDeadline POST /matters/{id}/deadlines
func (h *CaseTimelineHandler) CreateDeadline(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.CreateDeadlineObligationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	req.Normalize()
	if req.DueDate.IsZero() {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "due_date is required", map[string]string{"due_date": "required"})
		return
	}
	ownerUserID := userID
	if req.OwnerUserID != nil {
		ownerUserID = *req.OwnerUserID
	}
	item, err := h.service.CreateDeadlineObligation(r.Context(), tenantID, userID, matterID, req.Kind, req.Title, ownerUserID, req.OwnerName, req.DueDate, req.LeadDays)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

// ListDeadlines GET /matters/{id}/deadlines
func (h *CaseTimelineHandler) ListDeadlines(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	page, perPage := suiteapi.ParsePagination(r)
	items, total, err := h.service.ListDeadlineObligations(r.Context(), tenantID, matterID, page, perPage)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, page, perPage, total)
}

// ResolveDelayEvent POST /matters/{id}/delay-events/{eventId}/resolve
func (h *CaseTimelineHandler) ResolveDelayEvent(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	matterID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	eventID, err := suiteapi.UUIDParam(r, "eventId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.ResolveDelayEventRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.ResolveDelayEvent(r.Context(), tenantID, userID, matterID, eventID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}
