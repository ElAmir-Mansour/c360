package model

import (
	"time"

	"github.com/google/uuid"
)

// request_approval_policy.go defines the subject-agnostic request-approval
// policy stack (CAP-006, CAP-007). It lifts the contract-bound approval-policy
// design onto legal *requests*: the scope dimension is request_type (plus an
// optional service_id, the requester|provider stage, an optional department and
// priority tier and an optional numeric range) instead of contract_type. The
// routing surface (mode/quorum/approvers/form_fields/authority) and the
// governance trio (immutable versions, append-only audit, reusable templates)
// mirror the contract stack verbatim, reusing ApprovalPolicyApprover and
// ApprovalPolicyFormField for the routing payload.

// RequestApprovalStage distinguishes the side of a legal request a policy routes
// approvals for: the requester (intake/authorisation) or the provider (legal
// department fulfilment).
type RequestApprovalStage string

const (
	RequestApprovalStageRequester RequestApprovalStage = "requester"
	RequestApprovalStageProvider  RequestApprovalStage = "provider"
)

// RequestApprovalPolicyStatus is the lifecycle status of a request-approval
// policy. It mirrors ApprovalPolicyStatus (draft/active/archived).
type RequestApprovalPolicyStatus string

const (
	RequestApprovalPolicyStatusDraft    RequestApprovalPolicyStatus = "draft"
	RequestApprovalPolicyStatusActive   RequestApprovalPolicyStatus = "active"
	RequestApprovalPolicyStatusArchived RequestApprovalPolicyStatus = "archived"
)

// RequestApprovalPolicy is a subject-agnostic approval routing policy scoped to
// a legal request type. Approvers and FormFields reuse the contract
// approval-policy payload types verbatim (ApprovalPolicyApprover /
// ApprovalPolicyFormField).
type RequestApprovalPolicy struct {
	ID          uuid.UUID                   `json:"id"`
	TenantID    uuid.UUID                   `json:"tenant_id"`
	Name        string                      `json:"name"`
	Description string                      `json:"description"`
	Status      RequestApprovalPolicyStatus `json:"status"`
	Priority    int                         `json:"priority"`
	// Scope dimensions. A nil pointer (or empty RequestType) means "any" for that
	// dimension and matches every request.
	RequestType  *string               `json:"request_type,omitempty"`
	ServiceID    *uuid.UUID            `json:"service_id,omitempty"`
	Stage        *RequestApprovalStage `json:"stage,omitempty"`
	Department   *string               `json:"department,omitempty"`
	PriorityTier *string               `json:"priority_tier,omitempty"`
	MinValue     *float64              `json:"min_value,omitempty"`
	MaxValue     *float64              `json:"max_value,omitempty"`
	Currency     string                `json:"currency"`
	// Routing.
	Mode                     string                    `json:"mode"`
	Quorum                   string                    `json:"quorum"`
	QuorumN                  *int                      `json:"quorum_n,omitempty"`
	Approvers                []ApprovalPolicyApprover  `json:"approvers"`
	FormFields               []ApprovalPolicyFormField `json:"form_fields"`
	RequireAuthorityEvidence bool                      `json:"require_authority_evidence"`
	RequiredRole             *string                   `json:"required_role,omitempty"`
	RequiredAuthorityAmount  *float64                  `json:"required_authority_amount,omitempty"`
	Metadata                 map[string]any            `json:"metadata"`
	// Version is a monotonically increasing counter bumped on every mutation; each
	// value is captured immutably in RequestApprovalPolicyVersion history.
	Version int `json:"version"`
	// ValidFrom / ValidUntil bound the policy's effective window (policy expiry).
	// A nil bound is unbounded.
	ValidFrom  *time.Time `json:"valid_from,omitempty"`
	ValidUntil *time.Time `json:"valid_until,omitempty"`
	// TemplateID links a policy back to the template it was materialised from.
	TemplateID *uuid.UUID `json:"template_id,omitempty"`
	CreatedBy  uuid.UUID  `json:"created_by"`
	UpdatedBy  *uuid.UUID `json:"updated_by,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

// IsEffectiveAt reports whether the policy's effective window contains the given
// instant. Nil bounds are treated as unbounded.
func (p *RequestApprovalPolicy) IsEffectiveAt(at time.Time) bool {
	if p == nil {
		return false
	}
	if p.ValidFrom != nil && at.Before(*p.ValidFrom) {
		return false
	}
	if p.ValidUntil != nil && at.After(*p.ValidUntil) {
		return false
	}
	return true
}

// RequestApprovalPolicyListFilters narrows a list query. Nil pointers / empty
// strings are ignored. SortColumn is matched against a repository allowlist.
type RequestApprovalPolicyListFilters struct {
	Search        string
	Status        *RequestApprovalPolicyStatus
	RequestType   *string
	ServiceID     *uuid.UUID
	Stage         *RequestApprovalStage
	Page          int
	PerPage       int
	SortColumn    string
	SortDirection string
}

// RequestApprovalPolicyRecommendation is the result of resolving the best-match
// active policy for a concrete legal request.
type RequestApprovalPolicyRecommendation struct {
	Policy  *RequestApprovalPolicy `json:"policy,omitempty"`
	Matched bool                   `json:"matched"`
	Reason  string                 `json:"reason"`
}

// ---------------------------------------------------------------------------
// Governance trio (versions / audit / templates) — mirrors migration 000016.
// ---------------------------------------------------------------------------

// RequestApprovalPolicyAuditAction enumerates the mutations recorded in the
// append-only request-approval-policy audit log.
type RequestApprovalPolicyAuditAction string

const (
	RequestApprovalPolicyAuditCreated         RequestApprovalPolicyAuditAction = "created"
	RequestApprovalPolicyAuditUpdated         RequestApprovalPolicyAuditAction = "updated"
	RequestApprovalPolicyAuditArchived        RequestApprovalPolicyAuditAction = "archived"
	RequestApprovalPolicyAuditRestored        RequestApprovalPolicyAuditAction = "restored"
	RequestApprovalPolicyAuditTemplateApplied RequestApprovalPolicyAuditAction = "template_applied"
)

// RequestApprovalPolicyVersion is an immutable snapshot of a request-approval
// policy captured at a specific version number. Rows are append-only history.
// The (policy_id, version) pair is unique.
type RequestApprovalPolicyVersion struct {
	ID           uuid.UUID             `json:"id"`
	PolicyID     uuid.UUID             `json:"policy_id"`
	TenantID     uuid.UUID             `json:"tenant_id"`
	Version      int                   `json:"version"`
	Snapshot     RequestApprovalPolicy `json:"snapshot"`
	ChangeReason string                `json:"change_reason,omitempty"`
	CreatedBy    *uuid.UUID            `json:"created_by,omitempty"`
	CreatedAt    time.Time             `json:"created_at"`
}

// RequestApprovalPolicyAuditEntry is a single append-only audit record. The
// before/after documents capture the policy state on either side of the
// mutation (either may be nil). Rows are never updated or deleted.
type RequestApprovalPolicyAuditEntry struct {
	ID        uuid.UUID                        `json:"id"`
	TenantID  uuid.UUID                        `json:"tenant_id"`
	PolicyID  uuid.UUID                        `json:"policy_id"`
	Action    RequestApprovalPolicyAuditAction `json:"action"`
	ActorID   *uuid.UUID                       `json:"actor_id,omitempty"`
	Before    *RequestApprovalPolicy           `json:"before,omitempty"`
	After     *RequestApprovalPolicy           `json:"after,omitempty"`
	RequestID string                           `json:"request_id,omitempty"`
	CreatedAt time.Time                        `json:"created_at"`
}

// RequestApprovalPolicyTemplate is a reusable, named request-approval-policy
// definition that a policy can be materialised from. Templates are tenant-scoped
// and unique by (tenant_id, name).
type RequestApprovalPolicyTemplate struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	Name        string         `json:"name"`
	Description string         `json:"description"`
	Category    string         `json:"category"`
	Definition  map[string]any `json:"definition"`
	CreatedBy   *uuid.UUID     `json:"created_by,omitempty"`
	UpdatedBy   *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}
