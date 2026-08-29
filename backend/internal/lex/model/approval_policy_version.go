package model

import (
	"time"

	"github.com/google/uuid"
)

// ApprovalPolicyVersion is an immutable snapshot of an approval policy captured
// at a specific version number. Rows are append-only history: once written they
// are never updated or deleted (enforced by the absence of UPDATE/DELETE RLS
// policies on lex_approval_policy_versions). The (policy_id, version) pair is
// unique, so the table doubles as the version counter's source of truth.
type ApprovalPolicyVersion struct {
	ID           uuid.UUID      `json:"id"`
	PolicyID     uuid.UUID      `json:"policy_id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	Version      int            `json:"version"`
	Snapshot     ApprovalPolicy `json:"snapshot"`
	ChangeReason string         `json:"change_reason,omitempty"`
	CreatedBy    *uuid.UUID     `json:"created_by,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}
