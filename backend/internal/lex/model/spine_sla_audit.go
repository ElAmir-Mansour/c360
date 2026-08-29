package model

import (
	"time"

	"github.com/google/uuid"
)

// LegalRequestAuditEntry is one append-only governance audit row for the request
// spine (WS4): every material status transition records who moved it, from/to
// status, an optional reason, and a free-form detail payload. Written INSIDE the
// transition transaction so the row and the status flip commit atomically.
// Immutable: there is no update/delete path.
type LegalRequestAuditEntry struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	RequestID   uuid.UUID      `json:"request_id"`
	Action      string         `json:"action"`
	FromStatus  *string        `json:"from_status,omitempty"`
	ToStatus    *string        `json:"to_status,omitempty"`
	Reason      *string        `json:"reason,omitempty"`
	Detail      map[string]any `json:"detail"`
	ActorUserID *uuid.UUID     `json:"actor_user_id,omitempty"`
	// ActorName is a TRANSIENT display name resolved from the workforce directory
	// at read time (RequestAudit) — never persisted (no column, not in the INSERT
	// or the explicit-column SELECT). Nil when unresolved; the FE falls back to
	// the UUID so embedded/partial deployments keep working.
	ActorName *string   `json:"actor_name,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// LegalSLAAuditEntry is one append-only governance audit row for the SLA clock
// state machine (WS4): clock_started / acknowledged / breached / escalated /
// resolved. Written INSIDE the SLA mutation transaction. Immutable.
type LegalSLAAuditEntry struct {
	ID              uuid.UUID      `json:"id"`
	TenantID        uuid.UUID      `json:"tenant_id"`
	SLAClockID      uuid.UUID      `json:"sla_clock_id"`
	LegalRequestID  uuid.UUID      `json:"legal_request_id"`
	Action          string         `json:"action"`
	FromStatus      *string        `json:"from_status,omitempty"`
	ToStatus        *string        `json:"to_status,omitempty"`
	Reason          *string        `json:"reason,omitempty"`
	EscalationLevel int            `json:"escalation_level"`
	Detail          map[string]any `json:"detail"`
	ActorUserID     *uuid.UUID     `json:"actor_user_id,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
}
