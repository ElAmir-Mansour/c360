package model

import (
	"time"

	"github.com/google/uuid"
)

// LegalHoldSubjectType identifies the kind of legal resource a hold preserves.
type LegalHoldSubjectType string

const (
	// LegalHoldSubjectContract holds a contract record (and its versions).
	LegalHoldSubjectContract LegalHoldSubjectType = "contract"
	// LegalHoldSubjectMatter holds a legal matter.
	LegalHoldSubjectMatter LegalHoldSubjectType = "matter"
	// LegalHoldSubjectDocument holds a legal document.
	LegalHoldSubjectDocument LegalHoldSubjectType = "document"
	// LegalHoldSubjectConsultation holds a legal consultation (advisory request).
	LegalHoldSubjectConsultation LegalHoldSubjectType = "consultation"
)

// Valid reports whether the subject type is one of the supported values.
func (t LegalHoldSubjectType) Valid() bool {
	switch t {
	case LegalHoldSubjectContract, LegalHoldSubjectMatter, LegalHoldSubjectDocument, LegalHoldSubjectConsultation:
		return true
	default:
		return false
	}
}

// LegalHoldStatus is the lifecycle state of a legal hold.
type LegalHoldStatus string

const (
	// LegalHoldStatusActive means the subject is currently preserved and
	// destructive operations against it must be refused.
	LegalHoldStatusActive LegalHoldStatus = "active"
	// LegalHoldStatusReleased means the hold has been lifted; the subject can be
	// mutated again (unless another active hold exists).
	LegalHoldStatusReleased LegalHoldStatus = "released"
)

// LegalHold is a litigation/regulatory preservation record placed on a single
// contract, matter, or document. While a hold is active the subject cannot be
// deleted, archived, or status-transitioned in a way that would destroy or
// remove it (FR-WATHEEQ-005).
type LegalHold struct {
	ID          uuid.UUID            `json:"id"`
	TenantID    uuid.UUID            `json:"tenant_id"`
	SubjectType LegalHoldSubjectType `json:"subject_type"`
	SubjectID   uuid.UUID            `json:"subject_id"`
	Reason      string               `json:"reason"`
	Reference   string               `json:"reference"`
	Status      LegalHoldStatus      `json:"status"`
	Custodian   string               `json:"custodian"`
	Notes       string               `json:"notes"`
	AppliedBy   uuid.UUID            `json:"applied_by"`
	AppliedAt   time.Time            `json:"applied_at"`
	ReleasedBy  *uuid.UUID           `json:"released_by,omitempty"`
	ReleasedAt  *time.Time           `json:"released_at,omitempty"`
	ReleaseNote string               `json:"release_note"`
	Metadata    map[string]any       `json:"metadata"`
	CreatedAt   time.Time            `json:"created_at"`
	UpdatedAt   time.Time            `json:"updated_at"`
}

// IsActive reports whether the hold is currently in force.
func (h *LegalHold) IsActive() bool {
	return h != nil && h.Status == LegalHoldStatusActive
}

// LegalHoldListFilters constrains a legal-hold listing query. All filters are
// tenant-scoped by the service; zero values mean "no filter".
type LegalHoldListFilters struct {
	Page          int
	PerPage       int
	SubjectType   *LegalHoldSubjectType
	SubjectID     *uuid.UUID
	Status        *LegalHoldStatus
	Reference     string
	SortColumn    string
	SortDirection string
}
