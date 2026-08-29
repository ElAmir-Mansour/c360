package model

import (
	"time"

	"github.com/google/uuid"
)

// IntakeMailbox maps an inbound email address to a default routing target for
// the email intake webhook (CAP-002). When a message arrives at a mailbox the
// intake pipeline seeds the routed legal_request with this mailbox's
// request_type + beneficiary_entity_id before the rules classifier (CAP-003)
// refines them. The HMAC ingest secret is stored encrypted at rest via the lex
// field crypto (crypto/field_crypto.go).
type IntakeMailbox struct {
	ID                  uuid.UUID  `json:"id"`
	TenantID            uuid.UUID  `json:"tenant_id"`
	Address             string     `json:"address"`
	RequestType         string     `json:"request_type"`
	ServiceID           *uuid.UUID `json:"service_id,omitempty"`
	BeneficiaryEntityID *uuid.UUID `json:"beneficiary_entity_id,omitempty"`
	// IngestSecretHash is the encrypted ("enc:v1:...") HMAC shared secret used to
	// verify the X-Clario360-Signature on the webhook. It is NEVER serialized to
	// API responses (json:"-").
	IngestSecretHash string         `json:"-"`
	Active           bool           `json:"active"`
	Metadata         map[string]any `json:"metadata"`
	CreatedBy        uuid.UUID      `json:"created_by"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        *time.Time     `json:"deleted_at,omitempty"`
}

// IntakeMailboxListFilters carries the (already-validated) query parameters for
// the mailbox list endpoint.
type IntakeMailboxListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Active        *bool
	SortColumn    string
	SortDirection string
}
