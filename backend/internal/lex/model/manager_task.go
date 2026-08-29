package model

import (
	"time"

	"github.com/google/uuid"
)

type ManagerTaskStatus string

const (
	ManagerTaskStatusAssigned           ManagerTaskStatus = "assigned"
	ManagerTaskStatusInProgress         ManagerTaskStatus = "in_progress"
	ManagerTaskStatusSubmitted          ManagerTaskStatus = "submitted"
	ManagerTaskStatusCorrectionRequired ManagerTaskStatus = "correction_required"
	ManagerTaskStatusAccepted           ManagerTaskStatus = "accepted"
	ManagerTaskStatusCancelled          ManagerTaskStatus = "cancelled"
)

func (s ManagerTaskStatus) Valid() bool {
	switch s {
	case ManagerTaskStatusAssigned, ManagerTaskStatusInProgress, ManagerTaskStatusSubmitted,
		ManagerTaskStatusCorrectionRequired, ManagerTaskStatusAccepted, ManagerTaskStatusCancelled:
		return true
	default:
		return false
	}
}

// ManagerTask is an ad-hoc work item created by the Contracts & Consultations
// Manager. Attachment fields are an immutable, verified snapshot of a file-
// service object; bytes remain in the shared Files service.
type ManagerTask struct {
	ID             uuid.UUID         `json:"id"`
	TenantID       uuid.UUID         `json:"tenant_id"`
	Title          string            `json:"title"`
	Description    string            `json:"description"`
	AssigneeID     uuid.UUID         `json:"assignee_id"`
	Status         ManagerTaskStatus `json:"status"`
	Attachment     *ManagerTaskFile  `json:"attachment,omitempty"`
	Result         *string           `json:"result,omitempty"`
	CorrectionNote *string           `json:"correction_note,omitempty"`
	CreatedBy      uuid.UUID         `json:"created_by"`
	SubmittedAt    *time.Time        `json:"submitted_at,omitempty"`
	ReviewedBy     *uuid.UUID        `json:"reviewed_by,omitempty"`
	ReviewedAt     *time.Time        `json:"reviewed_at,omitempty"`
	CreatedAt      time.Time         `json:"created_at"`
	UpdatedAt      time.Time         `json:"updated_at"`
	DeletedAt      *time.Time        `json:"deleted_at,omitempty"`
}

type ManagerTaskFile struct {
	FileID          uuid.UUID `json:"file_id"`
	OriginalName    string    `json:"original_name"`
	ContentType     string    `json:"content_type"`
	SizeBytes       int64     `json:"size_bytes"`
	ChecksumSHA256  string    `json:"checksum_sha256"`
	FileVersion     int       `json:"file_version"`
	VirusScanStatus string    `json:"virus_scan_status"`
	UploadedBy      uuid.UUID `json:"uploaded_by"`
}

type ManagerTaskListFilters struct {
	Status     *ManagerTaskStatus
	AssigneeID *uuid.UUID
	Page       int
	PerPage    int
}
