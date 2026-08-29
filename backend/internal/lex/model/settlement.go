package model

import (
	"time"

	"github.com/google/uuid"
)

// settlement.go models the Settlements / ADR vertical (CAP-089..093): the
// reconciliation/settlement aggregate that hangs off a legal_matter, its
// negotiation-round register, and its append-only audit log. Counterparty PII on
// the settlement row is field-encrypted at rest (FieldCrypto) — the stored values
// carry the "enc:v1:" prefix and are decrypted on read.

// SettlementStatus is the settlement FSM (CAP-089..093). A settlement opens as a
// reconciliation attempt, runs through negotiation, is recorded/approved, and is
// finally executed (closing the owning matter by reconciliation) or abandoned.
type SettlementStatus string

const (
	// SettlementStatusProposed — a reconciliation attempt has been opened (CAP-089).
	SettlementStatusProposed SettlementStatus = "proposed"
	// SettlementStatusNegotiating — negotiation rounds are in progress (CAP-091).
	SettlementStatusNegotiating SettlementStatus = "negotiating"
	// SettlementStatusPendingApproval — terms recorded, awaiting approval (CAP-092).
	SettlementStatusPendingApproval SettlementStatus = "pending_approval"
	// SettlementStatusApproved — the settlement has cleared the approval chain (CAP-092).
	SettlementStatusApproved SettlementStatus = "approved"
	// SettlementStatusExecuted — the approved settlement closed the matter by
	// reconciliation (CAP-093).
	SettlementStatusExecuted SettlementStatus = "executed"
	// SettlementStatusRejected — the approval chain rejected the settlement.
	SettlementStatusRejected SettlementStatus = "rejected"
	// SettlementStatusAbandoned — reconciliation failed / was withdrawn.
	SettlementStatusAbandoned SettlementStatus = "abandoned"
)

// Valid reports whether the settlement status is one of the allowed values.
func (s SettlementStatus) Valid() bool {
	switch s {
	case SettlementStatusProposed, SettlementStatusNegotiating, SettlementStatusPendingApproval,
		SettlementStatusApproved, SettlementStatusExecuted, SettlementStatusRejected, SettlementStatusAbandoned:
		return true
	default:
		return false
	}
}

// SettlementMethod records the ADR mechanism used.
type SettlementMethod string

const (
	SettlementMethodReconciliation SettlementMethod = "reconciliation"
	SettlementMethodMediation      SettlementMethod = "mediation"
	SettlementMethodArbitration    SettlementMethod = "arbitration"
	SettlementMethodNegotiation    SettlementMethod = "negotiation"
	SettlementMethodOther          SettlementMethod = "other"
)

// Valid reports whether the settlement method is allowed.
func (m SettlementMethod) Valid() bool {
	switch m {
	case SettlementMethodReconciliation, SettlementMethodMediation, SettlementMethodArbitration,
		SettlementMethodNegotiation, SettlementMethodOther:
		return true
	default:
		return false
	}
}

// Settlement is the reconciliation/settlement aggregate root (CAP-089..093). It
// FKs the owning legal_matter and carries the negotiated terms, value, and the
// approval-workflow link. Counterparty PII (name/contact/identifier) is stored
// field-encrypted at rest and decrypted on read.
type Settlement struct {
	ID                   uuid.UUID        `json:"id"`
	TenantID             uuid.UUID        `json:"tenant_id"`
	MatterID             uuid.UUID        `json:"matter_id"`
	Reference            string           `json:"reference"`
	Status               SettlementStatus `json:"status"`
	Method               SettlementMethod `json:"method"`
	Title                string           `json:"title"`
	Terms                string           `json:"terms"`
	Value                *float64         `json:"value,omitempty"`
	Currency             *string          `json:"currency,omitempty"`
	CounterpartyName     *string          `json:"counterparty_name,omitempty"`
	CounterpartyContact  *string          `json:"counterparty_contact,omitempty"`
	CounterpartyIDNumber *string          `json:"counterparty_id_number,omitempty"`
	WorkflowInstanceID   *uuid.UUID       `json:"workflow_instance_id,omitempty"`
	ApprovedBy           *uuid.UUID       `json:"approved_by,omitempty"`
	ApprovedAt           *time.Time       `json:"approved_at,omitempty"`
	ExecutedAt           *time.Time       `json:"executed_at,omitempty"`
	Metadata             map[string]any   `json:"metadata"`
	CreatedBy            uuid.UUID        `json:"created_by"`
	CreatedAt            time.Time        `json:"created_at"`
	UpdatedAt            time.Time        `json:"updated_at"`
	DeletedAt            *time.Time       `json:"deleted_at,omitempty"`

	Rounds []SettlementNegotiationRound `json:"rounds,omitempty"`
}

// SettlementNegotiationRound is one recorded negotiation round on a settlement
// (CAP-091): a numbered offer/counter-offer with the proposing party and value.
type SettlementNegotiationRound struct {
	ID            uuid.UUID      `json:"id"`
	TenantID      uuid.UUID      `json:"tenant_id"`
	SettlementID  uuid.UUID      `json:"settlement_id"`
	RoundNumber   int            `json:"round_number"`
	ProposedBy    string         `json:"proposed_by"`
	ProposedValue *float64       `json:"proposed_value,omitempty"`
	Currency      *string        `json:"currency,omitempty"`
	Terms         string         `json:"terms"`
	Outcome       string         `json:"outcome"`
	Metadata      map[string]any `json:"metadata"`
	CreatedBy     uuid.UUID      `json:"created_by"`
	CreatedAt     time.Time      `json:"created_at"`
}

// SettlementAuditEntry is one append-only governance audit row for a settlement
// (state transitions, negotiation, approval, execution). The audit table is
// INSERT-only at the RLS layer (no UPDATE/DELETE policy).
type SettlementAuditEntry struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	SettlementID uuid.UUID      `json:"settlement_id"`
	Action       string         `json:"action"`
	FromStatus   *string        `json:"from_status,omitempty"`
	ToStatus     *string        `json:"to_status,omitempty"`
	Detail       map[string]any `json:"detail"`
	ActorUserID  uuid.UUID      `json:"actor_user_id"`
	CreatedAt    time.Time      `json:"created_at"`
}

// SettlementListFilters scopes a settlement listing.
type SettlementListFilters struct {
	MatterID   *uuid.UUID
	Status     *SettlementStatus
	Method     *SettlementMethod
	Search     string
	Page       int
	PerPage    int
	SortColumn string
	SortDir    string
}
