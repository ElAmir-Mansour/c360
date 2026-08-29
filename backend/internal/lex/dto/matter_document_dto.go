package dto

import (
	"strings"

	"github.com/google/uuid"
)

// CreateMatterDocumentLinkRequest links an existing repository document
// (LegalDocument) to a matter. This endpoint never accepts file bytes — the
// document must already exist in the document registry. Mirrors the case
// document-link request, scoped to the link-only fields.
type CreateMatterDocumentLinkRequest struct {
	DocumentID   *uuid.UUID `json:"document_id"`
	Relationship string     `json:"relationship,omitempty"`
}

func (r *CreateMatterDocumentLinkRequest) Normalize() {
	r.Relationship = strings.TrimSpace(r.Relationship)
	if r.Relationship == "" {
		r.Relationship = "related"
	}
}
