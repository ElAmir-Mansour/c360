package dto

import (
	"strings"

	"github.com/google/uuid"
)

// AID-09 prompt-library request DTOs.

type CreatePromptTemplateRequest struct {
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	Category     string         `json:"category"`
	SystemPrompt string         `json:"system_prompt"`
	UserPrompt   string         `json:"user_prompt"`
	Variables    []string       `json:"variables"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

func (r *CreatePromptTemplateRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	r.Category = strings.TrimSpace(r.Category)
	if r.Category == "" {
		r.Category = "general"
	}
	r.SystemPrompt = strings.TrimSpace(r.SystemPrompt)
	r.UserPrompt = strings.TrimSpace(r.UserPrompt)
	r.Variables = normalizeStrings(r.Variables)
}

type UpdatePromptTemplateRequest struct {
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	Category     string         `json:"category"`
	SystemPrompt string         `json:"system_prompt"`
	UserPrompt   string         `json:"user_prompt"`
	Variables    []string       `json:"variables"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

func (r *UpdatePromptTemplateRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	r.Category = strings.TrimSpace(r.Category)
	if r.Category == "" {
		r.Category = "general"
	}
	r.SystemPrompt = strings.TrimSpace(r.SystemPrompt)
	r.UserPrompt = strings.TrimSpace(r.UserPrompt)
	r.Variables = normalizeStrings(r.Variables)
}

// RunPromptRequest supplies the variable bindings for a saved template run.
type RunPromptRequest struct {
	Variables map[string]any `json:"variables"`
}

// SubmitDraftForReviewRequest submits an AI drafting output as a first-class
// engine-tracked human task (Feature 4). The draft content is carried into the
// task form data and persisted on the lex-side review projection.
type SubmitDraftForReviewRequest struct {
	// Title is a human-friendly label shown on the review task.
	Title string `json:"title"`
	// DraftKind records which AID-* artefact produced the content (free-form,
	// e.g. "clause", "contract", "rewrite").
	DraftKind string `json:"draft_kind"`
	// Content is the full draft payload to be reviewed. It is carried into the
	// engine task form data and persisted as the review's source of truth.
	Content map[string]any `json:"content"`
	// AssigneeID / AssigneeRole assign the engine task. At least one should be
	// provided; when both are empty the task is unassigned (claimable by role
	// policy elsewhere).
	AssigneeID   *uuid.UUID `json:"assignee_id,omitempty"`
	AssigneeRole *string    `json:"assignee_role,omitempty"`
	// SLAHours, when > 0, sets the task SLA deadline relative to submission time.
	SLAHours int `json:"sla_hours"`
	// FormFields are optional additional reviewer form fields appended to the
	// default decision/notes schema.
	FormFields []ApprovalFormFieldRequest `json:"form_fields,omitempty"`
	// Metadata is optional caller-supplied context stored on the review.
	Metadata map[string]any `json:"metadata,omitempty"`
}

func (r *SubmitDraftForReviewRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.DraftKind = strings.TrimSpace(r.DraftKind)
	if r.AssigneeRole != nil {
		role := strings.TrimSpace(*r.AssigneeRole)
		if role == "" {
			r.AssigneeRole = nil
		} else {
			r.AssigneeRole = &role
		}
	}
	if r.Content == nil {
		r.Content = map[string]any{}
	}
}
