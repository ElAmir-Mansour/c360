package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// CaseClassification is one node of the admin-extensible legal-case classification
// taxonomy (CAP-074/075/076). tenant_id leads every row (multitenant RLS);
// parent_id is a self-FK; path is the materialized ancestry (root-first array of
// classification ids as text) used for cheap subtree traversal and cascade-path
// resolution without recursive CTEs at read time. The cascading rental-dispute
// chain (eviction -> rent_claim -> fair_rent -> tax_committee) is modelled as
// linked parent/child rows with this materialized path.
//
// is_system marks the eight seeded base classifications + the seeded cascade
// chain so the admin CRUD can protect them from deletion while still allowing
// admins to add their own classifications alongside them.
type CaseClassification struct {
	ID        uuid.UUID           `json:"id"`
	TenantID  uuid.UUID           `json:"tenant_id"`
	ParentID  *uuid.UUID          `json:"parent_id,omitempty"`
	Code      string              `json:"code"`
	Name      forms.LocalizedText `json:"name"`
	Path      []string            `json:"path"`
	IsSystem  bool                `json:"is_system"`
	Active    bool                `json:"active"`
	Sort      int                 `json:"sort"`
	Metadata  map[string]any      `json:"metadata"`
	CreatedBy uuid.UUID           `json:"created_by"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
	DeletedAt *time.Time          `json:"deleted_at,omitempty"`
	// Children is populated only by the tree projection; it is the recursively
	// nested set of immediate child classifications (each with its own Children).
	Children []CaseClassification `json:"children,omitempty"`
}

// CaseClassificationListFilters is the flat list/search/sort surface for the
// taxonomy. The tree projection uses an unpaginated variant (PerPage forced wide)
// so callers can assemble the full hierarchy.
type CaseClassificationListFilters struct {
	Page          int
	PerPage       int
	Search        string
	ParentID      *uuid.UUID
	Active        *bool
	IsSystem      *bool
	RootOnly      bool
	SortColumn    string
	SortDirection string
}

// CaseClassificationCascade is the resolved root -> leaf cascade for a single
// classification: the ancestor chain (root-first) followed by the classification
// itself. It is the product CAP-076 consumes to render the eviction ->
// rent_claim -> fair_rent -> tax_committee escalation path.
type CaseClassificationCascade struct {
	ClassificationID uuid.UUID            `json:"classification_id"`
	Code             string               `json:"code"`
	Name             forms.LocalizedText  `json:"name"`
	ResolvedAt       time.Time            `json:"resolved_at"`
	Chain            []CaseClassification `json:"chain"`
}
