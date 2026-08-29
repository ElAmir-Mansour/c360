package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type CreateManagerTaskRequest struct {
	Title            string     `json:"title"`
	Description      string     `json:"description"`
	AssigneeID       uuid.UUID  `json:"assignee_id"`
	AttachmentFileID *uuid.UUID `json:"attachment_file_id,omitempty"`
}

func (r *CreateManagerTaskRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
}

type UpdateManagerTaskStatusRequest struct {
	Status model.ManagerTaskStatus `json:"status"`
}

type SubmitManagerTaskRequest struct {
	Result string `json:"result"`
}

func (r *SubmitManagerTaskRequest) Normalize() { r.Result = strings.TrimSpace(r.Result) }

type DecideManagerTaskRequest struct {
	Decision string `json:"decision"`
	Note     string `json:"note,omitempty"`
}

func (r *DecideManagerTaskRequest) Normalize() {
	r.Decision = strings.ToLower(strings.TrimSpace(r.Decision))
	r.Note = strings.TrimSpace(r.Note)
}
