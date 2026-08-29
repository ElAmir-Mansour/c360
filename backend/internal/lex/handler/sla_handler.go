package handler

import (
	"errors"
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

var slaTargetSortColumns = map[string]string{
	"service_code":            "s.service_code",
	"priority":                "s.priority",
	"turnaround_working_days": "s.turnaround_working_days",
	"updated_at":              "s.updated_at",
	"created_at":              "s.created_at",
}

// slaClockSortColumns allowlists the operations-board sort surface. Values are
// bare column names (no alias prefix): the service interpolates them as c.<col>,
// so only these allowlisted names can ever reach the ORDER BY clause.
var slaClockSortColumns = map[string]string{
	"turnaround_due_at": "turnaround_due_at",
	"ack_due_at":        "ack_due_at",
	"clock_started_at":  "clock_started_at",
	"escalation_level":  "escalation_level",
	"priority":          "priority",
	"service_code":      "service_code",
	"created_at":        "created_at",
	"updated_at":        "updated_at",
}

type SLAHandler struct {
	baseHandler
	service *service.SLAService
}

func NewSLAHandler(service *service.SLAService, logger zerolog.Logger) *SLAHandler {
	return &SLAHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// --- SLA target catalogue (admin CRUD) -------------------------------------

func (h *SLAHandler) CreateTarget(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.CreateSLATargetRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.CreateTarget(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *SLAHandler) ListTargets(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters := parseSLATargetListFilters(r)
	items, total, err := h.service.ListTargets(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *SLAHandler) GetTarget(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetTarget(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SLAHandler) UpdateTarget(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.UpdateSLATargetRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpdateTarget(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SLAHandler) DeleteTarget(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteTarget(r.Context(), tenantID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- SLA clock lifecycle ----------------------------------------------------

func (h *SLAHandler) StartClock(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.StartSLAClockRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.StartClock(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, item)
}

func (h *SLAHandler) GetClock(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetClock(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SLAHandler) GetClockByRequest(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	requestID, err := suiteapi.UUIDParam(r, "requestId")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetClockByRequest(r.Context(), tenantID, requestID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// ListClocks serves the WS9 operations-board view: a paginated, computed
// projection of SLA clocks with working-time remaining, the next escalation
// recipient, and ack-risk/breach-imminent flags. Filterable by status (outcome),
// breached, escalation_level, service_code, priority and a due-before window.
func (h *SLAHandler) ListClocks(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenantID(w, r)
	if !ok {
		return
	}
	filters, err := parseSLAClockListFilters(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	items, total, err := h.service.ListClockViews(r.Context(), tenantID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *SLAHandler) Acknowledge(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.AcknowledgeSLAClockRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.Acknowledge(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *SLAHandler) TriggerEscalation(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	var req dto.TriggerSLAEscalationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.TriggerEscalation(r.Context(), tenantID, userID, id, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

// --- outbox dispatch --------------------------------------------------------

func (h *SLAHandler) DispatchOutbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.DispatchSLAOutboxRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	result, err := h.service.DispatchOutbox(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func parseSLATargetListFilters(r *http.Request) model.SLATargetListFilters {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, slaTargetSortColumns, "updated_at", "desc")
	filters := model.SLATargetListFilters{
		Page:          page,
		PerPage:       perPage,
		Search:        strings.TrimSpace(r.URL.Query().Get("search")),
		ServiceCode:   strings.TrimSpace(r.URL.Query().Get("service_code")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}
	if priority := strings.TrimSpace(r.URL.Query().Get("priority")); priority != "" {
		value := model.SLATargetPriority(priority)
		filters.Priority = &value
	}
	if active := strings.TrimSpace(r.URL.Query().Get("active")); active != "" {
		if parsed, err := strconv.ParseBool(active); err == nil {
			filters.Active = &parsed
		}
	}
	return filters
}

// parseSLAClockListFilters reads the WS9 operations-board query surface. Unknown
// values (bad bool/int/enum/date) return a validation error rather than being
// silently dropped, so a misfiltered board call fails loudly. The sort column is
// resolved against slaClockSortColumns; an unknown column falls back to the
// default (turnaround_due_at asc).
func parseSLAClockListFilters(r *http.Request) (dto.SLAClockListFilters, error) {
	page, perPage := suiteapi.ParsePagination(r)
	sortCol, sortDir := suiteapi.ParseSort(r, slaClockSortColumns, "turnaround_due_at", "asc")
	q := r.URL.Query()
	filters := dto.SLAClockListFilters{
		Page:          page,
		PerPage:       perPage,
		ServiceCode:   strings.TrimSpace(q.Get("service_code")),
		SortColumn:    sortCol,
		SortDirection: sortDir,
	}

	// status filters on the terminal outcome (pending|on_time|breached).
	if status := strings.ToLower(strings.TrimSpace(q.Get("status"))); status != "" {
		outcome := model.SLAClockOutcome(status)
		if !outcome.Valid() {
			return dto.SLAClockListFilters{}, errors.New("invalid status; expected pending, on_time or breached")
		}
		filters.Outcome = &outcome
	}
	if breached := strings.TrimSpace(q.Get("breached")); breached != "" {
		parsed, err := strconv.ParseBool(breached)
		if err != nil {
			return dto.SLAClockListFilters{}, errors.New("invalid breached; expected a boolean")
		}
		filters.Breached = &parsed
	}
	if level := strings.TrimSpace(q.Get("escalation_level")); level != "" {
		parsed, err := strconv.Atoi(level)
		if err != nil || parsed < 0 || parsed > 3 {
			return dto.SLAClockListFilters{}, errors.New("invalid escalation_level; expected 0-3")
		}
		filters.EscalationLevel = &parsed
	}
	if priority := strings.ToLower(strings.TrimSpace(q.Get("priority"))); priority != "" {
		value := model.SLATargetPriority(priority)
		if !value.Valid() {
			return dto.SLAClockListFilters{}, errors.New("invalid priority; expected urgent or normal")
		}
		filters.Priority = &value
	}
	if dueBefore := strings.TrimSpace(q.Get("due_before")); dueBefore != "" {
		parsed, err := parseSLADueBefore(dueBefore)
		if err != nil {
			return dto.SLAClockListFilters{}, err
		}
		filters.DueBefore = &parsed
	}
	if includeResolved := strings.TrimSpace(q.Get("include_resolved")); includeResolved != "" {
		parsed, err := strconv.ParseBool(includeResolved)
		if err != nil {
			return dto.SLAClockListFilters{}, errors.New("invalid include_resolved; expected a boolean")
		}
		filters.IncludeResolved = parsed
	}
	return filters, nil
}

func parseSLADueBefore(raw string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339, "2006-01-02"} {
		if parsed, err := time.Parse(layout, raw); err == nil {
			return parsed.UTC(), nil
		}
	}
	return time.Time{}, errors.New("invalid due_before; expected RFC3339 or YYYY-MM-DD")
}
