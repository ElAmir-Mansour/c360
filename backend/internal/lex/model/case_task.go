package model

import (
	"time"

	"github.com/google/uuid"
)

// CaseTaskStatus is the lifecycle of a case task (CAP-040). The set covers the
// open → in-progress → done path plus a cancelled terminal.
type CaseTaskStatus string

const (
	CaseTaskStatusOpen       CaseTaskStatus = "open"
	CaseTaskStatusInProgress CaseTaskStatus = "in_progress"
	CaseTaskStatusDone       CaseTaskStatus = "done"
	CaseTaskStatusCancelled  CaseTaskStatus = "cancelled"
)

// Valid reports whether the task status is a known state.
func (s CaseTaskStatus) Valid() bool {
	switch s {
	case CaseTaskStatusOpen, CaseTaskStatusInProgress, CaseTaskStatusDone, CaseTaskStatusCancelled:
		return true
	default:
		return false
	}
}

// CaseTask is a work item defined against a litigation case (CAP-040). Priority
// reuses model.LegalPriority so case tasks share the legal-affairs priority
// vocabulary. AssigneeID is the user the task is allocated to.
type CaseTask struct {
	ID         uuid.UUID      `json:"id"`
	TenantID   uuid.UUID      `json:"tenant_id"`
	CaseID     uuid.UUID      `json:"case_id"`
	Title      string         `json:"title"`
	AssigneeID *uuid.UUID     `json:"assignee_id,omitempty"`
	Priority   LegalPriority  `json:"priority"`
	Status     CaseTaskStatus `json:"status"`
	DueDate    *time.Time     `json:"due_date,omitempty"`
	Metadata   map[string]any `json:"metadata"`
	CreatedBy  uuid.UUID      `json:"created_by"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	DeletedAt  *time.Time     `json:"deleted_at,omitempty"`
}
