package model

import (
	"time"

	"github.com/google/uuid"
)

// SettlementDocumentLink links a settlement to an existing repository document
// (LegalDocument). It is a pure join row: byte storage and versioning stay owned
// by the document registry. The linked document is hydrated on list/get responses
// when available. Mirrors MatterDocumentLink (legal_matter_documents).
type SettlementDocumentLink struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	SettlementID uuid.UUID      `json:"settlement_id"`
	DocumentID   uuid.UUID      `json:"document_id"`
	Relationship string         `json:"relationship"`
	CreatedBy    uuid.UUID      `json:"created_by"`
	CreatedAt    time.Time      `json:"created_at"`
	DeletedAt    *time.Time     `json:"deleted_at,omitempty"`
	Document     *LegalDocument `json:"document,omitempty"`
}
