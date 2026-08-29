package model

import (
	"time"

	"github.com/google/uuid"
)

// ApprovalPolicyTemplate is a reusable, named approval-policy definition that a
// policy can be materialised from. The Definition document holds the template's
// policy shape (approvers, mode, quorum, form fields, etc.) as a free-form JSON
// blob so templates can evolve independently of the concrete policy columns.
// Templates are tenant-scoped and unique by (tenant_id, name).
type ApprovalPolicyTemplate struct {
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
