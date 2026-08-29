package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractCategory is one entry in a tenant's manual contract-categorization
// vocabulary. It feeds the "categorize" multi-select on the contract detail /
// review-desk and is DISTINCT from the AI ContractClassificationResult path:
// categories are a human-curated catalog written into contracts.tags +
// metadata{categorized_at, categorized_by}, never an inferred recommended_type.
// Mirrors the contract_categories table (migration 000076).
type ContractCategory struct {
	ID        uuid.UUID  `json:"id"`
	TenantID  uuid.UUID  `json:"tenant_id"`
	Name      string     `json:"name"`
	Slug      string     `json:"slug"`
	SortOrder int        `json:"sort_order"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
}

// ContractCategorizationResult is the response of a manual categorize action: the
// applied category slugs (now part of contracts.tags) plus the categorization
// stamp written into the contract metadata. It is intentionally NOT a
// ContractClassificationResult — there is no recommended_type, confidence, or
// rationale, because categorization is operator-curated, not inferred.
type ContractCategorizationResult struct {
	ContractID    uuid.UUID `json:"contract_id"`
	CategoryTags  []string  `json:"category_tags"`
	Tags          []string  `json:"tags"`
	CategorizedAt time.Time `json:"categorized_at"`
	CategorizedBy uuid.UUID `json:"categorized_by"`
}
