package model

import (
	"time"

	"github.com/google/uuid"
)

// LegalRequestAttachment is the durable request-to-file relationship. File
// bytes remain in file-service; the metadata snapshot makes request review and
// approval audit records stable across later file metadata changes.
type LegalRequestAttachment struct {
	ID             uuid.UUID `json:"id"`
	TenantID       uuid.UUID `json:"tenant_id"`
	LegalRequestID uuid.UUID `json:"legal_request_id"`
	// Cycle is the review round this upload belongs to, stamped from the request's
	// counter at insert, so a file sent back on the third round is attributable to
	// that round rather than to one undifferentiated pile.
	Cycle           int        `json:"cycle"`
	FileID          uuid.UUID  `json:"file_id"`
	SlotKey         *string    `json:"slot_key,omitempty"`
	OriginalName    string     `json:"original_name"`
	ContentType     string     `json:"content_type"`
	SizeBytes       int64      `json:"size_bytes"`
	ChecksumSHA256  string     `json:"checksum_sha256"`
	FileVersion     int        `json:"file_version"`
	VirusScanStatus string     `json:"virus_scan_status"`
	UploadedBy      uuid.UUID  `json:"uploaded_by"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	DeletedAt       *time.Time `json:"deleted_at,omitempty"`
}
