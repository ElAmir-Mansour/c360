package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type CreateMatterRequest struct {
	MatterNumber    *string             `json:"matter_number,omitempty"`
	Title           string              `json:"title"`
	Description     string              `json:"description"`
	Type            model.MatterType    `json:"type"`
	Status          model.MatterStatus  `json:"status"`
	Priority        model.LegalPriority `json:"priority"`
	OwnerUserID     uuid.UUID           `json:"owner_user_id"`
	OwnerName       string              `json:"owner_name"`
	RequesterUserID *uuid.UUID          `json:"requester_user_id,omitempty"`
	RequesterName   *string             `json:"requester_name,omitempty"`
	Department      *string             `json:"department,omitempty"`
	DueDate         *time.Time          `json:"due_date,omitempty"`
	Tags            []string            `json:"tags"`
	Metadata        map[string]any      `json:"metadata"`
	ContractIDs     []uuid.UUID         `json:"contract_ids,omitempty"`
}

type UpdateMatterRequest struct {
	MatterNumber    *string              `json:"matter_number,omitempty"`
	Title           *string              `json:"title,omitempty"`
	Description     *string              `json:"description,omitempty"`
	Type            *model.MatterType    `json:"type,omitempty"`
	Status          *model.MatterStatus  `json:"status,omitempty"`
	Priority        *model.LegalPriority `json:"priority,omitempty"`
	OwnerUserID     *uuid.UUID           `json:"owner_user_id,omitempty"`
	OwnerName       *string              `json:"owner_name,omitempty"`
	RequesterUserID *uuid.UUID           `json:"requester_user_id,omitempty"`
	RequesterName   *string              `json:"requester_name,omitempty"`
	Department      *string              `json:"department,omitempty"`
	DueDate         *time.Time           `json:"due_date,omitempty"`
	Tags            []string             `json:"tags,omitempty"`
	Metadata        map[string]any       `json:"metadata,omitempty"`
}

type UpdateMatterStatusRequest struct {
	Status model.MatterStatus `json:"status"`
}

type TriageMatterRequest struct {
	Status      model.MatterStatus   `json:"status"`
	Priority    *model.LegalPriority `json:"priority,omitempty"`
	OwnerUserID *uuid.UUID           `json:"owner_user_id,omitempty"`
	OwnerName   *string              `json:"owner_name,omitempty"`
	DueDate     *time.Time           `json:"due_date,omitempty"`
	Notes       string               `json:"notes"`
	Metadata    map[string]any       `json:"metadata"`
}

type LinkMatterContractRequest struct {
	ContractID   uuid.UUID `json:"contract_id"`
	Relationship string    `json:"relationship"`
}

type MatterConflictCheckRequest struct {
	MatterID        *uuid.UUID `json:"matter_id,omitempty"`
	ContractID      *uuid.UUID `json:"contract_id,omitempty"`
	Title           string     `json:"title"`
	Description     string     `json:"description,omitempty"`
	Counterparty    string     `json:"counterparty,omitempty"`
	ContractTitle   string     `json:"contract_title,omitempty"`
	ContractContext string     `json:"contract_context,omitempty"`
}

type MatterConflictSeverity string

const (
	MatterConflictSeverityConflict MatterConflictSeverity = "conflict"
	MatterConflictSeverityWarning  MatterConflictSeverity = "warning"
)

type MatterConflictIssue struct {
	Severity      MatterConflictSeverity `json:"severity"`
	Reasons       []string               `json:"reasons"`
	MatterID      *uuid.UUID             `json:"matter_id,omitempty"`
	MatterTitle   *string                `json:"matter_title,omitempty"`
	ContractID    *uuid.UUID             `json:"contract_id,omitempty"`
	ContractTitle *string                `json:"contract_title,omitempty"`
	MatchedTerms  []string               `json:"matched_terms,omitempty"`
}

type MatterConflictCheckResult struct {
	CheckedAt time.Time             `json:"checked_at"`
	Conflicts []MatterConflictIssue `json:"conflicts"`
	Warnings  []MatterConflictIssue `json:"warnings"`
}

func (r *CreateMatterRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.OwnerName = strings.TrimSpace(r.OwnerName)
	if r.Type == "" {
		r.Type = model.MatterTypeGeneral
	}
	if r.Status == "" {
		r.Status = model.MatterStatusOpen
	}
	if r.Priority == "" {
		r.Priority = model.LegalPriorityMedium
	}
	r.Tags = normalizeTags(r.Tags)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *TriageMatterRequest) Normalize() {
	r.Notes = strings.TrimSpace(r.Notes)
	if r.Status == "" {
		r.Status = model.MatterStatusInReview
	}
	if r.OwnerName != nil {
		trimmed := strings.TrimSpace(*r.OwnerName)
		r.OwnerName = &trimmed
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *MatterConflictCheckRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.Counterparty = strings.TrimSpace(r.Counterparty)
	r.ContractTitle = strings.TrimSpace(r.ContractTitle)
	r.ContractContext = strings.TrimSpace(r.ContractContext)
}
