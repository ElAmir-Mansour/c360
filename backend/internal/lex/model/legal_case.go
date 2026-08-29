package model

import (
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
)

// CaseCompanyStatus records which side of the litigation the company is on for a
// given case (CAP-042). plaintiff = the company initiated the action;
// defendant = the company is being sued.
type CaseCompanyStatus string

const (
	CaseCompanyStatusPlaintiff CaseCompanyStatus = "plaintiff"
	CaseCompanyStatusDefendant CaseCompanyStatus = "defendant"
)

// Valid reports whether the company status is one of the two allowed sides.
func (s CaseCompanyStatus) Valid() bool {
	switch s {
	case CaseCompanyStatusPlaintiff, CaseCompanyStatusDefendant:
		return true
	default:
		return false
	}
}

// CaseStrength is the litigation-strength assessment recorded during intake
// (CAP-034). It is nullable on the case row until the assessment is performed.
type CaseStrength string

const (
	CaseStrengthStrong CaseStrength = "strong"
	CaseStrengthWeak   CaseStrength = "weak"
)

// Valid reports whether the strength is one of the two allowed assessments.
func (s CaseStrength) Valid() bool {
	switch s {
	case CaseStrengthStrong, CaseStrengthWeak:
		return true
	default:
		return false
	}
}

// allowedCaseRiskRatings is the graded litigation-risk vocabulary (Othaim PRD 8.2).
// It reuses the shared model.RiskLevel bands but deliberately EXCLUDES `none`: a
// case that has been assessed always carries a real band (low..critical), so an
// "unassessed" case is represented by a NULL column, never a `none` rating.
var allowedCaseRiskRatings = map[RiskLevel]struct{}{
	RiskLevelLow:      {},
	RiskLevelMedium:   {},
	RiskLevelHigh:     {},
	RiskLevelCritical: {},
}

// CaseRiskRatingValid reports whether r is one of the four graded case-risk bands
// (low/medium/high/critical). `none` and any unknown value are rejected.
func CaseRiskRatingValid(r RiskLevel) bool {
	_, ok := allowedCaseRiskRatings[r]
	return ok
}

// DeriveCaseRiskRating maps a likelihood × impact assessment (each on the 1–5
// scale) onto a graded band (Othaim PRD 8.2), reusing the shared risk-scoring
// matrix. The product is scaled to the 0–100 band RiskLevelFromScore expects
// (max 5×5×4 = 100). The floor is clamped to `low` so an assessed case never
// resolves to `none`.
func DeriveCaseRiskRating(likelihood, impact int) RiskLevel {
	level := RiskLevelFromScore(float64(likelihood) * float64(impact) * 4)
	if level == RiskLevelNone {
		return RiskLevelLow
	}
	return level
}

// CaseStatus is the finite-state lifecycle of a litigation case. Intake and the
// two-phase directive/handoff pipeline (phase1/phase2) precede the operational
// states (open → under_procedure → closed); cancelled is the terminal abort.
type CaseStatus string

const (
	CaseStatusIntake         CaseStatus = "intake"
	CaseStatusPhase1         CaseStatus = "phase1"
	CaseStatusPhase2         CaseStatus = "phase2"
	CaseStatusOpen           CaseStatus = "open"
	CaseStatusUnderProcedure CaseStatus = "under_procedure"
	CaseStatusClosed         CaseStatus = "closed"
	CaseStatusCancelled      CaseStatus = "cancelled"
)

// Valid reports whether the status is a known FSM state.
func (s CaseStatus) Valid() bool {
	switch s {
	case CaseStatusIntake, CaseStatusPhase1, CaseStatusPhase2, CaseStatusOpen,
		CaseStatusUnderProcedure, CaseStatusClosed, CaseStatusCancelled:
		return true
	default:
		return false
	}
}

// LegalCase is the first-class litigation aggregate (CAP-032..051). It is a
// distinct, fully-featured root — NOT a thin projection over Matter — designed as
// a clean base table that Phase 3 plaintiff/defendant flows extend (pleadings,
// judgments and expert tables FK back to legal_cases; rows hang off
// legal_case_parties / legal_case_hearings).
//
// request_id is the optional back-link to the legal_requests spine (the request
// that spawned this case). classification_id is a loose uuid reference to
// legal_case_classifications (no hard FK) so the classification taxonomy can ship
// independently. workflow_instance_id links the Phase-1 directive approval chain
// run through the shared ApprovalOrchestrator.
type LegalCase struct {
	ID                 uuid.UUID           `json:"id"`
	TenantID           uuid.UUID           `json:"tenant_id"`
	CaseNumber         string              `json:"case_number"`
	CourtNumber        *string             `json:"court_number,omitempty"`
	CaseType           string              `json:"case_type"`
	OtherCaseType      *string             `json:"other_case_type,omitempty"`
	ClassificationID   *uuid.UUID          `json:"classification_id,omitempty"`
	CourtID            *uuid.UUID          `json:"court_id,omitempty"`
	Court              *LegalCourt         `json:"court,omitempty"`
	ContractID         *uuid.UUID          `json:"contract_id,omitempty"`
	CompanyStatus      CaseCompanyStatus   `json:"company_status"`
	CompetentCourt     *string             `json:"competent_court,omitempty"`
	Chamber            *string             `json:"chamber,omitempty"`
	FilingDate         *time.Time          `json:"filing_date,omitempty"`
	Title              forms.LocalizedText `json:"title"`
	Description        string              `json:"description"`
	Strength           *CaseStrength       `json:"strength,omitempty"`
	ClaimAmount        *float64            `json:"claim_amount,omitempty"`
	CourtFees          *float64            `json:"court_fees,omitempty"`
	LegalFees          *float64            `json:"legal_fees,omitempty"`
	Currency           *string             `json:"currency,omitempty"`
	ExpectedResolution *time.Time          `json:"expected_resolution_date,omitempty"`

	// Graded litigation-risk assessment (Othaim PRD 8.2). RiskRating is the
	// first-class band (low/medium/high/critical), nullable until the case is
	// assessed. RiskLikelihood/RiskImpact are the optional 1–5 matrix inputs the
	// band can be derived from; RiskExposure* carry an optional monetary exposure;
	// RiskRationale/RiskAssessedBy/RiskAssessedAt record the assessment provenance.
	RiskRating           *RiskLevel `json:"risk_rating,omitempty"`
	RiskLikelihood       *int       `json:"risk_likelihood,omitempty"`
	RiskImpact           *int       `json:"risk_impact,omitempty"`
	RiskExposureValue    *float64   `json:"risk_exposure_value,omitempty"`
	RiskExposureCurrency *string    `json:"risk_exposure_currency,omitempty"`
	RiskRationale        *string    `json:"risk_rationale,omitempty"`
	RiskAssessedBy       *uuid.UUID `json:"risk_assessed_by,omitempty"`
	RiskAssessedAt       *time.Time `json:"risk_assessed_at,omitempty"`

	Status                       CaseStatus     `json:"status"`
	Priority                     LegalPriority  `json:"priority"`
	SectionManagerID             *uuid.UUID     `json:"section_manager_id,omitempty"`
	SupervisorID                 *uuid.UUID     `json:"supervisor_id,omitempty"`
	HandlingOfficerID            *uuid.UUID     `json:"handling_officer_id,omitempty"`
	ResponsibleLawyer            *string        `json:"responsible_lawyer,omitempty"`
	Department                   *string        `json:"department,omitempty"`
	RequestID                    *uuid.UUID     `json:"request_id,omitempty"`
	WorkflowInstanceID           *uuid.UUID     `json:"workflow_instance_id,omitempty"`
	Metadata                     map[string]any `json:"metadata"`
	CreatedBy                    uuid.UUID      `json:"created_by"`
	CreatedAt                    time.Time      `json:"created_at"`
	UpdatedAt                    time.Time      `json:"updated_at"`
	DeletedAt                    *time.Time     `json:"deleted_at,omitempty"`
	LateJustification            *string        `json:"late_justification,omitempty"`
	LateJustificationSubmittedBy *uuid.UUID     `json:"late_justification_submitted_by,omitempty"`
	LateJustificationSubmittedAt *time.Time     `json:"late_justification_submitted_at,omitempty"`
	LateJustificationManagerRole *string        `json:"late_justification_manager_role,omitempty"`

	// Child aggregates, hydrated on Get when requested.
	Parties  []CaseParty   `json:"parties,omitempty"`
	Hearings []CaseHearing `json:"hearings,omitempty"`
	Tasks    []CaseTask    `json:"tasks,omitempty"`
}

// CaseMilestoneType identifies the source-domain represented on a case timeline.
type CaseMilestoneType string

const (
	CaseMilestoneTypeFiling     CaseMilestoneType = "filing"
	CaseMilestoneTypeHearing    CaseMilestoneType = "hearing"
	CaseMilestoneTypeSubmission CaseMilestoneType = "submission"
	CaseMilestoneTypeDecision   CaseMilestoneType = "decision"
	CaseMilestoneTypeDeadline   CaseMilestoneType = "deadline"
	CaseMilestoneTypeCustom     CaseMilestoneType = "custom"
)

func (t CaseMilestoneType) Valid() bool {
	switch t {
	case CaseMilestoneTypeFiling, CaseMilestoneTypeHearing, CaseMilestoneTypeSubmission,
		CaseMilestoneTypeDecision, CaseMilestoneTypeDeadline, CaseMilestoneTypeCustom:
		return true
	default:
		return false
	}
}

// CaseMilestoneStatus is the user-managed lifecycle of a persisted milestone.
type CaseMilestoneStatus string

const (
	CaseMilestoneStatusPlanned   CaseMilestoneStatus = "planned"
	CaseMilestoneStatusCompleted CaseMilestoneStatus = "completed"
	CaseMilestoneStatusCancelled CaseMilestoneStatus = "cancelled"
)

func (s CaseMilestoneStatus) Valid() bool {
	switch s {
	case CaseMilestoneStatusPlanned, CaseMilestoneStatusCompleted, CaseMilestoneStatusCancelled:
		return true
	default:
		return false
	}
}

// CaseMilestone is a persisted, tenant-isolated user-created timeline item.
// Automatic timeline entries continue to be projected from their source tables;
// Source/SourceReference make a milestone traceable without duplicating those rows.
type CaseMilestone struct {
	ID              uuid.UUID           `json:"id"`
	TenantID        uuid.UUID           `json:"tenant_id"`
	CaseID          uuid.UUID           `json:"case_id"`
	Title           string              `json:"title"`
	Description     string              `json:"description"`
	MilestoneType   CaseMilestoneType   `json:"milestone_type"`
	Status          CaseMilestoneStatus `json:"status"`
	MilestoneDate   time.Time           `json:"milestone_date"`
	CompletedAt     *time.Time          `json:"completed_at,omitempty"`
	OwnerID         *uuid.UUID          `json:"owner_id,omitempty"`
	Source          string              `json:"source"`
	SourceReference *string             `json:"source_reference,omitempty"`
	Metadata        map[string]any      `json:"metadata"`
	CreatedBy       uuid.UUID           `json:"created_by"`
	UpdatedBy       *uuid.UUID          `json:"updated_by,omitempty"`
	CreatedAt       time.Time           `json:"created_at"`
	UpdatedAt       time.Time           `json:"updated_at"`
	DeletedAt       *time.Time          `json:"deleted_at,omitempty"`
}

// LegalCaseListFilters carries the (already-validated) query parameters for the
// case list/search endpoint.
type LegalCaseListFilters struct {
	Page                      int
	PerPage                   int
	Search                    string
	Status                    *CaseStatus
	Statuses                  []CaseStatus
	CompanyStatus             *CaseCompanyStatus
	Strength                  *CaseStrength
	RiskRating                *RiskLevel
	Priority                  *LegalPriority
	CaseType                  string
	CaseTypeUnassigned        bool
	ClassificationID          *uuid.UUID
	SectionManagerID          *uuid.UUID
	SupervisorID              *uuid.UUID
	HandlingOfficerID         *uuid.UUID
	HandlingOfficerUnassigned bool
	Department                string
	RequestID                 *uuid.UUID
	ExpectedResolutionFrom    *time.Time
	ExpectedResolutionTo      *time.Time
	SortColumn                string
	SortDirection             string

	// ExpandParties / ExpandHearings are opt-in hydration flags driven by the
	// `expand` query param on the list endpoint (e.g. expand=parties,hearings).
	// When false the list row carries only the scalar case fields + the cheap
	// summary aggregates (no per-row parties/hearings fan-out, no N+1). When set,
	// ListWithSummary hydrates the corresponding child slice on each returned row
	// using the same repository path Get uses, so Entity-360 / the Legal Calendar
	// can read real party/hearing data inline.
	ExpandParties  bool
	ExpandHearings bool
}

// LegalCaseAuditEntry is one append-only governance audit row (CAP-051): every
// case-data mutation and management action records who did what, when, and an
// optional before/after detail payload. Immutable: there is no update/delete path.
type LegalCaseAuditEntry struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	CaseID      uuid.UUID      `json:"case_id"`
	Action      string         `json:"action"`
	FromStatus  *string        `json:"from_status,omitempty"`
	ToStatus    *string        `json:"to_status,omitempty"`
	Detail      map[string]any `json:"detail"`
	ActorUserID uuid.UUID      `json:"actor_user_id"`
	CreatedAt   time.Time      `json:"created_at"`
}

// LegalCaseVersion is one immutable snapshot of the case aggregate, appended on
// each material mutation (CAP-051). Version numbers are monotonic per case.
type LegalCaseVersion struct {
	ID           uuid.UUID      `json:"id"`
	TenantID     uuid.UUID      `json:"tenant_id"`
	CaseID       uuid.UUID      `json:"case_id"`
	Version      int            `json:"version"`
	Snapshot     map[string]any `json:"snapshot"`
	ChangeReason string         `json:"change_reason"`
	CreatedBy    *uuid.UUID     `json:"created_by,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
}
