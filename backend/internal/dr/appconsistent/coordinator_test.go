package appconsistent

import (
	"context"
	"errors"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// memTenantRunner runs fns with a nil DBTX (the in-memory store ignores it) and
// records the write count, modelling the tenant-scoped transaction boundary.
type memTenantRunner struct {
	mu      sync.Mutex
	tenants []uuid.UUID
	writes  int
	// failOn, when set, makes RunWithTenant return this error to exercise the
	// persistence-failure path.
	failOn error
}

func (r *memTenantRunner) RunWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.mu.Lock()
	r.tenants = append(r.tenants, tenantID)
	r.writes++
	r.mu.Unlock()
	if r.failOn != nil {
		return r.failOn
	}
	return fn(nil)
}

// memBarrierStore is an in-memory BarrierStore exercising the real CreateBarrier
// input shape (validation, generated id) without Postgres.
type memBarrierStore struct {
	mu      sync.Mutex
	created []*Barrier
}

func (s *memBarrierStore) CreateBarrier(_ context.Context, _ repository.DBTX, b *Barrier) error {
	// Run the real validation that Store.CreateBarrier performs so the test
	// catches a malformed barrier the same way Postgres would.
	if b.TenantID == "" || b.GroupID == "" {
		return ErrInvalidInput
	}
	switch b.ConsistencyLevel {
	case ConsistencyApplication, ConsistencyCrash:
	default:
		return ErrInvalidInput
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	b.ID = uuid.NewString()
	b.CreatedAt = time.Now().UTC()
	cp := *b
	s.created = append(s.created, &cp)
	return nil
}

func (s *memBarrierStore) last() *Barrier {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.created) == 0 {
		return nil
	}
	return s.created[len(s.created)-1]
}

// recordingStager records staged events instead of writing the outbox.
type recordingStager struct {
	mu     sync.Mutex
	events []stagedEvent
}

type stagedEvent struct {
	eventType string
	tenantID  string
	data      map[string]any
}

func (s *recordingStager) Stage(_ context.Context, _ repository.DBTX, eventType, tenantID string, data map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, stagedEvent{eventType: eventType, tenantID: tenantID, data: data})
	return nil
}

func (s *recordingStager) lastType() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.events) == 0 {
		return ""
	}
	return s.events[len(s.events)-1].eventType
}

// fakeSealer is a fake RecoveryPointSealer (the only fake the spec allows here);
// the quiesce providers are real os/exec. It returns a canned point or a seal
// error, and records the calls so the test can assert sealing happened (or not).
type fakeSealer struct {
	mu    sync.Mutex
	calls int
	point *model.RecoveryPoint
	err   error
	// before/after let a test assert ordering against the quiesce side effects.
	onSeal func()
}

func (s *fakeSealer) SealRecoveryPoint(_ context.Context, tenantID, groupID uuid.UUID, _ SealInput) (*model.RecoveryPoint, error) {
	s.mu.Lock()
	s.calls++
	s.mu.Unlock()
	if s.onSeal != nil {
		s.onSeal()
	}
	if s.err != nil {
		return nil, s.err
	}
	p := *s.point
	p.TenantID = tenantID.String()
	p.GroupID = groupID.String()
	return &p, nil
}

func (s *fakeSealer) sealCalls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

// fakeLSN returns a fixed LSN, modelling the replication-stream barrier marker.
type fakeLSN struct{ lsn string }

func (f fakeLSN) CurrentLSN(context.Context, uuid.UUID, uuid.UUID) (string, error) {
	return f.lsn, nil
}

type fakeFencer struct {
	mu      sync.Mutex
	calls   int
	fence   StreamFence
	err     error
	onFence func(QuiesceResult)
}

func (f *fakeFencer) Fence(_ context.Context, _ uuid.UUID, _ uuid.UUID, qres QuiesceResult) (StreamFence, error) {
	f.mu.Lock()
	f.calls++
	f.mu.Unlock()
	if f.onFence != nil {
		f.onFence(qres)
	}
	if f.err != nil {
		return f.fence, f.err
	}
	if f.fence.MarkerLSN == "" {
		return StreamFence{MarkerLSN: "0/FENCE", Detail: "fake fence drained"}, nil
	}
	return f.fence, nil
}

func (f *fakeFencer) fenceCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func newTestCoordinator(t *testing.T, sealer RecoveryPointSealer, lsn LSNSource) (*Coordinator, *memBarrierStore, *recordingStager, *memTenantRunner) {
	t.Helper()
	store := &memBarrierStore{}
	stager := &recordingStager{}
	runner := &memTenantRunner{}
	fenceLSN := "0/FENCE"
	if f, ok := lsn.(fakeLSN); ok && f.lsn != "" {
		fenceLSN = f.lsn
	}
	coord, err := NewCoordinator(Config{
		TX:             runner,
		Store:          store,
		Sealer:         sealer,
		LSN:            lsn,
		Fencer:         &fakeFencer{fence: StreamFence{MarkerLSN: fenceLSN, Detail: "test fence drained"}},
		Stager:         stager,
		QuiesceTimeout: 5 * time.Second,
		FenceTimeout:   5 * time.Second,
		ThawTimeout:    5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewCoordinator: %v", err)
	}
	return coord, store, stager, runner
}

func requireSh(t *testing.T) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("coordinator test uses /bin/sh script providers")
	}
}

// TestCoordinator_HappyPath: a real script quiesce succeeds, the recovery point
// is sealed, the workload is thawed, and the barrier is application-consistent
// with the pinned LSN + a sealed event.
func TestCoordinator_HappyPath(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()

	// Track that the freeze ran before the seal and the thaw ran after, via a
	// shared marker file the shell scripts touch and the sealer reads.
	var (
		mu       sync.Mutex
		frozen   bool
		thawedAt time.Time
	)
	// We model freeze/thaw side effects in-process by having the script set a
	// sentinel through a temp file the test inspects.
	dir := t.TempDir()
	freezeMarker := dir + "/frozen"
	thawMarker := dir + "/thawed"

	provider := &ScriptQuiesceProvider{
		FreezeCmd: "touch " + freezeMarker + " && echo frozen",
		ThawCmd:   "touch " + thawMarker + " && echo thawed",
		Timeout:   5 * time.Second,
	}

	sealer := &fakeSealer{
		point: &model.RecoveryPoint{ID: uuid.NewString(), RPOSeconds: 12},
		onSeal: func() {
			mu.Lock()
			defer mu.Unlock()
			// The freeze marker must exist at seal time (workload quiesced) and
			// the thaw marker must NOT (thaw happens after sealing).
			frozen = fileExists(freezeMarker)
			if fileExists(thawMarker) {
				thawedAt = time.Now()
			}
		},
	}

	coord, store, stager, runner := newTestCoordinator(t, sealer, fakeLSN{lsn: "0/16B3748"})

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{Provider: provider})
	if err != nil {
		t.Fatalf("Trigger: %v", err)
	}

	mu.Lock()
	if !frozen {
		t.Fatal("workload was not frozen at seal time")
	}
	if !thawedAt.IsZero() {
		t.Fatal("workload was thawed before sealing — thaw must follow capture")
	}
	mu.Unlock()

	if !fileExists(thawMarker) {
		t.Fatal("workload was never thawed")
	}
	if sealer.sealCalls() != 1 {
		t.Fatalf("seal called %d times, want 1", sealer.sealCalls())
	}
	if !barrier.IsApplicationConsistent() {
		t.Fatalf("barrier is not application-consistent: %+v", barrier)
	}
	if barrier.ConsistencyLevel != ConsistencyApplication {
		t.Fatalf("consistency level = %q, want %q", barrier.ConsistencyLevel, ConsistencyApplication)
	}
	if barrier.Provider != ProviderScript {
		t.Fatalf("provider = %q, want %q", barrier.Provider, ProviderScript)
	}
	if barrier.BarrierLSN != "0/16B3748" {
		t.Fatalf("barrier LSN = %q, want pinned LSN", barrier.BarrierLSN)
	}
	if barrier.RecoveryPointID == nil || *barrier.RecoveryPointID != sealer.point.ID {
		t.Fatalf("recovery point id = %v, want %q", barrier.RecoveryPointID, sealer.point.ID)
	}
	if !barrier.Quiesced || !barrier.Thawed || !barrier.Success {
		t.Fatalf("flags: quiesced=%v thawed=%v success=%v, want all true", barrier.Quiesced, barrier.Thawed, barrier.Success)
	}
	if persisted := store.last(); persisted == nil || persisted.ID == "" {
		t.Fatal("barrier was not persisted")
	}
	if runner.writes != 1 {
		t.Fatalf("persistence writes = %d, want 1", runner.writes)
	}
	if stager.lastType() != EventTypeBarrierSealed {
		t.Fatalf("event type = %q, want %q", stager.lastType(), EventTypeBarrierSealed)
	}
}

// TestCoordinator_QuiesceFails: a failing freeze command means NO app-consistent
// point is sealed, the workload is NOT thawed (it was never frozen), and the
// barrier is recorded crash-level + failed.
func TestCoordinator_QuiesceFails(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()

	dir := t.TempDir()
	thawMarker := dir + "/thawed"

	provider := &ScriptQuiesceProvider{
		FreezeCmd: "echo 'device busy' 1>&2; exit 7",
		ThawCmd:   "touch " + thawMarker,
		Timeout:   5 * time.Second,
	}
	sealer := &fakeSealer{point: &model.RecoveryPoint{ID: uuid.NewString()}}

	coord, store, stager, _ := newTestCoordinator(t, sealer, fakeLSN{lsn: "0/1"})

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{Provider: provider})
	if !errors.Is(err, ErrQuiesceFailed) {
		t.Fatalf("expected ErrQuiesceFailed, got %v", err)
	}
	if sealer.sealCalls() != 0 {
		t.Fatalf("seal called %d times on quiesce failure, want 0", sealer.sealCalls())
	}
	if fileExists(thawMarker) {
		t.Fatal("thaw ran after a failed quiesce — must not (workload was never frozen)")
	}
	if barrier == nil {
		t.Fatal("expected a recorded barrier even on quiesce failure")
	}
	if barrier.Quiesced {
		t.Fatal("barrier marked quiesced after a failed freeze")
	}
	if barrier.Success {
		t.Fatal("barrier marked success after a failed freeze")
	}
	if barrier.ConsistencyLevel != ConsistencyCrash {
		t.Fatalf("consistency level = %q, want %q", barrier.ConsistencyLevel, ConsistencyCrash)
	}
	if barrier.RecoveryPointID != nil {
		t.Fatal("no recovery point should be pinned on quiesce failure")
	}
	if !strings.Contains(barrier.Detail, "device busy") {
		t.Fatalf("barrier detail %q should contain captured stderr", barrier.Detail)
	}
	if store.last() == nil {
		t.Fatal("failed barrier was not persisted")
	}
	if stager.lastType() != EventTypeBarrierFailed {
		t.Fatalf("event type = %q, want %q", stager.lastType(), EventTypeBarrierFailed)
	}
}

func TestCoordinator_FenceRunsBeforeSeal(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()

	var (
		mu           sync.Mutex
		fenceDone    bool
		sealSawFence bool
	)
	sealer := &fakeSealer{
		point: &model.RecoveryPoint{ID: uuid.NewString(), RPOSeconds: 5},
		onSeal: func() {
			mu.Lock()
			defer mu.Unlock()
			sealSawFence = fenceDone
		},
	}
	fencer := &fakeFencer{
		fence: StreamFence{MarkerLSN: "0/FENCED", Detail: "all streams drained"},
		onFence: func(qres QuiesceResult) {
			if !strings.Contains(qres.Output, "frozen") {
				t.Errorf("fencer did not receive quiesce output: %+v", qres)
			}
			mu.Lock()
			fenceDone = true
			mu.Unlock()
		},
	}
	store := &memBarrierStore{}
	stager := &recordingStager{}
	coord, err := NewCoordinator(Config{
		TX:             &memTenantRunner{},
		Store:          store,
		Sealer:         sealer,
		Fencer:         fencer,
		Stager:         stager,
		QuiesceTimeout: 5 * time.Second,
		FenceTimeout:   5 * time.Second,
		ThawTimeout:    5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewCoordinator: %v", err)
	}

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{
		Provider: &ScriptQuiesceProvider{FreezeCmd: "echo frozen", ThawCmd: "true", Timeout: 5 * time.Second},
	})
	if err != nil {
		t.Fatalf("Trigger: %v", err)
	}
	if fencer.fenceCalls() != 1 || sealer.sealCalls() != 1 {
		t.Fatalf("fence calls=%d seal calls=%d, want 1/1", fencer.fenceCalls(), sealer.sealCalls())
	}
	mu.Lock()
	gotSealSawFence := sealSawFence
	mu.Unlock()
	if !gotSealSawFence {
		t.Fatal("seal ran before the stream fence completed")
	}
	if barrier.BarrierLSN != "0/FENCED" || !barrier.IsApplicationConsistent() {
		t.Fatalf("barrier = %+v, want application point at fenced marker", barrier)
	}
}

func TestCoordinator_FenceFailsDegradesToCrashAndDoesNotSeal(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()
	dir := t.TempDir()
	thawMarker := dir + "/thawed"

	sealer := &fakeSealer{point: &model.RecoveryPoint{ID: uuid.NewString()}}
	fencer := &fakeFencer{
		fence: StreamFence{MarkerLSN: "0/WAIT"},
		err:   errors.New("timed out waiting for stream-a"),
	}
	store := &memBarrierStore{}
	stager := &recordingStager{}
	coord, err := NewCoordinator(Config{
		TX:             &memTenantRunner{},
		Store:          store,
		Sealer:         sealer,
		Fencer:         fencer,
		Stager:         stager,
		QuiesceTimeout: 5 * time.Second,
		FenceTimeout:   5 * time.Second,
		ThawTimeout:    5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewCoordinator: %v", err)
	}

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{
		Provider: &ScriptQuiesceProvider{FreezeCmd: "echo frozen", ThawCmd: "touch " + thawMarker, Timeout: 5 * time.Second},
	})
	if !errors.Is(err, ErrFenceFailed) {
		t.Fatalf("expected ErrFenceFailed, got %v", err)
	}
	if sealer.sealCalls() != 0 {
		t.Fatalf("seal called %d times, want 0 when fence fails", sealer.sealCalls())
	}
	if !fileExists(thawMarker) {
		t.Fatal("workload was not thawed after fence failure")
	}
	if barrier == nil || barrier.Success || barrier.ConsistencyLevel != ConsistencyCrash || barrier.RecoveryPointID != nil {
		t.Fatalf("barrier = %+v, want failed crash-level barrier without recovery point", barrier)
	}
	if barrier.BarrierLSN != "0/WAIT" {
		t.Fatalf("barrier LSN = %q, want failed marker retained", barrier.BarrierLSN)
	}
	if stager.lastType() != EventTypeBarrierFailed {
		t.Fatalf("event type = %q, want %q", stager.lastType(), EventTypeBarrierFailed)
	}
}

func TestCoordinator_MissingFenceFailsBeforeQuiesce(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()
	dir := t.TempDir()
	freezeMarker := dir + "/frozen"
	sealer := &fakeSealer{point: &model.RecoveryPoint{ID: uuid.NewString()}}
	store := &memBarrierStore{}
	coord, err := NewCoordinator(Config{
		TX:             &memTenantRunner{},
		Store:          store,
		Sealer:         sealer,
		Stager:         &recordingStager{},
		QuiesceTimeout: 5 * time.Second,
		ThawTimeout:    5 * time.Second,
	})
	if err != nil {
		t.Fatalf("NewCoordinator: %v", err)
	}

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{
		Provider: &ScriptQuiesceProvider{FreezeCmd: "touch " + freezeMarker, ThawCmd: "true", Timeout: 5 * time.Second},
	})
	if !errors.Is(err, ErrFenceFailed) {
		t.Fatalf("expected ErrFenceFailed, got %v", err)
	}
	if fileExists(freezeMarker) {
		t.Fatal("quiesce ran despite missing stream fencer")
	}
	if sealer.sealCalls() != 0 {
		t.Fatalf("seal called %d times, want 0", sealer.sealCalls())
	}
	if barrier == nil || barrier.Success || barrier.ConsistencyLevel != ConsistencyCrash {
		t.Fatalf("barrier = %+v, want failed crash-level barrier", barrier)
	}
	if store.last() == nil {
		t.Fatal("missing-fence barrier was not persisted")
	}
}

// TestCoordinator_CaptureFails: quiesce succeeds but sealing fails. The workload
// must STILL be thawed (defer), no recovery point is pinned, and the barrier is
// recorded as failed.
func TestCoordinator_CaptureFails(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()

	dir := t.TempDir()
	thawMarker := dir + "/thawed"

	provider := &ScriptQuiesceProvider{
		FreezeCmd: "echo frozen",
		ThawCmd:   "touch " + thawMarker + " && echo thawed",
		Timeout:   5 * time.Second,
	}
	sealer := &fakeSealer{err: errors.New("worm bucket unreachable")}

	coord, store, stager, _ := newTestCoordinator(t, sealer, fakeLSN{lsn: "0/2"})

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{Provider: provider})
	if !errors.Is(err, ErrCaptureFailed) {
		t.Fatalf("expected ErrCaptureFailed, got %v", err)
	}
	if sealer.sealCalls() != 1 {
		t.Fatalf("seal called %d times, want 1", sealer.sealCalls())
	}
	if !fileExists(thawMarker) {
		t.Fatal("workload was NOT thawed after a capture failure — defer thaw must always run")
	}
	if barrier == nil {
		t.Fatal("expected a recorded barrier on capture failure")
	}
	if !barrier.Quiesced {
		t.Fatal("barrier should record a successful quiesce")
	}
	if !barrier.Thawed {
		t.Fatal("barrier should record a successful thaw after capture failure")
	}
	if barrier.Success {
		t.Fatal("barrier marked success despite capture failure")
	}
	if barrier.RecoveryPointID != nil {
		t.Fatal("no recovery point should be pinned on capture failure")
	}
	if !strings.Contains(barrier.Error, "worm bucket unreachable") {
		t.Fatalf("barrier error %q should carry the seal failure", barrier.Error)
	}
	if store.last() == nil {
		t.Fatal("failed barrier was not persisted")
	}
	if stager.lastType() != EventTypeBarrierFailed {
		t.Fatalf("event type = %q, want %q", stager.lastType(), EventTypeBarrierFailed)
	}
}

// TestCoordinator_ThawFails: quiesce and seal succeed but the thaw command fails.
// The point IS sealed (recovery_point_id pinned), but the barrier is marked
// unsuccessful with the thaw error so an operator intervenes.
func TestCoordinator_ThawFails(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()

	provider := &ScriptQuiesceProvider{
		FreezeCmd: "echo frozen",
		ThawCmd:   "echo 'cannot unfreeze' 1>&2; exit 5",
		Timeout:   5 * time.Second,
	}
	sealer := &fakeSealer{point: &model.RecoveryPoint{ID: uuid.NewString(), RPOSeconds: 3}}

	coord, store, _, _ := newTestCoordinator(t, sealer, fakeLSN{lsn: "0/3"})

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{Provider: provider})
	if !errors.Is(err, ErrThawFailed) {
		t.Fatalf("expected ErrThawFailed, got %v", err)
	}
	if barrier.RecoveryPointID == nil || *barrier.RecoveryPointID != sealer.point.ID {
		t.Fatalf("recovery point should remain pinned despite thaw failure: %v", barrier.RecoveryPointID)
	}
	if barrier.Thawed {
		t.Fatal("barrier should record thaw as failed")
	}
	if barrier.Success {
		t.Fatal("barrier should be unsuccessful when thaw fails")
	}
	if !strings.Contains(barrier.Error, "cannot unfreeze") {
		t.Fatalf("barrier error %q should carry the thaw failure", barrier.Error)
	}
	if store.last() == nil {
		t.Fatal("barrier was not persisted")
	}
	// consistency level is still application: the point was captured under quiesce
	if barrier.ConsistencyLevel != ConsistencyApplication {
		t.Fatalf("consistency level = %q, want %q", barrier.ConsistencyLevel, ConsistencyApplication)
	}
}

// TestCoordinator_NoProvider_CrashConsistent: no provider means a crash-consistent
// point — sealed, but no quiesce/thaw and consistency_level=crash.
func TestCoordinator_NoProvider_CrashConsistent(t *testing.T) {
	tenantID, groupID := uuid.New(), uuid.New()
	sealer := &fakeSealer{point: &model.RecoveryPoint{ID: uuid.NewString(), RPOSeconds: 1}}
	coord, store, stager, _ := newTestCoordinator(t, sealer, fakeLSN{lsn: "0/4"})

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{Provider: nil})
	if err != nil {
		t.Fatalf("Trigger: %v", err)
	}
	if barrier.ConsistencyLevel != ConsistencyCrash {
		t.Fatalf("consistency level = %q, want %q", barrier.ConsistencyLevel, ConsistencyCrash)
	}
	if barrier.Provider != ProviderNone {
		t.Fatalf("provider = %q, want %q", barrier.Provider, ProviderNone)
	}
	if barrier.Quiesced {
		t.Fatal("crash-consistent point should not be quiesced")
	}
	if !barrier.Success || barrier.RecoveryPointID == nil {
		t.Fatalf("crash-consistent point should still seal successfully: %+v", barrier)
	}
	if barrier.IsApplicationConsistent() {
		t.Fatal("crash-consistent point must not report as application-consistent")
	}
	if store.last() == nil {
		t.Fatal("barrier not persisted")
	}
	if stager.lastType() != EventTypeBarrierSealed {
		t.Fatalf("event type = %q, want %q", stager.lastType(), EventTypeBarrierSealed)
	}
}

// TestCoordinator_HTTPProvider_HappyPath drives the protocol with a REAL HTTP
// quiesce provider against an httptest agent.
func TestCoordinator_HTTPProvider_HappyPath(t *testing.T) {
	tenantID, groupID := uuid.New(), uuid.New()

	agent := newFakeAgent(t)
	defer agent.close()

	provider := &HTTPQuiesceProvider{BaseURL: agent.url, Timeout: 5 * time.Second}
	sealer := &fakeSealer{
		point: &model.RecoveryPoint{ID: uuid.NewString(), RPOSeconds: 8},
		onSeal: func() {
			if !agent.isFrozen() {
				t.Error("agent not frozen at seal time")
			}
		},
	}

	coord, store, _, _ := newTestCoordinator(t, sealer, fakeLSN{lsn: "0/ABCD"})

	barrier, err := coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{Provider: provider})
	if err != nil {
		t.Fatalf("Trigger: %v", err)
	}
	if !barrier.IsApplicationConsistent() {
		t.Fatalf("barrier not application-consistent: %+v", barrier)
	}
	if barrier.Provider != ProviderHTTP {
		t.Fatalf("provider = %q, want %q", barrier.Provider, ProviderHTTP)
	}
	if !agent.thawedWithToken() {
		t.Fatal("agent thaw was not called with the issued barrier token")
	}
	if store.last() == nil {
		t.Fatal("barrier not persisted")
	}
}

// TestCoordinator_PersistFails surfaces a persistence error (and does not hide it
// as a recorded failure).
func TestCoordinator_PersistFails(t *testing.T) {
	requireSh(t)
	tenantID, groupID := uuid.New(), uuid.New()
	provider := &ScriptQuiesceProvider{FreezeCmd: "true", ThawCmd: "true", Timeout: 5 * time.Second}
	sealer := &fakeSealer{point: &model.RecoveryPoint{ID: uuid.NewString()}}

	store := &memBarrierStore{}
	stager := &recordingStager{}
	runner := &memTenantRunner{failOn: errors.New("db down")}
	coord, err := NewCoordinator(Config{TX: runner, Store: store, Sealer: sealer, Stager: stager})
	if err != nil {
		t.Fatalf("NewCoordinator: %v", err)
	}

	_, err = coord.Trigger(context.Background(), tenantID, groupID, TriggerInput{Provider: provider})
	if err == nil || !strings.Contains(err.Error(), "db down") {
		t.Fatalf("expected persistence error, got %v", err)
	}
}

// TestNewCoordinator_Validation rejects missing required dependencies.
func TestNewCoordinator_Validation(t *testing.T) {
	if _, err := NewCoordinator(Config{}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("missing TX: expected ErrNotConfigured, got %v", err)
	}
	if _, err := NewCoordinator(Config{TX: &memTenantRunner{}}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("missing Store: expected ErrNotConfigured, got %v", err)
	}
	if _, err := NewCoordinator(Config{TX: &memTenantRunner{}, Store: &memBarrierStore{}}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("missing Sealer: expected ErrNotConfigured, got %v", err)
	}
}
