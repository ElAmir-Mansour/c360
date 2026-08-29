package model

import (
	"time"

	"github.com/google/uuid"
)

type LegalDocumentType string

const (
	DocumentTypePolicy          LegalDocumentType = "policy"
	DocumentTypeRegulation      LegalDocumentType = "regulation"
	DocumentTypeTemplate        LegalDocumentType = "template"
	DocumentTypeMemo            LegalDocumentType = "memo"
	DocumentTypeOpinion         LegalDocumentType = "opinion"
	DocumentTypeFiling          LegalDocumentType = "filing"
	DocumentTypeCorrespondence  LegalDocumentType = "correspondence"
	DocumentTypeResolution      LegalDocumentType = "resolution"
	DocumentTypePowerOfAttorney LegalDocumentType = "power_of_attorney"
	DocumentTypeOther           LegalDocumentType = "other"
)

func (t LegalDocumentType) Valid() bool {
	switch t {
	case DocumentTypePolicy, DocumentTypeRegulation, DocumentTypeTemplate,
		DocumentTypeMemo, DocumentTypeOpinion, DocumentTypeFiling,
		DocumentTypeCorrespondence, DocumentTypeResolution,
		DocumentTypePowerOfAttorney, DocumentTypeOther:
		return true
	default:
		return false
	}
}

type DocumentConfidentiality string

const (
	DocumentConfidentialityPublic       DocumentConfidentiality = "public"
	DocumentConfidentialityInternal     DocumentConfidentiality = "internal"
	DocumentConfidentialityConfidential DocumentConfidentiality = "confidential"
	DocumentConfidentialityPrivileged   DocumentConfidentiality = "privileged"
)

func (c DocumentConfidentiality) Valid() bool {
	switch c {
	case DocumentConfidentialityPublic, DocumentConfidentialityInternal,
		DocumentConfidentialityConfidential, DocumentConfidentialityPrivileged:
		return true
	default:
		return false
	}
}

type DocumentStatus string

const (
	DocumentStatusDraft      DocumentStatus = "draft"
	DocumentStatusActive     DocumentStatus = "active"
	DocumentStatusArchived   DocumentStatus = "archived"
	DocumentStatusSuperseded DocumentStatus = "superseded"
)

type LegalDocument struct {
	ID              uuid.UUID               `json:"id"`
	TenantID        uuid.UUID               `json:"tenant_id"`
	Title           string                  `json:"title"`
	Type            LegalDocumentType       `json:"type"`
	Description     string                  `json:"description"`
	FileID          *uuid.UUID              `json:"file_id,omitempty"`
	FileName        *string                 `json:"file_name,omitempty"`
	FileSizeBytes   *int64                  `json:"file_size_bytes,omitempty"`
	ExtractedText   *string                 `json:"extracted_text,omitempty"`
	Category        *string                 `json:"category,omitempty"`
	Confidentiality DocumentConfidentiality `json:"confidentiality"`
	ContractID      *uuid.UUID              `json:"contract_id,omitempty"`
	CurrentVersion  int                     `json:"current_version"`
	Status          DocumentStatus          `json:"status"`
	Tags            []string                `json:"tags"`
	Metadata        map[string]any          `json:"metadata"`
	CreatedBy       uuid.UUID               `json:"created_by"`
	CreatedAt       time.Time               `json:"created_at"`
	UpdatedAt       time.Time               `json:"updated_at"`
	DeletedAt       *time.Time              `json:"deleted_at,omitempty"`
}

// DocumentListFilter carries the validated query parameters for the legal
// document list endpoint. Every field is optional; a zero value means "do not
// filter on this dimension", so an empty filter reproduces the legacy
// behaviour (type/status/search only).
type DocumentListFilter struct {
	Type            string
	Status          string
	Search          string
	Confidentiality string
	Category        string
	FolderPath      string
	Tag             string
	// MissingRetentionPolicy selects documents that have no retention policy
	// recorded in metadata (retention_policy / retentionPolicy).
	MissingRetentionPolicy bool
	// DispositionDue selects documents whose recorded disposition date
	// (disposition_date / dispositionDate) is in the past.
	DispositionDue bool
	Page           int
	PerPage        int
}

type DocumentRepositorySummary struct {
	TenantID          uuid.UUID                  `json:"tenant_id"`
	GeneratedAt       time.Time                  `json:"generated_at"`
	TotalDocuments    int                        `json:"total_documents"`
	ByType            map[string]int             `json:"by_type"`
	ByStatus          map[string]int             `json:"by_status"`
	ByConfidentiality map[string]int             `json:"by_confidentiality"`
	ByCategory        map[string]int             `json:"by_category"`
	Folders           []DocumentFolderSummary    `json:"folders"`
	SavedViews        []DocumentSavedViewSummary `json:"saved_views"`
	Taxonomy          []DocumentTaxonomySummary  `json:"taxonomy"`
	Retention         DocumentRetentionSummary   `json:"retention"`
}

type DocumentFolderSummary struct {
	Path          string `json:"path"`
	DocumentCount int    `json:"document_count"`
	Privileged    int    `json:"privileged"`
	Archived      int    `json:"archived"`
}

type DocumentSavedViewSummary struct {
	Name          string         `json:"name"`
	DocumentCount int            `json:"document_count"`
	Filters       map[string]any `json:"filters,omitempty"`
}

type DocumentTaxonomySummary struct {
	Dimension     string `json:"dimension"`
	Value         string `json:"value"`
	DocumentCount int    `json:"document_count"`
}

type DocumentRetentionSummary struct {
	WithPolicy      int `json:"with_policy"`
	WithDisposition int `json:"with_disposition"`
	DispositionDue  int `json:"disposition_due"`
	MissingPolicy   int `json:"missing_policy"`
}

type DocumentBulkImportResult struct {
	BatchID      string                         `json:"batch_id"`
	SourceSystem string                         `json:"source_system,omitempty"`
	Requested    int                            `json:"requested"`
	Succeeded    int                            `json:"succeeded"`
	Failed       int                            `json:"failed"`
	Items        []DocumentBulkImportItemResult `json:"items"`
}

type DocumentBulkImportItemResult struct {
	Index       int            `json:"index"`
	Status      string         `json:"status"`
	DocumentID  *uuid.UUID     `json:"document_id,omitempty"`
	Title       string         `json:"title,omitempty"`
	OCRStatus   string         `json:"ocr_status,omitempty"`
	IndexStatus string         `json:"index_status,omitempty"`
	Error       string         `json:"error,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
}

type DocumentVersion struct {
	ID            uuid.UUID `json:"id"`
	TenantID      uuid.UUID `json:"tenant_id"`
	DocumentID    uuid.UUID `json:"document_id"`
	Version       int       `json:"version"`
	FileID        uuid.UUID `json:"file_id"`
	FileName      string    `json:"file_name"`
	FileSizeBytes int64     `json:"file_size_bytes"`
	ContentHash   string    `json:"content_hash"`
	ExtractedText *string   `json:"extracted_text,omitempty"`
	ChangeSummary *string   `json:"change_summary,omitempty"`
	UploadedBy    uuid.UUID `json:"uploaded_by"`
	UploadedAt    time.Time `json:"uploaded_at"`
}
