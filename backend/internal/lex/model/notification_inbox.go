package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// NotificationCategory groups inbox rows so the FE can tab/filter them and so a
// per-user subscription can mute one category without muting the whole inbox.
// Categories mirror the Phase-4 trigger surface (CAP-158..164).
type NotificationCategory string

const (
	// NotificationCategoryRequest covers request lifecycle triggers: receipt
	// (CAP-158), transfer (CAP-159), additional-info (CAP-160), status update
	// (CAP-161).
	NotificationCategoryRequest NotificationCategory = "request"
	// NotificationCategoryCase covers litigation-case lifecycle/status triggers.
	NotificationCategoryCase NotificationCategory = "case"
	// NotificationCategoryHearing covers approaching-hearing-date reminders
	// (CAP-162).
	NotificationCategoryHearing NotificationCategory = "hearing"
	// NotificationCategoryJudgment covers judgment/decision issuance (CAP-164).
	NotificationCategoryJudgment NotificationCategory = "judgment"
	// NotificationCategoryContract covers contract-expiry reminders (CAP-163,
	// already emitted by the ExpiryMonitor; the inbox row is written when that
	// event is consumed).
	NotificationCategoryContract NotificationCategory = "contract"
	// NotificationCategoryGeneral is the catch-all bucket.
	NotificationCategoryGeneral NotificationCategory = "general"
)

// ValidNotificationCategory reports whether c is a known category.
func ValidNotificationCategory(c NotificationCategory) bool {
	switch c {
	case NotificationCategoryRequest, NotificationCategoryCase, NotificationCategoryHearing,
		NotificationCategoryJudgment, NotificationCategoryContract, NotificationCategoryGeneral:
		return true
	default:
		return false
	}
}

// NotificationInboxItem is one durable in-app notification for a recipient user.
// It is the lex-side, self-owned in-app inbox (CAP-156): rather than coupling to
// the platform notification-service RuleEngine, the lex consumer/monitor writes
// rows here directly and (optionally) fans an email copy out through the shared
// obligation-reminder dispatcher seam.
//
// Bilingual content (title/body) is forms.LocalizedText so the FE renders the
// active locale. dedup_key enforces idempotency: a partial-unique index on
// (tenant, recipient, dedup_key) lets a re-fired event/monitor pass be swallowed
// (mirrors the SLA/obligation outbox dedup idiom).
type NotificationInboxItem struct {
	ID          uuid.UUID            `json:"id"`
	TenantID    uuid.UUID            `json:"tenant_id"`
	RecipientID uuid.UUID            `json:"recipient_id"`
	Category    NotificationCategory `json:"category"`
	Title       forms.LocalizedText  `json:"title"`
	Body        forms.LocalizedText  `json:"body"`
	// EntityType/EntityID loosely reference the originating resource (e.g.
	// 'legal_request', 'legal_case', 'legal_case_hearing', 'legal_judgment',
	// 'contract'); no hard FK so the inbox survives source soft-deletes.
	EntityType *string    `json:"entity_type,omitempty"`
	EntityID   *uuid.UUID `json:"entity_id,omitempty"`
	// ActionURL is the in-app deep link the FE opens when the row is clicked.
	ActionURL *string `json:"action_url,omitempty"`
	// EventID is the originating CloudEvents id when the row was written by the
	// consumer (nil for monitor-authored rows).
	EventID *uuid.UUID `json:"event_id,omitempty"`
	// DedupKey is the idempotency key (e.g. "request.received:<id>" or
	// "hearing.proximity:<hearing_id>:7"). NULL rows are never deduped.
	DedupKey  *string        `json:"dedup_key,omitempty"`
	Metadata  map[string]any `json:"metadata"`
	ReadAt    *time.Time     `json:"read_at,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// IsRead reports whether the row has been marked read.
func (n *NotificationInboxItem) IsRead() bool { return n != nil && n.ReadAt != nil }

// NotificationInboxListFilters is the paginated/filterable inbox query shape.
type NotificationInboxListFilters struct {
	Page          int
	PerPage       int
	Category      *NotificationCategory
	UnreadOnly    bool
	SortColumn    string
	SortDirection string
}

// NotificationInboxCounts summarizes a recipient's inbox for badge rendering.
type NotificationInboxCounts struct {
	Total  int `json:"total"`
	Unread int `json:"unread"`
}
