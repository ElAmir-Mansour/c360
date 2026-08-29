package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type CreateSupportRequest struct {
	TargetEntityID uuid.UUID                        `json:"target_entity_id"`
	AssigneeID     uuid.UUID                        `json:"assignee_id"`
	Subject        string                           `json:"subject"`
	Body           string                           `json:"body"`
	Priority       model.SupportRequestPriority     `json:"priority"`
	SubjectType    *model.SupportRequestSubjectType `json:"subject_type,omitempty"`
	SubjectID      *uuid.UUID                       `json:"subject_id,omitempty"`
	BusinessDays   *int                             `json:"business_days,omitempty"`
}

func (r *CreateSupportRequest) Normalize() {
	r.Subject = strings.TrimSpace(r.Subject)
	r.Body = strings.TrimSpace(r.Body)
	r.Priority = model.SupportRequestPriority(strings.ToLower(strings.TrimSpace(string(r.Priority))))
	if r.Priority == "" {
		r.Priority = model.SupportPriorityNormal
	}
	if r.SubjectType != nil {
		value := model.SupportRequestSubjectType(strings.ToLower(strings.TrimSpace(string(*r.SubjectType))))
		r.SubjectType = &value
	}
}

type SupportRequestNote struct {
	Note string `json:"note"`
}

func (r *SupportRequestNote) Normalize() { r.Note = strings.TrimSpace(r.Note) }
