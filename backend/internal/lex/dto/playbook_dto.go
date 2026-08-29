package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// CreatePlaybookRequest is the body for creating a clause playbook (WTQ-RSK-02).
type CreatePlaybookRequest struct {
	Name         string                  `json:"name"`
	Description  string                  `json:"description"`
	ContractType model.ContractType      `json:"contract_type"`
	Status       model.PlaybookStatus    `json:"status"`
	Clauses      []PlaybookClauseRequest `json:"clauses"`
	Metadata     map[string]any          `json:"metadata,omitempty"`
}

// UpdatePlaybookRequest is the body for updating a clause playbook.
type UpdatePlaybookRequest struct {
	Name         string                  `json:"name"`
	Description  string                  `json:"description"`
	ContractType model.ContractType      `json:"contract_type"`
	Status       model.PlaybookStatus    `json:"status"`
	Clauses      []PlaybookClauseRequest `json:"clauses"`
	Metadata     map[string]any          `json:"metadata,omitempty"`
}

// PlaybookClauseRequest is one standard clause within a playbook payload.
type PlaybookClauseRequest struct {
	ClauseType          model.ClauseType `json:"clause_type"`
	Title               string           `json:"title"`
	StandardText        string           `json:"standard_text"`
	Required            bool             `json:"required"`
	RiskWeight          float64          `json:"risk_weight"`
	SimilarityThreshold float64          `json:"similarity_threshold"`
}

// DeviationReviewRequest is the body for upserting a deviation triage disposition
// (WTQ-RSK-02 #3).
type DeviationReviewRequest struct {
	Status model.DeviationReviewStatus `json:"status"`
	Note   string                      `json:"note"`
}

// PlaybookDryRunRequest tests a draft/edited playbook against a contract WITHOUT
// it being the stored active playbook (WTQ-RSK-02 #8). Either Clauses (a draft
// clause set) or PlaybookID (a saved playbook to preview) is used; PlaybookID wins
// when both are supplied. ContractType defaults to the contract's own type when
// blank; Threshold (0..1) overrides the detector's default similarity threshold.
type PlaybookDryRunRequest struct {
	ContractID   uuid.UUID               `json:"contract_id"`
	PlaybookID   *uuid.UUID              `json:"playbook_id,omitempty"`
	ContractType model.ContractType      `json:"contract_type,omitempty"`
	Threshold    float64                 `json:"threshold,omitempty"`
	Clauses      []PlaybookClauseRequest `json:"clauses"`
}

// Normalize trims/normalizes the dry-run request's nested clauses.
func (r *PlaybookDryRunRequest) Normalize() {
	for i := range r.Clauses {
		r.Clauses[i].Normalize()
	}
}

// PlaybookCloneRequest is the optional body for cloning a template or playbook
// (WTQ-RSK-02 #7). Name overrides the default clone name when non-empty.
type PlaybookCloneRequest struct {
	Name string `json:"name,omitempty"`
}

func (r *CreatePlaybookRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	if r.Status == "" {
		r.Status = model.PlaybookStatusActive
	}
	for i := range r.Clauses {
		r.Clauses[i].Normalize()
	}
}

func (r *UpdatePlaybookRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Description = strings.TrimSpace(r.Description)
	if r.Status == "" {
		r.Status = model.PlaybookStatusActive
	}
	for i := range r.Clauses {
		r.Clauses[i].Normalize()
	}
}

func (c *PlaybookClauseRequest) Normalize() {
	c.Title = strings.TrimSpace(c.Title)
	c.StandardText = strings.TrimSpace(c.StandardText)
}
