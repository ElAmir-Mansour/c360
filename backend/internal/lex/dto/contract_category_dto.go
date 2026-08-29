package dto

import "strings"

// CategorizeContractRequest carries the operator-selected category slugs for the
// manual contract categorization (CAP-123). Slugs are normalized the same way
// contract tags are (trim + lower + de-dupe) so the catalog vocabulary and the
// persisted contracts.tags stay in lock-step. This is the human "categorize"
// path, distinct from the AI ClassifyContractRequest.
type CategorizeContractRequest struct {
	CategoryTags []string `json:"category_tags"`
}

// Normalize trims/lowercases/de-dupes the requested category slugs, matching the
// normalizeTags rules used by the rest of the contract DTOs.
func (r *CategorizeContractRequest) Normalize() {
	r.CategoryTags = NormalizeTags(r.CategoryTags)
}

// CreateContractCategoryRequest is reserved for future catalog management; the
// CAP-123 surface only reads the catalog and writes categories onto a contract.
// Kept minimal and unexported-of-behaviour to avoid widening the API now.
type CreateContractCategoryRequest struct {
	Name string `json:"name"`
	Slug string `json:"slug"`
}

// NormalizedSlug returns the slug for a create request, deriving it from Name
// when omitted (lowercased, spaces -> hyphens), mirroring the seed catalog style.
func (r CreateContractCategoryRequest) NormalizedSlug() string {
	slug := strings.TrimSpace(strings.ToLower(r.Slug))
	if slug != "" {
		return slug
	}
	return strings.ReplaceAll(strings.TrimSpace(strings.ToLower(r.Name)), " ", "-")
}
