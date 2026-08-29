package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// CreateSLATargetRequest creates one admin SLA target keyed on
// (service_code, priority) (CAP-012).
type CreateSLATargetRequest struct {
	ServiceCode               string                  `json:"service_code"`
	Priority                  model.SLATargetPriority `json:"priority"`
	TurnaroundWorkingDaysFrom int                     `json:"turnaround_working_days_from"`
	TurnaroundWorkingDays     int                     `json:"turnaround_working_days"`
	AckWindowValue            int                     `json:"ack_window_value"`
	AckWindowUnit             model.SLAAckUnit        `json:"ack_window_unit"`
	EscalationL1Days          int                     `json:"escalation_l1_days"`
	EscalationL2Days          int                     `json:"escalation_l2_days"`
	EscalationL3Days          int                     `json:"escalation_l3_days"`
	Active                    *bool                   `json:"active,omitempty"`
	Metadata                  map[string]any          `json:"metadata"`
}

func (r *CreateSLATargetRequest) Normalize() {
	r.ServiceCode = strings.TrimSpace(r.ServiceCode)
	r.Priority = model.SLATargetPriority(strings.ToLower(strings.TrimSpace(string(r.Priority))))
	// The From (lower-bound) figure is optional and backward-compatible: a caller
	// that omits it (or passes 0) gets from == to, i.e. a single-figure window
	// identical to the pre-window behaviour.
	if r.TurnaroundWorkingDaysFrom <= 0 {
		r.TurnaroundWorkingDaysFrom = r.TurnaroundWorkingDays
	}
	ackUnitMissing := strings.TrimSpace(string(r.AckWindowUnit)) == ""
	r.AckWindowUnit = model.SLAAckUnit(strings.ToLower(strings.TrimSpace(string(r.AckWindowUnit))))
	// Emergency shares the urgent acknowledgement shape (working-hours), so both
	// fast tiers default to hours; normal defaults to days.
	fastAck := r.Priority == model.SLATargetPriorityUrgent || r.Priority == model.SLATargetPriorityEmergency
	if r.AckWindowUnit == "" {
		if fastAck {
			r.AckWindowUnit = model.SLAAckUnitWorkingHours
		} else {
			r.AckWindowUnit = model.SLAAckUnitWorkingDays
		}
	}
	if ackUnitMissing && r.AckWindowValue == 0 {
		if fastAck {
			r.AckWindowValue = model.DefaultSLAAckUrgentWorkingHours
		} else {
			r.AckWindowValue = model.DefaultSLAAckNormalWorkingDays
		}
	}
	if r.EscalationL1Days == 0 {
		r.EscalationL1Days = model.DefaultSLAEscalationL1WorkingDaysAfterBreach
	}
	if r.EscalationL2Days == 0 {
		r.EscalationL2Days = model.DefaultSLAEscalationL2WorkingDaysAfterBreach
	}
	if r.EscalationL3Days == 0 {
		r.EscalationL3Days = model.DefaultSLAEscalationL3WorkingDaysAfterBreach
	}
}

// UpdateSLATargetRequest patches an SLA target. service_code/priority identity is
// immutable; the value/unit/escalation budget is editable.
type UpdateSLATargetRequest struct {
	TurnaroundWorkingDaysFrom *int              `json:"turnaround_working_days_from,omitempty"`
	TurnaroundWorkingDays     *int              `json:"turnaround_working_days,omitempty"`
	AckWindowValue            *int              `json:"ack_window_value,omitempty"`
	AckWindowUnit             *model.SLAAckUnit `json:"ack_window_unit,omitempty"`
	EscalationL1Days          *int              `json:"escalation_l1_days,omitempty"`
	EscalationL2Days          *int              `json:"escalation_l2_days,omitempty"`
	EscalationL3Days          *int              `json:"escalation_l3_days,omitempty"`
	Active                    *bool             `json:"active,omitempty"`
	Metadata                  map[string]any    `json:"metadata,omitempty"`
}

func (r *UpdateSLATargetRequest) Normalize() {
	if r.AckWindowUnit != nil {
		normalized := model.SLAAckUnit(strings.ToLower(strings.TrimSpace(string(*r.AckWindowUnit))))
		r.AckWindowUnit = &normalized
	}
}

// StartSLAClockRequest materialises a clock for a request whose completeness has
// been confirmed by Execution (CAP-012). service_code/priority are passed through
// so the SLA module need not import the request/catalogue Go packages; they are
// normally lifted from the legal_requests spine by the caller. calendar_id is
// optional (defaults to the tenant's default working calendar).
type StartSLAClockRequest struct {
	LegalRequestID      uuid.UUID               `json:"legal_request_id"`
	ServiceCode         string                  `json:"service_code"`
	Priority            model.SLATargetPriority `json:"priority"`
	BeneficiaryEntityID *uuid.UUID              `json:"beneficiary_entity_id,omitempty"`
	CalendarID          *uuid.UUID              `json:"calendar_id,omitempty"`
	StartedAt           *time.Time              `json:"started_at,omitempty"`
	Metadata            map[string]any          `json:"metadata"`
}

func (r *StartSLAClockRequest) Normalize() {
	r.ServiceCode = strings.TrimSpace(r.ServiceCode)
	r.Priority = model.SLATargetPriority(strings.ToLower(strings.TrimSpace(string(r.Priority))))
}

// AcknowledgeSLAClockRequest records that the request was acknowledged (stops the
// ack rung).
type AcknowledgeSLAClockRequest struct {
	AcknowledgedAt *time.Time `json:"acknowledged_at,omitempty"`
}

func (r *AcknowledgeSLAClockRequest) Normalize() {}

// TriggerSLAEscalationRequest forces an escalation to a specific rung (1/2/3),
// the manual override path on top of the monitor's automatic ladder (CAP-017/18/19).
type TriggerSLAEscalationRequest struct {
	Level int    `json:"level"`
	Note  string `json:"note"`
}

func (r *TriggerSLAEscalationRequest) Normalize() {
	r.Note = strings.TrimSpace(r.Note)
}

// DispatchSLAOutboxRequest drives a delivery pass over the SLA notification
// outbox via the shared dispatcher seam.
type DispatchSLAOutboxRequest struct {
	Provider string     `json:"provider"`
	Limit    *int       `json:"limit,omitempty"`
	Retry    bool       `json:"retry"`
	AsOf     *time.Time `json:"as_of,omitempty"`
}

func (r *DispatchSLAOutboxRequest) Normalize() {
	r.Provider = strings.TrimSpace(r.Provider)
}

// SLAClockListFilters is the list/sort surface for the operations-board clock
// view (WS9). All filters are optional; an empty filter set returns every
// unresolved clock for the tenant. due-before narrows to clocks whose turnaround
// deadline lands on or before the supplied instant (the "coming due" window an
// operations board scans).
type SLAClockListFilters struct {
	Page    int
	PerPage int

	// Outcome filters on the terminal verdict (pending|on_time|breached). Nil
	// means "any outcome".
	Outcome *model.SLAClockOutcome
	// Breached, when set, restricts to clocks whose breach flag matches.
	Breached *bool
	// EscalationLevel, when set, restricts to clocks currently at that rung (0-3).
	EscalationLevel *int
	// ServiceCode restricts to a single service line.
	ServiceCode string
	// Priority restricts to urgent|normal.
	Priority *model.SLATargetPriority
	// DueBefore restricts to clocks whose turnaround deadline is <= this instant.
	DueBefore *time.Time
	// IncludeResolved widens the default (unresolved-only) scope to also include
	// already-resolved clocks (for an audit/history board view).
	IncludeResolved bool

	SortColumn    string
	SortDirection string
}

// SLAClockView is the computed operations-board projection of a clock (WS9). It
// embeds the raw SLAClock and layers working-time-remaining, the next escalation
// recipient label, and risk flags so the board can render without re-deriving
// deadlines client-side. All computed values are evaluated against the SAME
// frozen working calendar (C-1) that materialised the clock, so the board agrees
// with the monitor.
type SLAClockView struct {
	model.SLAClock

	// EvaluatedAt is the instant the view was computed (the board "as of").
	EvaluatedAt time.Time `json:"evaluated_at"`

	// AckWorkingMinutesRemaining / TurnaroundWorkingMinutesRemaining are whole
	// working minutes left until the respective deadline, floored at zero once the
	// deadline has passed. Nil when the rung is already satisfied/terminal (ack
	// done, or clock resolved) so the board can distinguish "no countdown" from
	// "zero remaining".
	AckWorkingMinutesRemaining        *int `json:"ack_working_minutes_remaining,omitempty"`
	TurnaroundWorkingMinutesRemaining *int `json:"turnaround_working_minutes_remaining,omitempty"`

	// TurnaroundFromWorkingMinutesRemaining is the whole working minutes left until
	// the earliest-promise (From) instant of the From–To window, floored at zero
	// once that instant has passed. Nil when the clock is breached/resolved or the
	// From instant is unset — it drives the board's "earliest delivery" marker only
	// and never gates breach, which keys off the To deadline.
	TurnaroundFromWorkingMinutesRemaining *int `json:"turnaround_from_working_minutes_remaining,omitempty"`

	// NextEscalationLevel is the rung that would fire next (current level + 1, or
	// nil once the clock is at L3 / resolved). NextEscalationDueAt is its
	// materialised deadline, and NextEscalationRecipient is the resolved org
	// recipient label for that rung (empty on a coverage gap or before breach).
	NextEscalationLevel     *int       `json:"next_escalation_level,omitempty"`
	NextEscalationDueAt     *time.Time `json:"next_escalation_due_at,omitempty"`
	NextEscalationRecipient string     `json:"next_escalation_recipient,omitempty"`

	// AckOverdue is true when the ack rung lapsed without acknowledgement.
	AckOverdue bool `json:"ack_overdue"`
	// AckRisk is true when the ack rung is unsatisfied and within the imminence
	// window of its deadline (but not yet overdue).
	AckRisk bool `json:"ack_risk"`
	// BreachImminent is true when the (unbreached, unresolved) clock is within the
	// imminence window of its turnaround deadline.
	BreachImminent bool `json:"breach_imminent"`
	// EscalationImminent is true when the next escalation rung is within the
	// imminence window of firing.
	EscalationImminent bool `json:"escalation_imminent"`
}
