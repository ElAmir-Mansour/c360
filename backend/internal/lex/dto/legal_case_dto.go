package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// CreateLegalCaseRequest is the payload for creating a first-class litigation
// case (CAP-032, CAP-042..050). case_number is auto-generated when omitted.
type CreateLegalCaseRequest struct {
	CaseNumber         *string                 `json:"case_number,omitempty"`
	CourtNumber        *string                 `json:"court_number,omitempty"`
	CaseType           string                  `json:"case_type"`
	OtherCaseType      *string                 `json:"other_case_type,omitempty"`
	ClassificationID   *uuid.UUID              `json:"classification_id,omitempty"`
	CourtID            *uuid.UUID              `json:"court_id,omitempty"`
	ContractID         *uuid.UUID              `json:"contract_id,omitempty"`
	CompanyStatus      model.CaseCompanyStatus `json:"company_status"`
	CompetentCourt     *string                 `json:"competent_court,omitempty"`
	Chamber            *string                 `json:"chamber,omitempty"`
	FilingDate         *time.Time              `json:"filing_date,omitempty"`
	Title              forms.LocalizedText     `json:"title"`
	Description        string                  `json:"description"`
	Strength           *model.CaseStrength     `json:"strength,omitempty"`
	ClaimAmount        *float64                `json:"claim_amount,omitempty"`
	CourtFees          *float64                `json:"court_fees,omitempty"`
	LegalFees          *float64                `json:"legal_fees,omitempty"`
	Currency           *string                 `json:"currency,omitempty"`
	ExpectedResolution *time.Time              `json:"expected_resolution_date,omitempty"`
	Status             model.CaseStatus        `json:"status"`
	Priority           model.LegalPriority     `json:"priority"`
	SectionManagerID   *uuid.UUID              `json:"section_manager_id,omitempty"`
	SupervisorID       *uuid.UUID              `json:"supervisor_id,omitempty"`
	HandlingOfficerID  *uuid.UUID              `json:"handling_officer_id,omitempty"`
	ResponsibleLawyer  *string                 `json:"responsible_lawyer,omitempty"`
	Department         *string                 `json:"department,omitempty"`
	RequestID          *uuid.UUID              `json:"request_id,omitempty"`
	Metadata           map[string]any          `json:"metadata"`
}

// UpdateLegalCaseRequest is the partial-update payload for case data (CAP-042..050).
type UpdateLegalCaseRequest struct {
	CaseNumber         *string                  `json:"case_number,omitempty"`
	CourtNumber        *string                  `json:"court_number,omitempty"`
	CaseType           *string                  `json:"case_type,omitempty"`
	OtherCaseType      *string                  `json:"other_case_type,omitempty"`
	ClassificationID   *uuid.UUID               `json:"classification_id,omitempty"`
	CourtID            *uuid.UUID               `json:"court_id,omitempty"`
	ContractID         *uuid.UUID               `json:"contract_id,omitempty"`
	RequestID          *uuid.UUID               `json:"request_id,omitempty"`
	CompanyStatus      *model.CaseCompanyStatus `json:"company_status,omitempty"`
	CompetentCourt     *string                  `json:"competent_court,omitempty"`
	Chamber            *string                  `json:"chamber,omitempty"`
	FilingDate         *time.Time               `json:"filing_date,omitempty"`
	Title              *forms.LocalizedText     `json:"title,omitempty"`
	Description        *string                  `json:"description,omitempty"`
	Strength           *model.CaseStrength      `json:"strength,omitempty"`
	ClaimAmount        *float64                 `json:"claim_amount,omitempty"`
	CourtFees          *float64                 `json:"court_fees,omitempty"`
	LegalFees          *float64                 `json:"legal_fees,omitempty"`
	Currency           *string                  `json:"currency,omitempty"`
	ExpectedResolution *time.Time               `json:"expected_resolution_date,omitempty"`
	ResponsibleLawyer  *string                  `json:"responsible_lawyer,omitempty"`
	Department         *string                  `json:"department,omitempty"`
	// Status and Priority are accepted here (mirroring CreateLegalCaseRequest) so the
	// edit form — which posts the full case shape — is not rejected by the strict
	// DisallowUnknownFields decoder. A guarded FSM transition with automation still
	// runs through the dedicated /status endpoint; this is a direct set, as on create.
	Status        *model.CaseStatus    `json:"status,omitempty"`
	Priority      *model.LegalPriority `json:"priority,omitempty"`
	Metadata      map[string]any       `json:"metadata,omitempty"`
	ClearedFields []string             `json:"cleared_fields,omitempty"`
}

func (r *UpdateLegalCaseRequest) ShouldClear(field string) bool {
	for _, candidate := range r.ClearedFields {
		if candidate == field {
			return true
		}
	}
	return false
}

// UpdateCaseStatusRequest drives the case FSM (CAP-051).
//
// Category is only consulted when Status == on_hold (the Round-2 delayed/hold
// FSM state, CAP-088): the service requires a valid DelayCategory
// (court|government|department|expert) plus a non-empty Reason to enter on_hold,
// and ignores Category for every other transition.
type UpdateCaseStatusRequest struct {
	Status            model.CaseStatus     `json:"status"`
	Reason            string               `json:"reason"`
	Category          *model.DelayCategory `json:"category,omitempty"`
	LateJustification *string              `json:"late_justification,omitempty"`
}

// SetCaseStrengthRequest records the litigation-strength assessment (CAP-034).
type SetCaseStrengthRequest struct {
	Strength model.CaseStrength `json:"strength"`
	Reason   string             `json:"reason"`
}

// SetCaseRiskRatingRequest records the graded litigation-risk rating (Othaim
// PRD 8.2). Either Rating is supplied directly, or both Likelihood and Impact
// (each 1–5) are supplied so the band can be derived from the risk matrix; an
// explicit Rating always wins over a derivation. ExposureValue/ExposureCurrency
// carry an optional monetary exposure figure, and Reason is the governance
// rationale recorded on the case and its audit trail.
type SetCaseRiskRatingRequest struct {
	Rating           *model.RiskLevel `json:"rating,omitempty"`
	Likelihood       *int             `json:"likelihood,omitempty"`
	Impact           *int             `json:"impact,omitempty"`
	ExposureValue    *float64         `json:"exposure_value,omitempty"`
	ExposureCurrency *string          `json:"exposure_currency,omitempty"`
	Reason           string           `json:"reason"`
}

// SetCasePriorityRequest sets the case priority (CAP-041).
type SetCasePriorityRequest struct {
	Priority model.LegalPriority `json:"priority"`
	Reason   string              `json:"reason"`
}

// TransferToSectionManagerRequest reassigns the owning section manager (CAP-037).
type TransferToSectionManagerRequest struct {
	SectionManagerID uuid.UUID `json:"section_manager_id"`
	Reason           string    `json:"reason"`
}

// AssignSupervisorRequest assigns the case supervisor (CAP-038).
type AssignSupervisorRequest struct {
	SupervisorID uuid.UUID `json:"supervisor_id"`
	Reason       string    `json:"reason"`
}

// AssignOfficerRequest assigns the handling officer (CAP-039).
type AssignOfficerRequest struct {
	HandlingOfficerID uuid.UUID `json:"handling_officer_id"`
	Reason            string    `json:"reason"`
}

// CreateCasePartyRequest adds a party to a case (CAP-043).
type CreateCasePartyRequest struct {
	Role       model.CasePartyRole `json:"role"`
	Name       string              `json:"name"`
	Identifier *string             `json:"identifier,omitempty"`
	Contact    *string             `json:"contact,omitempty"`
	Metadata   map[string]any      `json:"metadata"`
}

// UpdateCasePartyRequest is the partial-update payload for a party (CAP-043).
type UpdateCasePartyRequest struct {
	Role       *model.CasePartyRole `json:"role,omitempty"`
	Name       *string              `json:"name,omitempty"`
	Identifier *string              `json:"identifier,omitempty"`
	Contact    *string              `json:"contact,omitempty"`
	Metadata   map[string]any       `json:"metadata,omitempty"`
}

// CreateCaseHearingRequest schedules/records a hearing (CAP-044).
type CreateCaseHearingRequest struct {
	HearingDate time.Time      `json:"hearing_date"`
	Location    *string        `json:"location,omitempty"`
	Notes       string         `json:"notes"`
	Decision    *string        `json:"decision,omitempty"`
	Metadata    map[string]any `json:"metadata"`
}

// UpdateCaseHearingRequest is the partial-update payload for a hearing (CAP-044).
type UpdateCaseHearingRequest struct {
	HearingDate *time.Time     `json:"hearing_date,omitempty"`
	Location    *string        `json:"location,omitempty"`
	Notes       *string        `json:"notes,omitempty"`
	Decision    *string        `json:"decision,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

// CreateCaseTaskRequest defines a task against a case (CAP-040).
type CreateCaseTaskRequest struct {
	Title      string               `json:"title"`
	AssigneeID *uuid.UUID           `json:"assignee_id,omitempty"`
	Priority   model.LegalPriority  `json:"priority"`
	Status     model.CaseTaskStatus `json:"status"`
	DueDate    *time.Time           `json:"due_date,omitempty"`
	Metadata   map[string]any       `json:"metadata"`
}

// UpdateCaseTaskRequest is the partial-update payload for a task (CAP-040).
type UpdateCaseTaskRequest struct {
	Title      *string               `json:"title,omitempty"`
	AssigneeID *uuid.UUID            `json:"assignee_id,omitempty"`
	Priority   *model.LegalPriority  `json:"priority,omitempty"`
	Status     *model.CaseTaskStatus `json:"status,omitempty"`
	DueDate    *time.Time            `json:"due_date,omitempty"`
	Metadata   map[string]any        `json:"metadata,omitempty"`
}

// CreateCaseMilestoneRequest persists a user-created case timeline milestone.
type CreateCaseMilestoneRequest struct {
	Title           string                    `json:"title"`
	Description     string                    `json:"description"`
	MilestoneType   model.CaseMilestoneType   `json:"milestone_type"`
	Status          model.CaseMilestoneStatus `json:"status"`
	MilestoneDate   time.Time                 `json:"milestone_date"`
	CompletedAt     *time.Time                `json:"completed_at,omitempty"`
	OwnerID         *uuid.UUID                `json:"owner_id,omitempty"`
	Source          string                    `json:"source"`
	SourceReference *string                   `json:"source_reference,omitempty"`
	Metadata        map[string]any            `json:"metadata"`
}

func (r *CreateCaseMilestoneRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.MilestoneType = model.CaseMilestoneType(strings.ToLower(strings.TrimSpace(string(r.MilestoneType))))
	if r.MilestoneType == "" {
		r.MilestoneType = model.CaseMilestoneTypeCustom
	}
	r.Status = model.CaseMilestoneStatus(strings.ToLower(strings.TrimSpace(string(r.Status))))
	if r.Status == "" {
		r.Status = model.CaseMilestoneStatusPlanned
	}
	r.Source = strings.TrimSpace(r.Source)
	if r.Source == "" {
		r.Source = "manual"
	}
	if r.SourceReference != nil {
		value := strings.TrimSpace(*r.SourceReference)
		r.SourceReference = &value
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

// UpdateCaseMilestoneRequest patches a persisted milestone.
type UpdateCaseMilestoneRequest struct {
	Title           *string                    `json:"title,omitempty"`
	Description     *string                    `json:"description,omitempty"`
	MilestoneType   *model.CaseMilestoneType   `json:"milestone_type,omitempty"`
	Status          *model.CaseMilestoneStatus `json:"status,omitempty"`
	MilestoneDate   *time.Time                 `json:"milestone_date,omitempty"`
	CompletedAt     *time.Time                 `json:"completed_at,omitempty"`
	OwnerID         *uuid.UUID                 `json:"owner_id,omitempty"`
	Source          *string                    `json:"source,omitempty"`
	SourceReference *string                    `json:"source_reference,omitempty"`
	Metadata        map[string]any             `json:"metadata,omitempty"`
}

// CreateCaseCommentRequest creates a collaboration note on a case. Mentions are
// user IDs OR display handles referenced by the note body or client-side mention
// picker — matching the sibling matter/clause comment DTOs (a bare @handle is a
// valid mention, so this is []string, not []uuid.UUID; a UUID-only type hard-400s
// on the common @handle path).
type CreateCaseCommentRequest struct {
	Body     string         `json:"body"`
	Mentions []string       `json:"mentions,omitempty"`
	Metadata map[string]any `json:"metadata"`
}

// UpdateCaseCommentRequest patches a collaboration note. Nil fields are left as-is.
type UpdateCaseCommentRequest struct {
	Body     *string        `json:"body,omitempty"`
	Mentions []string       `json:"mentions,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

// CreateCaseDocumentLinkRequest either links an existing repository document
// (document_id) or creates a new LegalDocument metadata row and links it. The
// optional Document FileReference records an already-uploaded file object/version;
// this endpoint does not accept file bytes.
type CreateCaseDocumentLinkRequest struct {
	DocumentID       *uuid.UUID                    `json:"document_id,omitempty"`
	Title            string                        `json:"title,omitempty"`
	Type             model.LegalDocumentType       `json:"type,omitempty"`
	Description      string                        `json:"description,omitempty"`
	Category         *string                       `json:"category,omitempty"`
	Confidentiality  model.DocumentConfidentiality `json:"confidentiality,omitempty"`
	Tags             []string                      `json:"tags,omitempty"`
	DocumentMetadata map[string]any                `json:"document_metadata,omitempty"`
	Document         *FileReference                `json:"document,omitempty"`
	Source           string                        `json:"source,omitempty"`
	Notes            string                        `json:"notes,omitempty"`
	EvidenceStatus   model.EvidenceStatus          `json:"evidence_status,omitempty"`
	CourtReference   *string                       `json:"court_reference,omitempty"`
	SubmittedBy      *uuid.UUID                    `json:"submitted_by,omitempty"`
	SubmittedAt      *time.Time                    `json:"submitted_at,omitempty"`
	Metadata         map[string]any                `json:"metadata,omitempty"`
}

type UpdateCaseDocumentLinkRequest struct {
	Category       *string               `json:"category,omitempty"`
	Notes          *string               `json:"notes,omitempty"`
	EvidenceStatus *model.EvidenceStatus `json:"evidence_status,omitempty"`
	CourtReference *string               `json:"court_reference,omitempty"`
	SubmittedBy    *uuid.UUID            `json:"submitted_by,omitempty"`
	SubmittedAt    *time.Time            `json:"submitted_at,omitempty"`
	Metadata       map[string]any        `json:"metadata,omitempty"`
}

// StartCaseIntakeRequest opens the Phase-1 administrative directive chain over a
// case (CAP-032, CAP-033, CAP-034): the CEO directive + DoA-to-CEO authority
// evidence references plus the case-strength assessment.
type StartCaseIntakeRequest struct {
	CEODirectiveRef    *string             `json:"ceo_directive_ref,omitempty"`
	DoAAuthorityRef    *string             `json:"doa_authority_ref,omitempty"`
	StrengthAssessment *model.CaseStrength `json:"strength_assessment,omitempty"`
	Metadata           map[string]any      `json:"metadata"`
}

// DecideCaseIntakeRequest records one approver decision on a Phase-1 directive
// task, reusing the shared WorkflowDecisionRequest shape (decision + notes +
// optional X.509 DoA authority evidence).
type DecideCaseIntakeRequest = WorkflowDecisionRequest

// HandoffCaseIntakeRequest performs the Phase-2 Legal Director → Section Manager
// handoff (CAP-035, CAP-036): task estimation + officer/supervisor assignment.
type HandoffCaseIntakeRequest struct {
	SectionManagerID  uuid.UUID  `json:"section_manager_id"`
	SupervisorID      *uuid.UUID `json:"supervisor_id,omitempty"`
	HandlingOfficerID *uuid.UUID `json:"handling_officer_id,omitempty"`
	TaskEstimate      *string    `json:"task_estimate,omitempty"`
	Reason            string     `json:"reason"`
}

func (r *CreateLegalCaseRequest) Normalize() {
	r.CaseType = strings.TrimSpace(r.CaseType)
	r.OtherCaseType = trimOptional(r.OtherCaseType)
	r.Description = strings.TrimSpace(r.Description)
	r.CourtNumber = trimOptional(r.CourtNumber)
	r.CompetentCourt = trimOptional(r.CompetentCourt)
	r.Chamber = trimOptional(r.Chamber)
	r.Currency = trimOptional(r.Currency)
	if r.Currency != nil {
		value := strings.ToUpper(*r.Currency)
		r.Currency = &value
	}
	r.ResponsibleLawyer = trimOptional(r.ResponsibleLawyer)
	r.Department = trimOptional(r.Department)
	r.CaseNumber = trimOptional(r.CaseNumber)
	if r.Status == "" {
		r.Status = model.CaseStatusIntake
	}
	if r.Priority == "" {
		r.Priority = model.LegalPriorityMedium
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *CreateCasePartyRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Identifier = trimOptional(r.Identifier)
	r.Contact = trimOptional(r.Contact)
	if r.Role == "" {
		r.Role = model.CasePartyRoleOther
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *CreateCaseHearingRequest) Normalize() {
	r.Notes = strings.TrimSpace(r.Notes)
	r.Location = trimOptional(r.Location)
	r.Decision = trimOptional(r.Decision)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *CreateCaseTaskRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	if r.Priority == "" {
		r.Priority = model.LegalPriorityMedium
	}
	if r.Status == "" {
		r.Status = model.CaseTaskStatusOpen
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *CreateCaseCommentRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
	if r.Mentions == nil {
		r.Mentions = []string{}
	}
}

func (r *UpdateCaseCommentRequest) Normalize() {
	if r.Body != nil {
		body := strings.TrimSpace(*r.Body)
		r.Body = &body
	}
}

func (r *CreateCaseDocumentLinkRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.Category = trimOptional(r.Category)
	r.Source = strings.TrimSpace(r.Source)
	r.Notes = strings.TrimSpace(r.Notes)
	r.CourtReference = trimOptional(r.CourtReference)
	r.Tags = NormalizeTags(r.Tags)
	if r.Type == "" {
		r.Type = model.DocumentTypeOther
	}
	if r.Confidentiality == "" {
		r.Confidentiality = model.DocumentConfidentialityInternal
	}
	r.EvidenceStatus = model.EvidenceStatus(strings.ToLower(strings.TrimSpace(string(r.EvidenceStatus))))
	if r.EvidenceStatus == "" {
		r.EvidenceStatus = model.EvidenceStatusPending
	}
	if r.DocumentMetadata == nil {
		r.DocumentMetadata = map[string]any{}
	}
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *StartCaseIntakeRequest) Normalize() {
	r.CEODirectiveRef = trimOptional(r.CEODirectiveRef)
	r.DoAAuthorityRef = trimOptional(r.DoAAuthorityRef)
	if r.Metadata == nil {
		r.Metadata = map[string]any{}
	}
}

func (r *HandoffCaseIntakeRequest) Normalize() {
	r.Reason = strings.TrimSpace(r.Reason)
	r.TaskEstimate = trimOptional(r.TaskEstimate)
}

// --- WS9: computed views & list aggregates ----------------------------------

// CaseComputedBlock is the read-only, frontend-facing rollup attached to a case
// detail response (WS9). It is derived state — never persisted on the case row —
// so the frontend gets the SLA/operational summary in a single GET instead of
// fanning out to the SLA-clock, hearings and tasks endpoints (kills an N+1 on the
// case detail screen).
//
//   - SLAOutcome     mirrors legal_sla_clocks.outcome (pending|on_time|breached)
//     for the case's clock, keyed on COALESCE(request_id, case id). nil when no
//     clock has been materialised yet (case never opened).
//   - DaysOpen       whole days the case has been running, measured from the SLA
//     clock start (preferred) else the case creation time, up to the clock's
//     resolved_at when set, else now. nil before the clock starts AND when the
//     case has no creation time.
//   - NextHearingDate the earliest upcoming (>= now) hearing date, nil when none.
//   - EscalationLevel the case SLA clock's current escalation rung (0..3); 0 when
//     no clock exists.
//   - OpenTaskCount   number of case tasks not in a terminal state (done|cancelled).
type CaseComputedBlock struct {
	SLAOutcome       *string    `json:"sla_outcome"`
	SLATurnaroundDue *time.Time `json:"sla_turnaround_due_at"`
	DaysOpen         *int       `json:"days_open"`
	NextHearingDate  *time.Time `json:"next_hearing_date"`
	EscalationLevel  int        `json:"escalation_level"`
	OpenTaskCount    int        `json:"open_task_count"`
}

// LegalCaseDetail is the case detail response envelope (WS9). It embeds the full
// case aggregate (so every existing field — including the hydrated parties,
// hearings and tasks — stays exactly where clients already read it) and adds the
// computed block under a new "computed" key. Embedding (not nesting) the case
// keeps the response backward-compatible: no existing field moves.
type LegalCaseDetail struct {
	*model.LegalCase
	Computed CaseComputedBlock `json:"computed"`
}

// LegalCaseListItem is one row of the case list response (WS9). It embeds the
// case row and adds the two aggregate columns the list view needs so the
// frontend stops issuing a per-row hearings/parties fetch (N+1 kill):
//
//   - NextHearingDate the earliest upcoming hearing for the case, nil when none.
//   - PartyCount       number of (non-deleted) parties on the case.
//
// Embedding keeps every existing list field in place; the aggregates are additive.
type LegalCaseListItem struct {
	model.LegalCase
	NextHearingDate  *time.Time `json:"next_hearing_date"`
	SLATurnaroundDue *time.Time `json:"sla_turnaround_due_at"`
	PartyCount       int        `json:"party_count"`
}

// BulkCreateCasePartiesRequest creates several parties on a case in one call
// (WS9). Each item reuses the single-create CreateCasePartyRequest shape so
// validation/normalisation stay identical to the per-item endpoint.
type BulkCreateCasePartiesRequest struct {
	Parties []CreateCasePartyRequest `json:"parties"`
}

// BulkCreateCaseTasksRequest defines several tasks on a case in one call (WS9).
// Each item reuses the single-create CreateCaseTaskRequest shape.
type BulkCreateCaseTasksRequest struct {
	Tasks []CreateCaseTaskRequest `json:"tasks"`
}

// trimOptional trims a *string and collapses an all-whitespace value to nil.
func trimOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
