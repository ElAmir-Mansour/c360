package service

import (
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestBuildDocumentRepositorySummaryAggregatesMetadata(t *testing.T) {
	tenantID := uuid.New()
	now := time.Date(2026, 6, 14, 10, 0, 0, 0, time.UTC)
	category := "Board"
	documents := []model.LegalDocument{
		{
			ID:              uuid.New(),
			TenantID:        tenantID,
			Title:           "Board resolution",
			Type:            model.DocumentTypeResolution,
			Category:        &category,
			Confidentiality: model.DocumentConfidentialityPrivileged,
			Status:          model.DocumentStatusActive,
			Tags:            []string{"board", "ksa"},
			Metadata: map[string]any{
				"folder_path":      "Governance/Board",
				"department":       "Legal",
				"jurisdiction":     "KSA",
				"retention_policy": "board-records-10y",
				"disposition_date": "2026-06-01",
				"saved_views": []any{
					map[string]any{
						"name":    "Privileged board records",
						"filters": map[string]any{"confidentiality": "privileged"},
					},
				},
			},
		},
		{
			ID:              uuid.New(),
			TenantID:        tenantID,
			Title:           "Vendor memo",
			Type:            model.DocumentTypeMemo,
			Confidentiality: model.DocumentConfidentialityInternal,
			Status:          model.DocumentStatusArchived,
			Tags:            []string{"vendor"},
			Metadata: map[string]any{
				"folderPath": "Commercial/Vendors",
				"saved_view": "Archived commercial",
			},
		},
	}

	summary := buildDocumentRepositorySummary(tenantID, documents, now)
	if summary.TenantID != tenantID || summary.TotalDocuments != 2 {
		t.Fatalf("summary identity = %+v, want tenant %s total 2", summary, tenantID)
	}
	if summary.ByType[string(model.DocumentTypeResolution)] != 1 || summary.ByStatus[string(model.DocumentStatusArchived)] != 1 {
		t.Fatalf("type/status rollup = %#v %#v", summary.ByType, summary.ByStatus)
	}
	if len(summary.Folders) != 2 || summary.Folders[0].Path != "Commercial/Vendors" && summary.Folders[1].Path != "Commercial/Vendors" {
		t.Fatalf("folders = %+v, want Commercial/Vendors and Governance/Board", summary.Folders)
	}
	if summary.Retention.WithPolicy != 1 || summary.Retention.WithDisposition != 1 || summary.Retention.DispositionDue != 1 || summary.Retention.MissingPolicy != 1 {
		t.Fatalf("retention = %+v, want one policy, one due disposition, one missing policy", summary.Retention)
	}
	if !hasTaxonomy(summary.Taxonomy, "jurisdiction", "KSA") || !hasTaxonomy(summary.Taxonomy, "tag", "board") {
		t.Fatalf("taxonomy = %+v, want jurisdiction KSA and tag board", summary.Taxonomy)
	}
	if !hasSavedView(summary.SavedViews, "Privileged board records") || !hasSavedView(summary.SavedViews, "Archived commercial") {
		t.Fatalf("saved views = %+v, want both metadata-derived views", summary.SavedViews)
	}
}

func TestPrepareBulkImportDocumentAddsMigrationOCRAndIndexMetadata(t *testing.T) {
	now := time.Date(2026, 6, 14, 11, 30, 0, 0, time.UTC)
	fileID := uuid.New()
	req := dto.CreateLegalDocumentRequest{
		Title:       " Legacy board policy ",
		Type:        model.DocumentTypePolicy,
		Description: "Imported policy.",
		Metadata: map[string]any{
			"source_record_id": "LEG-42",
			"department":       "Legal",
		},
		Document: &dto.FileReference{
			FileID:        fileID,
			FileName:      "legacy-board-policy.pdf",
			FileSizeBytes: 1024,
			ContentHash:   "sha256:legacy",
			ExtractedText: "Board policy OCR text.",
		},
	}

	normalized, itemMetadata := prepareBulkImportDocument(req, "batch-ksa", "legacy-dms", true, now)

	if normalized.Title != "Legacy board policy" {
		t.Fatalf("title = %q, want trimmed title", normalized.Title)
	}
	if itemMetadata["ocr_status"] != "text_provided" || itemMetadata["index_status"] != "content_indexed" {
		t.Fatalf("item metadata = %+v, want OCR and content index proof", itemMetadata)
	}
	migration, ok := normalized.Metadata["migration"].(map[string]any)
	if !ok || migration["batch_id"] != "batch-ksa" || migration["source_record_id"] != "LEG-42" {
		t.Fatalf("migration metadata = %+v", normalized.Metadata["migration"])
	}
	ocr, ok := normalized.Metadata["ocr"].(map[string]any)
	if !ok || ocr["status"] != "text_provided" || ocr["text_available"] != true {
		t.Fatalf("ocr metadata = %+v", normalized.Metadata["ocr"])
	}
	repositoryIndex, ok := normalized.Metadata["repository_index"].(map[string]any)
	if !ok || repositoryIndex["status"] != "content_indexed" || repositoryIndex["mode"] != "deterministic_metadata" {
		t.Fatalf("repository index metadata = %+v", normalized.Metadata["repository_index"])
	}
}

func TestPrepareBulkImportDocumentMarksMissingTextPendingWithoutContentIndex(t *testing.T) {
	now := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)
	req := dto.CreateLegalDocumentRequest{
		Title: "Scanned board minutes",
		Type:  model.DocumentTypeResolution,
		Document: &dto.FileReference{
			FileID:        uuid.New(),
			FileName:      "scanned-board-minutes.pdf",
			FileSizeBytes: 4096,
			ContentHash:   "sha256:scanned",
			ExtractedText: "   ",
		},
	}

	normalized, itemMetadata := prepareBulkImportDocument(req, "batch-ocr", "scanner", true, now)

	if itemMetadata["ocr_status"] != "pending" || itemMetadata["index_status"] != "metadata_indexed" {
		t.Fatalf("item metadata = %+v, want pending OCR and metadata-only index", itemMetadata)
	}
	ocr, ok := normalized.Metadata["ocr"].(map[string]any)
	if !ok || ocr["status"] != "pending" || ocr["text_available"] != false || ocr["text_length"] != 0 {
		t.Fatalf("ocr metadata = %+v, want pending OCR with no text", normalized.Metadata["ocr"])
	}
	repositoryIndex, ok := normalized.Metadata["repository_index"].(map[string]any)
	if !ok || repositoryIndex["status"] != "metadata_indexed" {
		t.Fatalf("repository index metadata = %+v, want metadata-only index status", normalized.Metadata["repository_index"])
	}
}

func TestPrepareBulkImportDocumentRespectsIndexFalse(t *testing.T) {
	now := time.Date(2026, 6, 14, 12, 15, 0, 0, time.UTC)
	req := dto.CreateLegalDocumentRequest{
		Title: "Searchable policy",
		Type:  model.DocumentTypePolicy,
		Document: &dto.FileReference{
			FileID:        uuid.New(),
			FileName:      "searchable-policy.pdf",
			FileSizeBytes: 2048,
			ContentHash:   "sha256:searchable",
			ExtractedText: "This imported policy has OCR text but indexing is disabled.",
		},
	}

	normalized, itemMetadata := prepareBulkImportDocument(req, "batch-no-index", "legacy-dms", false, now)

	if itemMetadata["ocr_status"] != "text_provided" || itemMetadata["index_status"] != "skipped" {
		t.Fatalf("item metadata = %+v, want OCR proof and skipped index", itemMetadata)
	}
	repositoryIndex, ok := normalized.Metadata["repository_index"].(map[string]any)
	if !ok || repositoryIndex["status"] != "skipped" {
		t.Fatalf("repository index metadata = %+v, want skipped status", normalized.Metadata["repository_index"])
	}
}

func TestPrepareDocumentTextProcessingMetadataRecordsPdfTextLayerWithoutClaimingOCR(t *testing.T) {
	now := time.Date(2026, 7, 13, 9, 0, 0, 0, time.UTC)
	metadata := prepareDocumentTextProcessingMetadata(
		map[string]any{"department": "Legal"},
		&dto.FileReference{FileName: "policy.pdf", ExtractedText: "Embedded searchable policy text."},
		&dto.DocumentTextProcessingRequest{
			TextExtractionMethod: "pdf_text_layer",
			OCRStatus:            "not_required",
			PageCount:            2,
			PagesWithText:        2,
		},
		now,
	)

	extraction := mapFromMetadata(metadata["text_extraction"])
	if extraction["status"] != "extracted" || extraction["method"] != "pdf_text_layer" {
		t.Fatalf("text extraction metadata = %+v, want embedded text-layer proof", extraction)
	}
	ocr := mapFromMetadata(metadata["ocr"])
	if ocr["status"] != "not_required" || ocr["text_available"] != true {
		t.Fatalf("ocr metadata = %+v, want not_required without an OCR completion claim", ocr)
	}
	if metadata["department"] != "Legal" {
		t.Fatalf("metadata = %+v, want existing metadata preserved", metadata)
	}
}

func TestPrepareDocumentTextProcessingMetadataMarksScannedPdfOCRPending(t *testing.T) {
	metadata := prepareDocumentTextProcessingMetadata(
		nil,
		&dto.FileReference{FileName: "scanned-minutes.PDF", ExtractedText: "   "},
		&dto.DocumentTextProcessingRequest{
			TextExtractionMethod: "none",
			OCRStatus:            "pending",
			PageCount:            4,
			PagesNeedingOCR:      4,
		},
		time.Date(2026, 7, 13, 9, 5, 0, 0, time.UTC),
	)

	extraction := mapFromMetadata(metadata["text_extraction"])
	if extraction["status"] != "ocr_pending" || extraction["pages_needing_ocr"] != 4 {
		t.Fatalf("text extraction metadata = %+v, want scanned PDF pending", extraction)
	}
	ocr := mapFromMetadata(metadata["ocr"])
	if ocr["status"] != "pending" || ocr["text_available"] != false {
		t.Fatalf("ocr metadata = %+v, want OCR pending", ocr)
	}
}

func TestPrepareDocumentTextProcessingMetadataMarksPartialPdfOCRPending(t *testing.T) {
	metadata := prepareDocumentTextProcessingMetadata(
		nil,
		&dto.FileReference{FileName: "mixed.pdf", ExtractedText: "Text from the born-digital pages."},
		&dto.DocumentTextProcessingRequest{
			TextExtractionMethod: "pdf_text_layer",
			OCRStatus:            "partial_pending",
			PageCount:            5,
			PagesWithText:        3,
			PagesNeedingOCR:      2,
		},
		time.Date(2026, 7, 13, 9, 10, 0, 0, time.UTC),
	)

	extraction := mapFromMetadata(metadata["text_extraction"])
	ocr := mapFromMetadata(metadata["ocr"])
	if extraction["status"] != "partial" || ocr["status"] != "partial_pending" {
		t.Fatalf("metadata = %+v, want partial text with OCR still pending", metadata)
	}
}

func TestPrepareDocumentTextProcessingMetadataDoesNotTrustUnprovenProvidedPdfText(t *testing.T) {
	metadata := prepareDocumentTextProcessingMetadata(
		nil,
		&dto.FileReference{FileName: "legacy-scan.pdf", ExtractedText: "Text supplied by an API client."},
		nil,
		time.Date(2026, 7, 13, 9, 15, 0, 0, time.UTC),
	)

	extraction := mapFromMetadata(metadata["text_extraction"])
	ocr := mapFromMetadata(metadata["ocr"])
	if extraction["status"] != "provided" || extraction["method"] != "provided" {
		t.Fatalf("text extraction metadata = %+v, want unproven provided-text state", extraction)
	}
	if ocr["status"] != "pending" || ocr["text_available"] != true {
		t.Fatalf("ocr metadata = %+v, want OCR coverage pending despite searchable text", ocr)
	}
}

func TestBuildDocumentRepositorySummaryParsesCamelCaseSavedViewsFolderFallbackAndRetention(t *testing.T) {
	tenantID := uuid.New()
	now := time.Date(2026, 6, 14, 12, 0, 0, 0, time.UTC)
	category := "Policies"
	documents := []model.LegalDocument{
		{
			ID:       uuid.New(),
			TenantID: tenantID,
			Title:    "Records policy",
			Type:     model.DocumentTypePolicy,
			Category: &category,
			Status:   model.DocumentStatusActive,
			Metadata: map[string]any{
				"folder":          `Records\Policies/`,
				"retentionPolicy": "records-7y",
				"dispositionDate": "2026-06-14T09:30:00Z",
				"savedViews": []any{
					map[string]any{
						"title":   "Due records",
						"filters": map[string]any{"dispositionDue": true},
					},
				},
			},
		},
		{
			ID:       uuid.New(),
			TenantID: tenantID,
			Title:    "Policy without retention",
			Type:     model.DocumentTypeMemo,
			Category: &category,
			Status:   model.DocumentStatusArchived,
			Metadata: map[string]any{},
		},
	}

	summary := buildDocumentRepositorySummary(tenantID, documents, now)

	if !hasFolder(summary.Folders, "Records/Policies", 1) || !hasFolder(summary.Folders, "Policies", 1) {
		t.Fatalf("folders = %+v, want folder metadata and category fallback", summary.Folders)
	}
	if !hasSavedViewWithFilter(summary.SavedViews, "Due records", "dispositionDue", true) {
		t.Fatalf("saved views = %+v, want camelCase savedViews with filters", summary.SavedViews)
	}
	if summary.Retention.WithPolicy != 1 || summary.Retention.WithDisposition != 1 || summary.Retention.DispositionDue != 1 || summary.Retention.MissingPolicy != 1 {
		t.Fatalf("retention = %+v, want camelCase policy/disposition parsing", summary.Retention)
	}
}

func hasTaxonomy(items []model.DocumentTaxonomySummary, dimension, value string) bool {
	for _, item := range items {
		if item.Dimension == dimension && item.Value == value {
			return true
		}
	}
	return false
}

func hasFolder(items []model.DocumentFolderSummary, path string, count int) bool {
	for _, item := range items {
		if item.Path == path && item.DocumentCount == count {
			return true
		}
	}
	return false
}

func hasSavedViewWithFilter(items []model.DocumentSavedViewSummary, name, filterKey string, filterValue any) bool {
	for _, item := range items {
		if item.Name == name && item.Filters[filterKey] == filterValue {
			return true
		}
	}
	return false
}

func hasSavedView(items []model.DocumentSavedViewSummary, name string) bool {
	for _, item := range items {
		if item.Name == name {
			return true
		}
	}
	return false
}
