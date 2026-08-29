package dto

import (
	"strings"

	"github.com/google/uuid"
)

// CreateSettlementDocumentLinkRequest links an existing repository document
// (LegalDocument) to a settlement. This endpoint never accepts file bytes — the
// document must already exist in the document registry. Mirrors the matter
// document-link request, scoped to the link-only fields.
type CreateSettlementDocumentLinkRequest struct {
	DocumentID   *uuid.UUID `json:"document_id"`
	Relationship string     `json:"relationship,omitempty"`
}

func (r *CreateSettlementDocumentLinkRequest) Normalize() {
	r.Relationship = strings.TrimSpace(r.Relationship)
	if r.Relationship == "" {
		r.Relationship = "related"
	}
}
