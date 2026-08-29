package model

import (
	"time"

	"github.com/google/uuid"
)

// HearingReportType classifies a hearing report row (CAP-056..059). minutes ==
// ضبط الجلسة (the official session record); decision captures the court's ruling
// at the session; report is a free-form internal note on the hearing.
type HearingReportType string

const (
	HearingReportTypeMinutes  HearingReportType = "minutes"
	HearingReportTypeDecision HearingReportType = "decision"
	HearingReportTypeReport   HearingReportType = "report"
)

// Valid reports whether the report type is one of the allowed kinds.
func (t HearingReportType) Valid() bool {
	switch t {
	case HearingReportTypeMinutes, HearingReportTypeDecision, HearingReportTypeReport:
		return true
	default:
		return false
	}
}

// LegalHearingReport is a report/minutes (ضبط الجلسة) or recorded decision attached
// to a hearing on a litigation case (CAP-056..059). hearing_id FKs the BASE
// legal_case_hearings table (Phase-2); case_id is denormalised for tenant-leading
// indexes. Supporting documents land via the Files service with
// entity_type='legal_hearing_report'.
type LegalHearingReport struct {
	ID         uuid.UUID         `json:"id"`
	TenantID   uuid.UUID         `json:"tenant_id"`
	CaseID     uuid.UUID         `json:"case_id"`
	HearingID  uuid.UUID         `json:"hearing_id"`
	Type       HearingReportType `json:"type"`
	Title      string            `json:"title"`
	Body       string            `json:"body"`
	Decision   string            `json:"decision"`
	RecordedAt time.Time         `json:"recorded_at"`
	FileID     *uuid.UUID        `json:"file_id,omitempty"`
	Metadata   map[string]any    `json:"metadata"`
	CreatedBy  uuid.UUID         `json:"created_by"`
	CreatedAt  time.Time         `json:"created_at"`
	UpdatedAt  time.Time         `json:"updated_at"`
	DeletedAt  *time.Time        `json:"deleted_at,omitempty"`
}
