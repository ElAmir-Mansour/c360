package service

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/instant"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// --- in-memory fakes (no DB) ---------------------------------------------

type fakeExecRepo struct {
	mu       sync.Mutex
	targets  []*model.RecoveryTarget
	mappings []*model.NetworkMapping
	point    *model.RecoveryPoint
	safety   repository.PromotionSafety
	streams  map[string]*model.ReplicationStream
	steps    []*model.FailoverStep // shared persisted steps (UNIQUE run_id,step)
}

func (r *fakeExecRepo) SystemListRecoveryTargetsByGroup(_ context.Context, _ repository.DBTX, _ string) ([]*model.RecoveryTarget, error) {
	return r.targets, nil
}
func (r *fakeExecRepo) SystemListNetworkMappingsByProfile(_ context.Context, _ repository.DBTX, _, _ string) ([]*model.NetworkMapping, error) {
	return r.mappings, nil
}
func (r *fakeExecRepo) SystemGetStreamBySite(_ context.Context, _ repository.DBTX, siteID string) (*model.ReplicationStream, error) {
	s, ok := r.streams[siteID]
	if !ok {
		return nil, model.ErrNotFound
	}
	return s, nil
}
func (r *fakeExecRepo) SystemLatestValidatedRecoveryPoint(_ context.Context, _ repository.DBTX, _ string) (*model.RecoveryPoint, error) {
	return r.point, nil
}
func (r *fakeExecRepo) SystemGetRecoveryPoint(_ context.Context, _ repository.DBTX, _ string) (*model.RecoveryPoint, error) {
	return r.point, nil
}
func (r *fakeExecRepo) SystemRecoveryPointPromotionSafety(_ context.Context, _ repository.DBTX, _ string) (repository.PromotionSafety, error) {
	return r.safety, nil
}
func (r *fakeExecRepo) SystemListFailoverSteps(_ context.Context, _ repository.DBTX, _ string) ([]*model.FailoverStep, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*model.FailoverStep, len(r.steps))
	copy(out, r.steps)
	return out, nil
}
func (r *fakeExecRepo) UpsertFailoverStep(_ context.Context, _ repository.DBTX, step *model.FailoverStep) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *step
	for i, s := range r.steps {
		if s.Step == step.Step {
			r.steps[i] = &cp
			return nil
		}
	}
	r.steps = append(r.steps, &cp)
	return nil
}

type fakeSysRunner struct{}

func (fakeSysRunner) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}
func (fakeSysRunner) RunSystemTx(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(nil)
}

// uuidChunkReader returns deterministic bytes per stream and satisfies
// SealedChunkReader — the same interface the real WORM-backed Service does, so
// the executor's restore+decrypt path is exercised end-to-end in the unit test
// (real bytes flow through to the driver) without standing up MinIO.
type uuidChunkReader struct {
	bytesByStream map[string][]byte
}

func (r uuidChunkReader) ReadSealedChunk(_ context.Context, _, _ uuid.UUID, streamID string) ([]byte, error) {
	b, ok := r.bytesByStream[streamID]
	if !ok {
		return nil, model.ErrNotFound
	}
	return b, nil
}

type failingChunkReader struct{}

func (failingChunkReader) ReadSealedChunk(_ context.Context, _, _ uuid.UUID, streamID string) ([]byte, error) {
	return nil, errors.New("sealed chunk reader should not be called for " + streamID)
}

type fakeInstantStarter struct {
	mu         sync.Mutex
	calls      int
	sess       *instant.Session
	lastTenant uuid.UUID
	lastPoint  uuid.UUID
}

func (s *fakeInstantStarter) StartSession(_ context.Context, tenantID, recoveryPointID uuid.UUID, _ *uuid.UUID) (*instant.Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	s.lastTenant = tenantID
	s.lastPoint = recoveryPointID
	return s.sess, nil
}

// recordingDriver records boot order and teardown order, deriving a deterministic
// external id. It is a real driver (verifies non-empty plaintext) used to assert
// boot order, idempotency and rollback without a hypervisor.
type recordingDriver struct {
	mu          sync.Mutex
	bootOrder   []string // site ids in boot order
	ensureCalls map[string]int
	contexts    []RestoreContext
	teardowns   []string
	failOnSite  string // if set, Ensure returns an error for this site
}

func newRecordingDriver() *recordingDriver {
	return &recordingDriver{ensureCalls: map[string]int{}}
}

func (d *recordingDriver) Ensure(_ context.Context, rc RestoreContext) (string, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.ensureCalls[rc.SiteID]++
	d.contexts = append(d.contexts, rc)
	if len(rc.Plaintext) == 0 && rc.InstantSessionID == "" {
		return "", errors.New("empty restored chunk")
	}
	if d.failOnSite != "" && rc.SiteID == d.failOnSite {
		return "", errors.New("boot failed for " + rc.SiteID)
	}
	d.bootOrder = append(d.bootOrder, rc.SiteID)
	return "ext-" + rc.SiteID, nil
}

func (d *recordingDriver) Teardown(_ context.Context, externalID string, rc RestoreContext) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.teardowns = append(d.teardowns, rc.SiteID)
	return nil
}

func TestRecoveryExecutor_BootsInBootOrder(t *testing.T) {
	repo := newExecFixture()
	driver := newRecordingDriver()
	reader := uuidChunkReader{bytesByStream: map[string][]byte{
		"stream-a": []byte("data-a"),
		"stream-b": []byte("data-b"),
		"stream-c": []byte("data-c"),
	}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, reader, driver)

	run := &model.FailoverRun{ID: "run-1", TenantID: "11111111-1111-1111-1111-111111111111", GroupID: "g1", Mode: model.ModeReal, Status: model.StatusExecuting, RecoveryPointID: ptr("rp-1")}
	if _, err := exec.ExecuteWithDetail(context.Background(), run); err != nil {
		t.Fatalf("execute: %v", err)
	}
	want := []string{"site-a", "site-b", "site-c"}
	if len(driver.bootOrder) != 3 || driver.bootOrder[0] != "site-a" || driver.bootOrder[1] != "site-b" || driver.bootOrder[2] != "site-c" {
		t.Fatalf("boot order = %v, want %v", driver.bootOrder, want)
	}
}

func TestRecoveryExecutor_UsesInstantSessionWhenConfigured(t *testing.T) {
	repo := newExecFixture()
	driver := newRecordingDriver()
	sessionID := uuid.New()
	starter := &fakeInstantStarter{sess: &instant.Session{
		ID:              sessionID,
		OverlayLocation: "file:/var/lib/clario/instant",
		ChunkSize:       4096,
		ChunksTotal:     12,
	}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, failingChunkReader{}, driver).WithInstantRecovery(starter)

	run := &model.FailoverRun{ID: "run-instant", TenantID: "11111111-1111-1111-1111-111111111111", GroupID: "g1", Mode: model.ModeReal, Status: model.StatusExecuting, RecoveryPointID: ptr("rp-1")}
	detail, err := exec.ExecuteWithDetail(context.Background(), run)
	if err != nil {
		t.Fatalf("execute: %v", err)
	}
	if starter.calls != 1 {
		t.Fatalf("instant StartSession calls = %d, want 1", starter.calls)
	}
	if starter.lastPoint.String() != repo.point.ID {
		t.Fatalf("instant recovery point = %s, want %s", starter.lastPoint, repo.point.ID)
	}
	if _, ok := detail["instant_session"]; !ok {
		t.Fatalf("summary missing instant_session: %#v", detail)
	}
	if len(driver.contexts) != 3 {
		t.Fatalf("driver contexts = %d, want 3", len(driver.contexts))
	}
	for _, rc := range driver.contexts {
		if rc.InstantSessionID != sessionID.String() {
			t.Fatalf("context instant_session_id = %q, want %s", rc.InstantSessionID, sessionID)
		}
		if rc.InstantOverlayLocation != "file:/var/lib/clario/instant" {
			t.Fatalf("context overlay = %q", rc.InstantOverlayLocation)
		}
		if len(rc.Plaintext) != 0 {
			t.Fatalf("instant boot context for %s carried plaintext bytes", rc.SiteID)
		}
		if rc.ObjectKey != "instant:"+sessionID.String() {
			t.Fatalf("object key = %q, want instant descriptor", rc.ObjectKey)
		}
	}

	if _, err := exec.ExecuteWithDetail(context.Background(), run); err != nil {
		t.Fatalf("second execute: %v", err)
	}
	if starter.calls != 1 {
		t.Fatalf("reclaim started a second instant session: calls=%d", starter.calls)
	}
}

func TestRecoveryExecutor_IdempotentReclaimNoDoubleBoot(t *testing.T) {
	repo := newExecFixture()
	driver := newRecordingDriver()
	reader := uuidChunkReader{bytesByStream: map[string][]byte{
		"stream-a": []byte("data-a"),
		"stream-b": []byte("data-b"),
		"stream-c": []byte("data-c"),
	}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, reader, driver)
	run := &model.FailoverRun{ID: "run-1", TenantID: "11111111-1111-1111-1111-111111111111", GroupID: "g1", Mode: model.ModeReal, Status: model.StatusExecuting, RecoveryPointID: ptr("rp-1")}

	// First execute boots all three.
	if _, err := exec.ExecuteWithDetail(context.Background(), run); err != nil {
		t.Fatalf("first execute: %v", err)
	}
	// Re-claim: execute again. The recorded boot steps must make this a no-op.
	if _, err := exec.ExecuteWithDetail(context.Background(), run); err != nil {
		t.Fatalf("second execute: %v", err)
	}
	for site, n := range driver.ensureCalls {
		if n != 1 {
			t.Fatalf("site %s ensured %d times, want exactly 1 (idempotent re-claim double-booted)", site, n)
		}
	}
}

func TestRecoveryExecutor_RollbackOnBootFailure(t *testing.T) {
	repo := newExecFixture()
	driver := newRecordingDriver()
	driver.failOnSite = "site-c" // third member fails to boot
	reader := uuidChunkReader{bytesByStream: map[string][]byte{
		"stream-a": []byte("data-a"),
		"stream-b": []byte("data-b"),
		"stream-c": []byte("data-c"),
	}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, reader, driver)
	run := &model.FailoverRun{ID: "run-1", TenantID: "11111111-1111-1111-1111-111111111111", GroupID: "g1", Mode: model.ModeReal, Status: model.StatusExecuting, RecoveryPointID: ptr("rp-1")}

	_, err := exec.ExecuteWithDetail(context.Background(), run)
	if err == nil {
		t.Fatal("expected boot failure to surface (drives ROLLED_BACK)")
	}
	// site-a and site-b booted, then site-c failed: a and b must be torn down in
	// reverse order.
	if len(driver.teardowns) != 2 || driver.teardowns[0] != "site-b" || driver.teardowns[1] != "site-a" {
		t.Fatalf("teardown order = %v, want [site-b site-a] (reverse boot order)", driver.teardowns)
	}
}

func TestRecoveryExecutor_BlocksUnsafeRecoveryPoint(t *testing.T) {
	repo := newExecFixture()
	repo.safety = repository.PromotionSafety{
		CleanroomScanFound:        true,
		CleanroomVerdict:          "clean",
		RansomwareBlockingSignals: 1,
	}
	driver := newRecordingDriver()
	reader := uuidChunkReader{bytesByStream: map[string][]byte{
		"stream-a": []byte("data-a"),
		"stream-b": []byte("data-b"),
		"stream-c": []byte("data-c"),
	}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, reader, driver)
	run := &model.FailoverRun{ID: "run-unsafe", TenantID: "11111111-1111-1111-1111-111111111111", GroupID: "g1", Mode: model.ModeReal, Status: model.StatusExecuting, RecoveryPointID: ptr("rp-1")}

	_, err := exec.ExecuteWithDetail(context.Background(), run)
	if err == nil {
		t.Fatal("expected unsafe recovery point to be blocked")
	}
	if len(driver.ensureCalls) != 0 {
		t.Fatalf("unsafe recovery point booted %d members", len(driver.ensureCalls))
	}
}

func TestRecoveryExecutor_DrillUsesIsolatedProfile(t *testing.T) {
	repo := newExecFixture()
	// Add an isolated mapping; production mapping must NOT be selected for a drill.
	repo.mappings = []*model.NetworkMapping{
		{Profile: model.NetworkProfileIsolated, PrimaryCIDR: "10.0.0.0/24", RecoveryCIDR: "10.9.0.0/24"},
	}
	driver := newRecordingDriver()
	reader := uuidChunkReader{bytesByStream: map[string][]byte{
		"stream-a": []byte("data-a"), "stream-b": []byte("data-b"), "stream-c": []byte("data-c"),
	}}
	exec := NewRecoveryExecutor(repo, fakeSysRunner{}, reader, driver)
	run := &model.FailoverRun{ID: "run-drill", TenantID: "11111111-1111-1111-1111-111111111111", GroupID: "g1", Mode: model.ModeDrill, Status: model.StatusExecuting, RecoveryPointID: ptr("rp-1")}

	detail, err := exec.ExecuteWithDetail(context.Background(), run)
	if err != nil {
		t.Fatalf("drill execute: %v", err)
	}
	if detail["network_profile"] != model.NetworkProfileIsolated {
		t.Fatalf("drill profile = %v, want isolated", detail["network_profile"])
	}

	// Teardown the drill: all booted members discarded; recovery point untouched
	// (the executor never writes the recovery point).
	if err := exec.TeardownDrill(context.Background(), run); err != nil {
		t.Fatalf("teardown drill: %v", err)
	}
	if len(driver.teardowns) != 3 {
		t.Fatalf("drill teardown count = %d, want 3", len(driver.teardowns))
	}
	// Idempotent: a second teardown is a no-op.
	driver.teardowns = nil
	if err := exec.TeardownDrill(context.Background(), run); err != nil {
		t.Fatalf("second teardown drill: %v", err)
	}
	if len(driver.teardowns) != 0 {
		t.Fatalf("second drill teardown tore down %d members, want 0 (idempotent)", len(driver.teardowns))
	}
}

// --- fixture helpers ------------------------------------------------------

func newExecFixture() *fakeExecRepo {
	ratio := 1.0
	return &fakeExecRepo{
		targets: []*model.RecoveryTarget{
			{ID: "t-c", SiteID: "site-c", GroupID: "g1", BootOrder: 30, HealthProbe: model.HealthProbe{}},
			{ID: "t-a", SiteID: "site-a", GroupID: "g1", BootOrder: 10, HealthProbe: model.HealthProbe{}},
			{ID: "t-b", SiteID: "site-b", GroupID: "g1", BootOrder: 20, HealthProbe: model.HealthProbe{}},
		},
		streams: map[string]*model.ReplicationStream{
			"site-a": {ID: "stream-a", SiteID: "site-a"},
			"site-b": {ID: "stream-b", SiteID: "site-b"},
			"site-c": {ID: "stream-c", SiteID: "site-c"},
		},
		point: &model.RecoveryPoint{
			ID:              "11111111-1111-1111-1111-1111111111aa",
			GroupID:         "g1",
			IsValidated:     true,
			ValidationRatio: &ratio,
			ObjectKeys: map[string]string{
				"stream-a": "key-a", "stream-b": "key-b", "stream-c": "key-c",
			},
		},
		safety: repository.PromotionSafety{
			CleanroomScanFound: true,
			CleanroomVerdict:   "clean",
		},
	}
}

func ptr(s string) *string { return &s }
