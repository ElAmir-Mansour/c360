package model

import (
	"time"

	"github.com/google/uuid"
)

type ClauseLibraryStatus string

const (
	ClauseLibraryStatusDraft      ClauseLibraryStatus = "draft"
	ClauseLibraryStatusActive     ClauseLibraryStatus = "active"
	ClauseLibraryStatusDeprecated ClauseLibraryStatus = "deprecated"
	ClauseLibraryStatusArchived   ClauseLibraryStatus = "archived"
)

type ClauseGovernanceStatus string

const (
	ClauseGovernancePendingReview ClauseGovernanceStatus = "pending_review"
	ClauseGovernanceApproved      ClauseGovernanceStatus = "approved"
	ClauseGovernanceRejected      ClauseGovernanceStatus = "rejected"
)

type RegulationStatus string

const (
	RegulationStatusDraft      RegulationStatus = "draft"
	RegulationStatusActive     RegulationStatus = "active"
	RegulationStatusSuperseded RegulationStatus = "superseded"
	RegulationStatusDeprecated RegulationStatus = "deprecated"
	RegulationStatusArchived   RegulationStatus = "archived"
)

type RegulationType string

const (
	RegulationTypeLaw        RegulationType = "law"
	RegulationTypeRegulation RegulationType = "regulation"
	RegulationTypeCircular   RegulationType = "circular"
	RegulationTypeGuidance   RegulationType = "guidance"
	RegulationTypeStandard   RegulationType = "standard"
	RegulationTypePolicy     RegulationType = "policy"
	RegulationTypeOther      RegulationType = "other"
)

type RegulationClauseReferenceType string

const (
	RegulationClauseReferenceImplements    RegulationClauseReferenceType = "implements"
	RegulationClauseReferenceRequiredBy    RegulationClauseReferenceType = "required_by"
	RegulationClauseReferenceRecommendedBy RegulationClauseReferenceType = "recommended_by"
	RegulationClauseReferenceImpactedBy    RegulationClauseReferenceType = "impacted_by"
	RegulationClauseReferenceRelated       RegulationClauseReferenceType = "related"
)

type ClauseLibraryItem struct {
	ID               uuid.UUID              `json:"id"`
	TenantID         uuid.UUID              `json:"tenant_id"`
	Code             string                 `json:"code"`
	TitleEN          string                 `json:"title_en"`
	TitleAR          string                 `json:"title_ar"`
	TextEN           string                 `json:"text_en"`
	TextAR           string                 `json:"text_ar"`
	ClauseType       ClauseType             `json:"clause_type"`
	Category         string                 `json:"category"`
	Jurisdiction     string                 `json:"jurisdiction"`
	Source           string                 `json:"source"`
	SourceURL        *string                `json:"source_url,omitempty"`
	Version          int                    `json:"version"`
	Status           ClauseLibraryStatus    `json:"status"`
	GovernanceStatus ClauseGovernanceStatus `json:"governance_status"`
	SupersedesID     *uuid.UUID             `json:"supersedes_id,omitempty"`
	DeprecatedByID   *uuid.UUID             `json:"deprecated_by_id,omitempty"`
	DeprecatedAt     *time.Time             `json:"deprecated_at,omitempty"`
	Tags             []string               `json:"tags"`
	Metadata         map[string]any         `json:"metadata"`
	CreatedBy        uuid.UUID              `json:"created_by"`
	UpdatedBy        *uuid.UUID             `json:"updated_by,omitempty"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
	DeletedAt        *time.Time             `json:"deleted_at,omitempty"`
}

type RegulationLibraryItem struct {
	ID               uuid.UUID                   `json:"id"`
	TenantID         uuid.UUID                   `json:"tenant_id"`
	Code             string                      `json:"code"`
	TitleEN          string                      `json:"title_en"`
	TitleAR          string                      `json:"title_ar"`
	DescriptionEN    string                      `json:"description_en"`
	DescriptionAR    string                      `json:"description_ar"`
	Jurisdiction     string                      `json:"jurisdiction"`
	Authority        string                      `json:"authority"`
	Source           string                      `json:"source"`
	SourceURL        *string                     `json:"source_url,omitempty"`
	RegulationType   RegulationType              `json:"regulation_type"`
	EffectiveDate    *time.Time                  `json:"effective_date,omitempty"`
	Version          int                         `json:"version"`
	Status           RegulationStatus            `json:"status"`
	Tags             []string                    `json:"tags"`
	Metadata         map[string]any              `json:"metadata"`
	ClauseReferences []RegulationClauseReference `json:"clause_references,omitempty"`
	CreatedBy        uuid.UUID                   `json:"created_by"`
	UpdatedBy        *uuid.UUID                  `json:"updated_by,omitempty"`
	CreatedAt        time.Time                   `json:"created_at"`
	UpdatedAt        time.Time                   `json:"updated_at"`
	DeletedAt        *time.Time                  `json:"deleted_at,omitempty"`
}

type RegulationClauseReference struct {
	ID            uuid.UUID                     `json:"id"`
	TenantID      uuid.UUID                     `json:"tenant_id"`
	RegulationID  uuid.UUID                     `json:"regulation_id"`
	ClauseID      uuid.UUID                     `json:"clause_id"`
	ReferenceType RegulationClauseReferenceType `json:"reference_type"`
	Notes         string                        `json:"notes"`
	ClauseCode    string                        `json:"clause_code,omitempty"`
	ClauseTitleEN string                        `json:"clause_title_en,omitempty"`
	ClauseTitleAR string                        `json:"clause_title_ar,omitempty"`
	CreatedBy     uuid.UUID                     `json:"created_by"`
	CreatedAt     time.Time                     `json:"created_at"`
}

type ClauseLibraryListFilters struct {
	Search           string
	ClauseType       string
	Category         string
	Jurisdiction     string
	Status           string
	GovernanceStatus string
	Page             int
	PerPage          int
}

type ClauseLibrarySearchFilters struct {
	Query            string
	ClauseType       string
	Category         string
	Jurisdiction     string
	Status           string
	GovernanceStatus string
	RiskLevel        string
	Language         string
	Semantic         bool
	Page             int
	PerPage          int
}

type RegulationLibraryListFilters struct {
	Search         string
	Jurisdiction   string
	Authority      string
	RegulationType string
	Status         string
	Page           int
	PerPage        int
}

type RegulationLibrarySearchFilters struct {
	Query          string
	Jurisdiction   string
	Authority      string
	RegulationType string
	Status         string
	RiskLevel      string
	Language       string
	Semantic       bool
	Page           int
	PerPage        int
}

type ClauseLibrarySearchCandidate struct {
	Item           ClauseLibraryItem `json:"item"`
	RegulationText string            `json:"regulation_text"`
}

type RegulationLibrarySearchCandidate struct {
	Item       RegulationLibraryItem `json:"item"`
	ClauseText string                `json:"clause_text"`
}

type ClauseLibrarySearchResult struct {
	Item          ClauseLibraryItem `json:"item"`
	Score         float64           `json:"score"`
	MatchedFields []string          `json:"matched_fields"`
	Snippets      map[string]string `json:"snippets,omitempty"`
	Metadata      map[string]any    `json:"metadata,omitempty"`
}

type RegulationLibrarySearchResult struct {
	Item          RegulationLibraryItem `json:"item"`
	Score         float64               `json:"score"`
	MatchedFields []string              `json:"matched_fields"`
	Snippets      map[string]string     `json:"snippets,omitempty"`
	Metadata      map[string]any        `json:"metadata,omitempty"`
}
