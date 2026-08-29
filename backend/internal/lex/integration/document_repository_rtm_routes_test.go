//go:build integration

package integration

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestDocumentBulkImportRepositoryAcceptance(t *testing.T) {
	t.Parallel()

	h := newLexHarness(t)
	fileID := uuid.New()

	result := mustData[model.DocumentBulkImportResult](t, h.doJSON(t, http.MethodPost, "/api/v1/lex/documents/bulk-import", dto.BulkImportLegalDocumentsRequest{
		BatchID:      "legacy-ksa-2026",
		SourceSystem: "legacy-dms",
		Documents: []dto.CreateLegalDocumentRequest{
			{
				Title:           "Legacy Board Policy",
				Type:            model.DocumentTypePolicy,
				Description:     "Migrated policy with OCR text.",
				Category:        ptr("Governance"),
				Confidentiality: model.DocumentConfidentialityPrivileged,
				Tags:            []string{"board", "ksa"},
				Metadata: map[string]any{
					"source_record_id": "LEG-001",
					"folder_path":      "Legacy/Governance",
					"jurisdiction":     "KSA",
					"retention_policy": "board-records-10y",
				},
				Document: &dto.FileReference{
					FileID:        fileID,
					FileName:      "legacy-board-policy.pdf",
					FileSizeBytes: 2048,
					ContentHash:   "sha256:legacy-board",
					ExtractedText: "Legacy OCR text for board policy search and repository indexing.",
					ChangeSummary: "Initial legacy import.",
				},
			},
			{
				Type:            model.DocumentTypeMemo,
				Description:     "Invalid item should be reported but not block the batch.",
				Confidentiality: model.DocumentConfidentialityInternal,
			},
		},
	}), http.StatusOK)
	if result.BatchID != "legacy-ksa-2026" || result.Requested != 2 || result.Succeeded != 1 || result.Failed != 1 {
		t.Fatalf("bulk import result = %+v, want one imported and one failed", result)
	}
	if len(result.Items) != 2 || result.Items[0].Status != "imported" || result.Items[0].DocumentID == nil {
		t.Fatalf("bulk import items = %+v, want imported first item with document id", result.Items)
	}
	if result.Items[0].OCRStatus != "text_provided" || result.Items[0].IndexStatus != "content_indexed" {
		t.Fatalf("bulk import item metadata = %+v, want OCR/content index proof", result.Items[0])
	}
	if result.Items[1].Status != "failed" || result.Items[1].Error == "" {
		t.Fatalf("bulk import failed item = %+v, want item-level validation error", result.Items[1])
	}

	document := mustData[model.LegalDocument](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/documents/%s", *result.Items[0].DocumentID), nil), http.StatusOK)
	if document.FileID == nil || *document.FileID != fileID || document.CurrentVersion != 1 {
		t.Fatalf("imported document file/version = %+v, want current version 1 with file id %s", document, fileID)
	}
	if !documentMetadataNestedEquals(document.Metadata, "migration", "batch_id", "legacy-ksa-2026") ||
		!documentMetadataNestedEquals(document.Metadata, "ocr", "status", "text_provided") ||
		!documentMetadataNestedEquals(document.Metadata, "repository_index", "status", "content_indexed") {
		t.Fatalf("imported document metadata = %+v, want migration/OCR/index proof", document.Metadata)
	}

	versions := mustData[[]model.DocumentVersion](t, h.doJSON(t, http.MethodGet, fmt.Sprintf("/api/v1/lex/documents/%s/versions", document.ID), nil), http.StatusOK)
	if len(versions) != 1 || versions[0].ContentHash != "sha256:legacy-board" {
		t.Fatalf("document versions = %+v, want imported version evidence", versions)
	}

	summary := mustData[model.DocumentRepositorySummary](t, h.doJSON(t, http.MethodGet, "/api/v1/watheeq/documents/repository-summary", nil), http.StatusOK)
	if summary.TotalDocuments != 1 || summary.ByCategory["Governance"] != 1 || !repositorySummaryHasTaxonomy(summary, "jurisdiction", "KSA") {
		t.Fatalf("repository summary = %+v, want imported repository rollups", summary)
	}

	readOnly := h.withToken(h.env.mustToken(t, h.tenantID, uuid.New(), "viewer"))
	expectStatus(t, readOnly.doJSON(t, http.MethodPost, "/api/v1/lex/documents/bulk-import", dto.BulkImportLegalDocumentsRequest{}), http.StatusForbidden)
}

func documentMetadataNestedEquals(metadata map[string]any, parent, key, want string) bool {
	child, ok := metadata[parent].(map[string]any)
	if !ok {
		return false
	}
	got, _ := child[key].(string)
	return got == want
}

func repositorySummaryHasTaxonomy(summary model.DocumentRepositorySummary, dimension, value string) bool {
	for _, item := range summary.Taxonomy {
		if item.Dimension == dimension && item.Value == value {
			return true
		}
	}
	return false
}

func ptr[T any](value T) *T {
	return &value
}
