package dto

import "strings"

// CreateComplianceReviewRequest records (upserts) the reviewer's triage of a
// single matched regulatory-compliance flag on a contract (CAP-109). FlagRef is
// the stable compliance-flag code; Status is open|resolved (defaults to open
// when omitted).
type CreateComplianceReviewRequest struct {
	FlagRef string `json:"flag_ref"`
	Status  string `json:"status,omitempty"`
	Note    string `json:"note,omitempty"`
}

// UpdateComplianceReviewRequest patches an existing compliance review — chiefly
// to flip a flag between open and resolved. Nil fields are left as-is.
type UpdateComplianceReviewRequest struct {
	Status *string `json:"status,omitempty"`
	Note   *string `json:"note,omitempty"`
}

func (r *CreateComplianceReviewRequest) Normalize() {
	r.FlagRef = strings.TrimSpace(r.FlagRef)
	r.Status = strings.ToLower(strings.TrimSpace(r.Status))
	r.Note = strings.TrimSpace(r.Note)
}

func (r *UpdateComplianceReviewRequest) Normalize() {
	if r.Status != nil {
		status := strings.ToLower(strings.TrimSpace(*r.Status))
		r.Status = &status
	}
	if r.Note != nil {
		note := strings.TrimSpace(*r.Note)
		r.Note = &note
	}
}
