package model

import (
	"time"

	"github.com/google/uuid"
)

// NotificationChannel enumerates the delivery channels a subscription can toggle.
// in_app is the durable inbox (always available); email is fanned out through the
// shared obligation-reminder dispatcher seam (CAP-157).
type NotificationChannel string

const (
	NotificationChannelInApp NotificationChannel = "in_app"
	NotificationChannelEmail NotificationChannel = "email"
)

// ValidNotificationChannel reports whether c is a known channel.
func ValidNotificationChannel(c NotificationChannel) bool {
	switch c {
	case NotificationChannelInApp, NotificationChannelEmail:
		return true
	default:
		return false
	}
}

// NotificationSubscription is a per-user, per-(category,channel) override of the
// default-on notification behaviour. A row with enabled=false suppresses delivery
// of that category on that channel for that user; the absence of a row means the
// channel is enabled by default (opt-out model). The consumer/monitor consult
// these before writing an inbox row / enqueuing an email.
type NotificationSubscription struct {
	ID        uuid.UUID            `json:"id"`
	TenantID  uuid.UUID            `json:"tenant_id"`
	UserID    uuid.UUID            `json:"user_id"`
	Category  NotificationCategory `json:"category"`
	Channel   NotificationChannel  `json:"channel"`
	Enabled   bool                 `json:"enabled"`
	CreatedBy uuid.UUID            `json:"created_by"`
	CreatedAt time.Time            `json:"created_at"`
	UpdatedAt time.Time            `json:"updated_at"`
}

// NotificationSubscriptionListFilters filters a user's subscription overrides.
type NotificationSubscriptionListFilters struct {
	Category *NotificationCategory
	Channel  *NotificationChannel
}

// UpcomingHearing is the read-only projection the ProximityMonitor (CAP-162)
// scans from legal_case_hearings joined to legal_cases. The recipient resolution
// fields (handling_officer_id, supervisor_id, section_manager_id) are the case
// owners the reminder is delivered to; CaseTitle carries the bilingual case title
// for the notification body.
type UpcomingHearing struct {
	HearingID         uuid.UUID  `json:"hearing_id"`
	TenantID          uuid.UUID  `json:"tenant_id"`
	CaseID            uuid.UUID  `json:"case_id"`
	CaseNumber        string     `json:"case_number"`
	CaseTitle         []byte     `json:"-"`
	HearingDate       time.Time  `json:"hearing_date"`
	Location          *string    `json:"location,omitempty"`
	HandlingOfficerID *uuid.UUID `json:"handling_officer_id,omitempty"`
	SupervisorID      *uuid.UUID `json:"supervisor_id,omitempty"`
	SectionManagerID  *uuid.UUID `json:"section_manager_id,omitempty"`
}

// Recipients returns the distinct, non-nil case-owner user ids the hearing
// reminder should be delivered to, owner-first.
func (h UpcomingHearing) Recipients() []uuid.UUID {
	out := make([]uuid.UUID, 0, 3)
	seen := map[uuid.UUID]struct{}{}
	for _, id := range []*uuid.UUID{h.HandlingOfficerID, h.SupervisorID, h.SectionManagerID} {
		if id == nil || *id == uuid.Nil {
			continue
		}
		if _, ok := seen[*id]; ok {
			continue
		}
		seen[*id] = struct{}{}
		out = append(out, *id)
	}
	return out
}
