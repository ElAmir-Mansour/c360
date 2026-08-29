package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractComplianceReviewStatus is the per-issue triage disposition recorded
// against a single matched regulatory-compliance flag.
type ContractComplianceReviewStatus string

const (
	ContractComplianceReviewOpen     ContractComplianceReviewStatus = "open"
	ContractComplianceReviewResolved ContractComplianceReviewStatus = "resolved"
)

// ContractComplianceReview is the reviewer's triage of a single AI-populated
// compliance flag on a contract (CAP-109). One open/resolved row per
// (tenant, contract, flag_ref); the latest disposition is upserted in place.
// FlagRef is the stable compliance-flag code (ComplianceFlag.Code).
type ContractComplianceReview struct {
	ID         uuid.UUID                      `json:"id"`
	TenantID   uuid.UUID                      `json:"tenant_id"`
	ContractID uuid.UUID                      `json:"contract_id"`
	FlagRef    string                         `json:"flag_ref"`
	Status     ContractComplianceReviewStatus `json:"status"`
	Note       string                         `json:"note"`
	ResolvedBy *uuid.UUID                     `json:"resolved_by,omitempty"`
	ResolvedAt *time.Time                     `json:"resolved_at,omitempty"`
	CreatedAt  time.Time                      `json:"created_at"`
	UpdatedAt  time.Time                      `json:"updated_at"`
}

// ContractComplianceItem is a single matched regulatory issue: the contract's
// AI compliance flag enriched, read-side, with the tenant's matching
// compliance-rule context (rule text, severity, remediation) plus the reviewer's
// triage state. Severity falls back to the flag's own severity when the flag is
// not matched to a configured rule.
type ContractComplianceItem struct {
	FlagRef         string                         `json:"flag_ref"`
	Title           string                         `json:"title"`
	Description     string                         `json:"description"`
	Severity        RiskLevel                      `json:"severity"`
	ClauseReference *string                        `json:"clause_reference,omitempty"`
	Rule            *string                        `json:"rule,omitempty"`
	RuleType        *string                        `json:"rule_type,omitempty"`
	Remediation     *string                        `json:"remediation,omitempty"`
	Status          ContractComplianceReviewStatus `json:"status"`
	Note            string                         `json:"note"`
	ResolvedBy      *uuid.UUID                     `json:"resolved_by,omitempty"`
	ResolvedAt      *time.Time                     `json:"resolved_at,omitempty"`
}

// ContractComplianceCheck is the full compliance picture for a contract: the
// matched-issue list plus the open/resolved roll-up that drives the KPI strip.
type ContractComplianceCheck struct {
	ContractID  uuid.UUID                `json:"contract_id"`
	GeneratedAt time.Time                `json:"generated_at"`
	Total       int                      `json:"total"`
	Open        int                      `json:"open"`
	Resolved    int                      `json:"resolved"`
	Items       []ContractComplianceItem `json:"items"`
	HasAnalysis bool                     `json:"has_analysis"`
}
