package model

import (
	"time"

	"github.com/google/uuid"
)

// ApprovalPolicyAuditAction enumerates the mutations recorded in the append-only
// approval-policy audit log.
type ApprovalPolicyAuditAction string

const (
	ApprovalPolicyAuditCreated         ApprovalPolicyAuditAction = "created"
	ApprovalPolicyAuditUpdated         ApprovalPolicyAuditAction = "updated"
	ApprovalPolicyAuditArchived        ApprovalPolicyAuditAction = "archived"
	ApprovalPolicyAuditRestored        ApprovalPolicyAuditAction = "restored"
	ApprovalPolicyAuditTemplateApplied ApprovalPolicyAuditAction = "template_applied"
)

// ApprovalPolicyAuditEntry is a single append-only audit record describing a
// change to an approval policy. The before/after JSON documents capture the
// policy state on either side of the mutation (either may be nil, e.g. before is
// nil on create). Rows are never updated or deleted.
type ApprovalPolicyAuditEntry struct {
	ID        uuid.UUID                 `json:"id"`
	TenantID  uuid.UUID                 `json:"tenant_id"`
	PolicyID  uuid.UUID                 `json:"policy_id"`
	Action    ApprovalPolicyAuditAction `json:"action"`
	ActorID   *uuid.UUID                `json:"actor_id,omitempty"`
	Before    *ApprovalPolicy           `json:"before,omitempty"`
	After     *ApprovalPolicy           `json:"after,omitempty"`
	RequestID string                    `json:"request_id,omitempty"`
	CreatedAt time.Time                 `json:"created_at"`
}
