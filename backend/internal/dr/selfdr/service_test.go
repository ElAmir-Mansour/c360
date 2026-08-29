package selfdr

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"
)

// fakeDBTX satisfies DBTX for the service orchestration tests. Only Exec is
// exercised (by outbox.Write when a lifecycle event is staged); the faked store
// ignores the handle, so Query/QueryRow are never reached.
type fakeDBTX struct {
	execCalls int
	execErr   error
}

func (f *fakeDBTX) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	f.execCalls++
	return pgconn.CommandTag{}, f.execErr
}
func (f *fakeDBTX) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("selfdr test: Query not expected")
}
func (f *fakeDBTX) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("selfdr test: QueryRow not expected")
}

type fakeRunner struct {
	db       *fakeDBTX
	writeErr error
	readErr  error
}

func (r *fakeRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	if r.writeErr != nil {
		return r.writeErr
	}
	return fn(r.db)
}

func (r *fakeRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	if r.readErr != nil {
		return r.readErr
	}
	return fn(r.db)
}

type fakeStore struct {
	saved        *StoredAssessment
	saveErr      error
	getHdr       *StoredAssessment
	getErr       error
	latestHdr    *StoredAssessment
	latestErr    error
	savedArtifct *StoredArtifact
	saveArtErr   error
	artifacts    []StoredArtifact
	backupEv     map[string]BackupEvidence
	bundleEv     *OfflineRestoreBundle
}

func (s *fakeStore) SaveAssessment(_ context.Context, _ DBTX, a *StoredAssessment) error {
	if s.saveErr != nil {
		return s.saveErr
	}
	a.ID = uuid.New()
	a.CreatedAt = time.Now()
	s.saved = a
	return nil
}
func (s *fakeStore) GetAssessment(context.Context, DBTX, uuid.UUID) (*StoredAssessment, error) {
	return s.getHdr, s.getErr
}
func (s *fakeStore) LatestAssessment(context.Context, DBTX) (*StoredAssessment, error) {
	return s.latestHdr, s.latestErr
}
func (s *fakeStore) SaveArtifact(_ context.Context, _ DBTX, art *StoredArtifact) error {
	if s.saveArtErr != nil {
		return s.saveArtErr
	}
	art.ID = uuid.New()
	art.CreatedAt = time.Now()
	s.savedArtifct = art
	return nil
}
func (s *fakeStore) ListArtifacts(context.Context, DBTX, int) ([]StoredArtifact, error) {
	return s.artifacts, nil
}
func (s *fakeStore) LatestBackupEvidence(_ context.Context, _ DBTX, componentID string) (BackupEvidence, bool, error) {
	ev, ok := s.backupEv[componentID]
	return ev, ok, nil
}
func (s *fakeStore) LatestBundleEvidence(context.Context, DBTX) (OfflineRestoreBundle, bool, error) {
	if s.bundleEv == nil {
		return OfflineRestoreBundle{}, false, nil
	}
	return *s.bundleEv, true, nil
}

type fakeBackup struct {
	result BackupResult
	err    error
	called bool
	gotReq BackupRequest
}

func (f *fakeBackup) Capture(_ context.Context, req BackupRequest) (BackupResult, error) {
	f.called = true
	f.gotReq = req
	return f.result, f.err
}

type fakeBundle struct {
	result OfflineBundleResult
	err    error
	called bool
	gotReq OfflineBundleRequest
}

func (f *fakeBundle) Generate(_ context.Context, req OfflineBundleRequest) (OfflineBundleResult, error) {
	f.called = true
	f.gotReq = req
	return f.result, f.err
}

func newService(t *testing.T, store *fakeStore, runner *fakeRunner, opts ...func(*Config)) *Service {
	t.Helper()
	cfg := Config{
		Store:  store,
		Runner: runner,
		Clock:  func() time.Time { return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC) },
		Logger: zerolog.Nop(),
	}
	for _, o := range opts {
		o(&cfg)
	}
	return NewService(cfg)
}

func TestAssess_BaselineProfilePersistsAndStages(t *testing.T) {
	t.Parallel()
	store := &fakeStore{}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newService(t, store, runner)

	hdr, scored, err := svc.Assess(context.Background(), uuid.New(), uuid.New(), nil)
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	// Baseline has no recovery location / break-glass / backups, so it is not_ready
	// with critical findings — an honest readiness gap, persisted and staged.
	if scored.Verdict != VerdictNotReady {
		t.Errorf("verdict = %q, want not_ready for an unconfigured baseline", scored.Verdict)
	}
	if hdr.Critical == 0 {
		t.Error("expected critical findings for the unconfigured baseline")
	}
	if store.saved == nil {
		t.Error("assessment was not persisted")
	}
	if runner.db.execCalls != 1 {
		t.Errorf("event Exec calls = %d, want exactly 1 (staged in tx)", runner.db.execCalls)
	}
	if len(scored.RestorePlan.Waves) == 0 {
		t.Error("expected a restore plan with at least one wave")
	}
}

func TestAssess_EnrichmentOverlaysSealedEvidence(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	// A fully-ready single-component profile EXCEPT its backup evidence, which the
	// store supplies from a sealed artifact. Proves enrichment feeds real evidence.
	profile := &SelfDRProfile{
		ID: "cp",
		Components: []Component{{
			ID:        "postgres_control_db",
			Name:      "control db",
			Kind:      ComponentKindPostgresControlDB,
			Required:  true,
			Objective: RecoveryObjective{RTOSeconds: 3600, RPOSeconds: 300},
			Restore:   RestoreEvidence{Passed: true, TestedAt: now.AddDate(0, 0, -1), RTOSeconds: 100, RPOSeconds: 100},
		}},
		RequiredKinds:     []ComponentKind{ComponentKindPostgresControlDB},
		RecoveryLocations: []RecoveryLocation{{ID: "dr", Available: true, Independent: true}},
		BreakGlass:        BreakGlassAccess{Available: true, ControlPlaneIndependent: true},
	}
	store := &fakeStore{
		backupEv: map[string]BackupEvidence{
			"postgres_control_db": {Available: true, Immutable: true, Encrypted: true, MaxRPOSeconds: 60, CapturedAt: now.AddDate(0, 0, -1)},
		},
		bundleEv: &OfflineRestoreBundle{Available: true, Complete: true, GeneratedAt: now.AddDate(0, 0, -1)},
	}
	runner := &fakeRunner{db: &fakeDBTX{}}
	svc := newService(t, store, runner)

	_, scored, err := svc.Assess(context.Background(), uuid.New(), uuid.New(), profile)
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if scored.Verdict != VerdictReady {
		t.Fatalf("verdict = %q, want ready once sealed backup+bundle evidence is overlaid (findings=%+v)", scored.Verdict, scored.Findings)
	}
}

func TestCaptureBackup_NotConfigured(t *testing.T) {
	t.Parallel()
	svc := newService(t, &fakeStore{}, &fakeRunner{db: &fakeDBTX{}})
	_, err := svc.CaptureBackup(context.Background(), uuid.New(), uuid.New(), BackupRequest{ComponentID: "x", ComponentKind: ComponentKindPostgresControlDB})
	if !errors.Is(err, ErrSealingNotConfigured) {
		t.Fatalf("err = %v, want ErrSealingNotConfigured when no backup manager is wired", err)
	}
}

func TestCaptureBackup_SealsAndPersists(t *testing.T) {
	t.Parallel()
	store := &fakeStore{}
	runner := &fakeRunner{db: &fakeDBTX{}}
	backup := &fakeBackup{result: BackupResult{
		Evidence: BackupEvidence{Available: true, Immutable: true, Encrypted: true, LocationID: "dr-worm"},
		Artifact: ArtifactMetadata{Kind: ArtifactKindControlPlaneBackup, Key: "k/1", SHA256: "abc", SizeBytes: 1024},
	}}
	svc := newService(t, store, runner, func(c *Config) { c.Backup = backup })

	tenantID := uuid.New()
	art, err := svc.CaptureBackup(context.Background(), tenantID, uuid.New(), BackupRequest{
		ComponentID: "postgres_control_db", ComponentKind: ComponentKindPostgresControlDB,
	})
	if err != nil {
		t.Fatalf("CaptureBackup: %v", err)
	}
	if !backup.called || backup.gotReq.TenantID != tenantID.String() {
		t.Errorf("backup manager not called with tenant id; got %+v", backup.gotReq)
	}
	if art.Kind != ArtifactKindControlPlaneBackup || art.SHA256 != "abc" || !art.Immutable {
		t.Errorf("artifact = %+v, want sealed control-plane backup", art)
	}
	if store.savedArtifct == nil {
		t.Error("artifact was not persisted")
	}
	if runner.db.execCalls != 1 {
		t.Errorf("event Exec calls = %d, want 1", runner.db.execCalls)
	}
}

func TestGenerateBundle_NotConfigured(t *testing.T) {
	t.Parallel()
	svc := newService(t, &fakeStore{}, &fakeRunner{db: &fakeDBTX{}})
	_, err := svc.GenerateBundle(context.Background(), uuid.New(), uuid.New(), OfflineBundleRequest{})
	if !errors.Is(err, ErrSealingNotConfigured) {
		t.Fatalf("err = %v, want ErrSealingNotConfigured", err)
	}
}

func TestGenerateBundle_EnrichesAssessesSealsPersists(t *testing.T) {
	t.Parallel()
	store := &fakeStore{
		backupEv: map[string]BackupEvidence{},
		bundleEv: nil,
	}
	runner := &fakeRunner{db: &fakeDBTX{}}
	bundle := &fakeBundle{result: OfflineBundleResult{
		Evidence: OfflineRestoreBundle{Available: true, Complete: true, LocationID: "dr-worm"},
		Artifact: ArtifactMetadata{Kind: ArtifactKindOfflineBundle, Key: "b/1", SHA256: "def", SizeBytes: 2048},
	}}
	svc := newService(t, store, runner, func(c *Config) { c.Bundle = bundle })

	tenantID := uuid.New()
	art, err := svc.GenerateBundle(context.Background(), tenantID, uuid.New(), OfflineBundleRequest{})
	if err != nil {
		t.Fatalf("GenerateBundle: %v", err)
	}
	if !bundle.called {
		t.Fatal("bundle generator was not called")
	}
	// The service must enrich + assess before sealing so the bundle carries a fresh
	// assessment and the resolved (baseline) profile.
	if bundle.gotReq.TenantID != tenantID.String() {
		t.Errorf("bundle request tenant = %q, want %q", bundle.gotReq.TenantID, tenantID)
	}
	if bundle.gotReq.Assessment == nil {
		t.Error("bundle request should carry an assessment")
	}
	if len(bundle.gotReq.Profile.Components) == 0 {
		t.Error("bundle request should carry the resolved baseline profile")
	}
	if art.Kind != ArtifactKindOfflineBundle || store.savedArtifct == nil {
		t.Errorf("artifact = %+v not persisted as offline bundle", art)
	}
}

func TestGetReport_NotFound(t *testing.T) {
	t.Parallel()
	store := &fakeStore{getErr: ErrAssessmentNotFound}
	svc := newService(t, store, &fakeRunner{db: &fakeDBTX{}})
	_, err := svc.GetReport(context.Background(), uuid.New(), uuid.New())
	if !errors.Is(err, ErrAssessmentNotFound) {
		t.Fatalf("err = %v, want ErrAssessmentNotFound", err)
	}
}

func TestGetReport_IncludesArtifacts(t *testing.T) {
	t.Parallel()
	id := uuid.New()
	store := &fakeStore{
		getHdr:    &StoredAssessment{ID: id, Verdict: VerdictDegraded},
		artifacts: []StoredArtifact{{Kind: ArtifactKindControlPlaneBackup, SHA256: "abc"}},
	}
	svc := newService(t, store, &fakeRunner{db: &fakeDBTX{}})
	report, err := svc.GetReport(context.Background(), uuid.New(), id)
	if err != nil {
		t.Fatalf("GetReport: %v", err)
	}
	if report.Assessment.ID != id || len(report.Artifacts) != 1 {
		t.Errorf("report = %+v, want assessment %s with one artifact", report, id)
	}
}
