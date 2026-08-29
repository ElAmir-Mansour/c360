package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// CreateRequirementItemRequest adds one required attachment/data item to a
// request's execution checklist (CAP-022). Items are usually seeded from the
// service-catalog required-attachment config; this endpoint covers manual edits.
type CreateRequirementItemRequest struct {
	Code      string                `json:"code"`
	Label     forms.LocalizedText   `json:"label"`
	Kind      model.RequirementKind `json:"kind"`
	Required  *bool                 `json:"required,omitempty"`
	SortOrder int                   `json:"sort_order"`
	Metadata  map[string]any        `json:"metadata,omitempty"`
}

// UpdateRequirementItemRequest patches a requirement item and/or marks it
// satisfied. Supplying file_id (attachment) or data_value (data) satisfies the
// item; satisfied may also be set explicitly.
type UpdateRequirementItemRequest struct {
	Code      *string                `json:"code,omitempty"`
	Label     *forms.LocalizedText   `json:"label,omitempty"`
	Kind      *model.RequirementKind `json:"kind,omitempty"`
	Required  *bool                  `json:"required,omitempty"`
	Satisfied *bool                  `json:"satisfied,omitempty"`
	FileID    *uuid.UUID             `json:"file_id,omitempty"`
	DataValue *string                `json:"data_value,omitempty"`
	SortOrder *int                   `json:"sort_order,omitempty"`
	Metadata  map[string]any         `json:"metadata,omitempty"`
}

// ConfirmCompletenessRequest is the provider's confirmation that the request is
// COMPLETE (all required items satisfied) — this STARTS the execution clock
// (CAP-022/CAP-023). working_calendar_id selects the calendar for SLA math
// (CAP-029); nil uses the tenant default. sla_target_seconds optionally pins the
// execution target the SLA module consumes from the clock-start event.
type ConfirmCompletenessRequest struct {
	WorkingCalendarID *uuid.UUID `json:"working_calendar_id,omitempty"`
	SLATargetSeconds  *int64     `json:"sla_target_seconds,omitempty"`
	Notes             string     `json:"notes"`
}

// ReturnIncompleteRequest returns the request to the requester as incomplete
// (CAP-025), opening a review round. After the second return the engine
// auto-closes and clones (CAP-026).
//
// PRD 6.3 (Othaim intake governance) makes ReasonCode MANDATORY: a return may
// carry an additional free-text detail, but it MUST be filed against one of the
// four controlled deficiency codes so every returned request is categorised for
// reporting and audit. A free-text-only return (no code) is rejected 400 — see
// Validate. The four codes are the SAME enum the FE return-incomplete dialog
// offers (return-incomplete-dialog.tsx RETURN_REASON_CODES).
type ReturnIncompleteRequest struct {
	ReasonCode              model.ReturnIncompleteReasonCode `json:"reason_code"`
	Reason                  string                           `json:"reason"`
	MissingRequirementCodes []string                         `json:"missing_requirement_codes,omitempty"`
}

// RequestDeliveryConfirmationRequest opens the delivery-confirmation handshake
// after delivery (CAP-027). The requester is asked to confirm/deny; a 24-working-
// hour auto-close deadline is computed via the working calendar (CAP-028).
type RequestDeliveryConfirmationRequest struct {
	RecipientUserID   *uuid.UUID `json:"recipient_user_id,omitempty"`
	RecipientName     string     `json:"recipient_name"`
	RecipientContact  *string    `json:"recipient_contact,omitempty"`
	Notes             string     `json:"notes"`
	LateJustification *string    `json:"late_justification,omitempty"`
}

// RespondDeliveryConfirmationRequest is the requester's confirm/deny response
// (CAP-027).
type RespondDeliveryConfirmationRequest struct {
	Confirm bool    `json:"confirm"`
	Note    *string `json:"note,omitempty"`
}

// Normalize trims and defaults the create-requirement payload in place.
func (r *CreateRequirementItemRequest) Normalize() {
	r.Code = strings.TrimSpace(r.Code)
	r.Label = NormalizeLocalizedText(r.Label)
	if r.Kind == "" {
		r.Kind = model.RequirementKindAttachment
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// Normalize trims the update-requirement payload in place.
func (r *UpdateRequirementItemRequest) Normalize() {
	if r.Code != nil {
		trimmed := strings.TrimSpace(*r.Code)
		r.Code = &trimmed
	}
	if r.Label != nil {
		normalized := NormalizeLocalizedText(*r.Label)
		r.Label = &normalized
	}
	r.DataValue = NormalizeOptionalText(r.DataValue)
}

// Normalize trims the confirm-completeness payload in place.
func (r *ConfirmCompletenessRequest) Normalize() {
	r.Notes = strings.TrimSpace(r.Notes)
}

// Normalize trims the return-incomplete payload in place.
func (r *ReturnIncompleteRequest) Normalize() {
	r.ReasonCode = model.ReturnIncompleteReasonCode(strings.ToLower(strings.TrimSpace(string(r.ReasonCode))))
	r.Reason = strings.TrimSpace(r.Reason)
	if r.ReasonCode.Valid() {
		label := r.ReasonCode.Label()
		if r.Reason == "" {
			r.Reason = label
		} else {
			r.Reason = label + ": " + r.Reason
		}
	}
	r.MissingRequirementCodes = normalizeStringList(r.MissingRequirementCodes)
}

// Validate enforces the PRD 6.3 return-incomplete governance rule server-side,
// returning field-scoped errors (nil when valid) the service wraps into a 400.
// Call it AFTER Normalize (which lower-cases/trims the code and folds the code
// label into Reason). ReasonCode is MANDATORY and must be one of the four
// controlled deficiency codes: a return with no code, or with an unrecognised
// code, is rejected so a free-text-only return can never bypass the
// categorised-deficiency requirement.
func (r *ReturnIncompleteRequest) Validate() map[string]string {
	fields := map[string]string{}
	switch {
	case r.ReasonCode == "":
		fields["reason_code"] = "a return reason code is required (PRD 6.3)"
	case !r.ReasonCode.Valid():
		fields["reason_code"] = "return reason code must be one of the four controlled deficiency codes"
	}
	if r.Reason == "" {
		fields["reason"] = "reason is required"
	}
	if len(fields) == 0 {
		return nil
	}
	return fields
}

// Normalize trims the request-delivery-confirmation payload in place.
func (r *RequestDeliveryConfirmationRequest) Normalize() {
	r.RecipientName = strings.TrimSpace(r.RecipientName)
	r.RecipientContact = NormalizeOptionalText(r.RecipientContact)
	r.Notes = strings.TrimSpace(r.Notes)
	r.LateJustification = NormalizeOptionalText(r.LateJustification)
}

// Normalize trims the respond-delivery-confirmation payload in place.
func (r *RespondDeliveryConfirmationRequest) Normalize() {
	r.Note = NormalizeOptionalText(r.Note)
}

// ExecutionStateView is the aggregate read model returned by GET execution
// state: the singleton state plus its requirement checklist, review rounds and
// delivery confirmations.
type ExecutionStateView struct {
	State                 *model.ExecutionState        `json:"state"`
	Requirements          []model.RequirementItem      `json:"requirements"`
	ReviewRounds          []model.ReviewRound          `json:"review_rounds"`
	DeliveryConfirmations []model.DeliveryConfirmation `json:"delivery_confirmations"`
}
