package model

import (
	"time"

	"github.com/google/uuid"
)

// CaseComment is a persisted collaboration note on a legal case. Mentions are
// stored as user IDs OR display handles (a JSONB string array, mirroring the
// sibling matter/clause comment models) so the notification layer can resolve
// recipients later; a bare @handle is a valid, persistable mention.
type CaseComment struct {
	ID        uuid.UUID      `json:"id"`
	TenantID  uuid.UUID      `json:"tenant_id"`
	CaseID    uuid.UUID      `json:"case_id"`
	Body      string         `json:"body"`
	Mentions  []string       `json:"mentions"`
	Metadata  map[string]any `json:"metadata"`
	CreatedBy uuid.UUID      `json:"created_by"`
	UpdatedBy *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	DeletedAt *time.Time     `json:"deleted_at,omitempty"`
}

// CaseDocumentLink links a case to a repository document. The linked document is
// included on list/get responses when available; byte storage remains owned by the
// existing file/document registry through LegalDocument.FileID and versions.
type CaseDocumentLink struct {
	ID             uuid.UUID      `json:"id"`
	TenantID       uuid.UUID      `json:"tenant_id"`
	CaseID         uuid.UUID      `json:"case_id"`
	DocumentID     uuid.UUID      `json:"document_id"`
	Source         string         `json:"source"`
	Category       *string        `json:"category,omitempty"`
	Notes          string         `json:"notes"`
	EvidenceStatus EvidenceStatus `json:"evidence_status"`
	CourtReference *string        `json:"court_reference,omitempty"`
	SubmittedBy    *uuid.UUID     `json:"submitted_by,omitempty"`
	SubmittedAt    *time.Time     `json:"submitted_at,omitempty"`
	Metadata       map[string]any `json:"metadata"`
	CreatedBy      uuid.UUID      `json:"created_by"`
	UpdatedBy      *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      *time.Time     `json:"deleted_at,omitempty"`
	Document       *LegalDocument `json:"document,omitempty"`
}

type EvidenceStatus string

const (
	EvidenceStatusPending   EvidenceStatus = "pending"
	EvidenceStatusSubmitted EvidenceStatus = "submitted"
	EvidenceStatusAdmitted  EvidenceStatus = "admitted"
	EvidenceStatusRejected  EvidenceStatus = "rejected"
	EvidenceStatusWithdrawn EvidenceStatus = "withdrawn"
)

func (s EvidenceStatus) Valid() bool {
	switch s {
	case EvidenceStatusPending, EvidenceStatusSubmitted, EvidenceStatusAdmitted,
		EvidenceStatusRejected, EvidenceStatusWithdrawn:
		return true
	default:
		return false
	}
}
