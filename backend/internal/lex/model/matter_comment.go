package model

import (
	"time"

	"github.com/google/uuid"
)

// MatterComment is a persisted collaboration note on a legal matter. Mentions are
// stored so the notification/frontend layer can render @mentions and resolve
// recipients. Author identity is denormalized (author_user_id + author_name) so
// the comment thread renders without an extra user lookup. Mirrors CaseComment.
type MatterComment struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	MatterID     uuid.UUID      `json:"matter_id"`
	Body         string         `json:"body"`
	Mentions     []string       `json:"mentions"`
	Metadata     map[string]any `json:"metadata"`
	AuthorUserID uuid.UUID      `json:"author_user_id"`
	AuthorName   string         `json:"author_name"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	DeletedAt    *time.Time     `json:"deleted_at,omitempty"`
}
