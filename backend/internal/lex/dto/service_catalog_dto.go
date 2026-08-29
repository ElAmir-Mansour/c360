package dto

import (
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// CreateServiceCatalogRequest publishes a new legal service (CAP-001, CAP-005).
type CreateServiceCatalogRequest struct {
	Code                  string                          `json:"code"`
	RequestType           string                          `json:"request_type"`
	Name                  forms.LocalizedText             `json:"name"`
	Description           forms.LocalizedText             `json:"description"`
	AvailableTo           []string                        `json:"available_to"`
	RequesterApprovalReqd bool                            `json:"requester_approval_required"`
	ProviderApprovalReqd  bool                            `json:"provider_approval_required"`
	ApprovalPolicyID      *uuid.UUID                      `json:"approval_policy_id,omitempty"`
	IntakeEmail           *string                         `json:"intake_email,omitempty"`
	Channel               model.ServiceChannel            `json:"channel"`
	Active                *bool                           `json:"active,omitempty"`
	Metadata              map[string]any                  `json:"metadata,omitempty"`
	EligibilityRules      []ServiceEligibilityRuleRequest `json:"eligibility_rules,omitempty"`
}

// UpdateServiceCatalogRequest patches a service. Nil fields are left unchanged.
// When EligibilityRules is non-nil it REPLACES the existing rule set (CAP-005).
type UpdateServiceCatalogRequest struct {
	RequestType           *string                         `json:"request_type,omitempty"`
	Name                  *forms.LocalizedText            `json:"name,omitempty"`
	Description           *forms.LocalizedText            `json:"description,omitempty"`
	AvailableTo           []string                        `json:"available_to,omitempty"`
	RequesterApprovalReqd *bool                           `json:"requester_approval_required,omitempty"`
	ProviderApprovalReqd  *bool                           `json:"provider_approval_required,omitempty"`
	ApprovalPolicyID      *uuid.UUID                      `json:"approval_policy_id,omitempty"`
	IntakeEmail           *string                         `json:"intake_email,omitempty"`
	Channel               *model.ServiceChannel           `json:"channel,omitempty"`
	Active                *bool                           `json:"active,omitempty"`
	Metadata              map[string]any                  `json:"metadata,omitempty"`
	EligibilityRules      []ServiceEligibilityRuleRequest `json:"eligibility_rules,omitempty"`
}

// ServiceEligibilityRuleRequest is one CAP-008 predicate in a create/update.
type ServiceEligibilityRuleRequest struct {
	RuleType model.EligibilityRuleType `json:"rule_type"`
	Value    string                    `json:"value"`
}

// EligibilityCheckRequest evaluates a requester against a service's CAP-008
// rules. RequesterUserID defaults to the authenticated caller when omitted.
type EligibilityCheckRequest struct {
	ServiceID       uuid.UUID  `json:"service_id"`
	RequesterUserID *uuid.UUID `json:"requester_user_id,omitempty"`
	Department      *string    `json:"department,omitempty"`
	BeneficiaryCode *string    `json:"beneficiary_code,omitempty"`
}

// CreateIntakeMailboxRequest registers an inbound email mailbox (CAP-002). The
// IngestSecret is the plaintext HMAC shared secret; it is encrypted at rest and
// never echoed back.
type CreateIntakeMailboxRequest struct {
	Address             string         `json:"address"`
	RequestType         string         `json:"request_type"`
	ServiceID           *uuid.UUID     `json:"service_id,omitempty"`
	BeneficiaryEntityID *uuid.UUID     `json:"beneficiary_entity_id,omitempty"`
	IngestSecret        string         `json:"ingest_secret"`
	Active              *bool          `json:"active,omitempty"`
	Metadata            map[string]any `json:"metadata,omitempty"`
}

// UpdateIntakeMailboxRequest patches a mailbox. A non-empty IngestSecret rotates
// the shared secret; an empty one leaves it unchanged.
type UpdateIntakeMailboxRequest struct {
	RequestType         *string        `json:"request_type,omitempty"`
	ServiceID           *uuid.UUID     `json:"service_id,omitempty"`
	BeneficiaryEntityID *uuid.UUID     `json:"beneficiary_entity_id,omitempty"`
	IngestSecret        *string        `json:"ingest_secret,omitempty"`
	Active              *bool          `json:"active,omitempty"`
	Metadata            map[string]any `json:"metadata,omitempty"`
}

// IntakeSubmitRequest is the direct in-app platform intake payload (CAP-002). It
// routes through the service catalog to create a legal_request.
type IntakeSubmitRequest struct {
	ServiceID            uuid.UUID             `json:"service_id"`
	Title                forms.LocalizedText   `json:"title"`
	Description          string                `json:"description"`
	BeneficiaryEntityID  *uuid.UUID            `json:"beneficiary_entity_id,omitempty"`
	Department           *string               `json:"department,omitempty"`
	Priority             model.RequestPriority `json:"priority"`
	UrgencyJustification *string               `json:"urgency_justification,omitempty"`
	Metadata             map[string]any        `json:"metadata,omitempty"`
}

// IntakeEmailAttachment is one attachment carried on the email webhook payload.
// Content is base64-encoded raw bytes.
type IntakeEmailAttachment struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	ContentB64  string `json:"content_base64"`
}

// IntakeEmailWebhookRequest is the CAP-002 inbound email webhook body. It is
// delivered to a PUBLIC (no-JWT) route guarded only by HMAC signature
// verification against the addressed mailbox's ingest secret.
type IntakeEmailWebhookRequest struct {
	MessageID        string                  `json:"message_id"`
	From             string                  `json:"from"`
	To               string                  `json:"to"`
	Subject          string                  `json:"subject"`
	Body             string                  `json:"body"`
	WebhookTimestamp string                  `json:"webhook_timestamp,omitempty"`
	Attachments      []IntakeEmailAttachment `json:"attachments,omitempty"`
}

// IntakeSimulateRequest drives the JWT-gated Simulate-Inbound admin action: it
// synthesizes an inbound email against an owned mailbox and runs the full
// classify→route→legal_request pipeline WITHOUT any external mail provider or
// per-mailbox HMAC (the caller is already authenticated + authorized as
// mailbox-admin). All fields are optional; sensible defaults are applied so a
// bare click still produces a routed message. MessageID, when supplied, lets a
// caller replay a specific id (dedup makes the replay idempotent).
type IntakeSimulateRequest struct {
	MessageID   string                  `json:"message_id,omitempty"`
	From        string                  `json:"from,omitempty"`
	Subject     string                  `json:"subject,omitempty"`
	Body        string                  `json:"body,omitempty"`
	Attachments []IntakeEmailAttachment `json:"attachments,omitempty"`
}

// Normalize trims the simulate payload in place.
func (r *IntakeSimulateRequest) Normalize() {
	r.MessageID = strings.TrimSpace(r.MessageID)
	r.From = strings.ToLower(strings.TrimSpace(r.From))
	r.Subject = strings.TrimSpace(r.Subject)
}

// Normalize trims and defaults the create payload in place.
func (r *CreateServiceCatalogRequest) Normalize() {
	r.Code = strings.ToUpper(strings.TrimSpace(r.Code))
	r.RequestType = strings.TrimSpace(r.RequestType)
	r.Name = NormalizeLocalizedText(r.Name)
	r.Description = NormalizeLocalizedText(r.Description)
	r.AvailableTo = normalizeServiceStringList(r.AvailableTo)
	r.IntakeEmail = normalizeLowerOptional(r.IntakeEmail)
	if r.Channel == "" {
		r.Channel = model.ServiceChannelPlatform
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	for i := range r.EligibilityRules {
		r.EligibilityRules[i].Normalize()
	}
}

// Normalize trims the update payload in place.
func (r *UpdateServiceCatalogRequest) Normalize() {
	if r.RequestType != nil {
		trimmed := strings.TrimSpace(*r.RequestType)
		r.RequestType = &trimmed
	}
	if r.Name != nil {
		n := NormalizeLocalizedText(*r.Name)
		r.Name = &n
	}
	if r.Description != nil {
		d := NormalizeLocalizedText(*r.Description)
		r.Description = &d
	}
	if r.AvailableTo != nil {
		r.AvailableTo = normalizeServiceStringList(r.AvailableTo)
	}
	r.IntakeEmail = normalizeLowerOptional(r.IntakeEmail)
	for i := range r.EligibilityRules {
		r.EligibilityRules[i].Normalize()
	}
}

// Normalize trims a rule in place.
func (r *ServiceEligibilityRuleRequest) Normalize() {
	r.Value = strings.TrimSpace(r.Value)
	switch r.RuleType {
	case model.EligibilityRuleRole, model.EligibilityRuleDoAMatrix:
		r.Value = strings.ToLower(r.Value)
	}
}

// Normalize trims the eligibility-check payload in place.
func (r *EligibilityCheckRequest) Normalize() {
	r.Department = NormalizeOptionalText(r.Department)
	if r.BeneficiaryCode != nil {
		trimmed := strings.ToUpper(strings.TrimSpace(*r.BeneficiaryCode))
		if trimmed == "" {
			r.BeneficiaryCode = nil
		} else {
			r.BeneficiaryCode = &trimmed
		}
	}
}

// Normalize trims the mailbox create payload in place.
func (r *CreateIntakeMailboxRequest) Normalize() {
	r.Address = strings.ToLower(strings.TrimSpace(r.Address))
	r.RequestType = strings.TrimSpace(r.RequestType)
	r.IngestSecret = strings.TrimSpace(r.IngestSecret)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// Normalize trims the mailbox update payload in place.
func (r *UpdateIntakeMailboxRequest) Normalize() {
	if r.RequestType != nil {
		trimmed := strings.TrimSpace(*r.RequestType)
		r.RequestType = &trimmed
	}
	if r.IngestSecret != nil {
		trimmed := strings.TrimSpace(*r.IngestSecret)
		r.IngestSecret = &trimmed
	}
}

// Normalize trims and defaults the platform intake payload in place.
func (r *IntakeSubmitRequest) Normalize() {
	r.Title = NormalizeLocalizedText(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.Department = NormalizeOptionalText(r.Department)
	r.UrgencyJustification = NormalizeOptionalText(r.UrgencyJustification)
	if r.Priority == "" {
		r.Priority = model.RequestPriorityNormal
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// Normalize trims the email webhook payload in place.
func (r *IntakeEmailWebhookRequest) Normalize() {
	r.MessageID = strings.TrimSpace(r.MessageID)
	r.From = strings.ToLower(strings.TrimSpace(r.From))
	r.To = strings.ToLower(strings.TrimSpace(r.To))
	r.Subject = strings.TrimSpace(r.Subject)
	r.WebhookTimestamp = strings.TrimSpace(r.WebhookTimestamp)
}

func normalizeServiceStringList(values []string) []string {
	if values == nil {
		return nil
	}
	out := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func normalizeLowerOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.ToLower(strings.TrimSpace(*value))
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
