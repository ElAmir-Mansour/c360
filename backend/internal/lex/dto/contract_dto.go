package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

type FileReference struct {
	FileID        uuid.UUID `json:"file_id"`
	FileName      string    `json:"file_name"`
	FileSizeBytes int64     `json:"file_size_bytes"`
	ContentHash   string    `json:"content_hash"`
	ExtractedText string    `json:"extracted_text"`
	ChangeSummary string    `json:"change_summary"`
}

type CreateContractRequest struct {
	Title          string  `json:"title"`
	ContractNumber *string `json:"contract_number,omitempty"`
	// LegalRequestID optionally creates this contract from an approved legal
	// request. The service validates and consumes the request atomically, then
	// records the request back-link in both the request spine and contract
	// metadata. Manual contracts leave this nil.
	LegalRequestID    *uuid.UUID         `json:"legal_request_id,omitempty"`
	Type              model.ContractType `json:"type"`
	Description       string             `json:"description"`
	PartyAName        string             `json:"party_a_name"`
	PartyAEntity      *string            `json:"party_a_entity,omitempty"`
	PartyBName        string             `json:"party_b_name"`
	PartyBEntity      *string            `json:"party_b_entity,omitempty"`
	PartyBContact     *string            `json:"party_b_contact,omitempty"`
	TotalValue        *float64           `json:"total_value,omitempty"`
	Currency          string             `json:"currency"`
	PaymentTerms      *string            `json:"payment_terms,omitempty"`
	EffectiveDate     *time.Time         `json:"effective_date,omitempty"`
	ExpiryDate        *time.Time         `json:"expiry_date,omitempty"`
	RenewalDate       *time.Time         `json:"renewal_date,omitempty"`
	AutoRenew         bool               `json:"auto_renew"`
	RenewalNoticeDays int                `json:"renewal_notice_days"`
	OwnerUserID       uuid.UUID          `json:"owner_user_id"`
	OwnerName         string             `json:"owner_name"`
	LegalReviewerID   *uuid.UUID         `json:"legal_reviewer_id,omitempty"`
	LegalReviewerName *string            `json:"legal_reviewer_name,omitempty"`
	Department        *string            `json:"department,omitempty"`
	// OrgEntityID optionally links the contract to a legal-org registry entity
	// (legal_org_entities). party_a_*/party_b_* free-text stays authoritative
	// for party display; this is a structured filter/roll-up dimension.
	OrgEntityID *uuid.UUID     `json:"org_entity_id,omitempty"`
	Tags        []string       `json:"tags"`
	Metadata    map[string]any `json:"metadata"`
	Document    *FileReference `json:"document,omitempty"`
}

type UpdateContractRequest struct {
	Title             *string             `json:"title,omitempty"`
	ContractNumber    *string             `json:"contract_number,omitempty"`
	Type              *model.ContractType `json:"type,omitempty"`
	Description       *string             `json:"description,omitempty"`
	PartyAName        *string             `json:"party_a_name,omitempty"`
	PartyAEntity      *string             `json:"party_a_entity,omitempty"`
	PartyBName        *string             `json:"party_b_name,omitempty"`
	PartyBEntity      *string             `json:"party_b_entity,omitempty"`
	PartyBContact     *string             `json:"party_b_contact,omitempty"`
	TotalValue        *float64            `json:"total_value,omitempty"`
	Currency          *string             `json:"currency,omitempty"`
	PaymentTerms      *string             `json:"payment_terms,omitempty"`
	EffectiveDate     *time.Time          `json:"effective_date,omitempty"`
	ExpiryDate        *time.Time          `json:"expiry_date,omitempty"`
	RenewalDate       *time.Time          `json:"renewal_date,omitempty"`
	AutoRenew         *bool               `json:"auto_renew,omitempty"`
	RenewalNoticeDays *int                `json:"renewal_notice_days,omitempty"`
	SignedDate        *time.Time          `json:"signed_date,omitempty"`
	OwnerUserID       *uuid.UUID          `json:"owner_user_id,omitempty"`
	OwnerName         *string             `json:"owner_name,omitempty"`
	LegalReviewerID   *uuid.UUID          `json:"legal_reviewer_id,omitempty"`
	LegalReviewerName *string             `json:"legal_reviewer_name,omitempty"`
	Department        *string             `json:"department,omitempty"`
	// OrgEntityID relinks the contract to a legal-org registry entity. Send the
	// zero UUID or list "org_entity_id" in cleared_fields to unlink.
	OrgEntityID *uuid.UUID     `json:"org_entity_id,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`

	// ClearedFields lists JSON field names the client wants explicitly set to NULL.
	// This resolves the Go nil-pointer ambiguity for *time.Time and *float64 fields
	// where null in JSON is indistinguishable from an absent key during unmarshaling.
	ClearedFields []string `json:"cleared_fields,omitempty"`
}

// ShouldClear reports whether the given JSON field name was listed in ClearedFields.
func (r *UpdateContractRequest) ShouldClear(field string) bool {
	for _, f := range r.ClearedFields {
		if f == field {
			return true
		}
	}
	return false
}

type UploadContractDocumentRequest struct {
	FileReference
}

type UpdateContractStatusRequest struct {
	Status    model.ContractStatus `json:"status"`
	ChangedBy *uuid.UUID           `json:"changed_by,omitempty"`
}

type RenewContractRequest struct {
	NewEffectiveDate *time.Time `json:"new_effective_date,omitempty"`
	NewExpiryDate    time.Time  `json:"new_expiry_date"`
	NewValue         *float64   `json:"new_value,omitempty"`
	ChangeSummary    string     `json:"change_summary"`
}

type ClassifyContractRequest struct {
	Apply         bool                `json:"apply"`
	CandidateText string              `json:"candidate_text,omitempty"`
	OverrideType  *model.ContractType `json:"override_type,omitempty"`
}

type ReviewContractRequest struct {
	ApproverUserID   *uuid.UUID                  `json:"approver_user_id,omitempty"`
	ApproverRole     *string                     `json:"approver_role,omitempty"`
	ApprovalPolicyID *uuid.UUID                  `json:"approval_policy_id,omitempty"`
	SLAHours         int                         `json:"sla_hours"`
	Description      string                      `json:"description"`
	ApprovalPolicy   *ApprovalPolicyRequest      `json:"approval_policy,omitempty"`
	FormFields       []ApprovalFormFieldRequest  `json:"form_fields,omitempty"`
	OutOfOffice      *OutOfOfficeDelegationInput `json:"out_of_office,omitempty"`
}

type ApprovalPolicyRequest struct {
	PolicyID                 string   `json:"policy_id,omitempty"`
	Name                     string   `json:"name,omitempty"`
	RequiredRole             string   `json:"required_role,omitempty"`
	RequiredAuthorityAmount  *float64 `json:"required_authority_amount,omitempty"`
	Currency                 string   `json:"currency,omitempty"`
	RequireAuthorityEvidence *bool    `json:"require_authority_evidence,omitempty"`
}

type ApprovalFormFieldRequest struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Label       string   `json:"label"`
	Required    bool     `json:"required"`
	Options     []string `json:"options,omitempty"`
	Placeholder string   `json:"placeholder,omitempty"`
	Description string   `json:"description,omitempty"`
	// VisibleWhen is an optional boolean expression (the workflow expression DSL)
	// that controls conditional visibility of the field on the approval task form.
	// Empty means always visible. It is validated at write time and passed through
	// to the workflow engine's FormField.VisibleWhen (Feature 2).
	VisibleWhen string `json:"visible_when,omitempty"`
}

type OutOfOfficeDelegationInput struct {
	Active                 bool       `json:"active"`
	OriginalApproverUserID *uuid.UUID `json:"original_approver_user_id,omitempty"`
	DelegatedTo            *uuid.UUID `json:"delegated_to,omitempty"`
	Reason                 string     `json:"reason,omitempty"`
	EvidenceID             string     `json:"evidence_id,omitempty"`
	StartsAt               *time.Time `json:"starts_at,omitempty"`
	EndsAt                 *time.Time `json:"ends_at,omitempty"`
}

type WorkflowDecisionRequest struct {
	Decision          string                      `json:"decision"`
	Notes             *string                     `json:"notes,omitempty"`
	Metadata          map[string]any              `json:"metadata,omitempty"`
	FormData          map[string]any              `json:"form_data,omitempty"`
	AuthorityEvidence *ApprovalAuthorityEvidence  `json:"authority_evidence,omitempty"`
	DelegatedTo       *uuid.UUID                  `json:"delegated_to,omitempty"`
	DelegationReason  *string                     `json:"delegation_reason,omitempty"`
	OutOfOffice       *OutOfOfficeDelegationInput `json:"out_of_office,omitempty"`
	LateJustification *string                     `json:"late_justification,omitempty"`
	// ReturnReasonCode carries a structured PRD return-reason code (Al Othaim
	// PRD 7.0 / Diagram B) when the verdict is a REJECT at a legal-request or
	// lawsuit approval gate. It draws from the same controlled deficiency list
	// (model.ReturnIncompleteReasonCode) that the execution "return incomplete"
	// path uses, so a rejected approval captures a reportable reason instead of
	// free-text notes alone. Ignored on an approve verdict.
	ReturnReasonCode *string `json:"return_reason_code,omitempty"`
}

type WorkflowBulkDecisionRequest struct {
	Decision          string                       `json:"decision"`
	Notes             *string                      `json:"notes,omitempty"`
	Metadata          map[string]any               `json:"metadata,omitempty"`
	FormData          map[string]any               `json:"form_data,omitempty"`
	AuthorityEvidence *ApprovalAuthorityEvidence   `json:"authority_evidence,omitempty"`
	LateJustification *string                      `json:"late_justification,omitempty"`
	Items             []WorkflowBulkDecisionTarget `json:"items"`
}

type WorkflowBulkDecisionTarget struct {
	WorkflowInstanceID uuid.UUID                  `json:"workflow_instance_id"`
	TaskID             uuid.UUID                  `json:"task_id"`
	Notes              *string                    `json:"notes,omitempty"`
	Metadata           map[string]any             `json:"metadata,omitempty"`
	FormData           map[string]any             `json:"form_data,omitempty"`
	AuthorityEvidence  *ApprovalAuthorityEvidence `json:"authority_evidence,omitempty"`
	LateJustification  *string                    `json:"late_justification,omitempty"`
}

type ApprovalAuthorityEvidence struct {
	PolicyID        string  `json:"policy_id,omitempty"`
	Role            string  `json:"role"`
	AuthorityAmount float64 `json:"authority_amount"`
	Currency        string  `json:"currency"`
	EvidenceID      string  `json:"evidence_id"`
	Source          string  `json:"source,omitempty"`

	// Cryptographic Delegation-of-Authority evidence (Feature 3). When supplied,
	// the leaf certificate, detached signature and signed payload are validated
	// against the configured trusted roots (chain + signature + validity window),
	// and the cryptographically-bound authority amount must be >= the policy's
	// RequiredAuthorityAmount. All fields are optional so plain-text evidence keeps
	// working when no trusted roots are configured; when roots ARE configured and a
	// policy requires authority evidence, these become required.
	CertificatePEM   string `json:"certificate_pem,omitempty"`
	SignatureB64     string `json:"signature_b64,omitempty"`
	SignatureAlg     string `json:"signature_alg,omitempty"`
	SignedPayloadB64 string `json:"signed_payload_b64,omitempty"`
	TrustedRootsPEM  string `json:"trusted_roots_pem,omitempty"`
}

// HasCryptographicEvidence reports whether the caller supplied the cert +
// signature material needed to run PKI validation.
func (e *ApprovalAuthorityEvidence) HasCryptographicEvidence() bool {
	if e == nil {
		return false
	}
	return e.CertificatePEM != "" && e.SignatureB64 != "" && e.SignatureAlg != ""
}

type CreateApprovalPolicyRequest struct {
	Name                     string                     `json:"name"`
	Description              string                     `json:"description"`
	Status                   model.ApprovalPolicyStatus `json:"status,omitempty"`
	Priority                 int                        `json:"priority"`
	ContractType             *model.ContractType        `json:"contract_type,omitempty"`
	Department               *string                    `json:"department,omitempty"`
	MinValue                 *float64                   `json:"min_value,omitempty"`
	MaxValue                 *float64                   `json:"max_value,omitempty"`
	Currency                 string                     `json:"currency"`
	Mode                     string                     `json:"mode"`
	Quorum                   string                     `json:"quorum"`
	QuorumN                  *int                       `json:"quorum_n,omitempty"`
	Approvers                []ApprovalPolicyApprover   `json:"approvers"`
	FormFields               []ApprovalFormFieldRequest `json:"form_fields,omitempty"`
	RequireAuthorityEvidence *bool                      `json:"require_authority_evidence,omitempty"`
	RequiredRole             *string                    `json:"required_role,omitempty"`
	RequiredAuthorityAmount  *float64                   `json:"required_authority_amount,omitempty"`
	Metadata                 map[string]any             `json:"metadata,omitempty"`
	// ValidFrom / ValidUntil bound the policy's effective window (policy expiry).
	// A nil bound is unbounded. When both are set, valid_until must be after
	// valid_from.
	ValidFrom  *time.Time `json:"valid_from,omitempty"`
	ValidUntil *time.Time `json:"valid_until,omitempty"`
	// TemplateID links the policy back to the template it was instantiated from.
	TemplateID *uuid.UUID `json:"template_id,omitempty"`
}

type UpdateApprovalPolicyRequest struct {
	Name                     *string                     `json:"name,omitempty"`
	Description              *string                     `json:"description,omitempty"`
	Status                   *model.ApprovalPolicyStatus `json:"status,omitempty"`
	Priority                 *int                        `json:"priority,omitempty"`
	ContractType             *model.ContractType         `json:"contract_type,omitempty"`
	Department               *string                     `json:"department,omitempty"`
	MinValue                 *float64                    `json:"min_value,omitempty"`
	MaxValue                 *float64                    `json:"max_value,omitempty"`
	Currency                 *string                     `json:"currency,omitempty"`
	Mode                     *string                     `json:"mode,omitempty"`
	Quorum                   *string                     `json:"quorum,omitempty"`
	QuorumN                  *int                        `json:"quorum_n,omitempty"`
	Approvers                []ApprovalPolicyApprover    `json:"approvers,omitempty"`
	FormFields               []ApprovalFormFieldRequest  `json:"form_fields,omitempty"`
	RequireAuthorityEvidence *bool                       `json:"require_authority_evidence,omitempty"`
	RequiredRole             *string                     `json:"required_role,omitempty"`
	RequiredAuthorityAmount  *float64                    `json:"required_authority_amount,omitempty"`
	Metadata                 map[string]any              `json:"metadata,omitempty"`
	ValidFrom                *time.Time                  `json:"valid_from,omitempty"`
	ValidUntil               *time.Time                  `json:"valid_until,omitempty"`
	ClearedFields            []string                    `json:"cleared_fields,omitempty"`
}

func (r *UpdateApprovalPolicyRequest) ShouldClear(field string) bool {
	for _, f := range r.ClearedFields {
		if f == field {
			return true
		}
	}
	return false
}

type ApprovalPolicyApprover struct {
	Type  string `json:"type"`
	Ref   string `json:"ref"`
	Label string `json:"label,omitempty"`
}

func (r *CreateContractRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.PartyAName = strings.TrimSpace(r.PartyAName)
	r.PartyBName = strings.TrimSpace(r.PartyBName)
	r.Currency = normalizeCurrency(r.Currency)
	r.OwnerName = strings.TrimSpace(r.OwnerName)
	r.Tags = normalizeTags(r.Tags)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	if r.RenewalNoticeDays == 0 {
		r.RenewalNoticeDays = 30
	}
}

func normalizeCurrency(raw string) string {
	raw = strings.ToUpper(strings.TrimSpace(raw))
	if raw == "" {
		return "SAR"
	}
	return raw
}

func normalizeTags(tags []string) []string {
	if len(tags) == 0 {
		return []string{}
	}
	out := make([]string, 0, len(tags))
	seen := make(map[string]struct{}, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(strings.ToLower(tag))
		if tag == "" {
			continue
		}
		if _, exists := seen[tag]; exists {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	return out
}

func NormalizeTags(tags []string) []string {
	return normalizeTags(tags)
}
