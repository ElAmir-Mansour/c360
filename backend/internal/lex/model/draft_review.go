package model

import (
	"time"

	"github.com/google/uuid"
)

// Draft review lifecycle states. These mirror the engine HumanTask outcome onto
// the lex-side projection.
const (
	DraftReviewStatusPending          = "pending"
	DraftReviewStatusApproved         = "approved"
	DraftReviewStatusRejected         = "rejected"
	DraftReviewStatusChangesRequested = "changes_requested"
	DraftReviewStatusCancelled        = "cancelled"
)

// DraftReview is the lex-side projection of an AI-draft human review (Feature 4).
// The authoritative task state lives in the shared workflow engine
// (workflow_tasks / workflow_instances); this row persists the submitted draft
// content and the linkage + review lifecycle so the draft can be queried without
// joining the engine tables.
type DraftReview struct {
	ID                 uuid.UUID      `json:"id"`
	TenantID           uuid.UUID      `json:"tenant_id"`
	DraftID            uuid.UUID      `json:"draft_id"`
	Title              string         `json:"title"`
	DraftKind          string         `json:"draft_kind"`
	Content            map[string]any `json:"content"`
	ReviewStatus       string         `json:"review_status"`
	ReviewTaskID       *uuid.UUID     `json:"review_task_id,omitempty"`
	WorkflowInstanceID *uuid.UUID     `json:"workflow_instance_id,omitempty"`
	AssigneeID         *uuid.UUID     `json:"assignee_id,omitempty"`
	AssigneeRole       *string        `json:"assignee_role,omitempty"`
	SLADeadline        *time.Time     `json:"sla_deadline,omitempty"`
	ReviewNotes        string         `json:"review_notes,omitempty"`
	ReviewedBy         *uuid.UUID     `json:"reviewed_by,omitempty"`
	ReviewedAt         *time.Time     `json:"reviewed_at,omitempty"`
	SubmittedBy        *uuid.UUID     `json:"submitted_by,omitempty"`
	Metadata           map[string]any `json:"metadata"`
	CreatedAt          time.Time      `json:"created_at"`
	UpdatedAt          time.Time      `json:"updated_at"`
}

// DraftReviewOutcome carries the terminal review decision applied to a pending
// draft review by the completion path.
type DraftReviewOutcome struct {
	ID           uuid.UUID
	TenantID     uuid.UUID
	ReviewStatus string
	ReviewNotes  string
	ReviewedBy   *uuid.UUID
	ReviewedAt   time.Time
}
