package model

import (
	"time"

	"github.com/google/uuid"
)

// ClauseAmendmentStatus is the lifecycle of a proposed clause amendment:
// proposed (awaiting a decision) → accepted or rejected. Mirrors the
// status text column on contract_clause_amendments (migration 000072).
type ClauseAmendmentStatus string

const (
	ClauseAmendmentProposed ClauseAmendmentStatus = "proposed"
	ClauseAmendmentAccepted ClauseAmendmentStatus = "accepted"
	ClauseAmendmentRejected ClauseAmendmentStatus = "rejected"
)

// ContractClauseAmendment is a persisted proposed revision of a single contract
// clause (CAP-111): a reviewer proposes a redlined revision of the clause text
// (original_text → proposed_text) with a reason; a decider then accepts or
// rejects it. Accepted amendments are surfaceable in the contract's final
// review-desk recommendation (CAP-118). contract_id is denormalized so the
// list/recommendation read can scope by contract without a clause join.
// Mirrors MatterComment's flat denormalized shape.
type ContractClauseAmendment struct {
	ID           uuid.UUID             `json:"id"`
	TenantID     uuid.UUID             `json:"tenant_id"`
	ClauseID     uuid.UUID             `json:"clause_id"`
	ContractID   uuid.UUID             `json:"contract_id"`
	OriginalText string                `json:"original_text"`
	ProposedText string                `json:"proposed_text"`
	Reason       string                `json:"reason"`
	Status       ClauseAmendmentStatus `json:"status"`
	ProposedBy   uuid.UUID             `json:"proposed_by"`
	DecidedBy    *uuid.UUID            `json:"decided_by,omitempty"`
	DecidedAt    *time.Time            `json:"decided_at,omitempty"`
	CreatedAt    time.Time             `json:"created_at"`
}
