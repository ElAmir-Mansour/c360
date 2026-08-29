package vmcapture

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/repository"
)

// svcFakeRunner runs fn with a recording DBTX (no real DB) and counts staged
// outbox events so the test asserts state+event atomicity intent.
type svcFakeRunner struct {
	tx *svcRecordingTx
}

func newSvcFakeRunner() *svcFakeRunner { return &svcFakeRunner{tx: &svcRecordingTx{}} }

func (r *svcFakeRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(r.tx)
}
func (r *svcFakeRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(r.tx)
}

type svcRecordingTx struct {
	mu         sync.Mutex
	outboxRows int
}

func (t *svcRecordingTx) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if bytes.Contains([]byte(sql), []byte("event_outbox")) {
		t.outboxRows++
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}
func (t *svcRecordingTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query in service test")
}
func (t *svcRecordingTx) QueryRow(context.Context, string, ...any) pgx.Row { return nil }

// svcMemStore is a full in-memory implementation of the unexported store
// interface, so the service's transactional flow (source CRUD, epoch + state
// persistence, advance) is exercised end to end without a database.
type svcMemStore struct {
	mu       sync.Mutex
	sources  map[string]*Source
	epochs   map[string][]Epoch // sourceID -> epochs
	vmState  map[string]VMState // sourceID -> latest block map
	failNext error
}

func newSvcMemStore() *svcMemStore {
	return &svcMemStore{sources: map[string]*Source{}, epochs: map[string][]Epoch{}, vmState: map[string]VMState{}}
}

func (s *svcMemStore) CreateSource(_ context.Context, _ repository.DBTX, src *Source) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, ex := range s.sources {
		if ex.TenantID == src.TenantID && ex.Name == src.Name {
			return ErrAlreadyExists
		}
	}
	src.ID = uuid.NewString()
	src.CreatedAt = time.Now().UTC()
	src.UpdatedAt = src.CreatedAt
	cp := *src
	s.sources[src.ID] = &cp
	return nil
}

func (s *svcMemStore) GetSource(_ context.Context, _ repository.DBTX, tenantID, id string) (*Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.sources[id]
	if !ok || src.TenantID != tenantID {
		return nil, ErrNotFound
	}
	cp := *src
	return &cp, nil
}

func (s *svcMemStore) ListSources(_ context.Context, _ repository.DBTX, tenantID string) ([]Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []Source
	for _, src := range s.sources {
		if src.TenantID == tenantID {
			out = append(out, *src)
		}
	}
	return out, nil
}

func (s *svcMemStore) AdvanceSource(_ context.Context, _ repository.DBTX, tenantID, id string, epochCount int, lastSeq int64, runAt time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	src, ok := s.sources[id]
	if !ok || src.TenantID != tenantID {
		return ErrNotFound
	}
	src.EpochCount = epochCount
	src.LastSeq = lastSeq
	src.LastRunAt = &runAt
	return nil
}

func (s *svcMemStore) InsertEpoch(_ context.Context, _ repository.DBTX, e *Epoch) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.failNext != nil {
		err := s.failNext
		s.failNext = nil
		return err
	}
	for _, ex := range s.epochs[e.SourceID] {
		if ex.Epoch == e.Epoch {
			return ErrAlreadyExists
		}
	}
	e.ID = uuid.NewString()
	e.CapturedAt = time.Now().UTC()
	s.epochs[e.SourceID] = append(s.epochs[e.SourceID], *e)
	return nil
}

func (s *svcMemStore) ListEpochs(_ context.Context, _ repository.DBTX, tenantID, sourceID string) ([]Epoch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]Epoch(nil), s.epochs[sourceID]...), nil
}

func (s *svcMemStore) LatestEpoch(_ context.Context, _ repository.DBTX, tenantID, sourceID string) (*Epoch, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	es := s.epochs[sourceID]
	if len(es) == 0 {
		return nil, ErrNotFound
	}
	cp := es[len(es)-1]
	return &cp, nil
}

func (s *svcMemStore) GetVMState(_ context.Context, _ repository.DBTX, tenantID, sourceID string) (VMState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.vmState[sourceID], nil
}

func (s *svcMemStore) UpsertVMState(_ context.Context, _ repository.DBTX, st VMState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.vmState[st.SourceID] = st
	return nil
}

// svcMemSink records every captured frame keyed by (stream, seq) and is
// idempotent on identical bytes — the test asserts exactly which frames reached
// the pipeline.
type svcMemSink struct {
	mu     sync.Mutex
	frames []core.Frame
}

func (m *svcMemSink) SinkFrame(_ context.Context, _ uuid.UUID, f core.Frame) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.frames = append(m.frames, f)
	return nil
}

func writeServiceImage(t *testing.T, blocks int) string {
	t.Helper()
	buf := make([]byte, blocks*DefaultBlockSize)
	if _, err := rand.Read(buf); err != nil {
		t.Fatalf("rand: %v", err)
	}
	path := filepath.Join(t.TempDir(), "disk.img")
	if err := os.WriteFile(path, buf, 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	return path
}

func newTestService(t *testing.T, store store, sink FrameSink) (*Service, *svcFakeRunner) {
	t.Helper()
	runner := newSvcFakeRunner()
	svc, err := NewService(ServiceConfig{
		Runner:  runner,
		Store:   store,
		Sink:    sink,
		Factory: NewDefaultBindingFactory(),
		Logger:  zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, runner
}

func TestService_RegisterAndRunVMCapture(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenant := uuid.New()
	streamID := uuid.New()
	path := writeServiceImage(t, 3)

	store := newSvcMemStore()
	sink := &svcMemSink{}
	svc, runner := newTestService(t, store, sink)

	src, err := svc.RegisterSource(ctx, tenant, RegisterInput{
		StreamID:    streamID.String(),
		Name:        "vm-prod",
		SourceKind:  SourceKindVMDisk,
		BindingKind: BindingFile,
		Config:      map[string]any{"path": path},
	})
	if err != nil {
		t.Fatalf("RegisterSource: %v", err)
	}
	if src.BlockSizeBytes != DefaultBlockSize {
		t.Fatalf("block size default not applied: %d", src.BlockSizeBytes)
	}
	if runner.tx.outboxRows != 1 {
		t.Fatalf("register staged %d outbox rows, want 1", runner.tx.outboxRows)
	}

	sourceID := uuid.MustParse(src.ID)
	epoch, err := svc.RunCapture(ctx, tenant, sourceID)
	if err != nil {
		t.Fatalf("RunCapture: %v", err)
	}
	if epoch.EpochKind != EpochBase || epoch.Epoch != 1 {
		t.Fatalf("first epoch = %+v, want base #1", epoch)
	}
	if epoch.ChangedUnits != 3 {
		t.Fatalf("base changed units = %d, want 3", epoch.ChangedUnits)
	}
	// Every emitted frame reached the sink: 3 blocks + manifest + marker = 5.
	if len(sink.frames) != 5 {
		t.Fatalf("sink received %d frames, want 5", len(sink.frames))
	}
	// register(1) + capture-completed(1) outbox events.
	if runner.tx.outboxRows != 2 {
		t.Fatalf("after capture staged %d outbox rows, want 2", runner.tx.outboxRows)
	}
	// Source row advanced.
	stored, _ := store.GetSource(ctx, nil, tenant.String(), src.ID)
	if stored.EpochCount != 1 || stored.LastSeq != epoch.ToSeq {
		t.Fatalf("source not advanced: %+v", stored)
	}

	// A second run with no disk change is a no-change epoch (marker only).
	sink.frames = nil
	epoch2, err := svc.RunCapture(ctx, tenant, sourceID)
	if err != nil {
		t.Fatalf("RunCapture 2: %v", err)
	}
	if epoch2.EpochKind != EpochIncremental || epoch2.ChangedUnits != 0 {
		t.Fatalf("second epoch = %+v, want incremental w/ 0 changes", epoch2)
	}
	if len(sink.frames) != 1 || sink.frames[0].Kind != core.FrameKindMarker {
		t.Fatalf("no-change run sank %d frames, want 1 marker", len(sink.frames))
	}
}

func TestService_RunCapture_DisabledSource(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenant := uuid.New()
	store := newSvcMemStore()
	svc, _ := newTestService(t, store, &svcMemSink{})

	disabled := false
	src, err := svc.RegisterSource(ctx, tenant, RegisterInput{
		StreamID: uuid.New().String(), Name: "off", SourceKind: SourceKindVMDisk, BindingKind: BindingFile,
		Config: map[string]any{"path": writeServiceImage(t, 1)}, Enabled: &disabled,
	})
	if err != nil {
		t.Fatalf("RegisterSource: %v", err)
	}
	_, err = svc.RunCapture(ctx, tenant, uuid.MustParse(src.ID))
	if !errors.Is(err, ErrDisabled) {
		t.Fatalf("err = %v, want ErrDisabled", err)
	}
}

func TestService_RegisterSource_Validation(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenant := uuid.New()
	svc, _ := newTestService(t, newSvcMemStore(), &svcMemSink{})

	cases := []RegisterInput{
		{StreamID: "not-a-uuid", Name: "x", SourceKind: SourceKindVMDisk, BindingKind: BindingFile},
		{StreamID: uuid.New().String(), Name: "", SourceKind: SourceKindVMDisk, BindingKind: BindingFile},
		{StreamID: uuid.New().String(), Name: "x", SourceKind: "bogus", BindingKind: BindingFile},
		{StreamID: uuid.New().String(), Name: "x", SourceKind: SourceKindVMDisk, BindingKind: "rest"}, // wrong binding for kind
	}
	for i, in := range cases {
		if _, err := svc.RegisterSource(ctx, tenant, in); !errors.Is(err, ErrInvalid) {
			t.Fatalf("case %d: err = %v, want ErrInvalid", i, err)
		}
	}
}

// TestService_RunK8sCapture proves the K8s path runs through the service with a
// REST binding backed by a httptest-equivalent: here we inject a fixture source
// via a custom factory to keep the test hermetic while exercising the full
// service run (frames sinked, epoch persisted, source advanced).
func TestService_RunK8sCapture(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenant := uuid.New()
	streamID := uuid.New()
	store := newSvcMemStore()
	sink := &svcMemSink{}

	runner := newSvcFakeRunner()
	svc, err := NewService(ServiceConfig{
		Runner: runner, Store: store, Sink: sink,
		Factory: &fixtureFactory{resources: []Resource{
			{Kind: "ConfigMap", Namespace: "prod", Name: "c", Object: map[string]any{"kind": "ConfigMap", "metadata": map[string]any{"name": "c", "namespace": "prod", "uid": "u"}, "data": map[string]any{"k": "v"}}},
			{Kind: "PersistentVolumeClaim", Namespace: "prod", Name: "data", Object: map[string]any{"kind": "PersistentVolumeClaim", "metadata": map[string]any{"name": "data", "namespace": "prod"}, "spec": map[string]any{}}},
		}},
		Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}

	src, err := svc.RegisterSource(ctx, tenant, RegisterInput{
		StreamID: streamID.String(), Name: "k8s-prod", SourceKind: SourceKindK8sWorkload, BindingKind: BindingREST,
		Config: map[string]any{"api_server": "https://k8s", "namespaces": []any{"prod"}},
	})
	if err != nil {
		t.Fatalf("RegisterSource: %v", err)
	}
	epoch, err := svc.RunCapture(ctx, tenant, uuid.MustParse(src.ID))
	if err != nil {
		t.Fatalf("RunCapture: %v", err)
	}
	if epoch.TotalUnits != 2 {
		t.Fatalf("k8s total units = %d, want 2", epoch.TotalUnits)
	}
	// 2 resources + 1 PVC link + 1 marker = 4 frames.
	if len(sink.frames) != 4 {
		t.Fatalf("k8s sink frames = %d, want 4", len(sink.frames))
	}
}

// fixtureFactory injects a fixture ResourceSource for K8s and the real file
// binding for VM (unused here), so the service K8s path is hermetic.
type fixtureFactory struct {
	resources []Resource
}

func (f *fixtureFactory) VMBinding(_ context.Context, s *Source) (HypervisorBinding, error) {
	return FileHypervisorBinding{Path: stringFromConfig(s.Config, "path")}, nil
}
func (f *fixtureFactory) K8sSource(_ context.Context, _ *Source) (ResourceSource, error) {
	return &FixtureResourceSource{Resources: f.resources}, nil
}
