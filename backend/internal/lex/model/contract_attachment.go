package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractAttachmentSlot is one of the named document slots a contract review
// file is expected to carry on intake (CAP-099). The completeness check
// (CAP-103) verifies every required slot has at least one uploaded attachment.
//
// The slot set is the Othaim PRD §9.1 required-document list. The five PRD slots
// (foundation_document, purpose_of_contract, authorized_person_id,
// power_of_attorney, addendum_prior_docs) are the canonical intake set; the four
// original slots (draft, quotation, commercial_registration, committee_decision)
// are retained so existing intakes, attachments, and requirement rows keep
// validating. Widen this set here — never narrow it — so historical rows never
// fail Valid().
type ContractAttachmentSlot string

const (
	// ── Othaim PRD §9.1 required-document slots ──────────────────────────────

	// ContractAttachmentSlotFoundationDocument is the requesting entity's
	// foundation / incorporation document slot (PRD §9.1).
	ContractAttachmentSlotFoundationDocument ContractAttachmentSlot = "foundation_document"
	// ContractAttachmentSlotPurposeOfContract is the statement-of-purpose /
	// scope-of-contract document slot (PRD §9.1).
	ContractAttachmentSlotPurposeOfContract ContractAttachmentSlot = "purpose_of_contract"
	// ContractAttachmentSlotAuthorizedPersonID is the authorized signatory's
	// national-ID / identity document slot (PRD §9.1).
	ContractAttachmentSlotAuthorizedPersonID ContractAttachmentSlot = "authorized_person_id"
	// ContractAttachmentSlotPowerOfAttorney is the power-of-attorney / delegation
	// document slot (PRD §9.1).
	ContractAttachmentSlotPowerOfAttorney ContractAttachmentSlot = "power_of_attorney"
	// ContractAttachmentSlotAddendumPriorDocs is the addendum / prior-related
	// documents slot (PRD §9.1).
	ContractAttachmentSlotAddendumPriorDocs ContractAttachmentSlot = "addendum_prior_docs"

	// ── Original review-desk slots (retained for backward compatibility) ─────

	// ContractAttachmentSlotDraft is the draft contract document slot.
	ContractAttachmentSlotDraft ContractAttachmentSlot = "draft"
	// ContractAttachmentSlotQuotation is the price quotation slot.
	ContractAttachmentSlotQuotation ContractAttachmentSlot = "quotation"
	// ContractAttachmentSlotCommercialRegistration is the commercial registration slot.
	ContractAttachmentSlotCommercialRegistration ContractAttachmentSlot = "commercial_registration"
	// ContractAttachmentSlotCommitteeDecision is the committee decision slot.
	ContractAttachmentSlotCommitteeDecision ContractAttachmentSlot = "committee_decision"
)

// Valid reports whether the slot is a known named attachment slot.
func (s ContractAttachmentSlot) Valid() bool {
	switch s {
	case ContractAttachmentSlotFoundationDocument,
		ContractAttachmentSlotPurposeOfContract,
		ContractAttachmentSlotAuthorizedPersonID,
		ContractAttachmentSlotPowerOfAttorney,
		ContractAttachmentSlotAddendumPriorDocs,
		ContractAttachmentSlotDraft,
		ContractAttachmentSlotQuotation,
		ContractAttachmentSlotCommercialRegistration,
		ContractAttachmentSlotCommitteeDecision:
		return true
	default:
		return false
	}
}

// ContractAttachmentRequirement records, per contract, whether a named slot is
// required for the completeness check (CAP-099/CAP-103). Requirement rows are
// seeded when a review-desk intake opens so the four named slots are always
// represented; an intake can toggle a slot optional.
type ContractAttachmentRequirement struct {
	ID         uuid.UUID              `json:"id"`
	TenantID   uuid.UUID              `json:"tenant_id"`
	ContractID uuid.UUID              `json:"contract_id"`
	Slot       ContractAttachmentSlot `json:"slot"`
	Required   bool                   `json:"required"`
	Label      string                 `json:"label"`
	SortOrder  int                    `json:"sort_order"`
	CreatedBy  uuid.UUID              `json:"created_by"`
	CreatedAt  time.Time              `json:"created_at"`
	UpdatedAt  time.Time              `json:"updated_at"`
}

// ContractAttachment is one uploaded review-desk document, bound to a named slot
// and backed by the files service (CAP-099). Multiple attachments may target the
// same slot (e.g. re-uploads, CAP-115); the latest non-superseded attachment per
// required slot satisfies the completeness check.
type ContractAttachment struct {
	ID            uuid.UUID              `json:"id"`
	TenantID      uuid.UUID              `json:"tenant_id"`
	ContractID    uuid.UUID              `json:"contract_id"`
	Slot          ContractAttachmentSlot `json:"slot"`
	FileID        *uuid.UUID             `json:"file_id,omitempty"`
	FileName      string                 `json:"file_name"`
	FileSizeBytes int64                  `json:"file_size_bytes"`
	ContentHash   *string                `json:"content_hash,omitempty"`
	Version       int                    `json:"version"`
	Superseded    bool                   `json:"superseded"`
	Notes         *string                `json:"notes,omitempty"`
	Metadata      map[string]any         `json:"metadata"`
	UploadedBy    uuid.UUID              `json:"uploaded_by"`
	CreatedAt     time.Time              `json:"created_at"`
	UpdatedAt     time.Time              `json:"updated_at"`
	DeletedAt     *time.Time             `json:"deleted_at,omitempty"`
}

// ContractCompletenessSlot is the per-slot completeness result (CAP-103).
type ContractCompletenessSlot struct {
	Slot         ContractAttachmentSlot `json:"slot"`
	Label        string                 `json:"label"`
	Required     bool                   `json:"required"`
	Satisfied    bool                   `json:"satisfied"`
	AttachmentID *uuid.UUID             `json:"attachment_id,omitempty"`
	FileName     *string                `json:"file_name,omitempty"`
}

// ContractCompletenessResult is the computed completeness check across all named
// slots for a contract (CAP-103). Complete is true when every required slot has a
// live (non-superseded, non-deleted) attachment.
type ContractCompletenessResult struct {
	ContractID   uuid.UUID                  `json:"contract_id"`
	Complete     bool                       `json:"complete"`
	MissingSlots []ContractAttachmentSlot   `json:"missing_slots"`
	Slots        []ContractCompletenessSlot `json:"slots"`
	CheckedAt    time.Time                  `json:"checked_at"`
}
