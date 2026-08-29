package service

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func TestEffectiveEditorPermissionModeDowngradesWhenLockedByAnotherUser(t *testing.T) {
	actorID := uuid.New()
	otherID := uuid.New()
	lock := &model.DocumentEditorLock{LockedBy: otherID}

	got := effectiveEditorPermissionMode(model.DocumentEditorModeEdit, actorID, lock)
	if got != model.DocumentEditorModeView {
		t.Fatalf("permission mode = %q, want view when another user owns lock", got)
	}

	got = effectiveEditorPermissionMode(model.DocumentEditorModeComment, otherID, lock)
	if got != model.DocumentEditorModeComment {
		t.Fatalf("permission mode = %q, want comment for lock owner", got)
	}
}

func TestBuildDocumentEditorConfigOnlyOfficeShape(t *testing.T) {
	documentID := uuid.New()
	tenantID := uuid.New()
	userID := uuid.New()
	fileID := uuid.New()
	fileName := "draft-agreement.docx"
	callbackURL := "https://lex.example.test/api/v1/lex/documents/" + documentID.String() + "/editor/callback"
	document := &model.LegalDocument{
		ID:             documentID,
		TenantID:       tenantID,
		Title:          "Draft Agreement",
		FileID:         &fileID,
		FileName:       &fileName,
		CurrentVersion: 4,
	}
	session := &model.DocumentEditorSession{
		ID:                  uuid.New(),
		TenantID:            tenantID,
		DocumentID:          documentID,
		Provider:            "onlyoffice",
		RequestedMode:       model.DocumentEditorModeEdit,
		PermissionMode:      model.DocumentEditorModeEdit,
		ProviderDocumentKey: buildEditorProviderDocumentKey(tenantID, documentID, 4),
		DocumentVersion:     4,
		CallbackURL:         &callbackURL,
		CreatedBy:           userID,
	}

	config := buildDocumentEditorConfig(document, session, nil, EditorActor{
		UserID:      userID,
		Email:       "aisha@example.test",
		DisplayName: "Aisha Counsel",
	}, dto.OpenDocumentEditorSessionRequest{
		Provider:    "onlyoffice",
		Locale:      "en",
		BaseURL:     "https://app.example.test",
		RoutePrefix: "/api/v1/lex",
	}, "callback-token")

	if config.Provider != "onlyoffice" || config.DocumentType != "word" {
		t.Fatalf("config provider/type = %q/%q, want onlyoffice/word", config.Provider, config.DocumentType)
	}
	if config.Document["fileType"] != "docx" || config.Document["key"] == "" {
		t.Fatalf("document config = %+v, want docx and provider key", config.Document)
	}
	if got := config.Document["url"].(string); !strings.Contains(got, "/api/v1/files/"+fileID.String()+"/download") {
		t.Fatalf("document url = %q, want file download URL", got)
	}
	if config.EditorConfig["callbackUrl"] != callbackURL {
		t.Fatalf("callbackUrl = %v, want %s", config.EditorConfig["callbackUrl"], callbackURL)
	}
	if !config.Permissions.Edit || !config.Permissions.Comment || config.Metadata["callback_token"] != "callback-token" {
		t.Fatalf("permissions/metadata = %+v %+v, want editable config with callback token", config.Permissions, config.Metadata)
	}
}

func TestEditorProviderDocumentKeyIsStablePerVersion(t *testing.T) {
	tenantID := uuid.New()
	documentID := uuid.New()

	v3a := buildEditorProviderDocumentKey(tenantID, documentID, 3)
	v3b := buildEditorProviderDocumentKey(tenantID, documentID, 3)
	v4 := buildEditorProviderDocumentKey(tenantID, documentID, 4)

	if v3a != v3b {
		t.Fatalf("same version keys differ: %q vs %q", v3a, v3b)
	}
	if v3a == v4 {
		t.Fatalf("versioned keys match: %q", v3a)
	}
	if len(v3a) > 128 {
		t.Fatalf("provider key length = %d, want OnlyOffice-safe <= 128", len(v3a))
	}
}

func TestEditorSnapshotStatusRecognizesOnlyOfficeSaveStatuses(t *testing.T) {
	if !isEditorSnapshotStatus(float64(2)) || !isEditorSnapshotStatus(json.Number("6")) || !isEditorSnapshotStatus("force_saved") {
		t.Fatal("save statuses were not recognized as snapshot requests")
	}
	if isEditorSnapshotStatus(float64(1)) || isEditorSnapshotStatus("editing") {
		t.Fatal("non-save statuses were recognized as snapshot requests")
	}
}

func TestBuildPreflightPayloadIncludesRecordedAtAndChecks(t *testing.T) {
	score := 92.5
	recordedAt := time.Date(2026, 6, 26, 13, 0, 0, 0, time.UTC)
	payload := buildPreflightPayload(dto.SubmitDocumentEditorPreflightRequest{
		Status:   "warning",
		Score:    &score,
		Blocking: false,
		Summary:  "Review warnings",
		Checks: []dto.DocumentEditorPreflightCheck{
			{Key: "docx_format", Status: "passed", Severity: "info"},
		},
		Metadata: map[string]any{"source": "quality_gate"},
	}, recordedAt)

	if payload["status"] != "warning" || payload["recorded_at"] != recordedAt.Format(time.RFC3339) || payload["score"] != score {
		t.Fatalf("preflight payload = %+v, want status/recorded_at/score", payload)
	}
	if checks, ok := payload["checks"].([]any); !ok || len(checks) != 1 {
		t.Fatalf("checks = %#v, want one check", payload["checks"])
	}
}

func TestEditorNavigatorFallsBackToExtractedText(t *testing.T) {
	text := `"Effective Date" means the date this agreement is signed. The obligations in Section 2.1 survive. See clause 5.4.`
	workspace := &documentEditorWorkspaceContext{
		document: &model.LegalDocument{
			ID:             uuid.New(),
			Title:          "Draft Agreement",
			ExtractedText:  &text,
			CurrentVersion: 1,
			Metadata:       map[string]any{},
		},
		workspaceMetadata: map[string]any{},
		generatedAt:       time.Date(2026, 6, 26, 14, 0, 0, 0, time.UTC),
	}

	summary := buildNavigatorSummary(workspace)
	if len(summary.DefinedTerms) != 1 || summary.DefinedTerms[0].Term != "Effective Date" {
		t.Fatalf("defined terms = %+v, want Effective Date from extracted text", summary.DefinedTerms)
	}
	if len(summary.CrossReferences) != 2 {
		t.Fatalf("cross references = %+v, want section and clause references", summary.CrossReferences)
	}
}

func TestEditorPlaybookSummaryUsesAnalysisFallback(t *testing.T) {
	workspace := &documentEditorWorkspaceContext{
		document: &model.LegalDocument{
			ID:             uuid.New(),
			Title:          "Draft Agreement",
			ContractID:     ptrUUID(uuid.New()),
			CurrentVersion: 2,
			Metadata:       map[string]any{},
		},
		workspaceMetadata: map[string]any{},
		contractAnalysis: map[string]any{
			"clause_count":           float64(12),
			"high_risk_clause_count": float64(2),
			"missing_clauses":        []any{"indemnity", "governing_law"},
		},
		generatedAt: time.Date(2026, 6, 26, 14, 0, 0, 0, time.UTC),
	}

	summary := buildPlaybookEnforcementSummary(workspace)
	if summary.Status != "attention_required" || len(summary.MissingClauses) != 2 {
		t.Fatalf("playbook summary = %+v, want attention_required with missing clauses", summary)
	}
	if summary.ClauseCount != 12 || summary.HighRiskClauseCount != 2 {
		t.Fatalf("clause counts = %d/%d, want 12/2", summary.ClauseCount, summary.HighRiskClauseCount)
	}
}

func TestEditorHealthAndPrivilegedControlsAreDeterministic(t *testing.T) {
	fileName := "privileged-draft.docx"
	workspace := &documentEditorWorkspaceContext{
		document: &model.LegalDocument{
			ID:              uuid.New(),
			Title:           "Privileged Draft",
			FileName:        &fileName,
			Confidentiality: model.DocumentConfidentialityPrivileged,
			CurrentVersion:  3,
			Metadata:        map[string]any{},
		},
		workspaceMetadata: map[string]any{
			"legal_issues": map[string]any{
				"issues": []any{
					map[string]any{"id": "risk-1", "title": "Uncapped liability", "severity": "high", "status": "open"},
				},
			},
		},
		latestPreflight: map[string]any{"status": "failed"},
		generatedAt:     time.Date(2026, 6, 26, 14, 0, 0, 0, time.UTC),
	}

	health := buildDocumentHealthScore(workspace)
	if health.Score >= 80 || health.Status == "healthy" {
		t.Fatalf("health = %+v, want degraded score for failed preflight and open issue", health)
	}

	controls := buildPrivilegedControlsSummary(workspace)
	if !controls.Privileged || controls.ExternalSharingAllowed || controls.DownloadAllowed {
		t.Fatalf("privileged controls = %+v, want privileged defaults to restrict external sharing/download", controls)
	}
}

func TestEditorActionKeyValidation(t *testing.T) {
	for _, key := range []string{"risk_review", "playbook.compare", "redraft-clause"} {
		if !validEditorActionKey(key) {
			t.Fatalf("action key %q rejected", key)
		}
	}
	for _, key := range []string{"", "Risk Review", "delete/all"} {
		if validEditorActionKey(key) {
			t.Fatalf("action key %q accepted", key)
		}
	}
}
