package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// AttachmentPolicy (CAP-165..170) declares, per legal-request type / service
// code, the minimum number of supporting attachments an intake must carry and
// the named upload slots that must be filled. It is tenant-scoped master data
// administered by legal admins and consumed at intake-completeness time. The
// document store already covers e-archive / classification / versioning
// (CAP-166..168); this policy only encodes the per-request_type REQUIREMENT.
//
// Conventions mirror legal_org_entities: bilingual labels are forms.LocalizedText
// round-tripped to JSONB, tenant_id is first, soft-delete via DeletedAt.
type AttachmentPolicy struct {
	ID uuid.UUID `json:"id"`
	// TenantID is the owning tenant (tenant_id FIRST per multitenancy rule).
	TenantID uuid.UUID `json:"tenant_id"`
	// RequestType is the legal-request type this policy applies to (mirrors
	// legal_requests.request_type). Empty when keyed by ServiceCode instead.
	RequestType string `json:"request_type"`
	// ServiceCode is the catalog service code this policy applies to (mirrors
	// service_catalog ServiceCode constants). Empty when keyed by RequestType.
	ServiceCode string `json:"service_code"`
	// Name is the bilingual display name of the policy.
	Name forms.LocalizedText `json:"name"`
	// Description is an optional bilingual operator description.
	Description forms.LocalizedText `json:"description"`
	// MinAttachmentCount is the minimum number of attachments required for a
	// request of this type to be considered complete (CAP-165).
	MinAttachmentCount int `json:"min_attachment_count"`
	// MaxAttachmentCount caps the number of attachments (0 => unbounded).
	MaxAttachmentCount int `json:"max_attachment_count"`
	// Slots are the named, optionally-required upload slots (CAP-167/170).
	Slots []AttachmentSlot `json:"slots"`
	// AllowedContentTypes restricts uploads (docx/pdf already supported per
	// CAP-166; empty => store default of docx+pdf applies).
	AllowedContentTypes []string `json:"allowed_content_types"`
	// MaxFileSizeBytes caps a single attachment (0 => store default).
	MaxFileSizeBytes int64 `json:"max_file_size_bytes"`
	// Active toggles enforcement without deleting the policy.
	Active   bool           `json:"active"`
	Metadata map[string]any `json:"metadata"`

	CreatedBy uuid.UUID  `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	DeletedAt *time.Time `json:"deleted_at,omitempty"`
}

// AttachmentSlot is one named document slot inside an AttachmentPolicy. Slots
// give the intake UI fixed, labelled upload positions (CAP-167) and let a policy
// require a specific document (e.g. "signed_power_of_attorney") rather than only
// a raw count.
type AttachmentSlot struct {
	// Key is the stable slot identifier (snake_case, unique within a policy).
	Key string `json:"key"`
	// Label is the bilingual display label for the slot.
	Label forms.LocalizedText `json:"label"`
	// Required marks the slot as mandatory for completeness.
	Required bool `json:"required"`
	// SortOrder controls display ordering (ascending).
	SortOrder int `json:"sort_order"`
	// AllowedContentTypes optionally narrows the slot's accepted types beyond the
	// policy-level AllowedContentTypes (empty => inherit policy default).
	AllowedContentTypes []string `json:"allowed_content_types,omitempty"`
}

// AttachmentPolicyEvaluation is the completeness verdict produced by evaluating a
// set of provided slot keys / attachment count against an AttachmentPolicy. It is
// a pure value object (no DB row) returned by the service so callers (intake
// completeness checks) can render the deficiencies.
type AttachmentPolicyEvaluation struct {
	PolicyID        uuid.UUID `json:"policy_id"`
	RequestType     string    `json:"request_type"`
	ServiceCode     string    `json:"service_code"`
	RequiredCount   int       `json:"required_count"`
	MaxAllowedCount int       `json:"max_allowed_count"`
	ProvidedCount   int       `json:"provided_count"`
	CountSatisfied  bool      `json:"count_satisfied"`
	CountExceeded   bool      `json:"count_exceeded"`
	MissingSlots    []string  `json:"missing_slots"`
	SlotsSatisfied  bool      `json:"slots_satisfied"`
	Complete        bool      `json:"complete"`
	EvaluatedAtUnix int64     `json:"evaluated_at_unix"`
}
