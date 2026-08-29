package dto

import (
	"strings"

	"github.com/google/uuid"
)

// UploadContractFinalVersionRequest uploads the FINAL, approved contract version
// through the review-desk final-version ceremony (CAP-117). It is backed by a
// previously uploaded file (file service) and is only accepted once the latest
// review-desk recommendation for the contract is "approved": the ceremony then
// records the new current version, stamps contracts.final_uploaded_at, and
// transitions the contract draft -> active.
type UploadContractFinalVersionRequest struct {
	FileID        uuid.UUID `json:"file_id"`
	FileName      string    `json:"file_name"`
	FileSizeBytes int64     `json:"file_size_bytes"`
	ContentHash   string    `json:"content_hash"`
	ExtractedText string    `json:"extracted_text"`
	ChangeSummary string    `json:"change_summary"`
}

func (r *UploadContractFinalVersionRequest) Normalize() {
	r.FileName = strings.TrimSpace(r.FileName)
	r.ContentHash = strings.TrimSpace(r.ContentHash)
	r.ChangeSummary = strings.TrimSpace(r.ChangeSummary)
}
