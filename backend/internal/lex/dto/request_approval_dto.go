package dto

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
	workflowmodel "github.com/clario360/platform/internal/workflow/model"
)

// request_approval_dto.go carries the request/response payloads for the
// subject-agnostic request-approval policy stack (CAP-006, CAP-007). The
// approver and form-field shapes reuse the contract approval-policy DTOs
// (ApprovalPolicyApprover / ApprovalFormFieldRequest) verbatim so a single
// author-facing schema serves both subjects.

// CreateRequestApprovalPolicyRequest is the body for defining a new
// request-approval policy. Scope dimensions left nil/empty mean "any".
type CreateRequestApprovalPolicyRequest struct {
	Name        string                            `json:"name"`
	Description string                            `json:"description"`
	Status      model.RequestApprovalPolicyStatus `json:"status,omitempty"`
	Priority    int                               `json:"priority"`
	RequestType *string                           `json:"request_type,omitempty"`
	ServiceID   *uuid.UUID                        `json:"service_id,omitempty"`
	Stage       *model.RequestApprovalStage       `json:"stage,omitempty"`
	Department  *string                           `json:"department,omitempty"`
	// PriorityTier is an optional free-form urgency band (e.g. "standard",
	// "expedited") used as a scope dimension.
	PriorityTier             *string                    `json:"priority_tier,omitempty"`
	MinValue                 *float64                   `json:"min_value,omitempty"`
	MaxValue                 *float64                   `json:"max_value,omitempty"`
	Currency                 string                     `json:"currency"`
	Mode                     string                     `json:"mode"`
	Quorum                   string                     `json:"quorum"`
	QuorumN                  *int                       `json:"quorum_n,omitempty"`
	Approvers                []ApprovalPolicyApprover   `json:"approvers"`
	FormFields               []ApprovalFormFieldRequest `json:"form_fields,omitempty"`
	RequireAuthorityEvidence *bool                      `json:"require_authority_evidence,omitempty"`
	RequiredRole             *string                    `json:"required_role,omitempty"`
	RequiredAuthorityAmount  *float64                   `json:"required_authority_amount,omitempty"`
	Metadata                 map[string]any             `json:"metadata,omitempty"`
	ValidFrom                *time.Time                 `json:"valid_from,omitempty"`
	ValidUntil               *time.Time                 `json:"valid_until,omitempty"`
	TemplateID               *uuid.UUID                 `json:"template_id,omitempty"`
}

// UpdateRequestApprovalPolicyRequest patches a request-approval policy. Nil
// fields are left unchanged; fields listed in ClearedFields are reset to NULL.
type UpdateRequestApprovalPolicyRequest struct {
	Name                     *string                            `json:"name,omitempty"`
	Description              *string                            `json:"description,omitempty"`
	Status                   *model.RequestApprovalPolicyStatus `json:"status,omitempty"`
	Priority                 *int                               `json:"priority,omitempty"`
	RequestType              *string                            `json:"request_type,omitempty"`
	ServiceID                *uuid.UUID                         `json:"service_id,omitempty"`
	Stage                    *model.RequestApprovalStage        `json:"stage,omitempty"`
	Department               *string                            `json:"department,omitempty"`
	PriorityTier             *string                            `json:"priority_tier,omitempty"`
	MinValue                 *float64                           `json:"min_value,omitempty"`
	MaxValue                 *float64                           `json:"max_value,omitempty"`
	Currency                 *string                            `json:"currency,omitempty"`
	Mode                     *string                            `json:"mode,omitempty"`
	Quorum                   *string                            `json:"quorum,omitempty"`
	QuorumN                  *int                               `json:"quorum_n,omitempty"`
	Approvers                []ApprovalPolicyApprover           `json:"approvers,omitempty"`
	FormFields               []ApprovalFormFieldRequest         `json:"form_fields,omitempty"`
	RequireAuthorityEvidence *bool                              `json:"require_authority_evidence,omitempty"`
	RequiredRole             *string                            `json:"required_role,omitempty"`
	RequiredAuthorityAmount  *float64                           `json:"required_authority_amount,omitempty"`
	Metadata                 map[string]any                     `json:"metadata,omitempty"`
	ValidFrom                *time.Time                         `json:"valid_from,omitempty"`
	ValidUntil               *time.Time                         `json:"valid_until,omitempty"`
	ClearedFields            []string                           `json:"cleared_fields,omitempty"`
}

// ShouldClear reports whether the given JSON field name was listed in
// ClearedFields (so it should be reset to NULL on update).
func (r *UpdateRequestApprovalPolicyRequest) ShouldClear(field string) bool {
	for _, f := range r.ClearedFields {
		if f == field {
			return true
		}
	}
	return false
}

// RequestApprovalPolicyConflictCheckRequest is the body of the conflict-check
// endpoint: a candidate policy (same shape as a create request) plus an optional
// ExcludeID so an update preview omits the policy being edited.
type RequestApprovalPolicyConflictCheckRequest struct {
	CreateRequestApprovalPolicyRequest
	ExcludeID *string `json:"exclude_id,omitempty"`
}

// RequestApprovalPolicyConflictCheckResponse returns the detected scope
// conflicts for a candidate policy.
type RequestApprovalPolicyConflictCheckResponse struct {
	Conflicts    any  `json:"conflicts"`
	HasConflicts bool `json:"has_conflicts"`
	HasIdentical bool `json:"has_identical"`
}

// RequestApprovalPolicyVersionsResponse wraps the immutable version history.
type RequestApprovalPolicyVersionsResponse struct {
	PolicyID string                               `json:"policy_id"`
	Versions []model.RequestApprovalPolicyVersion `json:"versions"`
}

// RequestApprovalPolicyAuditResponse wraps a page of append-only audit entries.
type RequestApprovalPolicyAuditResponse struct {
	PolicyID string                                  `json:"policy_id"`
	Entries  []model.RequestApprovalPolicyAuditEntry `json:"entries"`
}

// RequestApprovalTaskResponse is the request-approval task read model. The
// embedded workflow task preserves the established wire shape; CanDecide is
// computed for the authenticated actor by the Lex service using the same
// capability, assignment, claim, role, status, and author/approver rules as the
// decision command. Clients must use it to decide whether to render controls.
type RequestApprovalTaskResponse struct {
	workflowmodel.HumanTask
	CanDecide bool `json:"can_decide"`
}

// CreateRequestApprovalPolicyTemplateRequest defines a reusable template.
// Definition holds the policy shape (same JSON fields as a create request).
type CreateRequestApprovalPolicyTemplateRequest struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Category    string         `json:"category"`
	Definition  map[string]any `json:"definition"`
}

// UpdateRequestApprovalPolicyTemplateRequest patches a template. Nil fields are
// left unchanged; a non-nil Definition replaces the whole definition document.
type UpdateRequestApprovalPolicyTemplateRequest struct {
	Name        *string        `json:"name,omitempty"`
	Description *string        `json:"description,omitempty"`
	Category    *string        `json:"category,omitempty"`
	Definition  map[string]any `json:"definition,omitempty"`
}

// InstantiateRequestApprovalPolicyTemplateRequest materialises a concrete policy
// from a template. Overrides (optional) take precedence over the template
// definition for any field they set.
type InstantiateRequestApprovalPolicyTemplateRequest struct {
	Overrides *UpdateRequestApprovalPolicyRequest `json:"overrides,omitempty"`
}
