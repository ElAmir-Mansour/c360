package model

import (
	"time"

	"github.com/google/uuid"
)

// PromptTemplate is a reusable, tenant-scoped LLM prompt for repeatable
// legal-ops drafting tasks (AID-09). The UserPrompt (and optionally
// SystemPrompt) may contain {{variable}} placeholders that are substituted at
// run time from caller-supplied values.
type PromptTemplate struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	Category     string         `json:"category"`
	SystemPrompt string         `json:"system_prompt"`
	UserPrompt   string         `json:"user_prompt"`
	Variables    []string       `json:"variables"`
	Metadata     map[string]any `json:"metadata"`
	CreatedBy    uuid.UUID      `json:"created_by"`
	UpdatedBy    *uuid.UUID     `json:"updated_by,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}
