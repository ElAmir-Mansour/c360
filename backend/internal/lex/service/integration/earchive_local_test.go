package integration

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/lex/model"
)

// nowFixed is a deterministic clock for the local-backend tests.
func nowFixed() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) }

// =============================================================================
// e-Archiving LOCAL (reversible, non-WORM) backend tests.
//
// Coverage: the local filesystem transport round-trip (Put + sidecar + Stat +
// Dispose), reversibility (dispose always succeeds), the forced-none WORM mode,
// the metadata-only legal-hold marker, the connector's local archive happy path
// (archive_ref local://…, worm=none, stamped metadata, real file on disk), the
// idempotent dedup gate, and the reversible dispose (no break-glass required
// because local is non-WORM by construction).
// =============================================================================

func localEndpoint(t *testing.T, baseDir, bucket string) model.IntegrationEndpoint {
	t.Helper()
	cfg := map[string]any{
		"protocol":     "local",
		"backend":      "local",
		"bucket":       bucket,
		"base_dir":     baseDir,
		"worm_enabled": false,
	}
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Kind:     model.IntegrationKindArchiving,
		Code:     "archive-local",
		Status:   model.IntegrationStatusActive,
		Config:   cfg,
	}
}

func TestParseArchiveConfig_LocalForcesNonWORM(t *testing.T) {
	// Even if a caller tries to request WORM on a local backend, it must be forced
	// to none (reversible by construction).
	cfg := parseArchiveConfig(map[string]any{
		"protocol":     "local",
		"bucket":       "b",
		"worm_enabled": true,
		"worm_mode":    "compliance",
	})
	if cfg.Backend != backendLocal {
		t.Fatalf("expected backendLocal, got %q", cfg.Backend)
	}
	if cfg.WORMMode != WORMModeNone {
		t.Fatalf("local backend must force WORMModeNone, got %q", cfg.WORMMode)
	}
	if !cfg.retainUntil(nowFixed).IsZero() {
		t.Error("local backend must never carry a retain-until window")
	}
	if cfg.BaseDir == "" {
		t.Error("local backend must resolve a base_dir")
	}
}

func TestLocalArchiveClient_RoundTripAndReversible(t *testing.T) {
	base := t.TempDir()
	client, err := NewLocalArchiveClient(LocalArchiveConfig{BaseDir: base, Bucket: "lex-earchive-demo"})
	if err != nil {
		t.Fatalf("new local client: %v", err)
	}
	if client.Mode() != WORMModeNone {
		t.Fatalf("local client mode must be none, got %q", client.Mode())
	}

	ctx := context.Background()
	probe, err := client.Probe(ctx)
	if err != nil || !probe.Writable {
		t.Fatalf("probe should report writable: %v %+v", err, probe)
	}
	if !probe.InKingdom {
		t.Error("local is operator-asserted in-Kingdom")
	}

	key := "tenant/doc/v1/abc123.archive"
	content := []byte("hello-archive")
	put, err := client.Put(ctx, key, content, nowFixed(), map[string]string{"lex-document-id": "doc"})
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	if put.AppliedMode != WORMModeNone || !put.RetainUntil.IsZero() {
		t.Fatalf("local put must be non-WORM with zero retain-until: mode=%q retain=%v", put.AppliedMode, put.RetainUntil)
	}
	if put.SHA256 == "" {
		t.Error("put must return a content hash")
	}

	// The object + sidecar exist on disk.
	objPath := filepath.Join(base, "lex-earchive-demo", filepath.FromSlash(key))
	if _, statErr := os.Stat(objPath); statErr != nil {
		t.Fatalf("archived object should exist on disk: %v", statErr)
	}
	if _, statErr := os.Stat(objPath + ".meta.json"); statErr != nil {
		t.Fatalf("sidecar should exist on disk: %v", statErr)
	}
	if size, serr := client.Stat(ctx, key); serr != nil || size != int64(len(content)) {
		t.Fatalf("stat wrong: size=%d err=%v", size, serr)
	}

	// Dispose is REVERSIBLE: it removes the object (never refused by a lock).
	if derr := client.Dispose(ctx, key, ""); derr != nil {
		t.Fatalf("dispose should succeed (reversible): %v", derr)
	}
	if _, statErr := os.Stat(objPath); !os.IsNotExist(statErr) {
		t.Error("dispose must remove the archived object")
	}
	// Idempotent dispose: a second dispose on a missing object is not an error.
	if derr := client.Dispose(ctx, key, ""); derr != nil {
		t.Errorf("second dispose should be idempotent: %v", derr)
	}
}

func TestLocalArchiveClient_LegalHoldMarkerBlocksDispose(t *testing.T) {
	base := t.TempDir()
	client, _ := NewLocalArchiveClient(LocalArchiveConfig{BaseDir: base, Bucket: "b"})
	ctx := context.Background()
	key := "t/d/v1/h.archive"
	if _, err := client.Put(ctx, key, []byte("x"), nowFixed(), nil); err != nil {
		t.Fatalf("put: %v", err)
	}
	if err := client.SetLegalHold(ctx, key, true); err != nil {
		t.Fatalf("set legal hold: %v", err)
	}
	if held, _ := client.LegalHold(ctx, key); !held {
		t.Fatal("legal-hold marker should be set")
	}
	// The metadata-only marker blocks dispose at the storage layer.
	if err := client.Dispose(ctx, key, ""); err != ErrArchiveObjectLocked {
		t.Fatalf("expected ErrArchiveObjectLocked while marker set, got %v", err)
	}
	// Clearing the marker makes dispose succeed (reversible).
	if err := client.SetLegalHold(ctx, key, false); err != nil {
		t.Fatalf("clear legal hold: %v", err)
	}
	if err := client.Dispose(ctx, key, ""); err != nil {
		t.Fatalf("dispose after clearing marker should succeed: %v", err)
	}
}

func TestLocalArchiveClient_PathTraversalRejected(t *testing.T) {
	base := t.TempDir()
	client, _ := NewLocalArchiveClient(LocalArchiveConfig{BaseDir: base, Bucket: "b"})
	if _, err := client.Put(context.Background(), "../../etc/passwd", []byte("x"), nowFixed(), nil); err == nil {
		t.Fatal("a path-traversal key must be rejected")
	}
}

func TestMissingRequired_Local(t *testing.T) {
	if (archiveConfig{Backend: backendLocal, Bucket: "b"}).missingRequired() != "" {
		t.Error("local with bucket should be complete")
	}
	if (archiveConfig{Backend: backendLocal}).missingRequired() != "bucket" {
		t.Error("local without bucket should require bucket")
	}
}

func TestTestConnection_Local_Writable(t *testing.T) {
	base := t.TempDir()
	c := newConnector(nil, nil, nil, nil)
	ep := localEndpoint(t, base, "lex-earchive-demo")
	res, err := c.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("local TestConnection should succeed: %v", err)
	}
	if !res.Reachable {
		t.Fatalf("local endpoint should be reachable: %s", res.Detail)
	}
	if wm, _ := res.Metadata["worm_mode"].(string); wm != string(WORMModeNone) {
		t.Errorf("local worm_mode should be none, got %q", wm)
	}
	if rev, _ := res.Metadata["reversible"].(bool); !rev {
		t.Error("local backend should be flagged reversible")
	}
}

func TestArchive_Local_NonWORM_StampsRefAndWritesFile(t *testing.T) {
	base := t.TempDir()
	doc, ver := newTestDoc()
	docs := &fakeDocStore{doc: doc, version: ver}
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close()
	// dedup miss, lastManifest miss, insert.
	mock.ExpectQuery("SELECT object_key").WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errInline("no rows"))
	mock.ExpectQuery("SELECT entry_hash").WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errInline("no rows"))
	mock.ExpectExec("INSERT INTO lex_document_archive_manifest").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	c := newConnector(nil, mock, docs, nil)
	ep := localEndpoint(t, base, "lex-earchive-demo")
	res, ierr := c.Invoke(context.Background(), ep, "archive", map[string]any{"document_id": doc.ID.String()})
	if ierr != nil {
		t.Fatalf("local archive failed: %v (%s)", ierr, res.Detail)
	}
	if !res.Success {
		t.Fatalf("local archive should succeed: %s", res.Detail)
	}
	if !strings.HasPrefix(res.Reference, "local://lex-earchive-demo/") {
		t.Errorf("archive_ref should be a local:// ref, got %q", res.Reference)
	}
	if wm, _ := res.Output["worm_mode"].(string); wm != string(WORMModeNone) {
		t.Errorf("worm_mode must be none, got %q", wm)
	}
	if _, hasRetain := res.Output["retain_until"]; hasRetain {
		t.Error("local archive must NOT carry a retain_until")
	}
	if docs.updateCalls == 0 {
		t.Error("archive_ref should be stamped onto the document")
	}
	if archive, ok := doc.Metadata["archive"].(map[string]any); !ok {
		t.Error("document metadata should carry an archive block")
	} else if archive["worm_mode"] != string(WORMModeNone) {
		t.Errorf("stamped worm_mode should be none, got %v", archive["worm_mode"])
	}
	// A real file exists under the base dir.
	var found bool
	_ = filepath.Walk(filepath.Join(base, "lex-earchive-demo"), func(p string, info os.FileInfo, _ error) error {
		if info != nil && !info.IsDir() && strings.HasSuffix(p, ".archive") {
			found = true
		}
		return nil
	})
	if !found {
		t.Error("expected a .archive file written under the base dir")
	}
}

func TestDispose_Local_ReversibleNoBreakGlass(t *testing.T) {
	base := t.TempDir()
	doc, ver := newTestDoc()
	// Stamp a local archive_ref so dispose can resolve the object key.
	key := "t/d/v1/h.archive"
	doc.Metadata["archive"] = map[string]any{"archive_ref": "local://lex-earchive-demo/" + key}
	docs := &fakeDocStore{doc: doc, version: ver}

	// Pre-create the object so dispose has something to remove.
	client, _ := NewLocalArchiveClient(LocalArchiveConfig{BaseDir: base, Bucket: "lex-earchive-demo"})
	if _, err := client.Put(context.Background(), key, []byte("x"), nowFixed(), nil); err != nil {
		t.Fatalf("seed object: %v", err)
	}

	c := newConnector(nil, nil, docs, &fakeHoldStore{held: false})
	ep := localEndpoint(t, base, "lex-earchive-demo")
	// No break_glass — local is non-WORM so the WORM gate does not require it.
	res, err := c.Invoke(context.Background(), ep, "dispose", map[string]any{"document_id": doc.ID.String()})
	if err != nil || !res.Success {
		t.Fatalf("local dispose should succeed without break-glass: %v (%s)", err, res.Detail)
	}
	if _, statErr := client.Stat(context.Background(), key); statErr != ErrArchiveObjectNotFound {
		t.Errorf("object should be gone after dispose, stat err=%v", statErr)
	}
}
