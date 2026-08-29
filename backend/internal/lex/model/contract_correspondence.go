package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractCorrespondenceKind classifies a review-desk correspondence entry
// (CAP-113..116): internal correspondence between desk staff, a clarification
// request raised to the requester, or the system-generated auto-return note.
type ContractCorrespondenceKind string

const (
	// ContractCorrespondenceKindInternal is internal desk correspondence (CAP-113).
	ContractCorrespondenceKindInternal ContractCorrespondenceKind = "internal"
	// ContractCorrespondenceKindClarification is a clarification request to the
	// requester (CAP-114).
	ContractCorrespondenceKindClarification ContractCorrespondenceKind = "clarification"
	// ContractCorrespondenceKindAutoReturn is the auto-return note recorded when a
	// completeness gate fails and the file is returned (CAP-116).
	ContractCorrespondenceKindAutoReturn ContractCorrespondenceKind = "auto_return"
)

// Valid reports whether the kind is a known correspondence kind.
func (k ContractCorrespondenceKind) Valid() bool {
	switch k {
	case ContractCorrespondenceKindInternal,
		ContractCorrespondenceKindClarification,
		ContractCorrespondenceKindAutoReturn:
		return true
	default:
		return false
	}
}

// ContractCorrespondenceDirection records whether a correspondence entry was sent
// outward (to the requester) or is an internal/inbound note.
type ContractCorrespondenceDirection string

const (
	ContractCorrespondenceDirectionInternal ContractCorrespondenceDirection = "internal"
	ContractCorrespondenceDirectionOutbound ContractCorrespondenceDirection = "outbound"
	ContractCorrespondenceDirectionInbound  ContractCorrespondenceDirection = "inbound"
)

// Valid reports whether the correspondence direction is one of the allowed
// values enforced by the database check constraint.
func (d ContractCorrespondenceDirection) Valid() bool {
	switch d {
	case ContractCorrespondenceDirectionInternal,
		ContractCorrespondenceDirectionOutbound,
		ContractCorrespondenceDirectionInbound:
		return true
	default:
		return false
	}
}

// ContractCorrespondence is one append-only review-desk correspondence entry
// (CAP-113..116). It is an immutable log line: there is no update/delete path so
// the desk thread is a faithful audit of every clarification/return exchange.
type ContractCorrespondence struct {
	ID         uuid.UUID                       `json:"id"`
	TenantID   uuid.UUID                       `json:"tenant_id"`
	ContractID uuid.UUID                       `json:"contract_id"`
	IntakeID   *uuid.UUID                      `json:"intake_id,omitempty"`
	Kind       ContractCorrespondenceKind      `json:"kind"`
	Direction  ContractCorrespondenceDirection `json:"direction"`
	Subject    string                          `json:"subject"`
	Body       string                          `json:"body"`
	AuthorName *string                         `json:"author_name,omitempty"`
	Metadata   map[string]any                  `json:"metadata"`
	CreatedBy  uuid.UUID                       `json:"created_by"`
	CreatedAt  time.Time                       `json:"created_at"`
}

// ContractCorrespondenceListFilters narrows a correspondence-thread query.
type ContractCorrespondenceListFilters struct {
	Page    int
	PerPage int
	Kind    *ContractCorrespondenceKind
}
