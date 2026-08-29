package model

import (
	"time"

	"github.com/google/uuid"
)

// CaseHearing is one scheduled/recorded hearing on a litigation case (CAP-044).
// It is a deliberately clean BASE table: Phase 3 extends hearings with reports
// and minutes (hearing reports/minutes are stored via the Files service with
// entity_type='legal_case_hearing'; structured pleadings/judgments tables FK back
// to legal_cases). decision captures the court's ruling text when recorded.
type CaseHearing struct {
	ID          uuid.UUID      `json:"id"`
	TenantID    uuid.UUID      `json:"tenant_id"`
	CaseID      uuid.UUID      `json:"case_id"`
	HearingDate time.Time      `json:"hearing_date"`
	Location    *string        `json:"location,omitempty"`
	Notes       string         `json:"notes"`
	Decision    *string        `json:"decision,omitempty"`
	Metadata    map[string]any `json:"metadata"`
	CreatedBy   uuid.UUID      `json:"created_by"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   *time.Time     `json:"deleted_at,omitempty"`
}
