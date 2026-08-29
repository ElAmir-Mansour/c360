package model

import (
	"time"

	"github.com/google/uuid"
)

// ClausePlaybook (WTQ-RSK-02) is a named set of approved/standard clauses that a
// contract of a given type is expected to contain. A contract's extracted
// clauses are compared against the applicable playbook to surface deviations:
// missing required clauses, materially altered clauses, and extra non-standard
// clauses.
type ClausePlaybook struct {
	ID           uuid.UUID        `json:"id"`
	TenantID     uuid.UUID        `json:"tenant_id"`
	Name         string           `json:"name"`
	Description  string           `json:"description"`
	ContractType ContractType     `json:"contract_type"`
	Status       PlaybookStatus   `json:"status"`
	Clauses      []PlaybookClause `json:"clauses"`
	Metadata     map[string]any   `json:"metadata"`
	CreatedBy    uuid.UUID        `json:"created_by"`
	UpdatedBy    *uuid.UUID       `json:"updated_by,omitempty"`
	CreatedAt    time.Time        `json:"created_at"`
	UpdatedAt    time.Time        `json:"updated_at"`
}

// PlaybookListFilters carries the server-side filter/sort options for listing
// clause playbooks (WTQ-RSK-02 #1). All fields are optional; the repository
// validates SortColumn/SortDirection against an allowlist before use.
type PlaybookListFilters struct {
	Page    int
	PerPage int
	// Search is an ILIKE fragment matched against name OR description.
	Search string
	// ContractType filters to an exact contract type when non-empty.
	ContractType *ContractType
	// Status filters to an exact playbook status when non-empty.
	Status *PlaybookStatus
	// SortColumn is a pre-validated SQL column expression (allowlisted by the
	// handler/repo); SortDirection is "asc" or "desc".
	SortColumn    string
	SortDirection string
}

// PlaybookStatus controls whether a playbook participates in deviation checks.
type PlaybookStatus string

const (
	PlaybookStatusDraft    PlaybookStatus = "draft"
	PlaybookStatusActive   PlaybookStatus = "active"
	PlaybookStatusArchived PlaybookStatus = "archived"
)

// PlaybookClause is one approved/standard clause within a playbook.
type PlaybookClause struct {
	// ClauseType is the standard clause code this entry governs.
	ClauseType ClauseType `json:"clause_type"`
	// Title is a human-friendly label for the standard clause.
	Title string `json:"title"`
	// StandardText is the approved/expected wording. A contract clause of the
	// same type whose normalized text diverges from this beyond the similarity
	// threshold is flagged ALTERED.
	StandardText string `json:"standard_text"`
	// Required marks the clause as mandatory: its absence is flagged MISSING.
	Required bool `json:"required"`
	// RiskWeight (0..1) scales the severity of a deviation on this clause. A
	// higher weight means a deviation matters more. Defaults to 1.0 when zero.
	RiskWeight float64 `json:"risk_weight"`
	// SimilarityThreshold (0..1) is the minimum normalized text similarity for a
	// present clause to be considered compliant. Below it the clause is ALTERED.
	// When zero, the engine's default threshold is used.
	SimilarityThreshold float64 `json:"similarity_threshold"`
}

// ClauseDeviationKind enumerates the deviation categories.
type ClauseDeviationKind string

const (
	// ClauseDeviationMissing: a required standard clause is absent from the contract.
	ClauseDeviationMissing ClauseDeviationKind = "missing"
	// ClauseDeviationAltered: a standard clause is present but its text materially
	// deviates from the playbook standard (similarity below threshold).
	ClauseDeviationAltered ClauseDeviationKind = "altered"
	// ClauseDeviationExtra: a non-standard clause is present that the playbook
	// does not define.
	ClauseDeviationExtra ClauseDeviationKind = "extra"
)

// ClauseDeviation describes a single difference between a contract clause and
// the applicable playbook.
type ClauseDeviation struct {
	Kind       ClauseDeviationKind `json:"kind"`
	ClauseType ClauseType          `json:"clause_type"`
	Title      string              `json:"title"`
	Required   bool                `json:"required"`
	// Similarity is the normalized text similarity (0..1) for ALTERED deviations.
	Similarity *float64 `json:"similarity,omitempty"`
	// Threshold is the similarity threshold applied for this clause.
	Threshold *float64 `json:"threshold,omitempty"`
	// RiskWeight is the playbook risk weighting for the affected clause.
	RiskWeight float64 `json:"risk_weight"`
	// Severity is the deviation severity derived from kind and risk weight.
	Severity RiskLevel `json:"severity"`
	// ContractClauseID is the stored contract-clause id the deviation refers to,
	// for deep-linking into the contract clause viewer. Set for ALTERED/EXTRA
	// deviations when the matched contract clause came from a persisted clause row;
	// nil for MISSING deviations (no contract clause exists) and for live document
	// extractions that have no persisted row (WTQ-RSK-02 #5).
	ContractClauseID *uuid.UUID `json:"contract_clause_id,omitempty"`
	// SectionReference points at where the deviating clause appears (ALTERED/EXTRA).
	SectionReference *string `json:"section_reference,omitempty"`
	// ExpectedExcerpt is a short excerpt of the standard text (MISSING/ALTERED).
	ExpectedExcerpt string `json:"expected_excerpt,omitempty"`
	// ActualExcerpt is a short excerpt of the contract clause text (ALTERED/EXTRA).
	ActualExcerpt string `json:"actual_excerpt,omitempty"`
	// Message is a human-readable summary of the deviation.
	Message string `json:"message"`
}

// ClauseDeviationReport is the result of comparing a contract against a playbook.
type ClauseDeviationReport struct {
	ContractID    uuid.UUID    `json:"contract_id"`
	PlaybookID    uuid.UUID    `json:"playbook_id"`
	PlaybookName  string       `json:"playbook_name"`
	ContractType  ContractType `json:"contract_type"`
	Matched       bool         `json:"matched"`
	Reason        string       `json:"reason"`
	Threshold     float64      `json:"threshold"`
	TotalStandard int          `json:"total_standard_clauses"`
	MissingCount  int          `json:"missing_count"`
	AlteredCount  int          `json:"altered_count"`
	ExtraCount    int          `json:"extra_count"`
	// ComplianceScore (0..100) is the risk-weighted share of standard clauses
	// present and within threshold.
	ComplianceScore float64           `json:"compliance_score"`
	Deviations      []ClauseDeviation `json:"deviations"`
	GeneratedAt     time.Time         `json:"generated_at"`
}

// PlaybookComplianceRow is one contract's compliance summary against its matched
// active playbook for the portfolio view (WTQ-RSK-02 #2). Only contracts that have
// a matched active playbook are returned.
type PlaybookComplianceRow struct {
	ContractID      uuid.UUID    `json:"contract_id"`
	ContractTitle   string       `json:"contract_title"`
	ContractType    ContractType `json:"contract_type"`
	PlaybookID      uuid.UUID    `json:"playbook_id"`
	PlaybookName    string       `json:"playbook_name"`
	ComplianceScore float64      `json:"compliance_score"`
	MissingCount    int          `json:"missing_count"`
	AlteredCount    int          `json:"altered_count"`
	ExtraCount      int          `json:"extra_count"`
	GeneratedAt     time.Time    `json:"generated_at"`
}

// PlaybookPortfolioFilters carries the portfolio-aggregate filter/sort options.
type PlaybookPortfolioFilters struct {
	Page    int
	PerPage int
	// ContractType narrows the scanned contracts to a single type.
	ContractType *ContractType
	// MinScore keeps only rows with compliance_score >= MinScore (when non-nil).
	MinScore *float64
	// MaxScore keeps only rows with compliance_score <= MaxScore (below-X% triage).
	MaxScore *float64
	// SortDirection "asc"|"desc" sorts the returned page by compliance_score.
	SortDirection string
}

// DeviationReviewStatus enumerates the triage dispositions of a clause deviation.
type DeviationReviewStatus string

const (
	DeviationReviewOpen     DeviationReviewStatus = "open"
	DeviationReviewAccepted DeviationReviewStatus = "accepted"
	DeviationReviewRejected DeviationReviewStatus = "rejected"
	DeviationReviewNeedsFix DeviationReviewStatus = "needs_fix"
)

// ContractClauseDeviationReview is a reviewer's triage disposition of a per
// clause-type deviation on a contract (WTQ-RSK-02 #3). At most one row exists per
// (tenant, contract, clause_type); the disposition is upserted in place.
type ContractClauseDeviationReview struct {
	ID         uuid.UUID             `json:"id"`
	TenantID   uuid.UUID             `json:"tenant_id"`
	ContractID uuid.UUID             `json:"contract_id"`
	ClauseType ClauseType            `json:"clause_type"`
	Status     DeviationReviewStatus `json:"status"`
	Note       string                `json:"note"`
	ReviewedBy *uuid.UUID            `json:"reviewed_by,omitempty"`
	ReviewedAt *time.Time            `json:"reviewed_at,omitempty"`
	CreatedAt  time.Time             `json:"created_at"`
	UpdatedAt  time.Time             `json:"updated_at"`
}
