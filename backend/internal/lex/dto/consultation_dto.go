package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// SubmitConsultationRequest opens a new legal consultation (CAP-126). It may be
// linked to a legal request via legal_request_id (spine back-link) or stand
// alone. type/priority default when omitted; question is required.
type SubmitConsultationRequest struct {
	ConsultationNumber *string                `json:"consultation_number,omitempty"`
	Type               model.ConsultationType `json:"type"`
	Title              forms.LocalizedText    `json:"title"`
	Priority           model.LegalPriority    `json:"priority"`
	LegalRequestID     *uuid.UUID             `json:"legal_request_id,omitempty"`
	RequesterUserID    *uuid.UUID             `json:"requester_user_id,omitempty"`
	RequesterName      string                 `json:"requester_name"`
	Department         *string                `json:"department,omitempty"`
	Question           string                 `json:"question"`
	Tags               []string               `json:"tags"`
	Metadata           map[string]any         `json:"metadata"`
}

// ClassifyConsultationRequest assigns/changes the consultation type (CAP-127),
// advancing submitted → classified.
type ClassifyConsultationRequest struct {
	Type     model.ConsultationType `json:"type"`
	Priority *model.LegalPriority   `json:"priority,omitempty"`
	Notes    string                 `json:"notes"`
}

// RouteConsultationRequest routes the consultation to an advisor (CAP-129),
// advancing classified → routed.
type RouteConsultationRequest struct {
	AdvisorID   uuid.UUID `json:"advisor_id"`
	AdvisorName *string   `json:"advisor_name,omitempty"`
	Notes       string    `json:"notes"`
}

// RespondConsultationRequest records the advisor's response (CAP-130), advancing
// routed → responded. UseAI requests an AI-drafted first response body via the
// shared drafting engine when no explicit response is supplied.
type RespondConsultationRequest struct {
	Response          string         `json:"response"`
	UseAI             bool           `json:"use_ai"`
	Locale            string         `json:"locale,omitempty"`
	Notes             string         `json:"notes"`
	Metadata          map[string]any `json:"metadata"`
	LateJustification *string        `json:"late_justification,omitempty"`
}

// DraftConsultationResponseRequest requests an AI-suggested first-response memo
// body for preview (#8) WITHOUT transitioning the consultation. Locale hints the
// drafting language ("ar" default); the body is optional.
type DraftConsultationResponseRequest struct {
	Locale string `json:"locale,omitempty"`
}

// AttachConsultationDocumentRequest links a Files-service object to a
// consultation (CAP-128).
type AttachConsultationDocumentRequest struct {
	FileID      uuid.UUID      `json:"file_id"`
	FileName    string         `json:"file_name"`
	FileSize    int64          `json:"file_size"`
	ContentType *string        `json:"content_type,omitempty"`
	Kind        string         `json:"kind"`
	Metadata    map[string]any `json:"metadata"`
}

// ArchiveConsultationRequest archives an approved consultation (CAP-132).
type ArchiveConsultationRequest struct {
	Reason string `json:"reason"`
}

// BulkConsultationAction is the verb of a bulk operation over many consultations.
type BulkConsultationAction string

const (
	BulkConsultationActionArchive  BulkConsultationAction = "archive"
	BulkConsultationActionDelete   BulkConsultationAction = "delete"
	BulkConsultationActionClassify BulkConsultationAction = "classify"
	BulkConsultationActionRoute    BulkConsultationAction = "route"
	BulkConsultationActionTag      BulkConsultationAction = "tag"
)

// BulkConsultationRequest applies one action across a set of consultation IDs
// (CORE #4). Each id is processed in its OWN transaction (via the existing per-id
// service method) so one failure never rolls back the rest. Action-specific params
// are carried inline and validated per action:
//
//	archive          → optional Reason
//	delete           → (no params; needs org:close in addition to lex:write)
//	classify         → Type (required), optional Priority, optional Notes
//	route            → AdvisorID (required), optional AdvisorName, optional Notes
//	tag              → Tags (required); TagMode "add" (default) or "replace"
type BulkConsultationRequest struct {
	Action BulkConsultationAction `json:"action"`
	IDs    []uuid.UUID            `json:"ids"`
	// classify
	Type model.ConsultationType `json:"type,omitempty"`
	// archive
	Reason string `json:"reason,omitempty"`
	// classify / route shared
	Priority *model.LegalPriority `json:"priority,omitempty"`
	Notes    string               `json:"notes,omitempty"`
	// route
	AdvisorID   *uuid.UUID `json:"advisor_id,omitempty"`
	AdvisorName *string    `json:"advisor_name,omitempty"`
	// tag
	Tags    []string `json:"tags,omitempty"`
	TagMode string   `json:"tag_mode,omitempty"` // "add" (default) | "replace"
}

// BulkConsultationFailure is one id that could not be processed, with the reason.
type BulkConsultationFailure struct {
	ID    uuid.UUID `json:"id"`
	Error string    `json:"error"`
}

// BulkConsultationResult is the per-id outcome of a bulk operation. Succeeded and
// Failed are always non-nil (empty slices, never null) so the JSON is stable.
type BulkConsultationResult struct {
	Succeeded []uuid.UUID               `json:"succeeded"`
	Failed    []BulkConsultationFailure `json:"failed"`
}

func (r *BulkConsultationRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
	r.Notes = strings.TrimSpace(r.Notes)
	r.TagMode = strings.ToLower(strings.TrimSpace(r.TagMode))
	if r.TagMode == "" {
		r.TagMode = "add"
	}
	r.Tags = normalizeTags(r.Tags)
	if r.AdvisorName != nil {
		name := strings.TrimSpace(*r.AdvisorName)
		if name == "" {
			r.AdvisorName = nil
		} else {
			r.AdvisorName = &name
		}
	}
}

func (r *SubmitConsultationRequest) Normalize() {
	r.RequesterName = strings.TrimSpace(r.RequesterName)
	r.Question = strings.TrimSpace(r.Question)
	r.Title.AR = strings.TrimSpace(r.Title.AR)
	r.Title.EN = strings.TrimSpace(r.Title.EN)
	if r.Type == "" {
		r.Type = model.ConsultationTypeGeneral
	}
	if r.Priority == "" {
		r.Priority = model.LegalPriorityMedium
	}
	r.Tags = normalizeTags(r.Tags)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	if r.Department != nil {
		dept := strings.TrimSpace(*r.Department)
		if dept == "" {
			r.Department = nil
		} else {
			r.Department = &dept
		}
	}
}

func (r *ClassifyConsultationRequest) Normalize() {
	r.Notes = strings.TrimSpace(r.Notes)
}

func (r *RouteConsultationRequest) Normalize() {
	r.Notes = strings.TrimSpace(r.Notes)
	if r.AdvisorName != nil {
		name := strings.TrimSpace(*r.AdvisorName)
		if name == "" {
			r.AdvisorName = nil
		} else {
			r.AdvisorName = &name
		}
	}
}

func (r *RespondConsultationRequest) Normalize() {
	r.Response = strings.TrimSpace(r.Response)
	r.Notes = strings.TrimSpace(r.Notes)
	r.Locale = strings.ToLower(strings.TrimSpace(r.Locale))
	r.LateJustification = NormalizeOptionalText(r.LateJustification)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *AttachConsultationDocumentRequest) Normalize() {
	r.FileName = strings.TrimSpace(r.FileName)
	r.Kind = strings.TrimSpace(r.Kind)
	if r.Kind == "" {
		r.Kind = "attachment"
	}
	if r.ContentType != nil {
		ct := strings.TrimSpace(*r.ContentType)
		if ct == "" {
			r.ContentType = nil
		} else {
			r.ContentType = &ct
		}
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *ArchiveConsultationRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
}
