package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// ApplyLegalHoldRequest places a new legal hold on a contract, matter, or
// document (FR-WATHEEQ-005). Reason is mandatory because a hold is an auditable
// preservation action; reference captures the case/court/matter identifier.
type ApplyLegalHoldRequest struct {
	SubjectType model.LegalHoldSubjectType `json:"subject_type"`
	SubjectID   uuid.UUID                  `json:"subject_id"`
	Reason      string                     `json:"reason"`
	Reference   string                     `json:"reference"`
	Custodian   string                     `json:"custodian"`
	Notes       string                     `json:"notes"`
	Metadata    map[string]any             `json:"metadata"`
}

// Normalize trims string fields in place so validation and persistence operate
// on canonical values.
func (r *ApplyLegalHoldRequest) Normalize() {
	r.SubjectType = model.LegalHoldSubjectType(strings.TrimSpace(string(r.SubjectType)))
	r.Reason = strings.TrimSpace(r.Reason)
	r.Reference = strings.TrimSpace(r.Reference)
	r.Custodian = strings.TrimSpace(r.Custodian)
	r.Notes = strings.TrimSpace(r.Notes)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// ReleaseLegalHoldRequest lifts an active legal hold. A release note documents
// why the preservation requirement ended.
type ReleaseLegalHoldRequest struct {
	ReleaseNote string `json:"release_note"`
}

// Normalize trims the release note in place.
func (r *ReleaseLegalHoldRequest) Normalize() {
	r.ReleaseNote = strings.TrimSpace(r.ReleaseNote)
}
