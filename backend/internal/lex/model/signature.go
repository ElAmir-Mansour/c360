package model

import (
	"time"

	"github.com/google/uuid"
)

type SignatureTargetType string

const (
	SignatureTargetContract SignatureTargetType = "contract"
	SignatureTargetDocument SignatureTargetType = "document"
)

type SignatureEnvelopeStatus string

const (
	SignatureEnvelopeDraft     SignatureEnvelopeStatus = "draft"
	SignatureEnvelopeSent      SignatureEnvelopeStatus = "sent"
	SignatureEnvelopeViewed    SignatureEnvelopeStatus = "viewed"
	SignatureEnvelopeSigned    SignatureEnvelopeStatus = "signed"
	SignatureEnvelopeDeclined  SignatureEnvelopeStatus = "declined"
	SignatureEnvelopeExpired   SignatureEnvelopeStatus = "expired"
	SignatureEnvelopeCancelled SignatureEnvelopeStatus = "cancelled"
)

type SignatureProvider string

const (
	SignatureProviderNative   SignatureProvider = "native"
	SignatureProviderNafath   SignatureProvider = "nafath"
	SignatureProviderNajiz    SignatureProvider = "najiz"
	SignatureProviderExternal SignatureProvider = "external"
)

type SignatureMethod string

const (
	SignatureMethodOTP          SignatureMethod = "otp"
	SignatureMethodNafath       SignatureMethod = "nafath"
	SignatureMethodCertificate  SignatureMethod = "certificate"
	SignatureMethodWetSignature SignatureMethod = "wet_signature"
)

// SignatureLanguage is the locale of a signing experience (WTQ-SIG-01). The
// envelope carries a default language; each recipient may override it. A value
// of "bilingual" means both Arabic and English are presented together.
type SignatureLanguage string

const (
	SignatureLanguageEN        SignatureLanguage = "en"
	SignatureLanguageAR        SignatureLanguage = "ar"
	SignatureLanguageBilingual SignatureLanguage = "bilingual"
)

// IsValidSignatureLanguage reports whether l is one of the supported locales.
func IsValidSignatureLanguage(l SignatureLanguage) bool {
	switch l {
	case SignatureLanguageEN, SignatureLanguageAR, SignatureLanguageBilingual:
		return true
	default:
		return false
	}
}

// Default legal-consent notices shown when an envelope does not specify its own.
// These are the e-signature consent statements presented to a signer.
const (
	DefaultSignatureConsentEN = "By signing electronically, I agree that my electronic signature is the legal equivalent of my handwritten signature and consent to conduct this transaction electronically."
	DefaultSignatureConsentAR = "بتوقيعي إلكترونياً، أوافق على أن توقيعي الإلكتروني يعادل قانونياً توقيعي الخطي، وأوافق على إتمام هذه المعاملة إلكترونياً."
)

type SignatureRecipientRole string

const (
	SignatureRecipientSigner     SignatureRecipientRole = "signer"
	SignatureRecipientApprover   SignatureRecipientRole = "approver"
	SignatureRecipientCarbonCopy SignatureRecipientRole = "carbon_copy"
)

type SignatureRecipientStatus string

const (
	SignatureRecipientDraft     SignatureRecipientStatus = "draft"
	SignatureRecipientSent      SignatureRecipientStatus = "sent"
	SignatureRecipientViewed    SignatureRecipientStatus = "viewed"
	SignatureRecipientSigned    SignatureRecipientStatus = "signed"
	SignatureRecipientDeclined  SignatureRecipientStatus = "declined"
	SignatureRecipientExpired   SignatureRecipientStatus = "expired"
	SignatureRecipientCancelled SignatureRecipientStatus = "cancelled"
)

type SignatureEventType string

const (
	SignatureEventCreated   SignatureEventType = "created"
	SignatureEventSent      SignatureEventType = "sent"
	SignatureEventViewed    SignatureEventType = "viewed"
	SignatureEventSigned    SignatureEventType = "signed"
	SignatureEventDeclined  SignatureEventType = "declined"
	SignatureEventExpired   SignatureEventType = "expired"
	SignatureEventCancelled SignatureEventType = "cancelled"
	SignatureEventCustody   SignatureEventType = "custody_recorded"
)

type SignatureEnvelope struct {
	ID                 uuid.UUID                  `json:"id"`
	TenantID           uuid.UUID                  `json:"tenant_id"`
	TargetType         SignatureTargetType        `json:"target_type"`
	ContractID         *uuid.UUID                 `json:"contract_id,omitempty"`
	DocumentID         *uuid.UUID                 `json:"document_id,omitempty"`
	Title              string                     `json:"title"`
	Subject            string                     `json:"subject"`
	Message            string                     `json:"message"`
	Language           SignatureLanguage          `json:"language"`
	SubjectAr          string                     `json:"subject_ar"`
	MessageAr          string                     `json:"message_ar"`
	LegalConsentEn     string                     `json:"legal_consent_en"`
	LegalConsentAr     string                     `json:"legal_consent_ar"`
	Status             SignatureEnvelopeStatus    `json:"status"`
	Provider           SignatureProvider          `json:"provider"`
	Method             SignatureMethod            `json:"method"`
	DueAt              *time.Time                 `json:"due_at,omitempty"`
	ExpiresAt          *time.Time                 `json:"expires_at,omitempty"`
	SentAt             *time.Time                 `json:"sent_at,omitempty"`
	CompletedAt        *time.Time                 `json:"completed_at,omitempty"`
	CancelledAt        *time.Time                 `json:"cancelled_at,omitempty"`
	CancelledBy        *uuid.UUID                 `json:"cancelled_by,omitempty"`
	CancellationReason *string                    `json:"cancellation_reason,omitempty"`
	EvidenceHash       *string                    `json:"evidence_hash,omitempty"`
	EvidenceMetadata   map[string]any             `json:"evidence_metadata"`
	CreatedBy          uuid.UUID                  `json:"created_by"`
	CreatedAt          time.Time                  `json:"created_at"`
	UpdatedAt          time.Time                  `json:"updated_at"`
	DeletedAt          *time.Time                 `json:"deleted_at,omitempty"`
	Recipients         []SignatureRecipient       `json:"recipients,omitempty"`
	Events             []SignatureEvent           `json:"events,omitempty"`
	CustodyEvidence    []SignatureCustodyEvidence `json:"custody_evidence,omitempty"`
}

type SignatureRecipient struct {
	ID                  uuid.UUID                `json:"id"`
	TenantID            uuid.UUID                `json:"tenant_id"`
	EnvelopeID          uuid.UUID                `json:"envelope_id"`
	UserID              *uuid.UUID               `json:"user_id,omitempty"`
	Name                string                   `json:"name"`
	Email               *string                  `json:"email,omitempty"`
	Phone               *string                  `json:"phone,omitempty"`
	Role                SignatureRecipientRole   `json:"role"`
	Language            *SignatureLanguage       `json:"language,omitempty"`
	Status              SignatureRecipientStatus `json:"status"`
	Provider            SignatureProvider        `json:"provider"`
	Method              SignatureMethod          `json:"method"`
	SigningOrder        int                      `json:"signing_order"`
	ProviderRecipientID *string                  `json:"provider_recipient_id,omitempty"`
	ViewedAt            *time.Time               `json:"viewed_at,omitempty"`
	SignedAt            *time.Time               `json:"signed_at,omitempty"`
	DeclinedAt          *time.Time               `json:"declined_at,omitempty"`
	DeclineReason       *string                  `json:"decline_reason,omitempty"`
	EvidenceHash        *string                  `json:"evidence_hash,omitempty"`
	EvidenceMetadata    map[string]any           `json:"evidence_metadata"`
	CreatedAt           time.Time                `json:"created_at"`
	UpdatedAt           time.Time                `json:"updated_at"`
}

type SignatureEvent struct {
	ID                  uuid.UUID          `json:"id"`
	TenantID            uuid.UUID          `json:"tenant_id"`
	EnvelopeID          uuid.UUID          `json:"envelope_id"`
	RecipientID         *uuid.UUID         `json:"recipient_id,omitempty"`
	EventType           SignatureEventType `json:"event_type"`
	Provider            *SignatureProvider `json:"provider,omitempty"`
	ProviderStatus      *string            `json:"provider_status,omitempty"`
	ProviderEventID     *string            `json:"provider_event_id,omitempty"`
	ProviderEnvelopeID  *string            `json:"provider_envelope_id,omitempty"`
	ProviderRecipientID *string            `json:"provider_recipient_id,omitempty"`
	ActorUserID         *uuid.UUID         `json:"actor_user_id,omitempty"`
	ActorName           *string            `json:"actor_name,omitempty"`
	ActorEmail          *string            `json:"actor_email,omitempty"`
	IPAddress           *string            `json:"ip_address,omitempty"`
	UserAgent           *string            `json:"user_agent,omitempty"`
	EvidenceHash        *string            `json:"evidence_hash,omitempty"`
	EvidenceMetadata    map[string]any     `json:"evidence_metadata"`
	OccurredAt          time.Time          `json:"occurred_at"`
	CreatedAt           time.Time          `json:"created_at"`
}

type SignatureCustodyEvidence struct {
	ID                uuid.UUID         `json:"id"`
	TenantID          uuid.UUID         `json:"tenant_id"`
	EnvelopeID        uuid.UUID         `json:"envelope_id"`
	FileID            string            `json:"file_id"`
	FileName          string            `json:"file_name"`
	FileSizeBytes     int64             `json:"file_size_bytes"`
	ContentHash       string            `json:"content_hash"`
	SealHash          *string           `json:"seal_hash,omitempty"`
	EvidenceHash      *string           `json:"evidence_hash,omitempty"`
	Provider          SignatureProvider `json:"provider"`
	SignedAt          time.Time         `json:"signed_at"`
	RetentionMetadata map[string]any    `json:"retention_metadata"`
	CustodyMetadata   map[string]any    `json:"custody_metadata"`
	CreatedBy         uuid.UUID         `json:"created_by"`
	CreatedAt         time.Time         `json:"created_at"`
}

type SignatureEnvelopeListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *SignatureEnvelopeStatus
	Provider      *SignatureProvider
	Method        *SignatureMethod
	ContractID    *uuid.UUID
	DocumentID    *uuid.UUID
	SortColumn    string
	SortDirection string
}

// SignatureUserProfile is a user's reusable native signature asset. It is scoped
// to a tenant/user pair and referenced from recipient evidence metadata when a
// user signs through the self-service native signing flow.
type SignatureUserProfile struct {
	TenantID           uuid.UUID `json:"tenant_id"`
	UserID             uuid.UUID `json:"user_id"`
	TypedName          string    `json:"typed_name"`
	Initials           string    `json:"initials"`
	SignatureImage     *string   `json:"signature_image,omitempty"`
	SignatureImageMIME *string   `json:"signature_image_mime,omitempty"`
	SignatureImageHash *string   `json:"signature_image_hash,omitempty"`
	InitialsImage      *string   `json:"initials_image,omitempty"`
	InitialsImageMIME  *string   `json:"initials_image_mime,omitempty"`
	InitialsImageHash  *string   `json:"initials_image_hash,omitempty"`
	ConsentVersion     string    `json:"consent_version"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
}
