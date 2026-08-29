package model

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestDocumentEditorOpenResultJSONShape(t *testing.T) {
	documentID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	sessionID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	lockID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	actorID := uuid.MustParse("44444444-4444-4444-4444-444444444444")
	fileID := uuid.MustParse("55555555-5555-5555-5555-555555555555")
	fileName := "draft.docx"
	expiresAt := time.Date(2026, 6, 26, 12, 0, 0, 0, time.UTC)

	raw, err := json.Marshal(DocumentEditorOpenResult{
		Session: &DocumentEditorSession{
			ID:                  sessionID,
			TenantID:            uuid.MustParse("66666666-6666-6666-6666-666666666666"),
			DocumentID:          documentID,
			Provider:            "onlyoffice",
			RequestedMode:       DocumentEditorModeEdit,
			PermissionMode:      DocumentEditorModeEdit,
			Status:              DocumentEditorSessionActive,
			ProviderDocumentKey: "lex-provider-key",
			DocumentVersion:     3,
			AutosaveMetadata:    map[string]any{"autosave": true},
			LastCallback:        map[string]any{},
			PreflightResult:     map[string]any{},
			SnapshotMetadata:    map[string]any{},
			CreatedBy:           actorID,
			ExpiresAt:           &expiresAt,
		},
		Document: DocumentEditorDocument{
			ID:             documentID,
			Title:          "Vendor Services Agreement",
			FileID:         &fileID,
			FileName:       &fileName,
			FileType:       "docx",
			CurrentVersion: 3,
		},
		Lock: &DocumentEditorLock{
			ID:         lockID,
			DocumentID: documentID,
			SessionID:  &sessionID,
			LockType:   "checkout",
			Status:     DocumentEditorLockActive,
			LockedBy:   actorID,
			ExpiresAt:  &expiresAt,
			Metadata:   map[string]any{"source": "word_editor"},
		},
		Config: DocumentEditorConfig{
			Provider:     "onlyoffice",
			DocumentType: "word",
			Document:     map[string]any{"fileType": "docx", "key": "lex-provider-key"},
			EditorConfig: map[string]any{"mode": "edit"},
			Permissions: DocumentEditorPermissions{
				Mode:     DocumentEditorModeEdit,
				Edit:     true,
				Comment:  true,
				Review:   true,
				Download: true,
				Print:    true,
				Copy:     true,
			},
			ProviderConfig: map[string]any{"onlyoffice": map[string]any{"documentType": "word"}},
			Metadata:       map[string]any{"session_id": sessionID.String()},
		},
	})
	if err != nil {
		t.Fatalf("marshal open result: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal open result: %v", err)
	}
	for _, key := range []string{"session", "document", "lock", "config"} {
		if _, ok := got[key]; !ok {
			t.Fatalf("open result missing %q in %v", key, got)
		}
	}
	session := got["session"].(map[string]any)
	if session["requested_mode"] != "edit" || session["permission_mode"] != "edit" || session["status"] != "active" {
		t.Fatalf("session mode/status = %v, want edit/edit/active", session)
	}
	config := got["config"].(map[string]any)
	if config["document_type"] != "word" {
		t.Fatalf("config document_type = %v, want word", config["document_type"])
	}
}

func TestDocumentEditorPreflightAndAuditJSONShape(t *testing.T) {
	sessionID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	lockID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	actorID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	provider := "onlyoffice"

	preflightRaw, err := json.Marshal(DocumentEditorPreflightResult{
		Accepted: true,
		Preflight: map[string]any{
			"status":   "warning",
			"blocking": false,
			"checks": []any{
				map[string]any{"key": "docx_format", "status": "passed", "severity": "info"},
			},
		},
	})
	if err != nil {
		t.Fatalf("marshal preflight result: %v", err)
	}
	var preflight map[string]any
	if err := json.Unmarshal(preflightRaw, &preflight); err != nil {
		t.Fatalf("unmarshal preflight result: %v", err)
	}
	if preflight["accepted"] != true {
		t.Fatalf("preflight accepted = %v, want true", preflight["accepted"])
	}
	if _, ok := preflight["preflight"].(map[string]any); !ok {
		t.Fatalf("preflight payload = %T, want object", preflight["preflight"])
	}

	auditRaw, err := json.Marshal(DocumentEditorAuditEntry{
		ID:          uuid.MustParse("44444444-4444-4444-4444-444444444444"),
		TenantID:    uuid.MustParse("55555555-5555-5555-5555-555555555555"),
		DocumentID:  uuid.MustParse("66666666-6666-6666-6666-666666666666"),
		SessionID:   &sessionID,
		LockID:      &lockID,
		Action:      "editor.lock_acquired",
		Provider:    &provider,
		ActorUserID: &actorID,
		Detail:      map[string]any{"lock_type": "checkout"},
		CreatedAt:   time.Date(2026, 6, 26, 12, 30, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("marshal audit entry: %v", err)
	}
	var audit map[string]any
	if err := json.Unmarshal(auditRaw, &audit); err != nil {
		t.Fatalf("unmarshal audit entry: %v", err)
	}
	for _, key := range []string{"id", "tenant_id", "document_id", "session_id", "lock_id", "action", "provider", "actor_user_id", "detail", "created_at"} {
		if _, ok := audit[key]; !ok {
			t.Fatalf("audit entry missing %q in %v", key, audit)
		}
	}
}

func TestDocumentEditorWorkspaceSummaryJSONShape(t *testing.T) {
	documentID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	generatedAt := time.Date(2026, 6, 26, 15, 0, 0, 0, time.UTC)

	raw, err := json.Marshal(DocumentEditorHealthScore{
		Document: DocumentEditorDocument{
			ID:             documentID,
			Title:          "Vendor Services Agreement",
			FileType:       "docx",
			CurrentVersion: 4,
		},
		Score:  82.5,
		Status: "healthy",
		Checks: []DocumentEditorHealthCheck{
			{Key: "preflight", Status: "passed", Severity: "info"},
		},
		Signals: []DocumentEditorWorkspaceItem{
			{Key: "issue-1", Title: "Review liability", Status: "open", Severity: "medium"},
		},
		GeneratedAt: generatedAt,
	})
	if err != nil {
		t.Fatalf("marshal health score: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal health score: %v", err)
	}
	for _, key := range []string{"document", "score", "status", "checks", "signals", "generated_at"} {
		if _, ok := got[key]; !ok {
			t.Fatalf("health score missing %q in %v", key, got)
		}
	}
}

func TestDocumentEditorSnapshotAndCallbackJSONShape(t *testing.T) {
	sessionID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	createdBy := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	createdAt := time.Date(2026, 6, 26, 14, 0, 0, 0, time.UTC)
	summary := "Before Word editor redlines"

	snapshotRaw, err := json.Marshal(DocumentEditorVersionSnapshot{
		ID:            uuid.MustParse("33333333-3333-3333-3333-333333333333"),
		TenantID:      uuid.MustParse("44444444-4444-4444-4444-444444444444"),
		DocumentID:    uuid.MustParse("55555555-5555-5555-5555-555555555555"),
		SessionID:     &sessionID,
		Version:       8,
		ChangeSummary: &summary,
		CreatedBy:     createdBy,
		CreatedAt:     createdAt,
		Metadata:      map[string]any{"source": "word_editor", "provider": "onlyoffice"},
	})
	if err != nil {
		t.Fatalf("marshal snapshot: %v", err)
	}
	var snapshot map[string]any
	if err := json.Unmarshal(snapshotRaw, &snapshot); err != nil {
		t.Fatalf("unmarshal snapshot: %v", err)
	}
	for _, key := range []string{"id", "tenant_id", "document_id", "session_id", "version", "change_summary", "created_by", "created_at", "metadata"} {
		if _, ok := snapshot[key]; !ok {
			t.Fatalf("snapshot missing %q in %v", key, snapshot)
		}
	}
	if snapshot["version"] != float64(8) {
		t.Fatalf("snapshot version = %v, want 8", snapshot["version"])
	}

	callbackRaw, err := json.Marshal(DocumentEditorCallbackResult{
		VersionSnapshotRequested: true,
		Session: &DocumentEditorSession{
			ID:             sessionID,
			TenantID:       uuid.MustParse("66666666-6666-6666-6666-666666666666"),
			DocumentID:     uuid.MustParse("77777777-7777-7777-7777-777777777777"),
			Provider:       "onlyoffice",
			RequestedMode:  DocumentEditorModeEdit,
			PermissionMode: DocumentEditorModeEdit,
			Status:         DocumentEditorSessionActive,
			CreatedBy:      createdBy,
		},
	})
	if err != nil {
		t.Fatalf("marshal callback result: %v", err)
	}
	var callback map[string]any
	if err := json.Unmarshal(callbackRaw, &callback); err != nil {
		t.Fatalf("unmarshal callback result: %v", err)
	}
	if callback["version_snapshot_requested"] != true {
		t.Fatalf("callback version_snapshot_requested = %v, want true", callback["version_snapshot_requested"])
	}
	if _, ok := callback["session"].(map[string]any); !ok {
		t.Fatalf("callback session = %T, want object", callback["session"])
	}
}

func TestDocumentEditorMaturitySummaryJSONShape(t *testing.T) {
	documentID := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	tenantID := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	userID := uuid.MustParse("33333333-3333-3333-3333-333333333333")
	generatedAt := time.Date(2026, 6, 26, 15, 0, 0, 0, time.UTC)
	doc := DocumentEditorDocument{
		ID:             documentID,
		Title:          "Vendor MSA",
		FileType:       "docx",
		CurrentVersion: 7,
	}

	raw, err := json.Marshal(DocumentEditorNegotiationRoomSummary{
		Document: doc,
		Status:   "open",
		Phase:    "redline",
		Summary:  "Counterparty review in progress.",
		Participants: []DocumentEditorParticipant{
			{
				UserID:       &userID,
				Name:         "Aisha Counsel",
				Email:        "aisha@example.test",
				Role:         "legal",
				Organization: "Clario360",
				Status:       "active",
				Metadata:     map[string]any{"side": "internal"},
			},
		},
		PendingItems: []DocumentEditorWorkspaceItem{
			{Key: "issue-1", Title: "Resolve liability cap", Status: "open", Severity: "high"},
		},
		ActiveSessions: 2,
		RecentActivity: []DocumentEditorTimelineEvent{
			{Action: "editor.comment_added", ActorUserID: &userID, CreatedAt: generatedAt, Detail: map[string]any{"section": "4.1"}},
		},
		Metadata:    map[string]any{"tenant_id": tenantID.String()},
		GeneratedAt: generatedAt,
	})
	if err != nil {
		t.Fatalf("marshal negotiation room summary: %v", err)
	}

	var summary map[string]any
	if err := json.Unmarshal(raw, &summary); err != nil {
		t.Fatalf("unmarshal negotiation room summary: %v", err)
	}
	for _, key := range []string{"document", "status", "phase", "summary", "participants", "pending_items", "active_sessions", "recent_activity", "metadata", "generated_at"} {
		if _, ok := summary[key]; !ok {
			t.Fatalf("negotiation room summary missing %q in %v", key, summary)
		}
	}
	if got := len(summary["participants"].([]any)); got != 1 {
		t.Fatalf("participants length = %d, want 1", got)
	}

	healthRaw, err := json.Marshal(DocumentEditorHealthScore{
		Document:    doc,
		Score:       83.5,
		Status:      "needs_review",
		Checks:      []DocumentEditorHealthCheck{{Key: "defined_terms", Status: "warning", Severity: "medium", Message: "Undefined term"}},
		Signals:     []DocumentEditorWorkspaceItem{{Key: "playbook", Title: "Playbook deviations", Status: "open"}},
		Metadata:    map[string]any{"source": "word_editor"},
		GeneratedAt: generatedAt,
	})
	if err != nil {
		t.Fatalf("marshal health score: %v", err)
	}
	var health map[string]any
	if err := json.Unmarshal(healthRaw, &health); err != nil {
		t.Fatalf("unmarshal health score: %v", err)
	}
	for _, key := range []string{"document", "score", "status", "checks", "signals", "metadata", "generated_at"} {
		if _, ok := health[key]; !ok {
			t.Fatalf("health score missing %q in %v", key, health)
		}
	}
	if health["score"] != 83.5 {
		t.Fatalf("health score = %v, want 83.5", health["score"])
	}
}
