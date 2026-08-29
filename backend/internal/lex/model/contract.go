package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

type ContractType string

const (
	ContractTypeServiceAgreement ContractType = "service_agreement"
	ContractTypeNDA              ContractType = "nda"
	ContractTypeEmployment       ContractType = "employment"
	ContractTypeVendor           ContractType = "vendor"
	ContractTypeLicense          ContractType = "license"
	ContractTypeLease            ContractType = "lease"
	ContractTypePartnership      ContractType = "partnership"
	ContractTypeConsulting       ContractType = "consulting"
	ContractTypeProcurement      ContractType = "procurement"
	ContractTypeSLA              ContractType = "sla"
	ContractTypeMOU              ContractType = "mou"
	ContractTypeAmendment        ContractType = "amendment"
	ContractTypeRenewal          ContractType = "renewal"
	ContractTypeOther            ContractType = "other"
)

type ContractStatus string

const (
	ContractStatusDraft            ContractStatus = "draft"
	ContractStatusInternalReview   ContractStatus = "internal_review"
	ContractStatusLegalReview      ContractStatus = "legal_review"
	ContractStatusNegotiation      ContractStatus = "negotiation"
	ContractStatusPendingSignature ContractStatus = "pending_signature"
	ContractStatusActive           ContractStatus = "active"
	ContractStatusSuspended        ContractStatus = "suspended"
	ContractStatusExpired          ContractStatus = "expired"
	ContractStatusTerminated       ContractStatus = "terminated"
	ContractStatusRenewed          ContractStatus = "renewed"
	ContractStatusCancelled        ContractStatus = "cancelled"
)

type AnalysisStatus string

const (
	AnalysisStatusPending   AnalysisStatus = "pending"
	AnalysisStatusAnalyzing AnalysisStatus = "analyzing"
	AnalysisStatusCompleted AnalysisStatus = "completed"
	AnalysisStatusFailed    AnalysisStatus = "failed"
)

type Contract struct {
	ID                 uuid.UUID       `json:"id"`
	TenantID           uuid.UUID       `json:"tenant_id"`
	Title              string          `json:"title"`
	ContractNumber     *string         `json:"contract_number,omitempty"`
	Type               ContractType    `json:"type"`
	Description        string          `json:"description"`
	PartyAName         string          `json:"party_a_name"`
	PartyAEntity       *string         `json:"party_a_entity,omitempty"`
	PartyBName         string          `json:"party_b_name"`
	PartyBEntity       *string         `json:"party_b_entity,omitempty"`
	PartyBContact      *string         `json:"party_b_contact,omitempty"`
	TotalValue         *float64        `json:"total_value,omitempty"`
	Currency           string          `json:"currency"`
	PaymentTerms       *string         `json:"payment_terms,omitempty"`
	EffectiveDate      *time.Time      `json:"effective_date,omitempty"`
	ExpiryDate         *time.Time      `json:"expiry_date,omitempty"`
	RenewalDate        *time.Time      `json:"renewal_date,omitempty"`
	AutoRenew          bool            `json:"auto_renew"`
	RenewalNoticeDays  int             `json:"renewal_notice_days"`
	SignedDate         *time.Time      `json:"signed_date,omitempty"`
	Status             ContractStatus  `json:"status"`
	PreviousStatus     *ContractStatus `json:"previous_status,omitempty"`
	StatusChangedAt    *time.Time      `json:"status_changed_at,omitempty"`
	StatusChangedBy    *uuid.UUID      `json:"status_changed_by,omitempty"`
	OwnerUserID        uuid.UUID       `json:"owner_user_id"`
	OwnerName          string          `json:"owner_name"`
	LegalReviewerID    *uuid.UUID      `json:"legal_reviewer_id,omitempty"`
	LegalReviewerName  *string         `json:"legal_reviewer_name,omitempty"`
	RiskScore          *float64        `json:"risk_score,omitempty"`
	RiskLevel          RiskLevel       `json:"risk_level"`
	AnalysisStatus     AnalysisStatus  `json:"analysis_status"`
	LastAnalyzedAt     *time.Time      `json:"last_analyzed_at,omitempty"`
	DocumentFileID     *uuid.UUID      `json:"document_file_id,omitempty"`
	DocumentText       string          `json:"document_text"`
	CurrentVersion     int             `json:"current_version"`
	ParentContractID   *uuid.UUID      `json:"parent_contract_id,omitempty"`
	WorkflowInstanceID *uuid.UUID      `json:"workflow_instance_id,omitempty"`
	// OrgEntityID is an OPTIONAL link to the legal-org master-data registry
	// (legal_org_entities). It coexists with — and never replaces — the
	// party_a_* / party_b_* free-text fields (back-compat). OrgEntityName is
	// the read-side resolved bilingual entity name (LEFT JOIN, nil when
	// unlinked or dangling); it is never written back.
	OrgEntityID   *uuid.UUID           `json:"org_entity_id,omitempty"`
	OrgEntityName *forms.LocalizedText `json:"org_entity_name,omitempty"`
	Department    *string              `json:"department,omitempty"`
	Tags          []string             `json:"tags"`
	Metadata      map[string]any       `json:"metadata"`
	CreatedBy     uuid.UUID            `json:"created_by"`
	CreatedAt     time.Time            `json:"created_at"`
	UpdatedAt     time.Time            `json:"updated_at"`
	DeletedAt     *time.Time           `json:"deleted_at,omitempty"`
}

type ContractVersion struct {
	ID            uuid.UUID `json:"id"`
	TenantID      uuid.UUID `json:"tenant_id"`
	ContractID    uuid.UUID `json:"contract_id"`
	Version       int       `json:"version"`
	FileID        uuid.UUID `json:"file_id"`
	FileName      string    `json:"file_name"`
	FileSizeBytes int64     `json:"file_size_bytes"`
	ContentHash   string    `json:"content_hash"`
	ExtractedText *string   `json:"extracted_text,omitempty"`
	ChangeSummary *string   `json:"change_summary,omitempty"`
	UploadedBy    uuid.UUID `json:"uploaded_by"`
	UploadedAt    time.Time `json:"uploaded_at"`
}

type RedlineOperation string

const (
	RedlineOperationEqual   RedlineOperation = "equal"
	RedlineOperationAdded   RedlineOperation = "added"
	RedlineOperationRemoved RedlineOperation = "removed"
)

type ContractRedlineSegment struct {
	Operation  RedlineOperation `json:"operation"`
	BaseLine   *int             `json:"base_line,omitempty"`
	TargetLine *int             `json:"target_line,omitempty"`
	Text       string           `json:"text"`
}

type ContractRedline struct {
	ContractID     uuid.UUID                `json:"contract_id"`
	BaseVersion    int                      `json:"base_version"`
	TargetVersion  int                      `json:"target_version"`
	BaseFileName   string                   `json:"base_file_name"`
	TargetFileName string                   `json:"target_file_name"`
	ChangeSummary  *string                  `json:"change_summary,omitempty"`
	Segments       []ContractRedlineSegment `json:"segments"`
	AddedLines     int                      `json:"added_lines"`
	RemovedLines   int                      `json:"removed_lines"`
	GeneratedAt    time.Time                `json:"generated_at"`
}

type ContractListFilters struct {
	Page           int
	PerPage        int
	Search         string
	Status         *ContractStatus
	Statuses       []ContractStatus
	Type           *ContractType
	Types          []ContractType
	OwnerUserID    *uuid.UUID
	RiskLevel      *RiskLevel
	Department     string
	Departments    []string
	Tag            string
	OrgEntityID    *uuid.UUID
	ExpiringInDays *int
	ExpiryFrom     *time.Time
	ExpiryTo       *time.Time
	CreatedFrom    *time.Time
	CreatedTo      *time.Time
	StatusFrom     *time.Time
	StatusTo       *time.Time
	SortColumn     string
	SortDirection  string
}

type ContractDetail struct {
	Contract       *Contract             `json:"contract"`
	Clauses        []Clause              `json:"clauses"`
	LatestAnalysis *ContractRiskAnalysis `json:"latest_analysis,omitempty"`
	VersionCount   int                   `json:"version_count"`
}

type ContractBriefClause struct {
	ID               uuid.UUID  `json:"id"`
	Title            string     `json:"title"`
	ClauseType       ClauseType `json:"clause_type"`
	SectionReference *string    `json:"section_reference,omitempty"`
	RiskLevel        RiskLevel  `json:"risk_level"`
	RiskScore        float64    `json:"risk_score"`
	Summary          string     `json:"summary"`
}

type ContractBriefRisk struct {
	Title           string      `json:"title"`
	Description     string      `json:"description"`
	Severity        RiskLevel   `json:"severity"`
	ClauseReference *string     `json:"clause_reference,omitempty"`
	Recommendation  string      `json:"recommendation,omitempty"`
	ClauseType      *ClauseType `json:"clause_type,omitempty"`
}

type ContractBriefSignal struct {
	Label  string `json:"label"`
	Value  string `json:"value"`
	Source string `json:"source"`
}

type ContractBrief struct {
	ContractID       uuid.UUID             `json:"contract_id"`
	Title            string                `json:"title"`
	Type             ContractType          `json:"type"`
	Status           ContractStatus        `json:"status"`
	Counterparty     string                `json:"counterparty"`
	Owner            string                `json:"owner"`
	Value            *float64              `json:"value,omitempty"`
	Currency         string                `json:"currency"`
	EffectiveDate    *time.Time            `json:"effective_date,omitempty"`
	ExpiryDate       *time.Time            `json:"expiry_date,omitempty"`
	RenewalDate      *time.Time            `json:"renewal_date,omitempty"`
	ExecutiveSummary string                `json:"executive_summary"`
	RiskSummary      string                `json:"risk_summary"`
	RiskLevel        RiskLevel             `json:"risk_level"`
	RiskScore        *float64              `json:"risk_score,omitempty"`
	TopClauses       []ContractBriefClause `json:"top_clauses"`
	TopRisks         []ContractBriefRisk   `json:"top_risks"`
	Obligations      []ContractBriefSignal `json:"obligations"`
	RenewalSignals   []ContractBriefSignal `json:"renewal_signals"`
	Metadata         map[string]any        `json:"metadata,omitempty"`
	GeneratedAt      time.Time             `json:"generated_at"`
}

type ContractSummary struct {
	ID         uuid.UUID      `json:"id"`
	Title      string         `json:"title"`
	Type       ContractType   `json:"type"`
	Status     ContractStatus `json:"status"`
	PartyBName string         `json:"party_b_name"`
	// TotalValue/Currency are populated ONLY by the reports path (contract
	// service reportSummary) and are verb-gated at the handler: stripped from
	// JSON and masked in CSV for callers without lex:contract:approve.
	// omitempty keeps every legacy payload byte-identical when absent.
	TotalValue     *float64   `json:"total_value,omitempty"`
	Currency       string     `json:"currency,omitempty"`
	RiskLevel      RiskLevel  `json:"risk_level"`
	RiskScore      *float64   `json:"risk_score,omitempty"`
	ExpiryDate     *time.Time `json:"expiry_date,omitempty"`
	CurrentVersion int        `json:"current_version"`
	CreatedAt      time.Time  `json:"created_at"`
}

type ExpiringContractSummary struct {
	ID                uuid.UUID      `json:"id"`
	Title             string         `json:"title"`
	Type              ContractType   `json:"type"`
	Status            ContractStatus `json:"status"`
	PartyBName        string         `json:"party_b_name"`
	ExpiryDate        time.Time      `json:"expiry_date"`
	DaysUntilExpiry   int            `json:"days_until_expiry"`
	OwnerName         string         `json:"owner_name"`
	LegalReviewerName *string        `json:"legal_reviewer_name,omitempty"`
}

type ContractRenewalWarningSeverity string

const (
	ContractRenewalWarningSeverityUrgent  ContractRenewalWarningSeverity = "urgent"
	ContractRenewalWarningSeverityWarning ContractRenewalWarningSeverity = "warning"
)

type ContractRenewalWarning struct {
	ContractID         uuid.UUID                      `json:"contract_id"`
	Title              string                         `json:"title"`
	Status             ContractStatus                 `json:"status"`
	Counterparty       string                         `json:"counterparty"`
	Owner              string                         `json:"owner"`
	ExpiryDate         *time.Time                     `json:"expiry_date,omitempty"`
	RenewalDate        *time.Time                     `json:"renewal_date,omitempty"`
	AutoRenew          bool                           `json:"auto_renew"`
	RenewalNoticeDays  int                            `json:"renewal_notice_days"`
	ConfiguredLeadDays int                            `json:"configured_lead_days"`
	TriggerDate        *time.Time                     `json:"trigger_date,omitempty"`
	DaysUntilTrigger   int                            `json:"days_until_trigger"`
	DaysUntilExpiry    int                            `json:"days_until_expiry"`
	Severity           ContractRenewalWarningSeverity `json:"severity"`
	Reason             string                         `json:"reason"`
}

type ContractRenewalWarningSummary struct {
	TenantID    uuid.UUID                `json:"tenant_id"`
	GeneratedAt time.Time                `json:"generated_at"`
	HorizonDays int                      `json:"horizon_days"`
	LeadDays    int                      `json:"lead_days"`
	Total       int                      `json:"total"`
	Urgent      int                      `json:"urgent"`
	Warning     int                      `json:"warning"`
	Items       []ContractRenewalWarning `json:"items"`
}

type ContractClassificationResult struct {
	ContractID      uuid.UUID      `json:"contract_id"`
	PreviousType    ContractType   `json:"previous_type"`
	RecommendedType ContractType   `json:"recommended_type"`
	AppliedType     ContractType   `json:"applied_type"`
	Applied         bool           `json:"applied"`
	Confidence      float64        `json:"confidence"`
	MatchedTerms    []string       `json:"matched_terms"`
	Rationale       string         `json:"rationale"`
	ClassifiedAt    time.Time      `json:"classified_at"`
	Metadata        map[string]any `json:"metadata,omitempty"`
}

type ContractTimelineEvent struct {
	ID          string         `json:"id"`
	EventType   string         `json:"event_type"`
	Title       string         `json:"title"`
	Description string         `json:"description"`
	OccurredAt  time.Time      `json:"occurred_at"`
	Actor       *string        `json:"actor,omitempty"`
	Source      string         `json:"source"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type ContractTimeline struct {
	ContractID  uuid.UUID               `json:"contract_id"`
	GeneratedAt time.Time               `json:"generated_at"`
	Events      []ContractTimelineEvent `json:"events"`
}

type ContractRiskSummary struct {
	ID         uuid.UUID      `json:"id"`
	Title      string         `json:"title"`
	Type       ContractType   `json:"type"`
	Status     ContractStatus `json:"status"`
	RiskLevel  RiskLevel      `json:"risk_level"`
	RiskScore  float64        `json:"risk_score"`
	PartyBName string         `json:"party_b_name"`
	ExpiryDate *time.Time     `json:"expiry_date,omitempty"`
}

type TotalValueBreakdown struct {
	ByType     map[string]float64 `json:"by_type"`
	ByCurrency map[string]float64 `json:"by_currency"`
}

type MonthlyContractActivity struct {
	Month     string `json:"month"`
	Created   int    `json:"created"`
	Activated int    `json:"activated"`
	Expired   int    `json:"expired"`
	Renewed   int    `json:"renewed"`
}

type LexDashboard struct {
	KPIs                     LexKPIs                   `json:"kpis"`
	ContractsByType          map[string]int            `json:"contracts_by_type"`
	ContractsByStatus        map[string]int            `json:"contracts_by_status"`
	ExpiringContracts        []ExpiringContractSummary `json:"expiring_contracts"`
	HighRiskContracts        []ContractRiskSummary     `json:"high_risk_contracts"`
	RecentContracts          []ContractSummary         `json:"recent_contracts"`
	ComplianceAlertsByStatus map[string]int            `json:"compliance_alerts_by_status"`
	TotalContractValue       TotalValueBreakdown       `json:"total_contract_value"`
	MonthlyActivity          []MonthlyContractActivity `json:"monthly_activity"`
	CalculatedAt             time.Time                 `json:"calculated_at"`
}

type LexKPIs struct {
	ActiveContracts   int     `json:"active_contracts"`
	ExpiringIn30Days  int     `json:"expiring_in_30_days"`
	ExpiringIn7Days   int     `json:"expiring_in_7_days"`
	HighRiskContracts int     `json:"high_risk_contracts"`
	PendingReview     int     `json:"pending_review"`
	OpenAlerts        int     `json:"open_compliance_alerts"`
	TotalValue        float64 `json:"total_active_value"`
	ComplianceScore   float64 `json:"compliance_score"`
}

type ContractStats struct {
	ByStatus       map[string]int `json:"by_status"`
	ByType         map[string]int `json:"by_type"`
	ByRiskLevel    map[string]int `json:"by_risk_level"`
	Expiring30Days int            `json:"expiring_30_days"`
	Expiring7Days  int            `json:"expiring_7_days"`
}

type ContractReport struct {
	GeneratedAt time.Time         `json:"generated_at"`
	Total       int               `json:"total"`
	Filters     map[string]string `json:"filters"`
	Contracts   []ContractSummary `json:"contracts"`
	ByStatus    map[string]int    `json:"by_status"`
	ByType      map[string]int    `json:"by_type"`
	ByRiskLevel map[string]int    `json:"by_risk_level"`
}

type LegalWorkflowSummary struct {
	WorkflowInstanceID uuid.UUID      `json:"workflow_instance_id"`
	TaskID             *uuid.UUID     `json:"task_id,omitempty"`
	ContractID         uuid.UUID      `json:"contract_id"`
	ContractTitle      string         `json:"contract_title"`
	ContractStatus     ContractStatus `json:"contract_status"`
	WorkflowStatus     string         `json:"workflow_status"`
	CurrentStepID      *string        `json:"current_step_id,omitempty"`
	StartedAt          time.Time      `json:"started_at"`
	AssigneeID         *uuid.UUID     `json:"assignee_id,omitempty"`
	AssigneeRole       *string        `json:"assignee_role,omitempty"`
	TaskStatus         *string        `json:"task_status,omitempty"`
	SLADeadline        *time.Time     `json:"sla_deadline,omitempty"`
	ApprovalPolicy     map[string]any `json:"approval_policy,omitempty"`
	Delegation         map[string]any `json:"delegation,omitempty"`
}

type LegalWorkflowDecisionResult struct {
	WorkflowInstanceID     uuid.UUID      `json:"workflow_instance_id"`
	TaskID                 uuid.UUID      `json:"task_id"`
	ContractID             uuid.UUID      `json:"contract_id"`
	PreviousContractStatus ContractStatus `json:"previous_contract_status"`
	ContractStatus         ContractStatus `json:"contract_status"`
	WorkflowStatus         string         `json:"workflow_status"`
	TaskStatus             string         `json:"task_status"`
	Decision               string         `json:"decision"`
	DecidedBy              uuid.UUID      `json:"decided_by"`
	DecidedAt              time.Time      `json:"decided_at"`
	Notes                  *string        `json:"notes,omitempty"`
	Metadata               map[string]any `json:"metadata,omitempty"`
	AuthorityEvidence      map[string]any `json:"authority_evidence,omitempty"`
	Delegation             map[string]any `json:"delegation,omitempty"`
}

type LegalWorkflowBulkDecisionError struct {
	WorkflowInstanceID uuid.UUID `json:"workflow_instance_id"`
	TaskID             uuid.UUID `json:"task_id"`
	Code               string    `json:"code"`
	Message            string    `json:"message"`
}

type LegalWorkflowBulkDecisionResult struct {
	Decision  string                           `json:"decision"`
	Requested int                              `json:"requested"`
	Succeeded int                              `json:"succeeded"`
	Failed    int                              `json:"failed"`
	DecidedBy uuid.UUID                        `json:"decided_by"`
	DecidedAt time.Time                        `json:"decided_at"`
	Results   []LegalWorkflowDecisionResult    `json:"results"`
	Errors    []LegalWorkflowBulkDecisionError `json:"errors"`
}
