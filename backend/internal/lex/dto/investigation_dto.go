package dto

import (
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// CreateInvestigationRequest registers a new legal investigation (CAP-077).
type CreateInvestigationRequest struct {
	InvestigationNumber *string             `json:"investigation_number,omitempty"`
	Subject             string              `json:"subject"`
	LeadInvestigator    string              `json:"lead_investigator"`
	Priority            model.LegalPriority `json:"priority"`
	CaseID              *uuid.UUID          `json:"case_id,omitempty"`
	Department          *string             `json:"department,omitempty"`
	Metadata            map[string]any      `json:"metadata,omitempty"`
}

// Normalize trims string inputs and applies defaults.
func (r *CreateInvestigationRequest) Normalize() {
	r.Subject = strings.TrimSpace(r.Subject)
	r.LeadInvestigator = strings.TrimSpace(r.LeadInvestigator)
	r.InvestigationNumber = trimOptional(r.InvestigationNumber)
	r.Department = trimOptional(r.Department)
	if strings.TrimSpace(string(r.Priority)) == "" {
		r.Priority = model.LegalPriorityMedium
	}
}

// UpdateInvestigationRequest patches mutable investigation fields (CAP-077).
type UpdateInvestigationRequest struct {
	Subject          *string              `json:"subject,omitempty"`
	LeadInvestigator *string              `json:"lead_investigator,omitempty"`
	Priority         *model.LegalPriority `json:"priority,omitempty"`
	CaseID           *uuid.UUID           `json:"case_id,omitempty"`
	Department       *string              `json:"department,omitempty"`
	Metadata         map[string]any       `json:"metadata,omitempty"`
}

// UpdateInvestigationStatusRequest transitions the investigation FSM (close/cancel/
// reopen). The results-approval transitions are NOT driven here — they flow through
// the approval-chain endpoints.
type UpdateInvestigationStatusRequest struct {
	Status            model.InvestigationStatus `json:"status"`
	Reason            string                    `json:"reason,omitempty"`
	LateJustification *string                   `json:"late_justification,omitempty"`
}

// ScheduleInvestigationReminderRequest links an obligation-backed deadline
// reminder to an investigation. The shared obligation dispatcher owns delivery.
type ScheduleInvestigationReminderRequest struct {
	Deadline time.Time `json:"deadline"`
	LeadDays []int     `json:"lead_days,omitempty"`
	Title    string    `json:"title,omitempty"`
}

func (r *ScheduleInvestigationReminderRequest) Normalize() {
	r.Deadline = r.Deadline.UTC()
	r.Title = strings.TrimSpace(r.Title)
}

// AddInvestigationPartyRequest registers a participant (CAP-078). identifier and
// contact are encrypted PII.
type AddInvestigationPartyRequest struct {
	Role       model.InvestigationPartyRole `json:"role"`
	Name       string                       `json:"name"`
	Identifier *string                      `json:"identifier,omitempty"`
	Contact    *string                      `json:"contact,omitempty"`
	Metadata   map[string]any               `json:"metadata,omitempty"`
}

// Normalize trims string inputs.
func (r *AddInvestigationPartyRequest) Normalize() {
	r.Name = strings.TrimSpace(r.Name)
	r.Identifier = trimOptional(r.Identifier)
	r.Contact = trimOptional(r.Contact)
}

// UpdateInvestigationPartyRequest patches a party row.
type UpdateInvestigationPartyRequest struct {
	Role       *model.InvestigationPartyRole `json:"role,omitempty"`
	Name       *string                       `json:"name,omitempty"`
	Identifier *string                       `json:"identifier,omitempty"`
	Contact    *string                       `json:"contact,omitempty"`
	Metadata   map[string]any                `json:"metadata,omitempty"`
}

// RecordInvestigationStatementRequest records a testimony/statement (CAP-079).
// statement is encrypted PII.
type RecordInvestigationStatementRequest struct {
	DeponentPartyID *uuid.UUID     `json:"deponent_party_id,omitempty"`
	DeponentName    string         `json:"deponent_name"`
	Statement       string         `json:"statement"`
	TakenAt         *time.Time     `json:"taken_at,omitempty"`
	TakenBy         string         `json:"taken_by"`
	Metadata        map[string]any `json:"metadata,omitempty"`
}

// Normalize trims string inputs.
func (r *RecordInvestigationStatementRequest) Normalize() {
	r.DeponentName = strings.TrimSpace(r.DeponentName)
	r.Statement = strings.TrimSpace(r.Statement)
	r.TakenBy = strings.TrimSpace(r.TakenBy)
}

// UploadInvestigationEvidenceRequest catalogues an evidence reference (CAP-080).
// The binary itself is uploaded to the Files service
// (entity_type='legal_investigation'); file_id links it here.
type UploadInvestigationEvidenceRequest struct {
	FileID       *uuid.UUID     `json:"file_id,omitempty"`
	Title        string         `json:"title"`
	Description  string         `json:"description"`
	EvidenceType string         `json:"evidence_type"`
	CollectedBy  string         `json:"collected_by"`
	CollectedAt  *time.Time     `json:"collected_at,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
}

// Normalize trims string inputs.
func (r *UploadInvestigationEvidenceRequest) Normalize() {
	r.Title = strings.TrimSpace(r.Title)
	r.Description = strings.TrimSpace(r.Description)
	r.EvidenceType = strings.TrimSpace(r.EvidenceType)
	r.CollectedBy = strings.TrimSpace(r.CollectedBy)
}

// RecordInvestigationResultsRequest records findings (CAP-081). When GenerateAI is
// true the findings body is drafted via the AID engine from FindingsPrompt
// (Arabic supported); otherwise Findings is taken verbatim.
type RecordInvestigationResultsRequest struct {
	Findings       string         `json:"findings"`
	GenerateAI     bool           `json:"generate_ai"`
	FindingsPrompt string         `json:"findings_prompt"`
	Metadata       map[string]any `json:"metadata,omitempty"`
}

// Normalize trims string inputs.
func (r *RecordInvestigationResultsRequest) Normalize() {
	r.Findings = strings.TrimSpace(r.Findings)
	r.FindingsPrompt = strings.TrimSpace(r.FindingsPrompt)
}

// RecordInvestigationRecommendationsRequest records the final recommendations
// (CAP-082). When GenerateAI is true the body is drafted via the AID engine.
type RecordInvestigationRecommendationsRequest struct {
	Recommendations       string         `json:"recommendations"`
	GenerateAI            bool           `json:"generate_ai"`
	RecommendationsPrompt string         `json:"recommendations_prompt"`
	Metadata              map[string]any `json:"metadata,omitempty"`
}

// Normalize trims string inputs.
func (r *RecordInvestigationRecommendationsRequest) Normalize() {
	r.Recommendations = strings.TrimSpace(r.Recommendations)
	r.RecommendationsPrompt = strings.TrimSpace(r.RecommendationsPrompt)
}

// StartInvestigationApprovalRequest opens the results-approval chain (CAP-083). The
// approver role/quorum default to a single legal-director approval when omitted.
type StartInvestigationApprovalRequest struct {
	ApproverRole string `json:"approver_role"`
	Notes        string `json:"notes"`
}

// Normalize trims inputs and applies the default approver role.
func (r *StartInvestigationApprovalRequest) Normalize() {
	r.ApproverRole = strings.TrimSpace(r.ApproverRole)
	r.Notes = strings.TrimSpace(r.Notes)
	if r.ApproverRole == "" {
		// Default to the on-roster hyphenated slug the role matrix defines
		// (auth.LegalAffairsRoleDefs). The previous "legal_director" underscore default
		// was off-roster and only worked because the decide path re-normalises -/_.
		r.ApproverRole = "legal-director"
	}
	// Canonicalise to the hyphenated roster slug form so a legacy underscore variant
	// (e.g. the "legal_director" the approval dialog historically defaulted to) resolves
	// to the on-roster "legal-director" slug instead of persisting an off-roster
	// assignee_role on the approval task (F48).
	r.ApproverRole = strings.ReplaceAll(strings.ToLower(r.ApproverRole), "_", "-")
}
