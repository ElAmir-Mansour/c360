package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// OpenContractIntakeRequest opens (or returns the existing) review-desk intake
// for a contract (CAP-100..102): assigns the desk reference number, seeds the
// four named attachment-requirement slots (CAP-099), and optionally assigns the
// initial legal reviewer.
type OpenContractIntakeRequest struct {
	AssignedReviewerID   *uuid.UUID `json:"assigned_reviewer_id,omitempty"`
	AssignedReviewerName *string    `json:"assigned_reviewer_name,omitempty"`
	Notes                *string    `json:"notes,omitempty"`
}

func (r *OpenContractIntakeRequest) Normalize() {
	r.AssignedReviewerName = trimPtr(r.AssignedReviewerName)
	r.Notes = trimPtr(r.Notes)
}

// AcknowledgeContractIntakeRequest records the receipt acknowledgement (CAP-101).
type AcknowledgeContractIntakeRequest struct {
	Notes *string `json:"notes,omitempty"`
}

// RouteContractIntakeRequest routes the intake to the legal desk (CAP-102) and
// optionally (re)assigns the reviewer.
type RouteContractIntakeRequest struct {
	AssignedReviewerID   *uuid.UUID `json:"assigned_reviewer_id,omitempty"`
	AssignedReviewerName *string    `json:"assigned_reviewer_name,omitempty"`
	Notes                *string    `json:"notes,omitempty"`
}

func (r *RouteContractIntakeRequest) Normalize() {
	r.AssignedReviewerName = trimPtr(r.AssignedReviewerName)
	r.Notes = trimPtr(r.Notes)
}

// ReturnContractIntakeRequest returns the file to the requester (CAP-104) with a
// mandatory reason; an optional deficiency notice (CAP-105) is recorded and
// surfaced as an auto-return correspondence entry (CAP-116).
type ReturnContractIntakeRequest struct {
	Reason           string  `json:"reason"`
	DeficiencyNotice *string `json:"deficiency_notice,omitempty"`
}

func (r *ReturnContractIntakeRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
	r.DeficiencyNotice = trimPtr(r.DeficiencyNotice)
}

// UploadContractAttachmentRequest registers a review-desk attachment against a
// named slot (CAP-099), backed by a previously uploaded file (file service). A
// new upload into an occupied slot supersedes the prior one (re-upload, CAP-115).
type UploadContractAttachmentRequest struct {
	Slot          model.ContractAttachmentSlot `json:"slot"`
	FileID        *uuid.UUID                   `json:"file_id,omitempty"`
	FileName      string                       `json:"file_name"`
	FileSizeBytes int64                        `json:"file_size_bytes"`
	ContentHash   *string                      `json:"content_hash,omitempty"`
	Notes         *string                      `json:"notes,omitempty"`
	Metadata      map[string]any               `json:"metadata,omitempty"`
}

func (r *UploadContractAttachmentRequest) Normalize() {
	r.FileName = strings.TrimSpace(r.FileName)
	r.ContentHash = trimPtr(r.ContentHash)
	r.Notes = trimPtr(r.Notes)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// SetAttachmentRequirementRequest toggles a named slot required/optional or
// relabels it (CAP-099).
type SetAttachmentRequirementRequest struct {
	Slot      model.ContractAttachmentSlot `json:"slot"`
	Required  bool                         `json:"required"`
	Label     *string                      `json:"label,omitempty"`
	SortOrder *int                         `json:"sort_order,omitempty"`
}

func (r *SetAttachmentRequirementRequest) Normalize() {
	r.Label = trimPtr(r.Label)
}

// AddContractCorrespondenceRequest appends an internal/clarification entry to the
// desk correspondence thread (CAP-113/CAP-114).
type AddContractCorrespondenceRequest struct {
	Kind      model.ContractCorrespondenceKind       `json:"kind"`
	Direction *model.ContractCorrespondenceDirection `json:"direction,omitempty"`
	Subject   string                                 `json:"subject"`
	Body      string                                 `json:"body"`
	Metadata  map[string]any                         `json:"metadata,omitempty"`
}

func (r *AddContractCorrespondenceRequest) Normalize() {
	r.Subject = strings.TrimSpace(r.Subject)
	r.Body = strings.TrimSpace(r.Body)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// RecordContractRecommendationRequest records the final review-desk
// recommendation (CAP-118..120). amendment_reason is required when the outcome is
// needs_amendment and rejection_reason when rejected (CAP-119). When the outcome
// is approved and start_approval is true the desk hands the file to the existing
// contract-review workflow + approval-policy engine for the Contracts-Manager
// approval (CAP-120).
type RecordContractRecommendationRequest struct {
	Outcome         model.ContractRecommendationOutcome `json:"outcome"`
	Summary         string                              `json:"summary"`
	AmendmentReason *string                             `json:"amendment_reason,omitempty"`
	RejectionReason *string                             `json:"rejection_reason,omitempty"`
	StartApproval   bool                                `json:"start_approval"`
	Review          *ReviewContractRequest              `json:"review,omitempty"`
	Metadata        map[string]any                      `json:"metadata,omitempty"`
}

func (r *RecordContractRecommendationRequest) Normalize() {
	r.Summary = strings.TrimSpace(r.Summary)
	r.AmendmentReason = trimPtr(r.AmendmentReason)
	r.RejectionReason = trimPtr(r.RejectionReason)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// ContractReviewDeskView is the aggregate desk read model (intake + named-slot
// requirements + live attachments + last completeness result + active
// recommendation) returned by the desk overview endpoint.
type ContractReviewDeskView struct {
	ContractID     uuid.UUID                             `json:"contract_id"`
	Intake         *model.ContractIntake                 `json:"intake,omitempty"`
	Requirements   []model.ContractAttachmentRequirement `json:"requirements"`
	Attachments    []model.ContractAttachment            `json:"attachments"`
	Completeness   *model.ContractCompletenessResult     `json:"completeness,omitempty"`
	Recommendation *model.ContractRecommendation         `json:"recommendation,omitempty"`
}

func trimPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
