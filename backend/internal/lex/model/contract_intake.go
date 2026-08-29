package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractIntakeStatus tracks the review-desk intake lifecycle for a contract
// (CAP-100..105). The desk is the administrative funnel that sits in front of the
// existing contract-review workflow: receipt acknowledgement, routing to legal,
// completeness gating, return-to-requester, and deficiency notices.
type ContractIntakeStatus string

const (
	// ContractIntakeStatusReceived is the initial state once an intake is opened
	// and a reference number is assigned (CAP-100).
	ContractIntakeStatusReceived ContractIntakeStatus = "received"
	// ContractIntakeStatusAcknowledged records the receipt acknowledgement (CAP-101).
	ContractIntakeStatusAcknowledged ContractIntakeStatus = "acknowledged"
	// ContractIntakeStatusRoutedToLegal records routing to the legal desk (CAP-102).
	ContractIntakeStatusRoutedToLegal ContractIntakeStatus = "routed_to_legal"
	// ContractIntakeStatusUnderReview is set once completeness passes and the desk
	// takes the file into substantive review.
	ContractIntakeStatusUnderReview ContractIntakeStatus = "under_review"
	// ContractIntakeStatusReturned records a return-to-requester (CAP-104), usually
	// accompanied by a deficiency notice (CAP-105).
	ContractIntakeStatusReturned ContractIntakeStatus = "returned"
	// ContractIntakeStatusCompleted is the terminal desk state once the file has
	// been distributed / a final recommendation recorded.
	ContractIntakeStatusCompleted ContractIntakeStatus = "completed"
)

// Valid reports whether the status is a known intake status.
func (s ContractIntakeStatus) Valid() bool {
	switch s {
	case ContractIntakeStatusReceived,
		ContractIntakeStatusAcknowledged,
		ContractIntakeStatusRoutedToLegal,
		ContractIntakeStatusUnderReview,
		ContractIntakeStatusReturned,
		ContractIntakeStatusCompleted:
		return true
	default:
		return false
	}
}

// ContractIntake is the singleton-per-contract review-desk intake record
// (CAP-100..105). It carries the auto-generated desk reference number, the
// receipt acknowledgement, the routing/return state machine, and the last
// completeness snapshot. PII-free: it references the contract by id and never
// duplicates party data.
type ContractIntake struct {
	ID                   uuid.UUID            `json:"id"`
	TenantID             uuid.UUID            `json:"tenant_id"`
	ContractID           uuid.UUID            `json:"contract_id"`
	ReferenceNumber      string               `json:"reference_number"`
	Status               ContractIntakeStatus `json:"status"`
	ReceivedAt           time.Time            `json:"received_at"`
	AcknowledgedAt       *time.Time           `json:"acknowledged_at,omitempty"`
	AcknowledgedBy       *uuid.UUID           `json:"acknowledged_by,omitempty"`
	RoutedToLegalAt      *time.Time           `json:"routed_to_legal_at,omitempty"`
	RoutedToLegalBy      *uuid.UUID           `json:"routed_to_legal_by,omitempty"`
	AssignedReviewerID   *uuid.UUID           `json:"assigned_reviewer_id,omitempty"`
	AssignedReviewerName *string              `json:"assigned_reviewer_name,omitempty"`
	CompletenessChecked  bool                 `json:"completeness_checked"`
	CompletenessPassed   bool                 `json:"completeness_passed"`
	LastCheckedAt        *time.Time           `json:"last_checked_at,omitempty"`
	ReturnedAt           *time.Time           `json:"returned_at,omitempty"`
	ReturnedBy           *uuid.UUID           `json:"returned_by,omitempty"`
	ReturnReason         *string              `json:"return_reason,omitempty"`
	DeficiencyNotice     *string              `json:"deficiency_notice,omitempty"`
	Metadata             map[string]any       `json:"metadata"`
	CreatedBy            uuid.UUID            `json:"created_by"`
	CreatedAt            time.Time            `json:"created_at"`
	UpdatedAt            time.Time            `json:"updated_at"`
}
