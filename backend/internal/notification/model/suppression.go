package model

import "time"

// Suppression reason values. Presence of a suppression row hard-blocks outbound
// delivery on a channel for a user regardless of their channel preferences.
const (
	SuppressionReasonBounce      = "bounce"
	SuppressionReasonComplaint   = "complaint"
	SuppressionReasonUnsubscribe = "unsubscribe"
	SuppressionReasonManual      = "manual"
)

// Suppression is a per-user, per-channel delivery suppression entry (compliance:
// unsubscribes, hard bounces, spam complaints). It is keyed by
// (tenant_id, user_id, channel); the dispatcher consults it before delivering on
// suppressible outbound channels (email, webhook).
type Suppression struct {
	TenantID  string    `json:"tenant_id" db:"tenant_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	Channel   string    `json:"channel" db:"channel"`
	Reason    string    `json:"reason" db:"reason"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}
