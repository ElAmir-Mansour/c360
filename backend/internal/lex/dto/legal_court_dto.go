package dto

import (
	"strings"

	"github.com/clario360/platform/internal/forms"
)

// CreateLegalCourtRequest adds one court to the tenant-maintained competent-court
// reference list (feedback items 5/6). The table ships empty on purpose — the
// customer's court list arrived blank — so this is the only way rows appear.
type CreateLegalCourtRequest struct {
	Code     string              `json:"code"`
	Name     forms.LocalizedText `json:"name"`
	Active   *bool               `json:"active,omitempty"`
	Sort     *int                `json:"sort,omitempty"`
	Metadata map[string]any      `json:"metadata,omitempty"`
}

// UpdateLegalCourtRequest patches a court. Nil fields are left unchanged.
type UpdateLegalCourtRequest struct {
	Code     *string              `json:"code,omitempty"`
	Name     *forms.LocalizedText `json:"name,omitempty"`
	Active   *bool                `json:"active,omitempty"`
	Sort     *int                 `json:"sort,omitempty"`
	Metadata map[string]any       `json:"metadata,omitempty"`
}

// LegalCourtLegacyValue is one distinct free-text `competent_court` string still
// carried by cases created before the reference list existed, with how many cases
// use it. Nothing is auto-mapped: this exists so an administrator can SEE the
// historical spellings and decide which real court row each belongs to.
type LegalCourtLegacyValue struct {
	Value string `json:"value"`
	Cases int    `json:"cases"`
}

func (r *CreateLegalCourtRequest) Normalize() {
	r.Code = strings.ToUpper(strings.TrimSpace(r.Code))
	r.Name.AR = strings.TrimSpace(r.Name.AR)
	r.Name.EN = strings.TrimSpace(r.Name.EN)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *UpdateLegalCourtRequest) Normalize() {
	if r.Code != nil {
		trimmed := strings.ToUpper(strings.TrimSpace(*r.Code))
		r.Code = &trimmed
	}
	if r.Name != nil {
		r.Name.AR = strings.TrimSpace(r.Name.AR)
		r.Name.EN = strings.TrimSpace(r.Name.EN)
	}
}
