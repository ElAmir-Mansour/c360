package model

import (
	"time"

	"github.com/google/uuid"
)

// MatterDocumentLink links a matter to an existing repository document
// (LegalDocument). It is a pure join row: byte storage and versioning stay owned
// by the document registry. The linked document is hydrated on list/get responses
// when available. Mirrors CaseDocumentLink (legal_case_documents).
type MatterDocumentLink struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	MatterID     uuid.UUID      `json:"matter_id"`
	DocumentID   uuid.UUID      `json:"document_id"`
	Relationship string         `json:"relationship"`
	CreatedBy    uuid.UUID      `json:"created_by"`
	CreatedAt    time.Time      `json:"created_at"`
	DeletedAt    *time.Time     `json:"deleted_at,omitempty"`
	Document     *LegalDocument `json:"document,omitempty"`
}
