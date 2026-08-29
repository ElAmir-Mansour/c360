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

// NotificationHandler serves the durable in-app inbox (CAP-156) and per-user
// subscription overrides (CAP-157). The inbox is always scoped to the
// authenticated user (recipient = userID); a user can never read another user's
// inbox. Gated lex:read (reads) / lex:write (mutations) by the route wiring.
type NotificationHandler struct {
	baseHandler
	service *service.LexNotificationService
}

func NewNotificationHandler(service *service.LexNotificationService, logger zerolog.Logger) *NotificationHandler {
	return &NotificationHandler{baseHandler: baseHandler{logger: logger}, service: service}
}

// --- inbox ------------------------------------------------------------------

func (h *NotificationHandler) ListInbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	filters := parseNotificationInboxFilters(r)
	items, total, err := h.service.ListInbox(r.Context(), tenantID, userID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WritePaginated(w, http.StatusOK, items, filters.Page, filters.PerPage, total)
}

func (h *NotificationHandler) GetInbox(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.GetInbox(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *NotificationHandler) Counts(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	counts, err := h.service.Counts(r.Context(), tenantID, userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, counts)
}

func (h *NotificationHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	item, err := h.service.MarkRead(r.Context(), tenantID, userID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *NotificationHandler) MarkAllRead(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	updated, err := h.service.MarkAllRead(r.Context(), tenantID, userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, dto.MarkAllReadResponse{Updated: updated})
}

// --- subscriptions ----------------------------------------------------------

func (h *NotificationHandler) ListSubscriptions(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	filters := parseNotificationSubscriptionFilters(r)
	items, err := h.service.ListSubscriptions(r.Context(), tenantID, userID, filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, items)
}

func (h *NotificationHandler) UpsertSubscription(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var req dto.UpsertNotificationSubscriptionRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", "invalid request body", nil)
		return
	}
	item, err := h.service.UpsertSubscription(r.Context(), tenantID, userID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, item)
}

func (h *NotificationHandler) DeleteSubscription(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "VALIDATION_ERROR", err.Error(), nil)
		return
	}
	if err := h.service.DeleteSubscription(r.Context(), tenantID, userID, id); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func parseNotificationInboxFilters(r *http.Request) model.NotificationInboxListFilters {
	page, perPage := suiteapi.ParsePagination(r)
	filters := model.NotificationInboxListFilters{
		Page:          page,
		PerPage:       perPage,
		SortColumn:    strings.TrimSpace(r.URL.Query().Get("sort")),
		SortDirection: strings.TrimSpace(r.URL.Query().Get("order")),
	}
	if category := strings.TrimSpace(r.URL.Query().Get("category")); category != "" {
		value := model.NotificationCategory(category)
		filters.Category = &value
	}
	if unread := strings.TrimSpace(r.URL.Query().Get("unread")); unread != "" {
		if parsed, err := strconv.ParseBool(unread); err == nil {
			filters.UnreadOnly = parsed
		}
	}
	return filters
}

func parseNotificationSubscriptionFilters(r *http.Request) model.NotificationSubscriptionListFilters {
	filters := model.NotificationSubscriptionListFilters{}
	if category := strings.TrimSpace(r.URL.Query().Get("category")); category != "" {
		value := model.NotificationCategory(category)
		filters.Category = &value
	}
	if channel := strings.TrimSpace(r.URL.Query().Get("channel")); channel != "" {
		value := model.NotificationChannel(channel)
		filters.Channel = &value
	}
	return filters
}
