package integration

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// e-Archiving connector tests.
//
// Coverage: in-Kingdom (PDPL) fail-closed, WORM mode + retention semantics,
// tamper-evident manifest chaining, deterministic/idempotent archive keys,
// honest Probe verdicts, idempotent re-archive (manifest dedup), WORM dispose
// gating (break-glass / legal-hold / retention), the in-process sandbox, the
// resilient CMIS push (retry on transient 5xx), and detail redaction.
//
// The S3 object-lock transport's live behaviour (PutObjectRetention/LegalHold)
// requires a real object-lock-enabled bucket; those are covered structurally via
// the pure helpers here and exercised live in the cross-suite when a sovereign
// MinIO is wired. The CMIS path is exercised end-to-end against httptest.
// =============================================================================

// --- fakes -------------------------------------------------------------------

type fakeDocStore struct {
	doc         *model.LegalDocument
	version     *model.DocumentVersion
	updateCalls int
}

func (f *fakeDocStore) Get(_ context.Context, _, _ uuid.UUID) (*model.LegalDocument, error) {
	return f.doc, nil
}
func (f *fakeDocStore) GetLatestVersion(_ context.Context, _, _ uuid.UUID) (*model.DocumentVersion, error) {
	return f.version, nil
}
func (f *fakeDocStore) ListVersions(_ context.Context, _, _ uuid.UUID) ([]model.DocumentVersion, error) {
	if f.version == nil {
		return nil, nil
	}
	return []model.DocumentVersion{*f.version}, nil
}
func (f *fakeDocStore) Update(_ context.Context, _ repository.Queryer, doc *model.LegalDocument) error {
	f.updateCalls++
	f.doc = doc
	return nil
}

type fakeHoldStore struct {
	held bool
	err  error
}

func (f *fakeHoldStore) IsSubjectHeld(_ context.Context, _ repository.Queryer, _ uuid.UUID, _ model.LegalHoldSubjectType, _ uuid.UUID) (bool, error) {
	return f.held, f.err
}
func (f *fakeHoldStore) GetActiveForSubject(_ context.Context, _ uuid.UUID, _ model.LegalHoldSubjectType, _ uuid.UUID) (*model.LegalHold, error) {
	return nil, nil
}

func newTestDoc() (*model.LegalDocument, *model.DocumentVersion) {
	docID := uuid.New()
	return &model.LegalDocument{
			ID:       docID,
			Title:    "Settlement Agreement",
			Metadata: map[string]any{},
		}, &model.DocumentVersion{
			ID:          uuid.New(),
			Version:     3,
			ContentHash: "abc123def456abc123def456",
		}
}

func cmisEndpoint(t *testing.T, baseURL string, inKingdom bool) model.IntegrationEndpoint {
	t.Helper()
	cfg := map[string]any{
		"protocol":         "cmis",
		"base_url":         baseURL,
		"root_folder_path": "/Legal/Archive",
		"username":         "svc",
		"password":         "s3cr3t",
		"repository_id":    "default",
		"worm_mode":        "compliance",
		"retention_days":   3650,
	}
	if inKingdom {
		cfg["region"] = "riyadh"
	} else {
		cfg["region"] = "us-east-1"
	}
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Kind:     model.IntegrationKindArchiving,
		Code:     "archive-cmis",
		Status:   model.IntegrationStatusActive,
		Config:   cfg,
	}
}

// --- pure helper tests -------------------------------------------------------

func TestRegionInKingdom_FailClosed(t *testing.T) {
	in := []string{"riyadh", "jeddah", "dammam", "ksa-central", "sa-riyadh-1", "in-kingdom", " Riyadh "}
	for _, r := range in {
		if !RegionInKingdom(r) {
			t.Errorf("expected %q to be in-Kingdom", r)
		}
	}
	out := []string{"", "us-east-1", "eu-west-1", "me-central-1" /* AWS UAE — excluded */, "unknown"}
	for _, r := range out {
		if RegionInKingdom(r) {
			t.Errorf("expected %q to be OUT of Kingdom (fail-closed)", r)
		}
	}
}

func TestComputeEntryHash_ChainAndTamper(t *testing.T) {
	genesis := ArchiveManifestEntry{Sequence: 1, DocumentID: "d1", Version: 1, ContentHash: "h1", ObjectHash: "o1", PrevHash: ""}
	genesis.EntryHash = ComputeEntryHash(genesis)
	if genesis.EntryHash == "" {
		t.Fatal("genesis entry hash empty")
	}
	second := ArchiveManifestEntry{Sequence: 2, DocumentID: "d1", Version: 2, ContentHash: "h2", ObjectHash: "o2", PrevHash: genesis.EntryHash}
	second.EntryHash = ComputeEntryHash(second)
	if second.EntryHash == genesis.EntryHash {
		t.Fatal("chained entries must differ")
	}
	// Tamper: flipping any field changes the hash.
	tampered := second
	tampered.ContentHash = "h2-altered"
	if ComputeEntryHash(tampered) == second.EntryHash {
		t.Fatal("tampered content_hash must break the chain")
	}
	tampered2 := second
	tampered2.PrevHash = "forged"
	if ComputeEntryHash(tampered2) == second.EntryHash {
		t.Fatal("tampered prev_hash must break the chain")
	}
}

func TestNormalizeWORMMode_DefaultsCompliance(t *testing.T) {
	if NormalizeWORMMode("") != WORMModeCompliance {
		t.Error("empty should default to compliance (safest)")
	}
	if NormalizeWORMMode("garbage") != WORMModeCompliance {
		t.Error("unknown should default to compliance")
	}
	if NormalizeWORMMode("GOVERNANCE") != WORMModeGovernance {
		t.Error("case-insensitive governance")
	}
	if NormalizeWORMMode("none") != WORMModeNone {
		t.Error("none preserved")
	}
}

func TestArchiveConfig_RetainUntil(t *testing.T) {
	now := func() time.Time { return time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC) }
	cfg := archiveConfig{WORMMode: WORMModeCompliance, RetentionDays: 30}
	got := cfg.retainUntil(now)
	want := now().Add(30 * 24 * time.Hour).UTC()
	if !got.Equal(want) {
		t.Errorf("retainUntil = %v want %v", got, want)
	}
	// WORMModeNone => zero retain-until.
	none := archiveConfig{WORMMode: WORMModeNone}
	if !none.retainUntil(now).IsZero() {
		t.Error("WORMModeNone must yield zero retain-until")
	}
	// Zero retention days => 10y default (non-zero).
	def := archiveConfig{WORMMode: WORMModeGovernance}
	if def.retainUntil(now).IsZero() {
		t.Error("default retention must be non-zero")
	}
}

func TestMissingRequired_PerBackend(t *testing.T) {
	cases := []struct {
		name string
		cfg  archiveConfig
		want bool // expect a missing field
	}{
		{"s3-complete", archiveConfig{Backend: backendS3ObjectLock, S3Endpoint: "s3.ksa:9000", Bucket: "b", AccessKeyID: "k", SecretAccessKey: "s"}, false},
		{"s3-no-bucket", archiveConfig{Backend: backendS3ObjectLock, S3Endpoint: "s3.ksa:9000", AccessKeyID: "k", SecretAccessKey: "s"}, true},
		{"s3-no-creds", archiveConfig{Backend: backendS3ObjectLock, S3Endpoint: "s3.ksa:9000", Bucket: "b"}, true},
		{"cmis-complete", archiveConfig{Backend: backendCMIS, BaseURL: "https://cmis", RootFolderPath: "/x"}, false},
		{"cmis-no-folder", archiveConfig{Backend: backendCMIS, BaseURL: "https://cmis"}, true},
		{"sp-complete", archiveConfig{Backend: backendSharePoint, BaseURL: "https://graph", SiteID: "s", BearerToken: "t"}, false},
		{"sp-no-token", archiveConfig{Backend: backendSharePoint, BaseURL: "https://graph", SiteID: "s"}, true},
		{"unknown", archiveConfig{Backend: "bogus"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.cfg.missingRequired() != ""
			if got != tc.want {
				t.Errorf("missingRequired present=%v want %v (%q)", got, tc.want, tc.cfg.missingRequired())
			}
		})
	}
}

func TestBuildArchiveKey_DeterministicAndContentAddressed(t *testing.T) {
	doc, ver := newTestDoc()
	tenant := uuid.New()
	k1 := buildArchiveKey(tenant, doc, ver)
	k2 := buildArchiveKey(tenant, doc, ver)
	if k1 != k2 {
		t.Fatalf("archive key must be deterministic: %q != %q", k1, k2)
	}
	if !strings.Contains(k1, doc.ID.String()) || !strings.Contains(k1, "v3") {
		t.Errorf("key should embed document id + version: %q", k1)
	}
	// A changed content hash yields a different key (content-addressed).
	ver2 := *ver
	ver2.ContentHash = "totally-different-hash-value"
	if buildArchiveKey(tenant, doc, &ver2) == k1 {
		t.Error("different content hash must yield a different key")
	}
}

func TestArchiveSanitizeDetail_Redacts(t *testing.T) {
	err := errInline("auth failed: Bearer ey.token.value")
	got := archiveSanitizeDetail("cmis", err)
	if strings.Contains(got, "ey.token.value") {
		t.Errorf("secret leaked in detail: %q", got)
	}
	if !strings.Contains(got, "[redacted]") {
		t.Errorf("expected [redacted] marker: %q", got)
	}
}

type errInline string

func (e errInline) Error() string { return string(e) }

// --- Probe honesty -----------------------------------------------------------

func newConnector(client *http.Client, db repository.Queryer, docs docStore, holds holdStore) *EArchiveConnector {
	return NewEArchiveConnector(EArchiveConnectorConfig{
		Endpoints: nil,
		Documents: docs,
		Holds:     holds,
		DB:        db,
		Client:    client,
		Timeout:   2 * time.Second,
	})
}

func TestProbe_HonestVerdicts(t *testing.T) {
	c := newConnector(nil, nil, nil, nil)
	now := time.Now()

	// Active + in-Kingdom + complete config => reachable.
	ep := cmisEndpoint(t, "https://cmis.local", true)
	if h := c.Probe(context.Background(), ep, now); !h.Reachable {
		t.Errorf("active in-Kingdom endpoint should be reachable: %s", h.Detail)
	}

	// Active + out-of-Kingdom => fail-closed.
	epOut := cmisEndpoint(t, "https://cmis.local", false)
	if h := c.Probe(context.Background(), epOut, now); h.Reachable {
		t.Errorf("out-of-Kingdom endpoint must NOT be reachable (PDPL fail-closed): %s", h.Detail)
	}

	// Active but missing config => not reachable.
	epMissing := cmisEndpoint(t, "https://cmis.local", true)
	delete(epMissing.Config, "root_folder_path")
	if h := c.Probe(context.Background(), epMissing, now); h.Reachable {
		t.Errorf("incomplete config must NOT be reachable: %s", h.Detail)
	}

	// Planned / disabled => not reachable, honest detail.
	epPlanned := cmisEndpoint(t, "https://cmis.local", true)
	epPlanned.Status = model.IntegrationStatusPlanned
	if h := c.Probe(context.Background(), epPlanned, now); h.Reachable || !strings.Contains(h.Detail, "planned") {
		t.Errorf("planned endpoint verdict wrong: %+v", h)
	}
}

// --- PDPL fail-closed on archive write --------------------------------------

func TestArchive_PDPLFailClosed(t *testing.T) {
	doc, ver := newTestDoc()
	c := newConnector(nil, nil, &fakeDocStore{doc: doc, version: ver}, nil)
	ep := cmisEndpoint(t, "https://cmis.local", false) // out-of-Kingdom region
	res, err := c.Invoke(context.Background(), ep, "archive", map[string]any{"document_id": doc.ID.String()})
	if err == nil {
		t.Fatal("expected PDPL fail-closed error")
	}
	if res.Success {
		t.Fatal("archive must NOT succeed out-of-Kingdom")
	}
	if !strings.Contains(strings.ToLower(res.Detail), "kingdom") {
		t.Errorf("detail should mention Kingdom: %q", res.Detail)
	}
}

// --- CMIS archive happy path + retry on transient 5xx -----------------------

func TestArchive_CMIS_RetryThenSuccess(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			n := atomic.AddInt32(&calls, 1)
			if n == 1 {
				w.WriteHeader(http.StatusServiceUnavailable) // transient -> should retry
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_, _ = w.Write([]byte(`{"properties":{"cmis:objectId":{"value":"obj-99"}}}`))
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	doc, ver := newTestDoc()
	docs := &fakeDocStore{doc: doc, version: ver}
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close()
	// dedup lookup (findArchived): miss => no row.
	mock.ExpectQuery("SELECT object_key").WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errInline("no rows"))
	// lastManifest: no prior entry.
	mock.ExpectQuery("SELECT entry_hash").WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnError(errInline("no rows"))
	// manifest insert.
	mock.ExpectExec("INSERT INTO lex_document_archive_manifest").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(), pgxmock.AnyArg(),
			pgxmock.AnyArg(), pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	c := newConnector(srv.Client(), mock, docs, nil)
	ep := cmisEndpoint(t, srv.URL, true)
	res, ierr := c.Invoke(context.Background(), ep, "archive", map[string]any{"document_id": doc.ID.String()})
	if ierr != nil {
		t.Fatalf("archive failed: %v (%s)", ierr, res.Detail)
	}
	if !res.Success {
		t.Fatalf("archive not successful: %s", res.Detail)
	}
	if atomic.LoadInt32(&calls) < 2 {
		t.Errorf("expected a retry after the 503 (calls=%d)", calls)
	}
	if docs.updateCalls == 0 {
		t.Error("archive_ref should have been stamped onto the document")
	}
}

// --- idempotent re-archive (manifest dedup) ---------------------------------

func TestArchive_IdempotentDedup(t *testing.T) {
	doc, ver := newTestDoc()
	docs := &fakeDocStore{doc: doc, version: ver}
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock: %v", err)
	}
	defer mock.Close()

	// findArchived HIT: an entry for this (doc, version, content_hash) already exists.
	rows := pgxmock.NewRows([]string{"object_key", "object_hash", "entry_hash", "sequence"}).
		AddRow("tenant/doc/v3/abc.archive", "objhash", "entryhash", 7)
	mock.ExpectQuery("SELECT object_key").
		WithArgs(pgxmock.AnyArg(), pgxmock.AnyArg(), 3, ver.ContentHash).
		WillReturnRows(rows)

	c := newConnector(nil, mock, docs, nil)
	ep := cmisEndpoint(t, "https://cmis.local", true)
	res, ierr := c.Invoke(context.Background(), ep, "archive", map[string]any{"document_id": doc.ID.String()})
	if ierr != nil {
		t.Fatalf("idempotent archive errored: %v", ierr)
	}
	if !res.Success {
		t.Fatalf("idempotent archive should succeed: %s", res.Detail)
	}
	if dd, _ := res.Output["deduplicated"].(bool); !dd {
		t.Error("expected deduplicated=true on re-archive")
	}
	if docs.updateCalls != 0 {
		t.Error("idempotent no-op must NOT re-stamp / re-write")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unmet expectations (a second write leaked?): %v", err)
	}
}

// --- WORM dispose gating -----------------------------------------------------

func TestDispose_ComplianceRequiresBreakGlass(t *testing.T) {
	doc, ver := newTestDoc()
	c := newConnector(nil, nil, &fakeDocStore{doc: doc, version: ver}, &fakeHoldStore{})
	ep := cmisEndpoint(t, "https://cmis.local", true) // worm_mode=compliance
	res, err := c.Invoke(context.Background(), ep, "dispose", map[string]any{"document_id": doc.ID.String()})
	if err == nil || res.Success {
		t.Fatal("compliance WORM dispose must be blocked without break-glass")
	}
	if !strings.Contains(strings.ToLower(res.Detail), "break-glass") {
		t.Errorf("detail should cite break-glass: %q", res.Detail)
	}
}

func TestDispose_ActiveLegalHoldBlocks(t *testing.T) {
	doc, ver := newTestDoc()
	c := newConnector(nil, nil, &fakeDocStore{doc: doc, version: ver}, &fakeHoldStore{held: true})
	ep := cmisEndpoint(t, "https://cmis.local", true)
	// break_glass set so we get past gate 1 and hit the legal-hold gate.
	res, err := c.Invoke(context.Background(), ep, "dispose", map[string]any{
		"document_id": doc.ID.String(),
		"break_glass": true,
	})
	if err == nil || res.Success {
		t.Fatal("active legal hold must block dispose even with break-glass")
	}
	if !strings.Contains(strings.ToLower(res.Detail), "legal hold") {
		t.Errorf("detail should cite legal hold: %q", res.Detail)
	}
}

func TestDispose_RetentionNotElapsedBlocks(t *testing.T) {
	doc, ver := newTestDoc()
	// Stamp a future retain_until on the doc metadata so the retention gate fires.
	future := time.Now().Add(365 * 24 * time.Hour).UTC().Format(time.RFC3339)
	doc.Metadata["archive"] = map[string]any{
		"archive_ref":  "cmis://default/obj-1",
		"retain_until": future,
	}
	c := newConnector(nil, nil, &fakeDocStore{doc: doc, version: ver}, &fakeHoldStore{held: false})
	ep := cmisEndpoint(t, "https://cmis.local", true)
	res, err := c.Invoke(context.Background(), ep, "dispose", map[string]any{
		"document_id": doc.ID.String(),
		"break_glass": true,
	})
	if err == nil || res.Success {
		t.Fatal("dispose must be blocked while retention has not elapsed")
	}
	if !strings.Contains(strings.ToLower(res.Detail), "retention") {
		t.Errorf("detail should cite retention: %q", res.Detail)
	}
}

// --- release-hold fail-closed ------------------------------------------------

func TestReleaseHold_FailClosedOnActiveLexHold(t *testing.T) {
	doc, ver := newTestDoc()
	doc.Metadata["archive"] = map[string]any{"archive_ref": "s3://bucket/key1"}
	c := newConnector(nil, nil, &fakeDocStore{doc: doc, version: ver}, &fakeHoldStore{held: true})
	ep := cmisEndpoint(t, "https://cmis.local", true)
	res, err := c.Invoke(context.Background(), ep, "release_hold", map[string]any{
		"document_id": doc.ID.String(),
		"object_key":  "key1",
	})
	if err == nil || res.Success {
		t.Fatal("release_hold must be refused while a lex legal hold is active")
	}
}

// --- sandbox -----------------------------------------------------------------

func TestSandboxInvoke_ArchiveAndGates(t *testing.T) {
	c := newConnector(nil, nil, nil, nil)
	ep := cmisEndpoint(t, "https://cmis.local", true)

	// archive: marked sandbox, never touches a backend.
	res, err := c.SandboxInvoke(context.Background(), ep, "archive", map[string]any{
		"document_id":  uuid.NewString(),
		"content_hash": "deadbeef",
	})
	if err != nil || !res.Success {
		t.Fatalf("sandbox archive should succeed: %v %s", err, res.Detail)
	}
	if sb, _ := res.Output["sandbox"].(bool); !sb {
		t.Error("sandbox result must be marked sandbox=true")
	}
	if !strings.Contains(res.Detail, "[sandbox]") {
		t.Errorf("detail should be marked sandbox: %q", res.Detail)
	}

	// dispose without break-glass: blocked even in sandbox (real gate logic).
	res2, _ := c.SandboxInvoke(context.Background(), ep, "dispose", map[string]any{"document_id": uuid.NewString()})
	if res2.Success {
		t.Error("sandbox dispose must respect WORM break-glass gate")
	}

	// PDPL fail-closed honoured in sandbox too.
	epOut := cmisEndpoint(t, "https://cmis.local", false)
	res3, _ := c.SandboxInvoke(context.Background(), epOut, "archive", map[string]any{"document_id": uuid.NewString()})
	if res3.Success {
		t.Error("sandbox archive must fail-closed out-of-Kingdom")
	}
}

// --- TestConnection PDPL fail-closed before network --------------------------

func TestTestConnection_PDPLFailClosedBeforeNetwork(t *testing.T) {
	// Server that would 200 — but we must never reach it because the declared
	// region is out-of-Kingdom.
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hit = true
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	c := newConnector(srv.Client(), nil, nil, nil)
	ep := cmisEndpoint(t, srv.URL, false) // out-of-Kingdom
	res, err := c.TestConnection(context.Background(), ep)
	if err == nil {
		t.Fatal("expected PDPL fail-closed error from TestConnection")
	}
	if res.Reachable {
		t.Fatal("out-of-Kingdom endpoint must not be reachable")
	}
	if hit {
		t.Error("network must NOT be contacted when residency fails closed")
	}
}
