package model

import (
	"time"

	"github.com/google/uuid"
)

// MatterLinkTargetType enumerates the sibling lex entities a matter may be
// related to. Mirrors the CHECK constraint on the matter_links table.
type MatterLinkTargetType string

const (
	MatterLinkTargetConsultation  MatterLinkTargetType = "consultation"
	MatterLinkTargetInvestigation MatterLinkTargetType = "investigation"
	MatterLinkTargetLegalCase     MatterLinkTargetType = "legal_case"
	MatterLinkTargetSettlement    MatterLinkTargetType = "settlement"
	MatterLinkTargetLitigation    MatterLinkTargetType = "litigation"
	MatterLinkTargetContract      MatterLinkTargetType = "contract"
)

// ValidMatterLinkTargetType reports whether t is one of the accepted target
// types.
func ValidMatterLinkTargetType(t MatterLinkTargetType) bool {
	switch t {
	case MatterLinkTargetConsultation,
		MatterLinkTargetInvestigation,
		MatterLinkTargetLegalCase,
		MatterLinkTargetSettlement,
		MatterLinkTargetLitigation,
		MatterLinkTargetContract:
		return true
	default:
		return false
	}
}

// MatterLink is a cross-domain related-items edge connecting a matter to a
// sibling lex entity (consultation, investigation, legal case, settlement,
// litigation, or contract). It is a lightweight directory row: it stores only
// the target type/id and a free-text relationship label. Title/reference
// enrichment, when cheaply available, is populated into TargetReference and
// TargetTitle on read; otherwise those are left empty for the frontend to
// resolve.
type MatterLink struct {
	ID           uuid.UUID            `json:"id"`
	TenantID     uuid.UUID            `json:"tenant_id"`
	MatterID     uuid.UUID            `json:"matter_id"`
	TargetType   MatterLinkTargetType `json:"target_type"`
	TargetID     uuid.UUID            `json:"target_id"`
	Relationship string               `json:"relationship"`
	CreatedBy    uuid.UUID            `json:"created_by"`
	CreatedAt    time.Time            `json:"created_at"`

	// Best-effort enrichment, populated on read when the target is cheaply
	// resolvable. Omitted from JSON when empty.
	TargetReference string `json:"target_reference,omitempty"`
	TargetTitle     string `json:"target_title,omitempty"`
}
