package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// CreateLegalRequestRequest is the intake payload for the request spine. Title
// is bilingual (Arabic-first per CAP-172); service_id and beneficiary_entity_id
// are optional decoupled references so the spine ships before the catalog/org
// modules.
type CreateLegalRequestRequest struct {
	RequestNumber         *string                               `json:"request_number,omitempty"`
	RequestType           string                                `json:"request_type"`
	ServiceID             *uuid.UUID                            `json:"service_id,omitempty"`
	Title                 forms.LocalizedText                   `json:"title"`
	Description           string                                `json:"description"`
	RequesterUserID       *uuid.UUID                            `json:"requester_user_id,omitempty"`
	RequesterName         string                                `json:"requester_name"`
	BeneficiaryEntityID   *uuid.UUID                            `json:"beneficiary_entity_id,omitempty"`
	Department            *string                               `json:"department,omitempty"`
	Priority              model.RequestPriority                 `json:"priority"`
	UrgencyJustification  *string                               `json:"urgency_justification,omitempty"`
	RequesterApprovalReqd bool                                  `json:"requester_approval_required"`
	ProviderApprovalReqd  bool                                  `json:"provider_approval_required"`
	SubjectType           *string                               `json:"subject_type,omitempty"`
	SubjectID             *uuid.UUID                            `json:"subject_id,omitempty"`
	Metadata              map[string]any                        `json:"metadata"`
	Attachments           []CreateLegalRequestAttachmentRequest `json:"attachments,omitempty"`
}

// CreateLegalRequestAttachmentRequest links an already-uploaded, clean Lex
// file to the request being created. The service re-reads file metadata and
// verifies tenant/uploader ownership; clients cannot supply trusted file facts.
type CreateLegalRequestAttachmentRequest struct {
	FileID  uuid.UUID `json:"file_id"`
	SlotKey *string   `json:"slot_key,omitempty"`
}

// UpdateLegalRequestRequest patches mutable fields of a draft/returned request.
// Status transitions are NOT performed here — use Submit / dedicated transition
// endpoints. Priority changes are NOT performed here — use the audited
// reclassify endpoint (CAP-011).
type UpdateLegalRequestRequest struct {
	RequestType           *string              `json:"request_type,omitempty"`
	ServiceID             *uuid.UUID           `json:"service_id,omitempty"`
	Title                 *forms.LocalizedText `json:"title,omitempty"`
	Description           *string              `json:"description,omitempty"`
	RequesterName         *string              `json:"requester_name,omitempty"`
	BeneficiaryEntityID   *uuid.UUID           `json:"beneficiary_entity_id,omitempty"`
	Department            *string              `json:"department,omitempty"`
	RequesterApprovalReqd *bool                `json:"requester_approval_required,omitempty"`
	ProviderApprovalReqd  *bool                `json:"provider_approval_required,omitempty"`
	SubjectType           *string              `json:"subject_type,omitempty"`
	SubjectID             *uuid.UUID           `json:"subject_id,omitempty"`
	Metadata              map[string]any       `json:"metadata,omitempty"`
}

// SubmitLegalRequestRequest carries optional notes recorded on the draft →
// submitted transition.
type SubmitLegalRequestRequest struct {
	Notes string `json:"notes"`
}

// ReclassifyPriorityRequest is the CAP-010/CAP-011 audited priority change. A
// move to "urgent" requires a non-empty structured justification that is NOT
// solely about requester delay / poor planning (enforced in the service layer).
type ReclassifyPriorityRequest struct {
	Priority             model.RequestPriority `json:"priority"`
	Reason               string                `json:"reason"`
	UrgencyJustification *string               `json:"urgency_justification,omitempty"`
}

// SubmitLegalRequestFeedbackRequest records the requester's one-time
// satisfaction response after the request has been delivered or closed.
type SubmitLegalRequestFeedbackRequest struct {
	Rating  int    `json:"rating"`
	Comment string `json:"comment,omitempty"`
}

// Normalize trims the optional feedback comment in place.
func (r *SubmitLegalRequestFeedbackRequest) Normalize() {
	r.Comment = strings.TrimSpace(r.Comment)
}

// Normalize trims and defaults the create payload in place.
func (r *CreateLegalRequestRequest) Normalize() {
	r.RequestType = strings.TrimSpace(r.RequestType)
	r.Description = strings.TrimSpace(r.Description)
	r.RequesterName = strings.TrimSpace(r.RequesterName)
	r.Title = NormalizeLocalizedText(r.Title)
	if r.Priority == "" {
		r.Priority = model.RequestPriorityNormal
	}
	r.UrgencyJustification = NormalizeOptionalText(r.UrgencyJustification)
	r.Department = NormalizeOptionalText(r.Department)
	r.SubjectType = NormalizeOptionalText(r.SubjectType)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	for i := range r.Attachments {
		r.Attachments[i].SlotKey = NormalizeOptionalText(r.Attachments[i].SlotKey)
	}
}

// Normalize trims the update payload in place.
func (r *UpdateLegalRequestRequest) Normalize() {
	if r.RequestType != nil {
		trimmed := strings.TrimSpace(*r.RequestType)
		r.RequestType = &trimmed
	}
	if r.Title != nil {
		normalized := NormalizeLocalizedText(*r.Title)
		r.Title = &normalized
	}
	if r.Description != nil {
		trimmed := strings.TrimSpace(*r.Description)
		r.Description = &trimmed
	}
	if r.RequesterName != nil {
		trimmed := strings.TrimSpace(*r.RequesterName)
		r.RequesterName = &trimmed
	}
	r.Department = NormalizeOptionalText(r.Department)
	r.SubjectType = NormalizeOptionalText(r.SubjectType)
}

// Normalize trims the submit payload in place.
func (r *SubmitLegalRequestRequest) Normalize() {
	r.Notes = strings.TrimSpace(r.Notes)
}

// Normalize trims the reclassify payload in place.
func (r *ReclassifyPriorityRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
	r.UrgencyJustification = NormalizeOptionalText(r.UrgencyJustification)
}

// NormalizeLocalizedText trims both locale strings of a bilingual label.
func NormalizeLocalizedText(lt forms.LocalizedText) forms.LocalizedText {
	return forms.LocalizedText{
		AR: strings.TrimSpace(lt.AR),
		EN: strings.TrimSpace(lt.EN),
	}
}

// NormalizeOptionalText trims an optional string, collapsing an empty result to
// nil so blank values are stored as SQL NULL.
func NormalizeOptionalText(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
