package model

import (
	"time"

	"github.com/google/uuid"
)

// DefendantCaseStatus is the FSM of an incoming-lawsuit (defendant-side) registration
// (CAP-067..073). registered → notified_dept → response_drafting → response_in_review
// → response_approved; closed/cancelled terminate.
type DefendantCaseStatus string

const (
	DefendantCaseStatusRegistered       DefendantCaseStatus = "registered"
	DefendantCaseStatusNotifiedDept     DefendantCaseStatus = "notified_dept"
	DefendantCaseStatusResponseDrafting DefendantCaseStatus = "response_drafting"
	DefendantCaseStatusResponseInReview DefendantCaseStatus = "response_in_review"
	DefendantCaseStatusResponseApproved DefendantCaseStatus = "response_approved"
	DefendantCaseStatusResponseRejected DefendantCaseStatus = "response_rejected"
	DefendantCaseStatusClosed           DefendantCaseStatus = "closed"
	DefendantCaseStatusCancelled        DefendantCaseStatus = "cancelled"
)

// Valid reports whether the status is a known defendant-case FSM state.
func (s DefendantCaseStatus) Valid() bool {
	switch s {
	case DefendantCaseStatusRegistered, DefendantCaseStatusNotifiedDept,
		DefendantCaseStatusResponseDrafting, DefendantCaseStatusResponseInReview,
		DefendantCaseStatusResponseApproved, DefendantCaseStatusResponseRejected,
		DefendantCaseStatusClosed, DefendantCaseStatusCancelled:
		return true
	default:
		return false
	}
}

// NajizSyncStatus tracks the manual Najiz (ناجز) court-portal representation entry
// (CAP-069/175). The real Najiz API is DEFERRED: company_representative + this status
// are manual entries today (manual/synced/failed). synced means an operator confirmed
// the representative is registered on the portal.
type NajizSyncStatus string

const (
	NajizSyncStatusManual NajizSyncStatus = "manual"
	NajizSyncStatusSynced NajizSyncStatus = "synced"
	NajizSyncStatusFailed NajizSyncStatus = "failed"
)

// Valid reports whether the Najiz sync status is one of the allowed values.
func (s NajizSyncStatus) Valid() bool {
	switch s {
	case NajizSyncStatusManual, NajizSyncStatusSynced, NajizSyncStatusFailed:
		return true
	default:
		return false
	}
}

// LegalDefendantCase registers an incoming lawsuit where the company is the
// defendant (CAP-067..073). case_id FKs legal_cases (the company_status='defendant'
// case this incoming suit hangs off). notification_date is when the court served
// the company (CAP-068). company_representative + najiz_status capture the Najiz
// court-portal representation (manual entry; real API deferred, CAP-069/175). The
// first-response memo (مذكرة الرد الأولى, CAP-072) is drafted into response_memo and
// gated by a two-tier supervisor→section_manager review via the shared
// ApprovalOrchestrator (CAP-073); workflow_instance_id links that chain run.
type LegalDefendantCase struct {
	ID                    uuid.UUID           `json:"id"`
	TenantID              uuid.UUID           `json:"tenant_id"`
	CaseID                uuid.UUID           `json:"case_id"`
	PlaintiffName         string              `json:"plaintiff_name"`
	CourtName             *string             `json:"court_name,omitempty"`
	NotificationDate      *time.Time          `json:"notification_date,omitempty"`
	CompanyRepresentative *string             `json:"company_representative,omitempty"`
	NajizStatus           NajizSyncStatus     `json:"najiz_status"`
	NajizReference        *string             `json:"najiz_reference,omitempty"`
	ConcernedDepartment   *string             `json:"concerned_department,omitempty"`
	DeptNotifiedAt        *time.Time          `json:"dept_notified_at,omitempty"`
	ResponseMemo          string              `json:"response_memo"`
	ResponseMemoAI        bool                `json:"response_memo_ai"`
	Status                DefendantCaseStatus `json:"status"`
	WorkflowInstanceID    *uuid.UUID          `json:"workflow_instance_id,omitempty"`
	ResponseApprovedBy    *uuid.UUID          `json:"response_approved_by,omitempty"`
	ResponseApprovedAt    *time.Time          `json:"response_approved_at,omitempty"`
	Metadata              map[string]any      `json:"metadata"`
	CreatedBy             uuid.UUID           `json:"created_by"`
	CreatedAt             time.Time           `json:"created_at"`
	UpdatedAt             time.Time           `json:"updated_at"`
	DeletedAt             *time.Time          `json:"deleted_at,omitempty"`

	Attachments []LegalDefendantAttachment `json:"attachments,omitempty"`
}

// LegalDefendantAttachment links a Files-service object
// (entity_type='legal_defendant_case') to a defendant case (CAP-070): the uploaded
// statement of claim served on the company / supporting documents.
type LegalDefendantAttachment struct {
	ID              uuid.UUID  `json:"id"`
	TenantID        uuid.UUID  `json:"tenant_id"`
	DefendantCaseID uuid.UUID  `json:"defendant_case_id"`
	FileID          *uuid.UUID `json:"file_id,omitempty"`
	FileName        string     `json:"file_name"`
	Caption         string     `json:"caption"`
	Kind            string     `json:"kind"`
	CreatedBy       uuid.UUID  `json:"created_by"`
	CreatedAt       time.Time  `json:"created_at"`
}

// LegalDefendantCaseListFilters carries the validated query parameters for the
// defendant-case list endpoint (scoped to a case).
type LegalDefendantCaseListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *DefendantCaseStatus
	SortColumn    string
	SortDirection string
}
