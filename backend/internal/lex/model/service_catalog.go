package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// ServiceChannel enumerates the intake channels a catalog service accepts. A
// service may be reachable via the in-app platform submission form, an email
// mailbox, or both (CAP-002).
type ServiceChannel string

const (
	ServiceChannelPlatform ServiceChannel = "platform"
	ServiceChannelEmail    ServiceChannel = "email"
	ServiceChannelBoth     ServiceChannel = "both"
)

const (
	ServiceCodeLegalConsultation    = "LEGAL_CONSULTATION"
	ServiceCodeContractReview       = "CONTRACT_REVIEW"
	ServiceCodeContractDrafting     = "CONTRACT_DRAFTING"
	ServiceCodeLitigationSupport    = "LITIGATION_SUPPORT"
	ServiceCodeLegalOpinion         = "LEGAL_OPINION"
	ServiceCodeRegulatoryCompliance = "REGULATORY_COMPLIANCE"
	ServiceCodePowerOfAttorney      = "POWER_OF_ATTORNEY"
	ServiceCodeGeneralLegalRequest  = "GENERAL_LEGAL_REQUEST"
	ServiceCodeEnforcementRequest   = "ENFORCEMENT_REQUEST"
	ServiceCodeViolationStudy       = "VIOLATION_STUDY"
	ServiceCodeFieldInspection      = "FIELD_INSPECTION"
)

// DefaultLegalServiceCodes is the active Al Othaim service catalogue defined
// by the client PRD dated 2026-07-14. The legacy constants above remain
// available because historical requests can still reference those codes.
var DefaultLegalServiceCodes = []string{
	ServiceCodeLegalConsultation,
	ServiceCodeContractReview,
	ServiceCodeLegalOpinion,
	ServiceCodeLitigationSupport,
	ServiceCodeEnforcementRequest,
	ServiceCodeViolationStudy,
	ServiceCodeFieldInspection,
	ServiceCodePowerOfAttorney,
}

// Valid reports whether the channel is one of the known values.
func (c ServiceChannel) Valid() bool {
	switch c {
	case ServiceChannelPlatform, ServiceChannelEmail, ServiceChannelBoth:
		return true
	default:
		return false
	}
}

// AcceptsEmail reports whether the service can be reached over the email channel.
func (c ServiceChannel) AcceptsEmail() bool {
	return c == ServiceChannelEmail || c == ServiceChannelBoth
}

// AcceptsPlatform reports whether the service can be reached over the in-app
// platform submission channel.
func (c ServiceChannel) AcceptsPlatform() bool {
	return c == ServiceChannelPlatform || c == ServiceChannelBoth
}

// EligibilityRuleType enumerates the predicate kinds an eligibility rule can
// express (CAP-008). `all` is the open predicate (anyone may request); the rest
// constrain the requester against the org registry / DoA matrix.
type EligibilityRuleType string

const (
	EligibilityRuleAll        EligibilityRuleType = "all"
	EligibilityRuleDepartment EligibilityRuleType = "department"
	EligibilityRuleRole       EligibilityRuleType = "role"
	EligibilityRuleDoAMatrix  EligibilityRuleType = "doa_matrix"
)

// Valid reports whether the rule type is one of the known predicates.
func (t EligibilityRuleType) Valid() bool {
	switch t {
	case EligibilityRuleAll, EligibilityRuleDepartment, EligibilityRuleRole, EligibilityRuleDoAMatrix:
		return true
	default:
		return false
	}
}

// ServiceCatalogEntry is one of the legal department's published services
// (CAP-001). It is admin-editable (CAP-005) and drives request intake routing:
// requests created against a service inherit its request_type, approval flags,
// optional approval policy, and channel configuration.
type ServiceCatalogEntry struct {
	ID                    uuid.UUID                `json:"id"`
	TenantID              uuid.UUID                `json:"tenant_id"`
	Code                  string                   `json:"code"`
	RequestType           string                   `json:"request_type"`
	Name                  forms.LocalizedText      `json:"name"`
	Description           forms.LocalizedText      `json:"description"`
	AvailableTo           []string                 `json:"available_to"`
	RequesterApprovalReqd bool                     `json:"requester_approval_required"`
	ProviderApprovalReqd  bool                     `json:"provider_approval_required"`
	ApprovalPolicyID      *uuid.UUID               `json:"approval_policy_id,omitempty"`
	IntakeEmail           *string                  `json:"intake_email,omitempty"`
	Channel               ServiceChannel           `json:"channel"`
	Active                bool                     `json:"active"`
	Metadata              map[string]any           `json:"metadata"`
	CreatedBy             uuid.UUID                `json:"created_by"`
	CreatedAt             time.Time                `json:"created_at"`
	UpdatedAt             time.Time                `json:"updated_at"`
	DeletedAt             *time.Time               `json:"deleted_at,omitempty"`
	EligibilityRules      []ServiceEligibilityRule `json:"eligibility_rules,omitempty"`
}

// ServiceEligibilityRule is one CAP-008 predicate attached to a catalog service.
// value carries the rule-type-specific configuration (e.g. a department code, an
// org role key, or a DoA matrix reference).
type ServiceEligibilityRule struct {
	ID        uuid.UUID           `json:"id"`
	TenantID  uuid.UUID           `json:"tenant_id"`
	ServiceID uuid.UUID           `json:"service_id"`
	RuleType  EligibilityRuleType `json:"rule_type"`
	Value     string              `json:"value"`
	CreatedBy uuid.UUID           `json:"created_by"`
	CreatedAt time.Time           `json:"created_at"`
	UpdatedAt time.Time           `json:"updated_at"`
	DeletedAt *time.Time          `json:"deleted_at,omitempty"`
}

// EligibilityDecision is the resolved CAP-008 eligibility outcome for a given
// requester against a service. When Eligible is false the failing predicates are
// listed in Reasons so the caller can surface a precise denial.
type EligibilityDecision struct {
	ServiceID   uuid.UUID `json:"service_id"`
	ServiceCode string    `json:"service_code"`
	Eligible    bool      `json:"eligible"`
	MatchedRule string    `json:"matched_rule,omitempty"`
	Reasons     []string  `json:"reasons,omitempty"`
}

// ServiceCatalogListFilters carries the (already-validated) query parameters for
// the catalog list/search endpoint.
type ServiceCatalogListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Channel       *ServiceChannel
	Channels      []ServiceChannel
	Active        *bool
	RequestType   string
	SortColumn    string
	SortDirection string
}
