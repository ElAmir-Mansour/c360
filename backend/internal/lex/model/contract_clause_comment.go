package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractClauseComment is a persisted collaboration note on a contract clause
// (CAP-110). It clones MatterComment but hangs off a contract clause: it carries
// both ContractID and ClauseID so the thread can be scoped/loaded by contract
// without an extra join, plus a nullable ParentCommentID for threaded replies.
// Mentions are stored so the notification/frontend layer can render @mentions and
// resolve recipients. Author identity is denormalized (author_user_id +
// author_name) so the thread renders without an extra user lookup.
type ContractClauseComment struct {
	ID              uuid.UUID      `json:"id"`
	TenantID        uuid.UUID      `json:"tenant_id"`
	ContractID      uuid.UUID      `json:"contract_id"`
	ClauseID        uuid.UUID      `json:"clause_id"`
	ParentCommentID *uuid.UUID     `json:"parent_comment_id,omitempty"`
	Body            string         `json:"body"`
	Mentions        []string       `json:"mentions"`
	Metadata        map[string]any `json:"metadata"`
	AuthorUserID    uuid.UUID      `json:"author_user_id"`
	AuthorName      string         `json:"author_name"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       *time.Time     `json:"deleted_at,omitempty"`
}
