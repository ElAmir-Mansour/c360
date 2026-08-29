package dto

import (
	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// --- in-app inbox ----------------------------------------------------------

// NotificationInboxListResponse is one inbox row returned to the FE.
type NotificationInboxResponse struct {
	ID         uuid.UUID                  `json:"id"`
	Category   model.NotificationCategory `json:"category"`
	Title      forms.LocalizedText        `json:"title"`
	Body       forms.LocalizedText        `json:"body"`
	EntityType *string                    `json:"entity_type,omitempty"`
	EntityID   *uuid.UUID                 `json:"entity_id,omitempty"`
	ActionURL  *string                    `json:"action_url,omitempty"`
	Metadata   map[string]any             `json:"metadata"`
	Read       bool                       `json:"read"`
	ReadAt     *string                    `json:"read_at,omitempty"`
	CreatedAt  string                     `json:"created_at"`
}

// NotificationInboxCountsResponse carries badge counts.
type NotificationInboxCountsResponse struct {
	Total  int `json:"total"`
	Unread int `json:"unread"`
}

// MarkAllReadResponse reports how many rows were marked read.
type MarkAllReadResponse struct {
	Updated int64 `json:"updated"`
}

// --- subscriptions ---------------------------------------------------------

// UpsertNotificationSubscriptionRequest creates/updates a per-user override.
type UpsertNotificationSubscriptionRequest struct {
	Category model.NotificationCategory `json:"category"`
	Channel  model.NotificationChannel  `json:"channel"`
	Enabled  bool                       `json:"enabled"`
}

// Validate checks the category/channel enums.
func (r UpsertNotificationSubscriptionRequest) Validate() map[string]string {
	fields := map[string]string{}
	if !model.ValidNotificationCategory(r.Category) {
		fields["category"] = "must be one of request, case, hearing, judgment, contract, general"
	}
	if !model.ValidNotificationChannel(r.Channel) {
		fields["channel"] = "must be one of in_app, email"
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// NotificationSubscriptionResponse is one persisted override.
type NotificationSubscriptionResponse struct {
	ID        uuid.UUID                  `json:"id"`
	Category  model.NotificationCategory `json:"category"`
	Channel   model.NotificationChannel  `json:"channel"`
	Enabled   bool                       `json:"enabled"`
	CreatedAt string                     `json:"created_at"`
	UpdatedAt string                     `json:"updated_at"`
}
