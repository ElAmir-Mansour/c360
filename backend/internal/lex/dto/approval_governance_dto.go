package dto

import (
	"github.com/clario360/platform/internal/lex/model"
)

// ApprovalPolicyConflictCheckRequest is the body of the conflict-check endpoint.
// It carries a candidate approval policy (the same shape as a create request) and
// an optional ExcludeID so an update preview can omit the policy being edited from
// the conflict scan.
type ApprovalPolicyConflictCheckRequest struct {
	CreateApprovalPolicyRequest
	// ExcludeID, when set, omits the policy with this id from the conflict scan so
	// a policy never conflicts with itself (used when previewing an update).
	ExcludeID *string `json:"exclude_id,omitempty"`
}

// CreateApprovalPolicyTemplateRequest is the body for defining a reusable
// approval-policy template. Definition holds the policy shape (same JSON fields as
// CreateApprovalPolicyRequest) that the instantiate endpoint materialises.
type CreateApprovalPolicyTemplateRequest struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Category    string         `json:"category"`
	Definition  map[string]any `json:"definition"`
}

// UpdateApprovalPolicyTemplateRequest patches a template. Nil fields are left
// unchanged; a non-nil Definition replaces the whole definition document.
type UpdateApprovalPolicyTemplateRequest struct {
	Name        *string        `json:"name,omitempty"`
	Description *string        `json:"description,omitempty"`
	Category    *string        `json:"category,omitempty"`
	Definition  map[string]any `json:"definition,omitempty"`
}

// InstantiateApprovalPolicyTemplateRequest materialises a concrete policy from a
// template. Overrides (optional) take precedence over the template definition for
// any field they set.
type InstantiateApprovalPolicyTemplateRequest struct {
	Overrides *UpdateApprovalPolicyRequest `json:"overrides,omitempty"`
}

// ApprovalPolicyVersionsResponse wraps the immutable version history of a policy.
type ApprovalPolicyVersionsResponse struct {
	PolicyID string                        `json:"policy_id"`
	Versions []model.ApprovalPolicyVersion `json:"versions"`
}

// ApprovalPolicyAuditResponse wraps a paginated page of audit entries.
type ApprovalPolicyAuditResponse struct {
	PolicyID string                           `json:"policy_id"`
	Entries  []model.ApprovalPolicyAuditEntry `json:"entries"`
}

// ApprovalPolicyConflictCheckResponse returns the detected scope conflicts for a
// candidate policy. HasIdentical is true when at least one conflict is an
// identical-scope duplicate (which would hard-fail a create/update).
type ApprovalPolicyConflictCheckResponse struct {
	Conflicts    any  `json:"conflicts"`
	HasConflicts bool `json:"has_conflicts"`
	HasIdentical bool `json:"has_identical"`
}
