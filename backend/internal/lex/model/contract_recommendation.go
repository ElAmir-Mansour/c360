package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractRecommendationOutcome is the final review-desk recommendation on a
// contract (CAP-118): approved as-is, or returned needing amendment.
type ContractRecommendationOutcome string

const (
	// ContractRecommendationOutcomeApproved recommends the contract for approval
	// as drafted (CAP-118).
	ContractRecommendationOutcomeApproved ContractRecommendationOutcome = "approved"
	// ContractRecommendationOutcomeNeedsAmendment returns the contract with
	// required amendments (CAP-118/CAP-119).
	ContractRecommendationOutcomeNeedsAmendment ContractRecommendationOutcome = "needs_amendment"
	// ContractRecommendationOutcomeRejected rejects the contract outright with a
	// rejection reason (CAP-119).
	ContractRecommendationOutcomeRejected ContractRecommendationOutcome = "rejected"
)

// Valid reports whether the outcome is a known recommendation outcome.
func (o ContractRecommendationOutcome) Valid() bool {
	switch o {
	case ContractRecommendationOutcomeApproved,
		ContractRecommendationOutcomeNeedsAmendment,
		ContractRecommendationOutcomeRejected:
		return true
	default:
		return false
	}
}

// ContractRecommendation is the final review-desk recommendation record
// (CAP-118..120). When the outcome is "approved" the desk hands the file to the
// existing contract-review workflow (WorkflowService.StartContractReview) for the
// Contracts-Manager approval (CAP-120); the resulting workflow instance id is
// stored back here. The amendment/rejection reasons (CAP-119) are mandatory for
// the non-approved outcomes. Append-only: a superseding recommendation marks the
// prior row superseded rather than mutating it, preserving the decision trail.
type ContractRecommendation struct {
	ID                 uuid.UUID                     `json:"id"`
	TenantID           uuid.UUID                     `json:"tenant_id"`
	ContractID         uuid.UUID                     `json:"contract_id"`
	IntakeID           *uuid.UUID                    `json:"intake_id,omitempty"`
	Outcome            ContractRecommendationOutcome `json:"outcome"`
	Summary            string                        `json:"summary"`
	AmendmentReason    *string                       `json:"amendment_reason,omitempty"`
	RejectionReason    *string                       `json:"rejection_reason,omitempty"`
	WorkflowInstanceID *uuid.UUID                    `json:"workflow_instance_id,omitempty"`
	Superseded         bool                          `json:"superseded"`
	RecommendedByName  *string                       `json:"recommended_by_name,omitempty"`
	Metadata           map[string]any                `json:"metadata"`
	CreatedBy          uuid.UUID                     `json:"created_by"`
	CreatedAt          time.Time                     `json:"created_at"`
	UpdatedAt          time.Time                     `json:"updated_at"`
}
