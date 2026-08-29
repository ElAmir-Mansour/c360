package model

import (
	"time"

	"github.com/google/uuid"
)

// CasePartyRole is the litigation role of a party on a case. The set is kept
// deliberately small and open-ended (Phase 3 plaintiff/defendant flows add rows
// with these roles + richer party detail tables FK'd to legal_case_parties).
type CasePartyRole string

const (
	CasePartyRolePlaintiff CasePartyRole = "plaintiff"
	CasePartyRoleDefendant CasePartyRole = "defendant"
	CasePartyRoleLawyer    CasePartyRole = "lawyer"
	CasePartyRoleWitness   CasePartyRole = "witness"
	CasePartyRoleExpert    CasePartyRole = "expert"
	CasePartyRoleOther     CasePartyRole = "other"
)

// Valid reports whether the role is a known party role.
func (r CasePartyRole) Valid() bool {
	switch r {
	case CasePartyRolePlaintiff, CasePartyRoleDefendant, CasePartyRoleLawyer,
		CasePartyRoleWitness, CasePartyRoleExpert, CasePartyRoleOther:
		return true
	default:
		return false
	}
}

// CaseParty is a participant on a litigation case (CAP-043). This is a clean base
// row; Phase 3 plaintiff/defendant flows extend the party model with additional
// detail tables FK'd back to legal_case_parties.
type CaseParty struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	CaseID     uuid.UUID      `json:"case_id"`
	Role       CasePartyRole  `json:"role"`
	Name       string         `json:"name"`
	Identifier *string        `json:"identifier,omitempty"`
	Contact    *string        `json:"contact,omitempty"`
	Metadata   map[string]any `json:"metadata"`
	CreatedBy  uuid.UUID      `json:"created_by"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  *time.Time     `json:"deleted_at,omitempty"`
}
