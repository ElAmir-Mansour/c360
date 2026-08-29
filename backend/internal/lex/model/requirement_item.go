package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// RequirementKind classifies a per-request required input (CAP-022): an
// attachment (a file the requester must provide) or a structured data field.
type RequirementKind string

const (
	RequirementKindAttachment RequirementKind = "attachment"
	RequirementKindData       RequirementKind = "data"
)

// Valid reports whether the kind is a known requirement classification.
func (k RequirementKind) Valid() bool {
	switch k {
	case RequirementKindAttachment, RequirementKindData:
		return true
	default:
		return false
	}
}

// RequirementItem is one required attachment/data item for a request, seeded
// from the service-catalog required-attachment config and toggled satisfied as
// the requester supplies it. The execution clock only starts once EVERY required
// item is satisfied (CAP-022). file_id is the platform-files reference for an
// attachment item (entity_type/entity_id, suite='lex'); it is nil until provided.
type RequirementItem struct {
	ID             uuid.UUID           `json:"id"`
	TenantID       uuid.UUID           `json:"tenant_id"`
	LegalRequestID uuid.UUID           `json:"legal_request_id"`
	Code           string              `json:"code"`
	Label          forms.LocalizedText `json:"label"`
	Kind           RequirementKind     `json:"kind"`
	Required       bool                `json:"required"`
	Satisfied      bool                `json:"satisfied"`
	FileID         *uuid.UUID          `json:"file_id,omitempty"`
	DataValue      *string             `json:"data_value,omitempty"`
	SatisfiedBy    *uuid.UUID          `json:"satisfied_by,omitempty"`
	SatisfiedAt    *time.Time          `json:"satisfied_at,omitempty"`
	SortOrder      int                 `json:"sort_order"`
	Metadata       map[string]any      `json:"metadata"`
	CreatedBy      uuid.UUID           `json:"created_by"`
	CreatedAt      time.Time           `json:"created_at"`
	UpdatedAt      time.Time           `json:"updated_at"`
}
