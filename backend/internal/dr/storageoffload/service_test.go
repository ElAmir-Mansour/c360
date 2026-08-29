package storageoffload

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// --- in-memory infrastructure ---------------------------------------------

// noopDB is a repository.DBTX that swallows the outbox.Write Exec the service
// issues (the events table is out of scope for these unit tests). It only needs
// to satisfy Exec; the in-memory store ignores the db argument entirely.
type noopDB struct{}

func (noopDB) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, nil
}
func (noopDB) Query(context.Context, string, ...any) (pgx.Rows, error) { return nil, nil }
func (noopDB) QueryRow(context.Context, string, ...any) pgx.Row        { return nil }

// memRunner runs fns with a noopDB; it records tenant calls so a test can assert
// the request path was tenant-scoped.
type memRunner struct{}

func (memRunner) RunWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(noopDB{})
}
func (memRunner) RunReadWithTenant(ctx context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(noopDB{})
}
func (memRunner) RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error {
	return fn(noopDB{})
}
func (memRunner) RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error {
	return fn(noopDB{})
}

// memStore is an in-memory catalogStore. It ignores the db argument; the runner
// passes a noopDB. It is concurrency-safe so the -race detector is satisfied.
type memStore struct {
	mu        sync.Mutex
	volumes   map[uuid.UUID]*Volume
	snapshots map[uuid.UUID]*Snapshot
}

func newMemStore() *memStore {
	return &memStore{volumes: map[uuid.UUID]*Volume{}, snapshots: map[uuid.UUID]*Snapshot{}}
}

func cloneVolume(v *Volume) *Volume { c := *v; return &c }
func cloneSnapshot(s *Snapshot) *Snapshot {
	c := *s
	if s.ParentID != nil {
		p := *s.ParentID
		c.ParentID = &p
	}
	if s.ReplicatedTarget != nil {
		t := *s.ReplicatedTarget
		c.ReplicatedTarget = &t
	}
	if s.LastError != nil {
		e := *s.LastError
		c.LastError = &e
	}
	return &c
}

func (m *memStore) CreateVolume(_ context.Context, _ repository.DBTX, v *Volume) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ex := range m.volumes {
		if ex.TenantID == v.TenantID && ex.Name == v.Name {
			return ErrAlreadyExists
		}
	}
	if v.ID == uuid.Nil {
		v.ID = uuid.New()
	}
	v.CreatedAt = time.Now().UTC()
	v.UpdatedAt = v.CreatedAt
	m.volumes[v.ID] = cloneVolume(v)
	return nil
}

func (m *memStore) GetVolume(_ context.Context, _ repository.DBTX, tenantID, id uuid.UUID) (*Volume, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.volumes[id]
	if !ok || v.TenantID != tenantID {
		return nil, ErrNotFound
	}
	return cloneVolume(v), nil
}

func (m *memStore) GetVolumeSystem(_ context.Context, _ repository.DBTX, id uuid.UUID) (*Volume, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.volumes[id]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneVolume(v), nil
}

func (m *memStore) ListVolumes(_ context.Context, _ repository.DBTX, tenantID uuid.UUID) ([]*Volume, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Volume
	for _, v := range m.volumes {
		if v.TenantID == tenantID {
			out = append(out, cloneVolume(v))
		}
	}
	return out, nil
}

func (m *memStore) CreateSnapshot(_ context.Context, _ repository.DBTX, snap *Snapshot) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if snap.ID == uuid.Nil {
		snap.ID = uuid.New()
	}
	if snap.State == "" {
		snap.State = StatePending
	}
	if snap.Kind == "" {
		snap.Kind = SnapshotKindFull
	}
	snap.CreatedAt = time.Now().UTC().Add(time.Duration(len(m.snapshots)) * time.Millisecond)
	snap.UpdatedAt = snap.CreatedAt
	m.snapshots[snap.ID] = cloneSnapshot(snap)
	return nil
}

func (m *memStore) GetSnapshot(_ context.Context, _ repository.DBTX, tenantID, id uuid.UUID) (*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok || s.TenantID != tenantID {
		return nil, ErrNotFound
	}
	return cloneSnapshot(s), nil
}

func (m *memStore) GetSnapshotSystem(_ context.Context, _ repository.DBTX, id uuid.UUID) (*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok {
		return nil, ErrNotFound
	}
	return cloneSnapshot(s), nil
}

func (m *memStore) byVolume(volumeID uuid.UUID) []*Snapshot {
	var out []*Snapshot
	for _, s := range m.snapshots {
		if s.VolumeID == volumeID {
			out = append(out, cloneSnapshot(s))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.After(out[j].CreatedAt) })
	return out
}

func (m *memStore) ListSnapshotsByVolume(_ context.Context, _ repository.DBTX, tenantID, volumeID uuid.UUID) ([]*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Snapshot
	for _, s := range m.byVolume(volumeID) {
		if s.TenantID == tenantID {
			out = append(out, s)
		}
	}
	return out, nil
}

func (m *memStore) ListSnapshotsByVolumeSystem(_ context.Context, _ repository.DBTX, volumeID uuid.UUID) ([]*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.byVolume(volumeID), nil
}

func (m *memStore) LatestReadySnapshot(_ context.Context, _ repository.DBTX, tenantID, volumeID uuid.UUID) (*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.byVolume(volumeID) {
		if s.TenantID != tenantID {
			continue
		}
		switch s.State {
		case StateReady, StateReplicating, StateReplicated:
			return s, nil
		}
	}
	return nil, ErrNotFound
}

func (m *memStore) ClaimActiveSnapshots(_ context.Context, _ repository.DBTX, limit int) ([]*Snapshot, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Snapshot
	for _, s := range m.snapshots {
		switch s.State {
		case StatePending, StateCreating, StateReplicating:
			out = append(out, cloneSnapshot(s))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].CreatedAt.Before(out[j].CreatedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *memStore) MarkCreating(_ context.Context, _ repository.DBTX, id uuid.UUID, handle string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok || s.State != StatePending {
		return false, nil
	}
	s.State = StateCreating
	s.ProviderHandle = handle
	return true, nil
}

func (m *memStore) MarkReady(_ context.Context, _ repository.DBTX, id uuid.UUID, handle, manifestHash string, sizeBytes, changedBytes int64, fileCount int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok || (s.State != StatePending && s.State != StateCreating) {
		return false, nil
	}
	s.State = StateReady
	if handle != "" {
		s.ProviderHandle = handle
	}
	s.ManifestHash = manifestHash
	s.SizeBytes = sizeBytes
	s.ChangedBytes = changedBytes
	s.FileCount = fileCount
	now := time.Now().UTC()
	s.ReadyAt = &now
	return true, nil
}

func (m *memStore) MarkReplicating(_ context.Context, _ repository.DBTX, id uuid.UUID, target string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok || s.State != StateReady {
		return false, nil
	}
	s.State = StateReplicating
	s.ReplicatedTarget = &target
	return true, nil
}

func (m *memStore) MarkReplicated(_ context.Context, _ repository.DBTX, id uuid.UUID, target string, transferred int64) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok || s.State != StateReplicating {
		return false, nil
	}
	s.State = StateReplicated
	s.ReplicatedTarget = &target
	s.ChangedBytes = transferred
	now := time.Now().UTC()
	s.ReplicatedAt = &now
	return true, nil
}

func (m *memStore) MarkExpired(_ context.Context, _ repository.DBTX, id uuid.UUID) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok || IsTerminal(s.State) {
		return false, nil
	}
	s.State = StateExpired
	now := time.Now().UTC()
	s.ExpiredAt = &now
	return true, nil
}

func (m *memStore) FailSnapshot(_ context.Context, _ repository.DBTX, id uuid.UUID, reason string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.snapshots[id]
	if !ok || s.State == StateExpired || s.State == StateFailed || s.State == StateReplicated {
		return false, nil
	}
	s.State = StateFailed
	s.LastError = &reason
	return true, nil
}

func (m *memStore) HasLiveChild(_ context.Context, _ repository.DBTX, id uuid.UUID) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, s := range m.snapshots {
		if s.ParentID != nil && *s.ParentID == id && !IsTerminal(s.State) {
			return true, nil
		}
	}
	return false, nil
}

// newTestService builds a Service over the in-memory store and a real file
// provider rooted at the given snapshot root, with a deterministic clock.
func newTestService(t *testing.T, store *memStore, snapRoot string) (*Service, *memStore) {
	t.Helper()
	fp := NewFileProvider()
	svc, err := NewService(Deps{
		Store:     store,
		Runner:    memRunner{},
		System:    memRunner{},
		Providers: map[string]StorageOffloadProvider{ProviderFile: fp},
		Metrics:   NewMetrics(nil),
		Logger:    zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, store
}

// --- tests ----------------------------------------------------------------

// TestService_FullLifecycle_RequestPollCatalogReplicate is the end-to-end
// orchestrator test against a REAL file volume: register -> request snapshot ->
// drive (provider creates, poll to ready, catalog) -> replicate to a real target
// dir -> assert catalog + bytes.
func TestService_FullLifecycle_RequestPollCatalogReplicate(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()
	target := filepath.Join(t.TempDir(), "dr")

	writeVolumeFile(t, volumeDir, "data/a.txt", []byte("alpha"))
	writeVolumeFile(t, volumeDir, "data/b.txt", []byte("bravo bravo"))

	store := newMemStore()
	svc, _ := newTestService(t, store, snapRoot)
	tenantID := uuid.New()

	vol, err := svc.RegisterVolume(ctx, &Volume{
		TenantID: tenantID, Name: "estate-vol", Provider: ProviderFile,
		ArrayEndpoint: snapRoot, SourceLocation: volumeDir, RetentionMaxSnapshots: 10,
	})
	if err != nil {
		t.Fatalf("RegisterVolume: %v", err)
	}

	// Request a snapshot: must be PENDING and a FULL base (no prior snapshot).
	snap, err := svc.RequestSnapshot(ctx, tenantID, vol.ID)
	if err != nil {
		t.Fatalf("RequestSnapshot: %v", err)
	}
	if snap.State != StatePending || snap.Kind != SnapshotKindFull || snap.ParentID != nil {
		t.Fatalf("requested snapshot = %+v, want PENDING full base", snap)
	}

	// Drive: the provider creates the snapshot, the orchestrator polls to ready
	// and catalogs it with the manifest-derived size/hash/file count.
	if err := svc.DriveSnapshot(ctx, snap); err != nil {
		t.Fatalf("DriveSnapshot: %v", err)
	}
	got, err := svc.GetSnapshot(ctx, tenantID, snap.ID)
	if err != nil {
		t.Fatalf("GetSnapshot: %v", err)
	}
	if got.State != StateReady {
		t.Fatalf("after drive state = %q, want READY", got.State)
	}
	if got.FileCount != 2 {
		t.Errorf("FileCount = %d, want 2", got.FileCount)
	}
	if got.SizeBytes != int64(len("alpha")+len("bravo bravo")) {
		t.Errorf("SizeBytes = %d, want %d", got.SizeBytes, len("alpha")+len("bravo bravo"))
	}
	if got.ManifestHash == "" {
		t.Error("ManifestHash empty after ready")
	}
	if got.ProviderHandle == "" {
		t.Error("ProviderHandle empty after ready")
	}

	// Request replication; the target is persisted atomically with the
	// READY -> REPLICATING transition so any loop node can resume the transfer.
	repl, err := svc.RequestReplication(ctx, tenantID, snap.ID, target)
	if err != nil {
		t.Fatalf("RequestReplication: %v", err)
	}
	if repl.State != StateReplicating {
		t.Fatalf("after RequestReplication state = %q, want REPLICATING", repl.State)
	}
	if repl.ReplicatedTarget == nil || *repl.ReplicatedTarget != target {
		t.Fatalf("replication target = %v, want %q", repl.ReplicatedTarget, target)
	}

	// Drive the replicating snapshot: ships real bytes to the target dir.
	driving, _ := svc.GetSnapshot(ctx, tenantID, snap.ID)
	if err := svc.DriveSnapshot(ctx, driving); err != nil {
		t.Fatalf("DriveSnapshot (replicate): %v", err)
	}
	final, _ := svc.GetSnapshot(ctx, tenantID, snap.ID)
	if final.State != StateReplicated {
		t.Fatalf("final state = %q, want REPLICATED", final.State)
	}
	if final.ReplicatedTarget == nil || *final.ReplicatedTarget != target {
		t.Fatalf("ReplicatedTarget = %v, want %q", final.ReplicatedTarget, target)
	}
	// The DR target holds byte-identical copies.
	if b, _ := os.ReadFile(filepath.Join(target, "data", "a.txt")); !bytes.Equal(b, []byte("alpha")) {
		t.Errorf("replicated a.txt = %q, want alpha", b)
	}
	if b, _ := os.ReadFile(filepath.Join(target, "data", "b.txt")); !bytes.Equal(b, []byte("bravo bravo")) {
		t.Errorf("replicated b.txt = %q, want bravo bravo", b)
	}
}

// TestService_SecondSnapshotIsIncremental verifies the orchestrator links a
// second snapshot to the first as an incremental and that driving it records
// only the delta bytes.
func TestService_SecondSnapshotIsIncremental(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	volumeDir := t.TempDir()
	snapRoot := t.TempDir()

	writeVolumeFile(t, volumeDir, "keep.txt", []byte("static"))
	writeVolumeFile(t, volumeDir, "mut.txt", []byte("one"))

	store := newMemStore()
	svc, _ := newTestService(t, store, snapRoot)
	tenantID := uuid.New()

	vol, err := svc.RegisterVolume(ctx, &Volume{
		TenantID: tenantID, Name: "v", Provider: ProviderFile,
		ArrayEndpoint: snapRoot, SourceLocation: volumeDir, RetentionMaxSnapshots: 10,
	})
	if err != nil {
		t.Fatalf("RegisterVolume: %v", err)
	}

	// First snapshot: full base.
	first, err := svc.RequestSnapshot(ctx, tenantID, vol.ID)
	if err != nil {
		t.Fatalf("RequestSnapshot 1: %v", err)
	}
	if err := svc.DriveSnapshot(ctx, first); err != nil {
		t.Fatalf("DriveSnapshot 1: %v", err)
	}

	// Mutate, then second snapshot: must be INCREMENTAL with parent = first.
	writeVolumeFile(t, volumeDir, "mut.txt", []byte("two longer"))
	second, err := svc.RequestSnapshot(ctx, tenantID, vol.ID)
	if err != nil {
		t.Fatalf("RequestSnapshot 2: %v", err)
	}
	if second.Kind != SnapshotKindIncremental {
		t.Fatalf("second kind = %q, want incremental", second.Kind)
	}
	if second.ParentID == nil || *second.ParentID != first.ID {
		t.Fatalf("second parent = %v, want %s", second.ParentID, first.ID)
	}
	if err := svc.DriveSnapshot(ctx, second); err != nil {
		t.Fatalf("DriveSnapshot 2: %v", err)
	}
	got, _ := svc.GetSnapshot(ctx, tenantID, second.ID)
	if got.State != StateReady {
		t.Fatalf("incremental state = %q, want READY", got.State)
	}
	// Delta bytes are only the changed file.
	if got.ChangedBytes != int64(len("two longer")) {
		t.Errorf("incremental ChangedBytes = %d, want %d", got.ChangedBytes, len("two longer"))
	}
	// But the logical size still reflects the full dataset.
	if got.SizeBytes != int64(len("static")+len("two longer")) {
		t.Errorf("incremental SizeBytes = %d, want full dataset", got.SizeBytes)
	}
}

// TestService_Retention_ExpiresOldKeepsReferencedParents drives several full
// snapshots (no parent chain) plus one incremental chain, then applies a
// keep-newest-1 policy and asserts the referenced parent is NOT expired while
// surplus standalone snapshots are.
func TestService_Retention_ExpiresOldKeepsReferencedParents(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	snapRoot := t.TempDir()
	store := newMemStore()
	svc, _ := newTestService(t, store, snapRoot)
	tenantID := uuid.New()
	volumeID := uuid.New()

	// Seed catalog directly: a parent with a live incremental child, plus two
	// surplus standalone READY snapshots, newest-first by CreatedAt.
	base := time.Now().UTC()
	parent := &Snapshot{ID: uuid.New(), TenantID: tenantID, VolumeID: volumeID, State: StateReady, Kind: SnapshotKindFull, CreatedAt: base.Add(-50 * time.Minute), ProviderHandle: "snap-parent"}
	child := &Snapshot{ID: uuid.New(), TenantID: tenantID, VolumeID: volumeID, State: StateReady, Kind: SnapshotKindIncremental, ParentID: &parent.ID, CreatedAt: base.Add(-10 * time.Minute), ProviderHandle: "snap-child"}
	surplus1 := &Snapshot{ID: uuid.New(), TenantID: tenantID, VolumeID: volumeID, State: StateReady, Kind: SnapshotKindFull, CreatedAt: base.Add(-40 * time.Minute), ProviderHandle: "snap-surplus1"}
	surplus2 := &Snapshot{ID: uuid.New(), TenantID: tenantID, VolumeID: volumeID, State: StateReady, Kind: SnapshotKindFull, CreatedAt: base.Add(-30 * time.Minute), ProviderHandle: "snap-surplus2"}

	vol := &Volume{ID: volumeID, TenantID: tenantID, Name: "ret-vol", Provider: ProviderFile, ArrayEndpoint: snapRoot, SourceLocation: t.TempDir(), RetentionMaxSnapshots: 1}
	store.mu.Lock()
	store.volumes[volumeID] = vol
	for _, s := range []*Snapshot{parent, child, surplus1, surplus2} {
		store.snapshots[s.ID] = cloneSnapshot(s)
	}
	store.mu.Unlock()

	// Materialize the provider-side dirs so DeleteSnapshot has something real to
	// remove (proves retention drives real provider I/O).
	for _, h := range []string{"snap-parent", "snap-surplus1", "snap-surplus2"} {
		if err := os.MkdirAll(filepath.Join(snapRoot, h), 0o750); err != nil {
			t.Fatalf("mkdir provider dir: %v", err)
		}
	}

	expired, err := svc.ApplyRetention(ctx, volumeID)
	if err != nil {
		t.Fatalf("ApplyRetention: %v", err)
	}
	// Keep newest 1 (the child). parent is a live-parent so it is kept despite
	// being beyond the count. surplus1 and surplus2 are expired => 2.
	if expired != 2 {
		t.Fatalf("expired = %d, want 2 (two surplus standalone snapshots)", expired)
	}

	assertState := func(id uuid.UUID, want string) {
		s, _ := svc.GetSnapshot(ctx, tenantID, id)
		if s.State != want {
			t.Errorf("snapshot %s state = %q, want %q", id, s.State, want)
		}
	}
	assertState(child.ID, StateReady)  // newest, kept
	assertState(parent.ID, StateReady) // referenced parent, kept
	assertState(surplus1.ID, StateExpired)
	assertState(surplus2.ID, StateExpired)

	// The expired snapshots' provider dirs must be gone (real delete).
	for _, h := range []string{"snap-surplus1", "snap-surplus2"} {
		if _, err := os.Stat(filepath.Join(snapRoot, h)); !os.IsNotExist(err) {
			t.Errorf("expired provider dir %q still exists (err=%v)", h, err)
		}
	}
	// The kept parent dir must survive.
	if _, err := os.Stat(filepath.Join(snapRoot, "snap-parent")); err != nil {
		t.Errorf("kept parent provider dir removed: %v", err)
	}
}

// TestService_RequestReplication_RejectsNonReady proves replication is gated on
// READY.
func TestService_RequestReplication_RejectsNonReady(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := newMemStore()
	svc, _ := newTestService(t, store, t.TempDir())
	tenantID := uuid.New()
	volumeID := uuid.New()

	snap := &Snapshot{ID: uuid.New(), TenantID: tenantID, VolumeID: volumeID, State: StatePending}
	store.mu.Lock()
	store.snapshots[snap.ID] = cloneSnapshot(snap)
	store.mu.Unlock()

	if _, err := svc.RequestReplication(ctx, tenantID, snap.ID, "dr://x"); !errors.Is(err, ErrInvalidState) {
		t.Fatalf("RequestReplication on PENDING err = %v, want ErrInvalidState", err)
	}
}

// TestService_RegisterVolume_RejectsUnknownProvider proves the provider must be
// wired.
func TestService_RegisterVolume_RejectsUnknownProvider(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	svc, _ := newTestService(t, newMemStore(), t.TempDir())
	_, err := svc.RegisterVolume(ctx, &Volume{TenantID: uuid.New(), Name: "x", Provider: "netapp_ontap", SourceLocation: "/data"})
	if !errors.Is(err, ErrValidation) {
		t.Fatalf("RegisterVolume unknown provider err = %v, want ErrValidation", err)
	}
}
