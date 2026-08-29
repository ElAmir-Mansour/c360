package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/clario360/platform/internal/notification/model"
	notifservice "github.com/clario360/platform/internal/notification/service"
)

type internalNotificationRequest struct {
	TenantID      string                 `json:"tenant_id"`
	UserID        string                 `json:"user_id"`
	Type          string                 `json:"type"`
	Category      string                 `json:"category"`
	Priority      string                 `json:"priority"`
	Title         string                 `json:"title"`
	Body          string                 `json:"body"`
	ActionURL     string                 `json:"action_url"`
	SourceEventID string                 `json:"source_event_id"`
	Data          map[string]interface{} `json:"data"`
	Channels      []string               `json:"channels"`
	// PreferredLocale lets a producer pass the recipient's resolved locale
	// (from their profile/tenant default) so it is captured at enqueue time for
	// the async email render. Optional; empty falls back to the KSA default.
	PreferredLocale string `json:"preferred_locale"`
}

func (h *AdminHandler) CreateInternalNotification(w http.ResponseWriter, r *http.Request) {
	var req internalNotificationRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error(), r)
		return
	}
	if err := req.validate(); err != nil {
		writeErrorResponse(w, http.StatusBadRequest, "INVALID_REQUEST", err.Error(), r)
		return
	}
	if err := h.notifSvc.CreateNotification(r.Context(), notifservice.CreateNotificationRequest{
		TenantID:        req.TenantID,
		UserID:          req.UserID,
		Type:            model.NotificationType(req.Type),
		Category:        req.Category,
		Priority:        req.Priority,
		Title:           req.Title,
		Body:            req.Body,
		ActionURL:       req.ActionURL,
		SourceEventID:   req.SourceEventID,
		Data:            req.Data,
		Channels:        req.Channels,
		RecipientLocale: req.PreferredLocale,
	}); err != nil {
		h.logger.Error().Err(err).Msg("failed to create internal notification")
		writeErrorResponse(w, http.StatusInternalServerError, "INTERNAL_ERROR", "failed to create notification", r)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]interface{}{
		"success":         true,
		"notification_id": strings.TrimSpace(req.SourceEventID),
	})
}

func (r internalNotificationRequest) validate() error {
	if strings.TrimSpace(r.TenantID) == "" {
		return fmt.Errorf("tenant_id is required")
	}
	if strings.TrimSpace(r.UserID) == "" {
		return fmt.Errorf("user_id is required")
	}
	if strings.TrimSpace(r.Type) == "" {
		return fmt.Errorf("type is required")
	}
	if strings.TrimSpace(r.Category) == "" {
		return fmt.Errorf("category is required")
	}
	if strings.TrimSpace(r.Priority) == "" {
		return fmt.Errorf("priority is required")
	}
	if strings.TrimSpace(r.Title) == "" {
		return fmt.Errorf("title is required")
	}
	if strings.TrimSpace(r.Body) == "" {
		return fmt.Errorf("body is required")
	}
	return nil
}
