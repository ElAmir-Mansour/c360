package model

import (
	"time"

	"github.com/google/uuid"
)

// SLATargetPriority is the two-tier urgency classification a SLA target is keyed
// against. It mirrors RequestPriority (urgent|normal) but is declared locally so
// the SLA model does not couple to the request spine's Go types; the catalogue &
// SLA sheet (CAP-012) is published per (service_code, priority).
type SLATargetPriority string

const (
	SLATargetPriorityEmergency SLATargetPriority = "emergency"
	SLATargetPriorityUrgent    SLATargetPriority = "urgent"
	SLATargetPriorityNormal    SLATargetPriority = "normal"
)

const (
	// DefaultSLAAckUrgentWorkingHours is the default urgent acknowledgement
	// window: immediate through four working hours (CAP-014).
	DefaultSLAAckUrgentWorkingHours = 4
	// DefaultSLAAckNormalWorkingDays is the default normal acknowledgement
	// window: immediate through one working day (CAP-013).
	DefaultSLAAckNormalWorkingDays = 1

	// DefaultSLAEscalation*WorkingDaysAfterBreach are the fixed org-escalation
	// rungs after the turnaround deadline breaches (CAP-017/018/019).
	DefaultSLAEscalationL1WorkingDaysAfterBreach = 2
	DefaultSLAEscalationL2WorkingDaysAfterBreach = 4
	DefaultSLAEscalationL3WorkingDaysAfterBreach = 6
)

// Valid reports whether the priority is one of the allowed tiers.
func (p SLATargetPriority) Valid() bool {
	switch p {
	case SLATargetPriorityEmergency, SLATargetPriorityUrgent, SLATargetPriorityNormal:
		return true
	default:
		return false
	}
}

// SLAAckUnit selects the unit the acknowledgement window is measured in. Normal
// requests acknowledge within whole working DAYS (CAP-013); urgent requests
// within working HOURS (CAP-014). The unit is stored alongside the value so the
// clock materialiser knows whether to call AddWorkingDays or AddWorkingHours.
type SLAAckUnit string

const (
	SLAAckUnitWorkingDays  SLAAckUnit = "working_days"
	SLAAckUnitWorkingHours SLAAckUnit = "working_hours"
)

// Valid reports whether the ack unit is recognised.
func (u SLAAckUnit) Valid() bool {
	switch u {
	case SLAAckUnitWorkingDays, SLAAckUnitWorkingHours:
		return true
	default:
		return false
	}
}

// SLAClockOutcome is the terminal SLA verdict for a request once the turnaround
// deadline is reached or the request is delivered.
type SLAClockOutcome string

const (
	SLAClockOutcomePending  SLAClockOutcome = "pending"
	SLAClockOutcomeOnTime   SLAClockOutcome = "on_time"
	SLAClockOutcomeBreached SLAClockOutcome = "breached"
	// SLAClockOutcomeStopped terminates a cycle because the request was RETURNED
	// to the requester. It is deliberately neither on_time nor breached: the
	// department did not deliver, but neither did it miss a deadline it still
	// controlled, so counting it as either would corrupt the compliance ratio.
	// Excluded from every SLA outcome aggregate.
	SLAClockOutcomeStopped SLAClockOutcome = "stopped"
)

// Valid reports whether the outcome is recognised.
func (o SLAClockOutcome) Valid() bool {
	switch o {
	case SLAClockOutcomePending, SLAClockOutcomeOnTime, SLAClockOutcomeBreached,
		SLAClockOutcomeStopped:
		return true
	default:
		return false
	}
}

// Live reports whether the clock is still running — the single predicate the
// monitor, the "active clock" lookup and the restart guard all key off.
func (o SLAClockOutcome) Live() bool { return o == SLAClockOutcomePending }

// SLATarget is the admin-maintained per-(service_code, priority) SLA policy row
// (CAP-012). The delivery budget is published as a From–To working-day window:
// turnaround_working_days is the authoritative UPPER bound (the enforced deadline
// that breach/escalation key off), and turnaround_working_days_from is the LOWER
// bound (the earliest-promise figure) used for display only — it never changes any
// lifecycle/monitor/KPI semantics. The acknowledgement window is expressed as
// (ack_window_value, ack_window_unit) so Normal lands on working days and Urgent on
// working hours. Escalation offsets (L1/L2/L3, in working days) are stored here too
// so a single config row fully describes the clock that gets materialised on start.
type SLATarget struct {
	ID                        uuid.UUID         `json:"id"`
	TenantID                  uuid.UUID         `json:"tenant_id"`
	ServiceCode               string            `json:"service_code"`
	Priority                  SLATargetPriority `json:"priority"`
	TurnaroundWorkingDaysFrom int               `json:"turnaround_working_days_from"`
	TurnaroundWorkingDays     int               `json:"turnaround_working_days"`
	AckWindowValue            int               `json:"ack_window_value"`
	AckWindowUnit             SLAAckUnit        `json:"ack_window_unit"`
	EscalationL1Days          int               `json:"escalation_l1_days"`
	EscalationL2Days          int               `json:"escalation_l2_days"`
	EscalationL3Days          int               `json:"escalation_l3_days"`
	Active                    bool              `json:"active"`
	Metadata                  map[string]any    `json:"metadata"`
	CreatedBy                 uuid.UUID         `json:"created_by"`
	CreatedAt                 time.Time         `json:"created_at"`
	UpdatedAt                 time.Time         `json:"updated_at"`
	DeletedAt                 *time.Time        `json:"deleted_at,omitempty"`
}

// SLATargetListFilters is the list/search/sort surface for the target catalogue.
type SLATargetListFilters struct {
	Page          int
	PerPage       int
	Search        string
	ServiceCode   string
	Priority      *SLATargetPriority
	Active        *bool
	SortColumn    string
	SortDirection string
}

// SLAClock is the per-request, materialised deadline set (CAP-012). It is created
// once when Execution signals completeness ("clock start") and then driven by the
// sla_monitor. SLA owns this row, the breach flag, and the escalation ladder;
// Execution owns clock_started_at (recorded here at materialisation time but
// authoritatively sourced from the legal_requests spine).
type SLAClock struct {
	ID                  uuid.UUID         `json:"id"`
	TenantID            uuid.UUID         `json:"tenant_id"`
	LegalRequestID      uuid.UUID         `json:"legal_request_id"`
	SLATargetID         *uuid.UUID        `json:"sla_target_id,omitempty"`
	ServiceCode         string            `json:"service_code"`
	Priority            SLATargetPriority `json:"priority"`
	BeneficiaryEntityID *uuid.UUID        `json:"beneficiary_entity_id,omitempty"`
	ClockStartedAt      time.Time         `json:"clock_started_at"`
	AckDueAt            time.Time         `json:"ack_due_at"`
	// TurnaroundFromDueAt is the materialised earliest-promise instant (the lower
	// bound of the From–To window). It is display-only; breach/escalation still key
	// off TurnaroundDueAt (the enforced upper-bound deadline). Nullable: clocks
	// materialised before the From bound existed carry no value.
	TurnaroundFromDueAt *time.Time      `json:"turnaround_from_due_at,omitempty"`
	TurnaroundDueAt     time.Time       `json:"turnaround_due_at"`
	EscalationL1DueAt   time.Time       `json:"escalation_l1_due_at"`
	EscalationL2DueAt   time.Time       `json:"escalation_l2_due_at"`
	EscalationL3DueAt   time.Time       `json:"escalation_l3_due_at"`
	AckDone             bool            `json:"ack_done"`
	AckDoneAt           *time.Time      `json:"ack_done_at,omitempty"`
	EscalationLevel     int             `json:"escalation_level"`
	Breached            bool            `json:"breached"`
	BreachedAt          *time.Time      `json:"breached_at,omitempty"`
	Outcome             SLAClockOutcome `json:"outcome"`
	ResolvedAt          *time.Time      `json:"resolved_at,omitempty"`
	// Cycle is the 1-based submission round this clock measures. A request that
	// is returned and resubmitted accrues one clock per round: the returned round
	// ends 'stopped' and a fresh clock starts at cycle+1 with deadlines
	// materialised from the resubmission instant. At most one cycle per request
	// is ever live (partial unique index on outcome = 'pending').
	Cycle int `json:"cycle"`
	// StoppedAt is when this cycle was halted by a return to the requester. Set
	// if and only if Outcome is 'stopped'.
	StoppedAt *time.Time     `json:"stopped_at,omitempty"`
	Metadata  map[string]any `json:"metadata"`
	CreatedBy uuid.UUID      `json:"created_by"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

// SLANotificationType enumerates the SLA-driven notification kinds emitted onto
// the outbox by the monitor.
type SLANotificationType string

const (
	SLANotificationAck        SLANotificationType = "ack_due"
	SLANotificationBreach     SLANotificationType = "breach"
	SLANotificationEscalation SLANotificationType = "escalation"
)

// Valid reports whether the SLA notification type is recognised.
func (t SLANotificationType) Valid() bool {
	switch t {
	case SLANotificationAck, SLANotificationBreach, SLANotificationEscalation:
		return true
	default:
		return false
	}
}

// SLANotificationChannel mirrors the obligation channel set so the shared
// dispatcher seam can deliver SLA notifications without a bespoke channel layer.
type SLANotificationChannel string

const (
	SLANotificationChannelEmail    SLANotificationChannel = "email"
	SLANotificationChannelCalendar SLANotificationChannel = "calendar"
	SLANotificationChannelInApp    SLANotificationChannel = "in_app"
)

// SLANotificationOutboxStatus is the append-only outbox status machine (mirrors
// the obligation outbox in 000007).
type SLANotificationOutboxStatus string

const (
	SLANotificationOutboxPending SLANotificationOutboxStatus = "pending"
	SLANotificationOutboxSent    SLANotificationOutboxStatus = "sent"
	SLANotificationOutboxFailed  SLANotificationOutboxStatus = "failed"
)

// SLANotificationOutboxItem is one queued SLA notification. Dedup is enforced by a
// partial-unique index on (tenant, clock, event_type, escalation_level) so the
// idempotent monitor never double-emits an ack/breach/escalation for a clock.
type SLANotificationOutboxItem struct {
	ID                uuid.UUID                   `json:"id"`
	TenantID          uuid.UUID                   `json:"tenant_id"`
	SLAClockID        uuid.UUID                   `json:"sla_clock_id"`
	LegalRequestID    uuid.UUID                   `json:"legal_request_id"`
	EventID           uuid.UUID                   `json:"event_id"`
	EventType         SLANotificationType         `json:"event_type"`
	EscalationLevel   int                         `json:"escalation_level"`
	Channel           SLANotificationChannel      `json:"channel"`
	RecipientUserID   *uuid.UUID                  `json:"recipient_user_id,omitempty"`
	RecipientName     string                      `json:"recipient_name"`
	RecipientContact  *string                     `json:"recipient_contact,omitempty"`
	ScheduledAt       time.Time                   `json:"scheduled_at"`
	Status            SLANotificationOutboxStatus `json:"status"`
	Provider          string                      `json:"provider"`
	ProviderMessageID *string                     `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any              `json:"provider_metadata"`
	ErrorMessage      *string                     `json:"error_message,omitempty"`
	AttemptCount      int                         `json:"attempt_count"`
	LastAttemptAt     *time.Time                  `json:"last_attempt_at,omitempty"`
	SentAt            *time.Time                  `json:"sent_at,omitempty"`
	CreatedBy         uuid.UUID                   `json:"created_by"`
	CreatedAt         time.Time                   `json:"created_at"`
	UpdatedAt         time.Time                   `json:"updated_at"`
}

// SLAOutboxDispatchAttempt is the result of attempting delivery of one outbox row.
type SLAOutboxDispatchAttempt struct {
	OutboxID          uuid.UUID                   `json:"outbox_id"`
	SLAClockID        uuid.UUID                   `json:"sla_clock_id"`
	EventType         SLANotificationType         `json:"event_type"`
	Channel           SLANotificationChannel      `json:"channel"`
	PreviousStatus    SLANotificationOutboxStatus `json:"previous_status"`
	Status            SLANotificationOutboxStatus `json:"status"`
	Provider          string                      `json:"provider,omitempty"`
	ProviderMessageID *string                     `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any              `json:"provider_metadata,omitempty"`
	ErrorMessage      *string                     `json:"error_message,omitempty"`
	SkippedReason     string                      `json:"skipped_reason,omitempty"`
	Item              *SLANotificationOutboxItem  `json:"item,omitempty"`
}

// SLAOutboxDispatchResult aggregates a dispatch pass over the SLA outbox.
type SLAOutboxDispatchResult struct {
	Provider        string                     `json:"provider"`
	Retry           bool                       `json:"retry"`
	RequestedCount  int                        `json:"requested_count"`
	DispatchedCount int                        `json:"dispatched_count"`
	SentCount       int                        `json:"sent_count"`
	FailedCount     int                        `json:"failed_count"`
	SkippedCount    int                        `json:"skipped_count"`
	Attempts        []SLAOutboxDispatchAttempt `json:"attempts"`
}
