package model

import (
	"time"

	"github.com/google/uuid"
)

// ExecutionStatus is the lifecycle of the per-request execution clock (CAP-022,
// CAP-023). A request enters execution as "awaiting_completeness"; once the
// provider confirms a COMPLETE request the clock starts ("in_progress"); the
// provider either delivers ("delivered") or returns it incomplete ("returned").
// After two review rounds without acceptance the engine auto-closes the request
// and spawns a clone ("auto_closed", CAP-026).
type ExecutionStatus string

const (
	ExecutionStatusAwaitingCompleteness ExecutionStatus = "awaiting_completeness"
	ExecutionStatusInProgress           ExecutionStatus = "in_progress"
	ExecutionStatusDelivered            ExecutionStatus = "delivered"
	ExecutionStatusReturned             ExecutionStatus = "returned"
	ExecutionStatusAutoClosed           ExecutionStatus = "auto_closed"
	ExecutionStatusClosed               ExecutionStatus = "closed"
)

// Valid reports whether the status is a known execution-state value.
func (s ExecutionStatus) Valid() bool {
	switch s {
	case ExecutionStatusAwaitingCompleteness, ExecutionStatusInProgress,
		ExecutionStatusDelivered, ExecutionStatusReturned,
		ExecutionStatusAutoClosed, ExecutionStatusClosed:
		return true
	default:
		return false
	}
}

// ExecutionState is the singleton per-request execution record (one row per
// legal_request_id). Execution OWNS the execution clock: clock_started_at,
// sla_target_seconds and the completeness flag are written here and the
// clock-start event is what the SLA module consumes (it never imports this
// package). review_round_count drives the CAP-026 two-round auto-close.
type ExecutionState struct {
	ID                    uuid.UUID       `json:"id"`
	TenantID              uuid.UUID       `json:"tenant_id"`
	LegalRequestID        uuid.UUID       `json:"legal_request_id"`
	Status                ExecutionStatus `json:"status"`
	ClockStartedAt        *time.Time      `json:"clock_started_at,omitempty"`
	CompletenessConfirmed *time.Time      `json:"completeness_confirmed_at,omitempty"`
	SLATargetSeconds      *int64          `json:"sla_target_seconds,omitempty"`
	WorkingCalendarID     *uuid.UUID      `json:"working_calendar_id,omitempty"`
	ReviewRoundCount      int             `json:"review_round_count"`
	MaxReviewRounds       int             `json:"max_review_rounds"`
	ClonedFromRequestID   *uuid.UUID      `json:"cloned_from_request_id,omitempty"`
	CloneRequestID        *uuid.UUID      `json:"clone_request_id,omitempty"`
	DeliveredAt           *time.Time      `json:"delivered_at,omitempty"`
	ClosedAt              *time.Time      `json:"closed_at,omitempty"`
	Metadata              map[string]any  `json:"metadata"`
	CreatedBy             uuid.UUID       `json:"created_by"`
	CreatedAt             time.Time       `json:"created_at"`
	UpdatedAt             time.Time       `json:"updated_at"`
}

// ExecutionAuditEntry is one append-only row in the execution audit trail
// (legal_request_execution_audit_log). The log is immutable: rows are only ever
// inserted, never updated or deleted (CAP-024).
type ExecutionAuditEntry struct {
	ID             uuid.UUID      `json:"id"`
	TenantID       uuid.UUID      `json:"tenant_id"`
	LegalRequestID uuid.UUID      `json:"legal_request_id"`
	Action         string         `json:"action"`
	FromStatus     *string        `json:"from_status,omitempty"`
	ToStatus       *string        `json:"to_status,omitempty"`
	Detail         map[string]any `json:"detail"`
	ActorUserID    uuid.UUID      `json:"actor_user_id"`
	CreatedAt      time.Time      `json:"created_at"`
}
