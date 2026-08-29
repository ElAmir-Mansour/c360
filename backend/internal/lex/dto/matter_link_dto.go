package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// CreateMatterLinkRequest creates a cross-domain related-items edge from a
// matter to a sibling lex entity. The matter id is taken from the URL path; the
// body supplies the target type/id and an optional free-text relationship label.
type CreateMatterLinkRequest struct {
	TargetType   model.MatterLinkTargetType `json:"target_type"`
	TargetID     uuid.UUID                  `json:"target_id"`
	Relationship string                     `json:"relationship,omitempty"`
}

// Normalize trims whitespace from the free-text fields.
func (r *CreateMatterLinkRequest) Normalize() {
	r.TargetType = model.MatterLinkTargetType(strings.TrimSpace(string(r.TargetType)))
	r.Relationship = strings.TrimSpace(r.Relationship)
}
