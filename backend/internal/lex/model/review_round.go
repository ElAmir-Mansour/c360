package model

import (
	"time"

	"github.com/google/uuid"
)

// ReturnIncompleteReasonCode is the controlled deficiency list prescribed by
// the Al Othaim request-intake workflow. A free-text detail may accompany the
// selected code, but the category remains stable for reporting and audit.
type ReturnIncompleteReasonCode string

const (
	ReturnReasonMissingInformation           ReturnIncompleteReasonCode = "missing_information"
	ReturnReasonDoANonCompliance             ReturnIncompleteReasonCode = "doa_non_compliance"
	ReturnReasonIncompleteReferralProcedures ReturnIncompleteReasonCode = "incomplete_referral_procedures"
	ReturnReasonInvalidAttachments           ReturnIncompleteReasonCode = "invalid_attachments"
)

func (c ReturnIncompleteReasonCode) Valid() bool {
	switch c {
	case ReturnReasonMissingInformation, ReturnReasonDoANonCompliance,
		ReturnReasonIncompleteReferralProcedures, ReturnReasonInvalidAttachments:
		return true
	default:
		return false
	}
}

func (c ReturnIncompleteReasonCode) Label() string {
	switch c {
	case ReturnReasonMissingInformation:
		return "Complete missing information"
	case ReturnReasonDoANonCompliance:
		return "Non-compliance with the Delegation of Authority (DOA) matrix"
	case ReturnReasonIncompleteReferralProcedures:
		return "Failure to complete the referral procedures"
	case ReturnReasonInvalidAttachments:
		return "Invalidity of attached documents"
	default:
		return ""
	}
}

// ReviewRoundOutcome is the terminal disposition of a review round (CAP-025,
// CAP-026). A round either accepts the delivered work, returns it incomplete to
// the requester, or is the final auto-close round (the second return).
type ReviewRoundOutcome string

const (
	ReviewRoundOutcomeAccepted   ReviewRoundOutcome = "accepted"
	ReviewRoundOutcomeReturned   ReviewRoundOutcome = "returned"
	ReviewRoundOutcomeAutoClosed ReviewRoundOutcome = "auto_closed"
)

// Valid reports whether the outcome is a known review-round disposition.
func (o ReviewRoundOutcome) Valid() bool {
	switch o {
	case ReviewRoundOutcomeAccepted, ReviewRoundOutcomeReturned, ReviewRoundOutcomeAutoClosed:
		return true
	default:
		return false
	}
}

// ReviewRound is one return-incomplete review cycle for a request (CAP-025). The
// round is opened when the provider returns the request incomplete and closed
// with an outcome. After the SECOND returned round the engine auto-closes the
// request and spawns a clone (CAP-026).
type ReviewRound struct {
	ID             uuid.UUID           `json:"id"`
	TenantID       uuid.UUID           `json:"tenant_id"`
	LegalRequestID uuid.UUID           `json:"legal_request_id"`
	RoundNo        int                 `json:"round_no"`
	Reason         string              `json:"reason"`
	Outcome        *ReviewRoundOutcome `json:"outcome,omitempty"`
	OpenedBy       uuid.UUID           `json:"opened_by"`
	OpenedAt       time.Time           `json:"opened_at"`
	ClosedBy       *uuid.UUID          `json:"closed_by,omitempty"`
	ClosedAt       *time.Time          `json:"closed_at,omitempty"`
	Metadata       map[string]any      `json:"metadata"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
}
