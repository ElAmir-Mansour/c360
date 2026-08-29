package model

import (
	"time"

	"github.com/google/uuid"
)

// ExpertAssignmentStatus is the FSM of an expert assignment (ندب خبير, CAP-060..062).
// requested → appointed → report_received → closed; cancelled aborts the appointment.
type ExpertAssignmentStatus string

const (
	ExpertAssignmentStatusRequested      ExpertAssignmentStatus = "requested"
	ExpertAssignmentStatusAppointed      ExpertAssignmentStatus = "appointed"
	ExpertAssignmentStatusReportReceived ExpertAssignmentStatus = "report_received"
	ExpertAssignmentStatusClosed         ExpertAssignmentStatus = "closed"
	ExpertAssignmentStatusCancelled      ExpertAssignmentStatus = "cancelled"
)

// Valid reports whether the status is a known expert-assignment FSM state.
func (s ExpertAssignmentStatus) Valid() bool {
	switch s {
	case ExpertAssignmentStatusRequested, ExpertAssignmentStatusAppointed,
		ExpertAssignmentStatusReportReceived, ExpertAssignmentStatusClosed,
		ExpertAssignmentStatusCancelled:
		return true
	default:
		return false
	}
}

// LegalExpertAssignment records the appointment of a court expert on a litigation
// case (ندب خبير, CAP-060..062). case_id FKs legal_cases. specialization names the
// expert's field; appointed_at / report_due_date / report_received_at track the
// engagement timeline. Documents furnished to the expert (CAP-062) are recorded in
// legal_expert_documents.
type LegalExpertAssignment struct {
	ID               uuid.UUID              `json:"id"`
	TenantID         uuid.UUID              `json:"tenant_id"`
	CaseID           uuid.UUID              `json:"case_id"`
	ExpertName       string                 `json:"expert_name"`
	Specialization   string                 `json:"specialization"`
	ContactInfo      *string                `json:"contact_info,omitempty"`
	Mandate          string                 `json:"mandate"`
	Status           ExpertAssignmentStatus `json:"status"`
	AppointedAt      *time.Time             `json:"appointed_at,omitempty"`
	ReportDueDate    *time.Time             `json:"report_due_date,omitempty"`
	ReportReceivedAt *time.Time             `json:"report_received_at,omitempty"`
	Metadata         map[string]any         `json:"metadata"`
	CreatedBy        uuid.UUID              `json:"created_by"`
	CreatedAt        time.Time              `json:"created_at"`
	UpdatedAt        time.Time              `json:"updated_at"`
	DeletedAt        *time.Time             `json:"deleted_at,omitempty"`

	Documents []LegalExpertDocument `json:"documents,omitempty"`
}

// LegalExpertDocument links a Files-service object (entity_type='legal_expert_assignment')
// furnished to an appointed expert (CAP-062).
type LegalExpertDocument struct {
	ID           uuid.UUID  `json:"id"`
	TenantID     uuid.UUID  `json:"tenant_id"`
	AssignmentID uuid.UUID  `json:"assignment_id"`
	FileID       *uuid.UUID `json:"file_id,omitempty"`
	FileName     string     `json:"file_name"`
	Caption      string     `json:"caption"`
	CreatedBy    uuid.UUID  `json:"created_by"`
	CreatedAt    time.Time  `json:"created_at"`
}

// LegalExpertAssignmentListFilters carries the validated query parameters for the
// expert-assignment list endpoint (scoped to a case).
type LegalExpertAssignmentListFilters struct {
	Page          int
	PerPage       int
	Search        string
	Status        *ExpertAssignmentStatus
	SortColumn    string
	SortDirection string
}
