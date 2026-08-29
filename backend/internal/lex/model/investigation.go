package model

import (
	"time"

	"github.com/google/uuid"
)

// InvestigationStatus is the finite-state lifecycle of a legal investigation
// (CAP-077..083). registered → in_progress while parties/statements/evidence are
// gathered; results_recorded once findings + recommendations are captured;
// pending_approval while the results-approval chain (CAP-083) runs through the
// shared ApprovalOrchestrator; approved is terminal-success, rejected is an
// explicit annotation that must take the rejected -> in_progress edge before
// rework; closed/cancelled are terminal.
type InvestigationStatus string

const (
	InvestigationStatusRegistered     InvestigationStatus = "registered"
	InvestigationStatusInProgress     InvestigationStatus = "in_progress"
	InvestigationStatusResults        InvestigationStatus = "results_recorded"
	InvestigationStatusPendingApprove InvestigationStatus = "pending_approval"
	InvestigationStatusApproved       InvestigationStatus = "approved"
	InvestigationStatusRejected       InvestigationStatus = "rejected"
	InvestigationStatusClosed         InvestigationStatus = "closed"
	InvestigationStatusCancelled      InvestigationStatus = "cancelled"
)

// Valid reports whether the status is a known FSM state.
func (s InvestigationStatus) Valid() bool {
	switch s {
	case InvestigationStatusRegistered, InvestigationStatusInProgress, InvestigationStatusResults,
		InvestigationStatusPendingApprove, InvestigationStatusApproved, InvestigationStatusRejected,
		InvestigationStatusClosed, InvestigationStatusCancelled:
		return true
	default:
		return false
	}
}

// IsTerminal reports whether the investigation is in a terminal state and may no
// longer be mutated (used by the in-service mutability guard alongside the
// LegalHold guard on any linked case).
func (s InvestigationStatus) IsTerminal() bool {
	switch s {
	case InvestigationStatusApproved, InvestigationStatusClosed, InvestigationStatusCancelled:
		return true
	default:
		return false
	}
}

// InvestigationPartyRole is the role of a participant in an investigation
// (CAP-078). Deliberately small and open-ended.
type InvestigationPartyRole string

const (
	InvestigationPartyRoleSubject      InvestigationPartyRole = "subject"
	InvestigationPartyRoleComplainant  InvestigationPartyRole = "complainant"
	InvestigationPartyRoleWitness      InvestigationPartyRole = "witness"
	InvestigationPartyRoleInvestigator InvestigationPartyRole = "investigator"
	InvestigationPartyRoleExpert       InvestigationPartyRole = "expert"
	InvestigationPartyRoleOther        InvestigationPartyRole = "other"
)

// Valid reports whether the party role is a known role.
func (r InvestigationPartyRole) Valid() bool {
	switch r {
	case InvestigationPartyRoleSubject, InvestigationPartyRoleComplainant, InvestigationPartyRoleWitness,
		InvestigationPartyRoleInvestigator, InvestigationPartyRoleExpert, InvestigationPartyRoleOther:
		return true
	default:
		return false
	}
}

// LegalInvestigation is the first-class investigation aggregate (CAP-077..083).
// subject, lead_investigator and findings carry PII; subject/lead_investigator are
// field-encrypted at rest via FieldCrypto (the same AES-256-GCM "enc:v1:" envelope
// used for contract counterparty PII), findings likewise. case_id is an OPTIONAL,
// NULLABLE loose uuid reference to legal_cases with NO hard FK so this module ships
// independently of litigation.
type LegalInvestigation struct {
	ID                  uuid.UUID           `json:"id"`
	TenantID            uuid.UUID           `json:"tenant_id"`
	InvestigationNumber string              `json:"investigation_number"`
	Subject             string              `json:"subject"`
	LeadInvestigator    string              `json:"lead_investigator"`
	Status              InvestigationStatus `json:"status"`
	Priority            LegalPriority       `json:"priority"`
	// CaseID is an OPTIONAL loose reference to legal_cases (no hard FK).
	CaseID *uuid.UUID `json:"case_id,omitempty"`
	// Findings is the field-encrypted investigation findings (CAP-081). Empty when
	// not yet recorded.
	Findings string `json:"findings"`
	// Recommendations is the final recommendation text (CAP-082).
	Recommendations string `json:"recommendations"`
	// AIDrafted reports whether the most recent findings/recommendation body was
	// produced via the drafting (AID) engine.
	AIDrafted                    bool           `json:"ai_drafted"`
	Department                   *string        `json:"department,omitempty"`
	WorkflowInstanceID           *uuid.UUID     `json:"workflow_instance_id,omitempty"`
	ReminderObligationID         *uuid.UUID     `json:"reminder_obligation_id,omitempty"`
	Metadata                     map[string]any `json:"metadata"`
	CreatedBy                    uuid.UUID      `json:"created_by"`
	ClosedBy                     *uuid.UUID     `json:"closed_by,omitempty"`
	ClosedAt                     *time.Time     `json:"closed_at,omitempty"`
	ClosureReason                string         `json:"closure_reason,omitempty"`
	SLADeadline                  *time.Time     `json:"sla_deadline,omitempty"`
	LateJustification            *string        `json:"late_justification,omitempty"`
	LateJustificationSubmittedBy *uuid.UUID     `json:"late_justification_submitted_by,omitempty"`
	LateJustificationSubmittedAt *time.Time     `json:"late_justification_submitted_at,omitempty"`
	LateJustificationManagerRole *string        `json:"late_justification_manager_role,omitempty"`
	CreatedAt                    time.Time      `json:"created_at"`
	UpdatedAt                    time.Time      `json:"updated_at"`
	DeletedAt                    *time.Time     `json:"deleted_at,omitempty"`

	// Child aggregates, hydrated on Get.
	Parties    []InvestigationParty     `json:"parties,omitempty"`
	Statements []InvestigationStatement `json:"statements,omitempty"`
	Evidence   []InvestigationEvidence  `json:"evidence,omitempty"`
}

// InvestigationListFilters carries the (already-validated) query parameters for
// the investigation list/search endpoint.
type InvestigationListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *InvestigationStatus
	Statuses      []InvestigationStatus
	Priority      *LegalPriority
	CaseID        *uuid.UUID
	Department    string
	CaseType      string
	SortColumn    string
	SortDirection string
}

// InvestigationParty is a participant in an investigation (CAP-078). identifier
// and contact are PII and field-encrypted at rest.
type InvestigationParty struct {
	ID              uuid.UUID              `json:"id"`
	TenantID        uuid.UUID              `json:"tenant_id"`
	InvestigationID uuid.UUID              `json:"investigation_id"`
	Role            InvestigationPartyRole `json:"role"`
	Name            string                 `json:"name"`
	Identifier      *string                `json:"identifier,omitempty"`
	Contact         *string                `json:"contact,omitempty"`
	Metadata        map[string]any         `json:"metadata"`
	CreatedBy       uuid.UUID              `json:"created_by"`
	CreatedAt       time.Time              `json:"created_at"`
	UpdatedAt       time.Time              `json:"updated_at"`
	DeletedAt       *time.Time             `json:"deleted_at,omitempty"`
}

// InvestigationStatement is a recorded testimony/statement taken during an
// investigation (CAP-079). statement is field-encrypted at rest (PII / sensitive
// testimony). deponent_party_id optionally links the statement to a party row.
type InvestigationStatement struct {
	ID              uuid.UUID      `json:"id"`
	TenantID        uuid.UUID      `json:"tenant_id"`
	InvestigationID uuid.UUID      `json:"investigation_id"`
	DeponentPartyID *uuid.UUID     `json:"deponent_party_id,omitempty"`
	DeponentName    string         `json:"deponent_name"`
	Statement       string         `json:"statement"`
	TakenAt         time.Time      `json:"taken_at"`
	TakenBy         string         `json:"taken_by"`
	Metadata        map[string]any `json:"metadata"`
	CreatedBy       uuid.UUID      `json:"created_by"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       *time.Time     `json:"deleted_at,omitempty"`
}

// InvestigationEvidence is an evidence reference catalogued on an investigation
// (CAP-080). The binary lives in the Files service (entity_type='legal_investigation',
// entity_id=investigation_id); this row records the file_id + chain-of-custody
// metadata.
type InvestigationEvidence struct {
	ID              uuid.UUID      `json:"id"`
	TenantID        uuid.UUID      `json:"tenant_id"`
	InvestigationID uuid.UUID      `json:"investigation_id"`
	FileID          *uuid.UUID     `json:"file_id,omitempty"`
	Title           string         `json:"title"`
	Description     string         `json:"description"`
	EvidenceType    string         `json:"evidence_type"`
	CollectedBy     string         `json:"collected_by"`
	CollectedAt     *time.Time     `json:"collected_at,omitempty"`
	Metadata        map[string]any `json:"metadata"`
	CreatedBy       uuid.UUID      `json:"created_by"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	DeletedAt       *time.Time     `json:"deleted_at,omitempty"`
}

// InvestigationAuditEntry is one append-only governance audit row (CAP-081/083):
// every investigation mutation and management action records who did what, when,
// and an optional before/after detail payload. Immutable: no update/delete path.
type InvestigationAuditEntry struct {
	ID              uuid.UUID      `json:"id"`
	TenantID        uuid.UUID      `json:"tenant_id"`
	InvestigationID uuid.UUID      `json:"investigation_id"`
	Action          string         `json:"action"`
	FromStatus      *string        `json:"from_status,omitempty"`
	ToStatus        *string        `json:"to_status,omitempty"`
	Detail          map[string]any `json:"detail"`
	Before          map[string]any `json:"before,omitempty"`
	After           map[string]any `json:"after,omitempty"`
	Reason          *string        `json:"reason,omitempty"`
	ActorUserID     uuid.UUID      `json:"actor_user_id"`
	CreatedAt       time.Time      `json:"created_at"`
}
