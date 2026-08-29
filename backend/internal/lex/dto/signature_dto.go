package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type CreateSignatureEnvelopeRequest struct {
	ContractID       *uuid.UUID                        `json:"contract_id,omitempty"`
	DocumentID       *uuid.UUID                        `json:"document_id,omitempty"`
	Title            string                            `json:"title"`
	Subject          string                            `json:"subject"`
	Message          string                            `json:"message"`
	Language         model.SignatureLanguage           `json:"language"`
	SubjectAr        string                            `json:"subject_ar"`
	MessageAr        string                            `json:"message_ar"`
	LegalConsentEn   string                            `json:"legal_consent_en"`
	LegalConsentAr   string                            `json:"legal_consent_ar"`
	Provider         model.SignatureProvider           `json:"provider"`
	Method           model.SignatureMethod             `json:"method"`
	DueAt            *time.Time                        `json:"due_at,omitempty"`
	ExpiresAt        *time.Time                        `json:"expires_at,omitempty"`
	EvidenceMetadata map[string]any                    `json:"evidence_metadata"`
	Recipients       []CreateSignatureRecipientRequest `json:"recipients"`
}

type CreateSignatureRecipientRequest struct {
	UserID              *uuid.UUID                   `json:"user_id,omitempty"`
	Name                string                       `json:"name"`
	Email               *string                      `json:"email,omitempty"`
	Phone               *string                      `json:"phone,omitempty"`
	Role                model.SignatureRecipientRole `json:"role"`
	Language            *model.SignatureLanguage     `json:"language,omitempty"`
	Method              *model.SignatureMethod       `json:"method,omitempty"`
	SigningOrder        int                          `json:"signing_order"`
	ProviderRecipientID *string                      `json:"provider_recipient_id,omitempty"`
	EvidenceMetadata    map[string]any               `json:"evidence_metadata"`
}

type SendSignatureEnvelopeRequest struct {
	Message          *string        `json:"message,omitempty"`
	ExpiresAt        *time.Time     `json:"expires_at,omitempty"`
	EvidenceHash     *string        `json:"evidence_hash,omitempty"`
	EvidenceMetadata map[string]any `json:"evidence_metadata"`
}

type SignatureRecipientAction string

const (
	SignatureRecipientActionView    SignatureRecipientAction = "view"
	SignatureRecipientActionSign    SignatureRecipientAction = "sign"
	SignatureRecipientActionDecline SignatureRecipientAction = "decline"
)

type SignatureRecipientActionRequest struct {
	Action           SignatureRecipientAction `json:"action"`
	ActorName        *string                  `json:"actor_name,omitempty"`
	ActorEmail       *string                  `json:"actor_email,omitempty"`
	EvidenceHash     *string                  `json:"evidence_hash,omitempty"`
	EvidenceMetadata map[string]any           `json:"evidence_metadata"`
	DeclineReason    *string                  `json:"decline_reason,omitempty"`
}

type SignaturePlacement struct {
	ID          string     `json:"id"`
	RecipientID *uuid.UUID `json:"recipient_id,omitempty"`
	Kind        string     `json:"kind"`
	Page        int        `json:"page"`
	X           float64    `json:"x"`
	Y           float64    `json:"y"`
	Width       float64    `json:"width"`
	Height      float64    `json:"height"`
	Required    bool       `json:"required"`
	Label       string     `json:"label,omitempty"`
}

type UpsertSignaturePlacementsRequest struct {
	Placements       []SignaturePlacement `json:"placements"`
	EvidenceMetadata map[string]any       `json:"evidence_metadata"`
}

type UpsertSignatureUserProfileRequest struct {
	TypedName      string  `json:"typed_name"`
	Initials       string  `json:"initials"`
	SignatureImage *string `json:"signature_image,omitempty"`
	InitialsImage  *string `json:"initials_image,omitempty"`
	ConsentVersion string  `json:"consent_version,omitempty"`
}

type SignatureProviderEventRequest struct {
	Provider             model.SignatureProvider `json:"provider"`
	ProviderStatus       string                  `json:"provider_status"`
	ProviderEventID      *string                 `json:"provider_event_id,omitempty"`
	ProviderEnvelopeID   *string                 `json:"provider_envelope_id,omitempty"`
	ProviderRecipientID  *string                 `json:"provider_recipient_id,omitempty"`
	RecipientID          *uuid.UUID              `json:"recipient_id,omitempty"`
	ActorName            *string                 `json:"actor_name,omitempty"`
	ActorEmail           *string                 `json:"actor_email,omitempty"`
	EvidenceHash         *string                 `json:"evidence_hash,omitempty"`
	EvidenceMetadata     map[string]any          `json:"evidence_metadata"`
	DeclineReason        *string                 `json:"decline_reason,omitempty"`
	Reason               *string                 `json:"reason,omitempty"`
	OccurredAt           *time.Time              `json:"occurred_at,omitempty"`
	WebhookSignature     *string                 `json:"webhook_signature,omitempty"`
	WebhookTimestamp     *string                 `json:"webhook_timestamp,omitempty"`
	WebhookPayload       *string                 `json:"webhook_payload,omitempty"`
	WebhookSecret        *string                 `json:"webhook_secret,omitempty"`
	WebhookSignatureBase *string                 `json:"webhook_signature_base,omitempty"`
	WebhookAlgorithm     *string                 `json:"webhook_algorithm,omitempty"`
	RawPayload           []byte                  `json:"-"`
}

type RecordSignatureCustodyRequest struct {
	FileID            string                  `json:"file_id"`
	FileName          string                  `json:"file_name"`
	FileSizeBytes     int64                   `json:"file_size_bytes"`
	ContentHash       string                  `json:"content_hash"`
	SealHash          *string                 `json:"seal_hash,omitempty"`
	EvidenceHash      *string                 `json:"evidence_hash,omitempty"`
	Provider          model.SignatureProvider `json:"provider,omitempty"`
	SignedAt          *time.Time              `json:"signed_at,omitempty"`
	RetentionMetadata map[string]any          `json:"retention_metadata"`
	CustodyMetadata   map[string]any          `json:"custody_metadata"`
}

type CancelSignatureEnvelopeRequest struct {
	Reason           string         `json:"reason"`
	EvidenceHash     *string        `json:"evidence_hash,omitempty"`
	EvidenceMetadata map[string]any `json:"evidence_metadata"`
}

func (r *CreateSignatureEnvelopeRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Subject = strings.TrimSpace(r.Subject)
	r.Message = strings.TrimSpace(r.Message)
	r.SubjectAr = strings.TrimSpace(r.SubjectAr)
	r.MessageAr = strings.TrimSpace(r.MessageAr)
	r.LegalConsentEn = strings.TrimSpace(r.LegalConsentEn)
	r.LegalConsentAr = strings.TrimSpace(r.LegalConsentAr)
	r.Language = model.SignatureLanguage(strings.ToLower(strings.TrimSpace(string(r.Language))))
	if r.Language == "" {
		r.Language = model.SignatureLanguageEN
	}
	if r.Provider == "" {
		r.Provider = model.SignatureProviderNative
	}
	if r.Method == "" {
		r.Method = model.SignatureMethodOTP
	}
	if r.EvidenceMetadata == nil {
		r.EvidenceMetadata = map[string]any{}
	}
	for i := range r.Recipients {
		r.Recipients[i].Normalize(r.Method)
		if r.Recipients[i].SigningOrder == 0 {
			r.Recipients[i].SigningOrder = i + 1
		}
	}
}

func (r *CreateSignatureRecipientRequest) Normalize(defaultMethod model.SignatureMethod) {
	r.Name = strings.TrimSpace(r.Name)
	if r.Email != nil {
		trimmed := strings.ToLower(strings.TrimSpace(*r.Email))
		if trimmed == "" {
			r.Email = nil
		} else {
			r.Email = &trimmed
		}
	}
	if r.Phone != nil {
		trimmed := strings.TrimSpace(*r.Phone)
		if trimmed == "" {
			r.Phone = nil
		} else {
			r.Phone = &trimmed
		}
	}
	if r.Role == "" {
		r.Role = model.SignatureRecipientSigner
	}
	if r.Language != nil {
		normalized := model.SignatureLanguage(strings.ToLower(strings.TrimSpace(string(*r.Language))))
		if normalized == "" {
			r.Language = nil
		} else {
			r.Language = &normalized
		}
	}
	if r.Method == nil {
		r.Method = &defaultMethod
	}
	if r.EvidenceMetadata == nil {
		r.EvidenceMetadata = map[string]any{}
	}
}

func (r *SendSignatureEnvelopeRequest) Normalize() {
	if r.Message != nil {
		trimmed := strings.TrimSpace(*r.Message)
		r.Message = &trimmed
	}
	if r.EvidenceHash != nil {
		trimmed := strings.TrimSpace(*r.EvidenceHash)
		if trimmed == "" {
			r.EvidenceHash = nil
		} else {
			r.EvidenceHash = &trimmed
		}
	}
	if r.EvidenceMetadata == nil {
		r.EvidenceMetadata = map[string]any{}
	}
}

func (r *SignatureRecipientActionRequest) Normalize() {
	if r.ActorName != nil {
		trimmed := strings.TrimSpace(*r.ActorName)
		if trimmed == "" {
			r.ActorName = nil
		} else {
			r.ActorName = &trimmed
		}
	}
	if r.ActorEmail != nil {
		trimmed := strings.ToLower(strings.TrimSpace(*r.ActorEmail))
		if trimmed == "" {
			r.ActorEmail = nil
		} else {
			r.ActorEmail = &trimmed
		}
	}
	if r.EvidenceHash != nil {
		trimmed := strings.TrimSpace(*r.EvidenceHash)
		if trimmed == "" {
			r.EvidenceHash = nil
		} else {
			r.EvidenceHash = &trimmed
		}
	}
	if r.DeclineReason != nil {
		trimmed := strings.TrimSpace(*r.DeclineReason)
		if trimmed == "" {
			r.DeclineReason = nil
		} else {
			r.DeclineReason = &trimmed
		}
	}
	if r.EvidenceMetadata == nil {
		r.EvidenceMetadata = map[string]any{}
	}
}

func (r *UpsertSignaturePlacementsRequest) Normalize() {
	if r.EvidenceMetadata == nil {
		r.EvidenceMetadata = map[string]any{}
	}
	for i := range r.Placements {
		p := &r.Placements[i]
		p.ID = strings.TrimSpace(p.ID)
		p.Kind = strings.ToLower(strings.TrimSpace(p.Kind))
		p.Label = strings.TrimSpace(p.Label)
	}
}

func (r *UpsertSignatureUserProfileRequest) Normalize() {
	r.TypedName = strings.TrimSpace(r.TypedName)
	r.Initials = strings.ToUpper(strings.TrimSpace(r.Initials))
	r.SignatureImage = normalizeOptionalStringPtr(r.SignatureImage)
	r.InitialsImage = normalizeOptionalStringPtr(r.InitialsImage)
	r.ConsentVersion = strings.TrimSpace(r.ConsentVersion)
	if r.ConsentVersion == "" {
		r.ConsentVersion = "native-v1"
	}
}

func (r *SignatureProviderEventRequest) Normalize() {
	r.Provider = model.SignatureProvider(strings.ToLower(strings.TrimSpace(string(r.Provider))))
	r.ProviderStatus = strings.ToLower(strings.TrimSpace(r.ProviderStatus))
	r.ProviderEventID = normalizeOptionalStringPtr(r.ProviderEventID)
	r.ProviderEnvelopeID = normalizeOptionalStringPtr(r.ProviderEnvelopeID)
	r.ProviderRecipientID = normalizeOptionalStringPtr(r.ProviderRecipientID)
	if r.ActorName != nil {
		trimmed := strings.TrimSpace(*r.ActorName)
		if trimmed == "" {
			r.ActorName = nil
		} else {
			r.ActorName = &trimmed
		}
	}
	if r.ActorEmail != nil {
		trimmed := strings.ToLower(strings.TrimSpace(*r.ActorEmail))
		if trimmed == "" {
			r.ActorEmail = nil
		} else {
			r.ActorEmail = &trimmed
		}
	}
	r.EvidenceHash = normalizeOptionalStringPtr(r.EvidenceHash)
	if r.DeclineReason != nil {
		trimmed := strings.TrimSpace(*r.DeclineReason)
		if trimmed == "" {
			r.DeclineReason = nil
		} else {
			r.DeclineReason = &trimmed
		}
	}
	if r.Reason != nil {
		trimmed := strings.TrimSpace(*r.Reason)
		if trimmed == "" {
			r.Reason = nil
		} else {
			r.Reason = &trimmed
		}
	}
	if r.EvidenceMetadata == nil {
		r.EvidenceMetadata = map[string]any{}
	}
	r.WebhookSignature = normalizeOptionalStringPtr(r.WebhookSignature)
	r.WebhookTimestamp = normalizeOptionalStringPtr(r.WebhookTimestamp)
	r.WebhookPayload = normalizeOptionalStringPtr(r.WebhookPayload)
	r.WebhookSecret = normalizeOptionalStringPtr(r.WebhookSecret)
	r.WebhookSignatureBase = normalizeOptionalStringPtr(r.WebhookSignatureBase)
	if r.WebhookSignatureBase != nil {
		normalized := strings.ToLower(strings.TrimSpace(*r.WebhookSignatureBase))
		r.WebhookSignatureBase = &normalized
	}
	r.WebhookAlgorithm = normalizeOptionalStringPtr(r.WebhookAlgorithm)
	if r.WebhookAlgorithm != nil {
		normalized := strings.ToLower(strings.TrimSpace(*r.WebhookAlgorithm))
		r.WebhookAlgorithm = &normalized
	}
}

func (r *CancelSignatureEnvelopeRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
	if r.EvidenceHash != nil {
		trimmed := strings.TrimSpace(*r.EvidenceHash)
		if trimmed == "" {
			r.EvidenceHash = nil
		} else {
			r.EvidenceHash = &trimmed
		}
	}
	if r.EvidenceMetadata == nil {
		r.EvidenceMetadata = map[string]any{}
	}
}

func (r *RecordSignatureCustodyRequest) Normalize() {
	r.FileID = strings.TrimSpace(r.FileID)
	r.FileName = strings.TrimSpace(r.FileName)
	r.ContentHash = strings.TrimSpace(r.ContentHash)
	r.Provider = model.SignatureProvider(strings.ToLower(strings.TrimSpace(string(r.Provider))))
	r.SealHash = normalizeOptionalStringPtr(r.SealHash)
	r.EvidenceHash = normalizeOptionalStringPtr(r.EvidenceHash)
	if r.RetentionMetadata == nil {
		r.RetentionMetadata = map[string]any{}
	}
	if r.CustodyMetadata == nil {
		r.CustodyMetadata = map[string]any{}
	}
}

func normalizeOptionalStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
