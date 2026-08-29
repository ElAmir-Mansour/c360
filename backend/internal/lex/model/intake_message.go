package model

import (
	"time"

	"github.com/google/uuid"
)

// IntakeMessageStatus is the lifecycle of an ingested email intake message
// (CAP-002). An accepted message lands as `received`, is `classified` by the
// rules classifier (CAP-003), then `routed` once a legal_request is created.
// `rejected` records a message that failed classification/eligibility and could
// not be routed (kept for audit).
type IntakeMessageStatus string

const (
	IntakeMessageStatusReceived   IntakeMessageStatus = "received"
	IntakeMessageStatusClassified IntakeMessageStatus = "classified"
	IntakeMessageStatusRouted     IntakeMessageStatus = "routed"
	IntakeMessageStatusRejected   IntakeMessageStatus = "rejected"
)

// Valid reports whether the status is one of the known values.
func (s IntakeMessageStatus) Valid() bool {
	switch s {
	case IntakeMessageStatusReceived, IntakeMessageStatusClassified, IntakeMessageStatusRouted, IntakeMessageStatusRejected:
		return true
	default:
		return false
	}
}

// IntakeMessage is the persisted, deduplicated record of an inbound email intake
// message (CAP-002). provider_message_id is the upstream Message-ID and is unique
// per (tenant, provider_message_id) so a re-delivered message is idempotently
// ignored. raw_ref points at the raw message body persisted to the platform
// files service (entity_type='lex_intake_message', suite='lex'); attachments are
// likewise file references. The classified_request_type / beneficiary_entity_id
// capture the CAP-003 routing decision; legal_request_id back-links the created
// spine row once routing succeeds.
type IntakeMessage struct {
	ID                    uuid.UUID           `json:"id"`
	TenantID              uuid.UUID           `json:"tenant_id"`
	MailboxID             *uuid.UUID          `json:"mailbox_id,omitempty"`
	ProviderMessageID     string              `json:"provider_message_id"`
	FromAddress           string              `json:"from_address"`
	ToAddress             string              `json:"to_address"`
	Subject               string              `json:"subject"`
	RawFileID             *uuid.UUID          `json:"raw_file_id,omitempty"`
	AttachmentFileIDs     []uuid.UUID         `json:"attachment_file_ids"`
	ClassifiedRequestType *string             `json:"classified_request_type,omitempty"`
	BeneficiaryEntityID   *uuid.UUID          `json:"beneficiary_entity_id,omitempty"`
	LegalRequestID        *uuid.UUID          `json:"legal_request_id,omitempty"`
	Status                IntakeMessageStatus `json:"status"`
	ClassifierReason      *string             `json:"classifier_reason,omitempty"`
	ErrorMessage          *string             `json:"error_message,omitempty"`
	Metadata              map[string]any      `json:"metadata"`
	CreatedBy             uuid.UUID           `json:"created_by"`
	CreatedAt             time.Time           `json:"created_at"`
	UpdatedAt             time.Time           `json:"updated_at"`
}

// IntakeMessageListFilters carries the (already-validated) query parameters for
// the intake-message list endpoint.
type IntakeMessageListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *IntakeMessageStatus
	MailboxID     *uuid.UUID
	SortColumn    string
	SortDirection string
}
