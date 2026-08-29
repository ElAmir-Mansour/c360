package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// ============================================================================
// Plaintiff — Pleadings (CAP-052..055)
// ============================================================================

// CreatePleadingRequest creates a plaintiff pleading on a case (CAP-053). When
// GenerateBody is true and body is empty, the service drafts the statement-of-claim
// body via the AID drafting engine (CAP-052).
type CreatePleadingRequest struct {
	Type             model.PleadingType      `json:"type"`
	Direction        model.PleadingDirection `json:"direction"`
	Title            string                  `json:"title"`
	Body             string                  `json:"body"`
	Recipient        *string                 `json:"recipient,omitempty"`
	CourtReference   *string                 `json:"court_reference,omitempty"`
	ResponseDeadline *time.Time              `json:"response_deadline,omitempty"`
	ResponseOwnerID  *uuid.UUID              `json:"response_owner_id,omitempty"`
	GenerateBody     bool                    `json:"generate_body"`
	Language         string                  `json:"language"`
	DraftPrompt      string                  `json:"draft_prompt"`
	Metadata         map[string]any          `json:"metadata"`
}

func (r *CreatePleadingRequest) Normalize() {
	r.Type = model.PleadingType(strings.ToLower(strings.TrimSpace(string(r.Type))))
	if r.Type == "" {
		r.Type = model.PleadingTypeStatementOfClaim
	}
	r.Direction = model.PleadingDirection(strings.ToLower(strings.TrimSpace(string(r.Direction))))
	if r.Direction == "" {
		r.Direction = model.PleadingDirectionOutgoing
	}
	r.Title = strings.TrimSpace(r.Title)
	r.Body = strings.TrimSpace(r.Body)
	r.Recipient = normalizeLitigationOptional(r.Recipient)
	r.CourtReference = normalizeLitigationOptional(r.CourtReference)
	r.Language = strings.ToLower(strings.TrimSpace(r.Language))
	r.DraftPrompt = strings.TrimSpace(r.DraftPrompt)
}

// GeneratePleadingRequest starts or retries the asynchronous AI body generation
// for an already-persisted draft. Keeping this separate from CreatePleadingRequest
// lets the UI save the user's filing metadata immediately, then attach/detach from
// the generation stream without risking loss of the draft.
type GeneratePleadingRequest struct {
	Language    string `json:"language"`
	DraftPrompt string `json:"draft_prompt"`
}

func (r *GeneratePleadingRequest) Normalize() {
	r.Language = strings.ToLower(strings.TrimSpace(r.Language))
	if r.Language == "" {
		r.Language = "ar"
	}
	r.DraftPrompt = strings.TrimSpace(r.DraftPrompt)
}

// UpdatePleadingRequest edits a draft pleading and appends a new version (CAP-054).
type UpdatePleadingRequest struct {
	Type             *model.PleadingType      `json:"type"`
	Direction        *model.PleadingDirection `json:"direction"`
	Title            *string                  `json:"title"`
	Body             *string                  `json:"body"`
	Recipient        *string                  `json:"recipient"`
	CourtReference   *string                  `json:"court_reference"`
	ResponseDeadline *time.Time               `json:"response_deadline"`
	ResponseOwnerID  *uuid.UUID               `json:"response_owner_id"`
	ChangeReason     string                   `json:"change_reason"`
	Metadata         map[string]any           `json:"metadata"`
}

func (r *UpdatePleadingRequest) Normalize() {
	if r.Title != nil {
		trimmed := strings.TrimSpace(*r.Title)
		r.Title = &trimmed
	}
	if r.Body != nil {
		trimmed := strings.TrimSpace(*r.Body)
		r.Body = &trimmed
	}
	if r.Type != nil {
		value := model.PleadingType(strings.ToLower(strings.TrimSpace(string(*r.Type))))
		r.Type = &value
	}
	if r.Direction != nil {
		value := model.PleadingDirection(strings.ToLower(strings.TrimSpace(string(*r.Direction))))
		r.Direction = &value
	}
	r.Recipient = normalizeLitigationOptional(r.Recipient)
	r.CourtReference = normalizeLitigationOptional(r.CourtReference)
	r.ChangeReason = strings.TrimSpace(r.ChangeReason)
}

func normalizeLitigationOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

// AddPleadingAttachmentRequest links a Files-service object to a pleading (CAP-053).
type AddPleadingAttachmentRequest struct {
	FileID   *uuid.UUID `json:"file_id"`
	FileName string     `json:"file_name"`
	Caption  string     `json:"caption"`
}

func (r *AddPleadingAttachmentRequest) Normalize() {
	r.FileName = strings.TrimSpace(r.FileName)
	r.Caption = strings.TrimSpace(r.Caption)
}

// FilePleadingRequest marks an approved pleading as filed with the court.
type FilePleadingRequest struct {
	FiledAt *time.Time `json:"filed_at"`
	Note    string     `json:"note"`
}

func (r *FilePleadingRequest) Normalize() { r.Note = strings.TrimSpace(r.Note) }

// ============================================================================
// Hearings — reports / minutes (CAP-056..059)
// ============================================================================

// CreateHearingReportRequest records a hearing report / minutes (ضبط الجلسة) /
// decision on a case hearing (CAP-056..059).
type CreateHearingReportRequest struct {
	Type       model.HearingReportType `json:"type"`
	Title      string                  `json:"title"`
	Body       string                  `json:"body"`
	Decision   string                  `json:"decision"`
	RecordedAt *time.Time              `json:"recorded_at"`
	FileID     *uuid.UUID              `json:"file_id"`
	Metadata   map[string]any          `json:"metadata"`
}

func (r *CreateHearingReportRequest) Normalize() {
	r.Type = model.HearingReportType(strings.ToLower(strings.TrimSpace(string(r.Type))))
	if r.Type == "" {
		r.Type = model.HearingReportTypeMinutes
	}
	r.Title = strings.TrimSpace(r.Title)
	r.Body = strings.TrimSpace(r.Body)
	r.Decision = strings.TrimSpace(r.Decision)
}

// UpdateHearingReportRequest edits a hearing report.
type UpdateHearingReportRequest struct {
	Type     *model.HearingReportType `json:"type"`
	Title    *string                  `json:"title"`
	Body     *string                  `json:"body"`
	Decision *string                  `json:"decision"`
	FileID   *uuid.UUID               `json:"file_id"`
	Metadata map[string]any           `json:"metadata"`
}

// ============================================================================
// Experts (CAP-060..062)
// ============================================================================

// CreateExpertAssignmentRequest appoints a court expert on a case (ندب خبير).
type CreateExpertAssignmentRequest struct {
	ExpertName     string         `json:"expert_name"`
	Specialization string         `json:"specialization"`
	ContactInfo    *string        `json:"contact_info"`
	Mandate        string         `json:"mandate"`
	ReportDueDate  *time.Time     `json:"report_due_date"`
	Metadata       map[string]any `json:"metadata"`
}

func (r *CreateExpertAssignmentRequest) Normalize() {
	r.ExpertName = strings.TrimSpace(r.ExpertName)
	r.Specialization = strings.TrimSpace(r.Specialization)
	r.Mandate = strings.TrimSpace(r.Mandate)
}

// UpdateExpertAssignmentRequest edits / advances an expert assignment (CAP-061).
type UpdateExpertAssignmentRequest struct {
	ExpertName       *string                       `json:"expert_name"`
	Specialization   *string                       `json:"specialization"`
	ContactInfo      *string                       `json:"contact_info"`
	Mandate          *string                       `json:"mandate"`
	Status           *model.ExpertAssignmentStatus `json:"status"`
	AppointedAt      *time.Time                    `json:"appointed_at"`
	ReportDueDate    *time.Time                    `json:"report_due_date"`
	ReportReceivedAt *time.Time                    `json:"report_received_at"`
	Metadata         map[string]any                `json:"metadata"`
}

// AddExpertDocumentRequest furnishes a Files-service object to an expert (CAP-062).
type AddExpertDocumentRequest struct {
	FileID   *uuid.UUID `json:"file_id"`
	FileName string     `json:"file_name"`
	Caption  string     `json:"caption"`
}

func (r *AddExpertDocumentRequest) Normalize() {
	r.FileName = strings.TrimSpace(r.FileName)
	r.Caption = strings.TrimSpace(r.Caption)
}

// ============================================================================
// Judgments (CAP-063..066)
// ============================================================================

// CreateJudgmentRequest records a court judgment on a case (CAP-063).
type CreateJudgmentRequest struct {
	JudgmentRef          string                     `json:"judgment_ref"`
	JudgmentDate         *time.Time                 `json:"judgment_date"`
	DecisionType         model.JudgmentDecisionType `json:"decision_type"`
	Impact               *model.JudgmentImpact      `json:"impact,omitempty"`
	JudgeName            *string                    `json:"judge_name,omitempty"`
	CourtName            *string                    `json:"court_name,omitempty"`
	Outcome              *model.JudgmentOutcome     `json:"outcome"`
	Summary              string                     `json:"summary"`
	Implications         string                     `json:"implications"`
	FileID               *uuid.UUID                 `json:"file_id"`
	DocumentReference    *string                    `json:"document_reference,omitempty"`
	NextExpectedRulingAt *time.Time                 `json:"next_expected_ruling_at,omitempty"`
	NextExpectedRuling   *string                    `json:"next_expected_ruling,omitempty"`
	Metadata             map[string]any             `json:"metadata"`
}

func (r *CreateJudgmentRequest) Normalize() {
	r.JudgmentRef = strings.TrimSpace(r.JudgmentRef)
	r.DecisionType = model.JudgmentDecisionType(strings.ToLower(strings.TrimSpace(string(r.DecisionType))))
	if r.DecisionType == "" {
		r.DecisionType = model.JudgmentDecisionTypeOther
	}
	r.Summary = strings.TrimSpace(r.Summary)
	r.Implications = strings.TrimSpace(r.Implications)
	r.JudgeName = normalizeLitigationOptional(r.JudgeName)
	r.CourtName = normalizeLitigationOptional(r.CourtName)
	r.DocumentReference = normalizeLitigationOptional(r.DocumentReference)
	r.NextExpectedRuling = normalizeLitigationOptional(r.NextExpectedRuling)
}

// StudyJudgmentRequest records the study + objection/non-objection recommendation
// (CAP-064..066). When the recommendation is "object", objection_deadline is required
// and the service creates a linked legal_obligation so the existing reminder outbox
// fires the deadline (no new timer).
type StudyJudgmentRequest struct {
	StudyNotes           string                       `json:"study_notes"`
	Recommendation       model.JudgmentRecommendation `json:"recommendation"`
	ObjectionDeadline    *time.Time                   `json:"objection_deadline"`
	OwnerUserID          *uuid.UUID                   `json:"owner_user_id"`
	OwnerName            string                       `json:"owner_name"`
	Metadata             map[string]any               `json:"metadata"`
	Implications         *string                      `json:"implications,omitempty"`
	NextExpectedRulingAt *time.Time                   `json:"next_expected_ruling_at,omitempty"`
	NextExpectedRuling   *string                      `json:"next_expected_ruling,omitempty"`
}

func (r *StudyJudgmentRequest) Normalize() {
	r.StudyNotes = strings.TrimSpace(r.StudyNotes)
	r.Recommendation = model.JudgmentRecommendation(strings.ToLower(strings.TrimSpace(string(r.Recommendation))))
	r.OwnerName = strings.TrimSpace(r.OwnerName)
	if r.Implications != nil {
		value := strings.TrimSpace(*r.Implications)
		r.Implications = &value
	}
	r.NextExpectedRuling = normalizeLitigationOptional(r.NextExpectedRuling)
}

// ============================================================================
// Defendant flows (CAP-067..073)
// ============================================================================

// RegisterDefendantCaseRequest registers an incoming lawsuit against the company
// (CAP-067/068).
type RegisterDefendantCaseRequest struct {
	PlaintiffName    string         `json:"plaintiff_name"`
	CourtName        *string        `json:"court_name"`
	NotificationDate *time.Time     `json:"notification_date"`
	Metadata         map[string]any `json:"metadata"`
}

func (r *RegisterDefendantCaseRequest) Normalize() {
	r.PlaintiffName = strings.TrimSpace(r.PlaintiffName)
}

// UpdateDefendantCaseRequest edits the registration fields of a defendant case.
type UpdateDefendantCaseRequest struct {
	PlaintiffName    *string        `json:"plaintiff_name"`
	CourtName        *string        `json:"court_name"`
	NotificationDate *time.Time     `json:"notification_date"`
	Metadata         map[string]any `json:"metadata"`
}

// SetNajizRepresentativeRequest records the Najiz (ناجز) company representative —
// manual entry; real Najiz API deferred (CAP-069/175).
type SetNajizRepresentativeRequest struct {
	CompanyRepresentative string                `json:"company_representative"`
	NajizStatus           model.NajizSyncStatus `json:"najiz_status"`
	NajizReference        *string               `json:"najiz_reference"`
}

func (r *SetNajizRepresentativeRequest) Normalize() {
	r.CompanyRepresentative = strings.TrimSpace(r.CompanyRepresentative)
	r.NajizStatus = model.NajizSyncStatus(strings.ToLower(strings.TrimSpace(string(r.NajizStatus))))
	if r.NajizStatus == "" {
		r.NajizStatus = model.NajizSyncStatusManual
	}
}

// AddDefendantAttachmentRequest uploads the served statement of claim / supporting
// documents to a defendant case (CAP-070).
type AddDefendantAttachmentRequest struct {
	FileID   *uuid.UUID `json:"file_id"`
	FileName string     `json:"file_name"`
	Caption  string     `json:"caption"`
	Kind     string     `json:"kind"`
}

func (r *AddDefendantAttachmentRequest) Normalize() {
	r.FileName = strings.TrimSpace(r.FileName)
	r.Caption = strings.TrimSpace(r.Caption)
	r.Kind = strings.ToLower(strings.TrimSpace(r.Kind))
	if r.Kind == "" {
		r.Kind = "statement_of_claim"
	}
}

// NotifyDepartmentRequest notifies the concerned department of an incoming lawsuit
// (CAP-071).
type NotifyDepartmentRequest struct {
	ConcernedDepartment string         `json:"concerned_department"`
	Note                string         `json:"note"`
	Metadata            map[string]any `json:"metadata"`
}

func (r *NotifyDepartmentRequest) Normalize() {
	r.ConcernedDepartment = strings.TrimSpace(r.ConcernedDepartment)
	r.Note = strings.TrimSpace(r.Note)
}

// DraftResponseMemoRequest drafts the first-response memo (مذكرة الرد الأولى,
// CAP-072). When GenerateBody is true and body is empty, the service drafts via the
// AID drafting engine.
type DraftResponseMemoRequest struct {
	Body         string `json:"body"`
	GenerateBody bool   `json:"generate_body"`
	Language     string `json:"language"`
	DraftPrompt  string `json:"draft_prompt"`
}

func (r *DraftResponseMemoRequest) Normalize() {
	r.Body = strings.TrimSpace(r.Body)
	r.Language = strings.ToLower(strings.TrimSpace(r.Language))
	r.DraftPrompt = strings.TrimSpace(r.DraftPrompt)
}

// StartResponseReviewRequest opens the two-tier supervisor→section_manager review
// of the first-response memo (CAP-073). When approver ids are omitted the service
// falls back to the role-addressed tiers ("supervisor" then "section_manager").
type StartResponseReviewRequest struct {
	SupervisorID     *uuid.UUID `json:"supervisor_id"`
	SectionManagerID *uuid.UUID `json:"section_manager_id"`
}
