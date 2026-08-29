package model

import (
	"time"

	"github.com/google/uuid"
)

type ApprovalPolicyStatus string

const (
	ApprovalPolicyStatusDraft    ApprovalPolicyStatus = "draft"
	ApprovalPolicyStatusActive   ApprovalPolicyStatus = "active"
	ApprovalPolicyStatusArchived ApprovalPolicyStatus = "archived"
)

type ApprovalPolicyApprover struct {
	Type  string `json:"type"`
	Ref   string `json:"ref"`
	Label string `json:"label,omitempty"`
}

type ApprovalPolicyFormField struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Label       string   `json:"label"`
	Required    bool     `json:"required"`
	Options     []string `json:"options,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Description string   `json:"description,omitempty"`
	// VisibleWhen is an optional boolean expression (the workflow expression DSL)
	// evaluated against the current submitted approval-task form values; when it
	// resolves to false the field is hidden (excluded from required validation and
	// cleared on submit). Empty means always visible. It is passed through to the
	// engine's workflowmodel.FormField.VisibleWhen so Lex approval task forms
	// honour conditional field visibility (Feature 2).
	VisibleWhen string `json:"visible_when,omitempty"`
}

type ApprovalPolicy struct {
	ID                       uuid.UUID                 `json:"id"`
	TenantID                 uuid.UUID                 `json:"tenant_id"`
	Name                     string                    `json:"name"`
	Description              string                    `json:"description"`
	Status                   ApprovalPolicyStatus      `json:"status"`
	Priority                 int                       `json:"priority"`
	ContractType             *ContractType             `json:"contract_type,omitempty"`
	Department               *string                   `json:"department,omitempty"`
	MinValue                 *float64                  `json:"min_value,omitempty"`
	MaxValue                 *float64                  `json:"max_value,omitempty"`
	Currency                 string                    `json:"currency"`
	Mode                     string                    `json:"mode"`
	Quorum                   string                    `json:"quorum"`
	QuorumN                  *int                      `json:"quorum_n,omitempty"`
	Approvers                []ApprovalPolicyApprover  `json:"approvers"`
	FormFields               []ApprovalPolicyFormField `json:"form_fields"`
	RequireAuthorityEvidence bool                      `json:"require_authority_evidence"`
	RequiredRole             *string                   `json:"required_role,omitempty"`
	RequiredAuthorityAmount  *float64                  `json:"required_authority_amount,omitempty"`
	Metadata                 map[string]any            `json:"metadata"`
	// Version is a monotonically increasing counter bumped on every mutation;
	// each value is captured immutably in ApprovalPolicyVersion history.
	Version int `json:"version"`
	// ValidFrom / ValidUntil define the effective window for policy expiry.
	// A nil bound is unbounded (NULL in the database). A policy is in effect when
	// now() is within [ValidFrom, ValidUntil].
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
func (p *ApprovalPolicy) IsEffectiveAt(at time.Time) bool {
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

type ApprovalPolicyRecommendation struct {
	Policy  *ApprovalPolicy `json:"policy,omitempty"`
	Matched bool            `json:"matched"`
	Reason  string          `json:"reason"`
}

type ApprovalPolicyAnalytics struct {
	TenantID             uuid.UUID                       `json:"tenant_id"`
	GeneratedAt          time.Time                       `json:"generated_at"`
	TotalPolicies        int                             `json:"total_policies"`
	ActivePolicies       int                             `json:"active_policies"`
	DraftPolicies        int                             `json:"draft_policies"`
	ArchivedPolicies     int                             `json:"archived_policies"`
	TotalRoutedTasks     int                             `json:"total_routed_tasks"`
	ActiveTasks          int                             `json:"active_tasks"`
	CompletedTasks       int                             `json:"completed_tasks"`
	RejectedTasks        int                             `json:"rejected_tasks"`
	CancelledTasks       int                             `json:"cancelled_tasks"`
	AwaitingQuorumTasks  int                             `json:"awaiting_quorum_tasks"`
	AverageDecisionHours *float64                        `json:"average_decision_hours,omitempty"`
	Policies             []ApprovalPolicyAnalyticsPolicy `json:"policies"`
}

type ApprovalPolicyAnalyticsPolicy struct {
	PolicyID                 uuid.UUID            `json:"policy_id"`
	Name                     string               `json:"name"`
	Status                   ApprovalPolicyStatus `json:"status"`
	Mode                     string               `json:"mode"`
	Quorum                   string               `json:"quorum"`
	QuorumN                  *int                 `json:"quorum_n,omitempty"`
	RequireAuthorityEvidence bool                 `json:"require_authority_evidence"`
	TotalTasks               int                  `json:"total_tasks"`
	ActiveTasks              int                  `json:"active_tasks"`
	CompletedTasks           int                  `json:"completed_tasks"`
	RejectedTasks            int                  `json:"rejected_tasks"`
	CancelledTasks           int                  `json:"cancelled_tasks"`
	AwaitingQuorumTasks      int                  `json:"awaiting_quorum_tasks"`
	AverageDecisionHours     *float64             `json:"average_decision_hours,omitempty"`
	LastTaskAt               *time.Time           `json:"last_task_at,omitempty"`
}
