package cleanroom

import (
	"context"
	"errors"
	"sort"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// memTenantRunner runs fns with a nil DBTX (the fake store ignores it) and
// records which path (read vs write) was used. It models the tenant-scoped
// transaction boundary without a database.
type memTenantRunner struct {
	tenants []uuid.UUID
	writes  int
	reads   int
}

func (r *memTenantRunner) RunWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.tenants = append(r.tenants, tenantID)
	r.writes++
	return fn(nil)
}

func (r *memTenantRunner) RunReadWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.tenants = append(r.tenants, tenantID)
	r.reads++
	return fn(nil)
}

// memScanStore is an in-memory ScanStore. It exercises the real CreateScan
// inputs (verdict, findings) without Postgres.
type memScanStore struct {
	mu      sync.Mutex
	created []*Scan
}

func (s *memScanStore) CreateScan(_ context.Context, _ repository.DBTX, sc *Scan) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc.ID = uuid.NewString()
	cp := *sc
	s.created = append(s.created, &cp)
	return nil
}

func (s *memScanStore) LatestScan(_ context.Context, _ repository.DBTX, _, recoveryPointID string) (*Scan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := len(s.created) - 1; i >= 0; i-- {
		if s.created[i].RecoveryPointID == recoveryPointID {
			return s.created[i], nil
		}
	}
	return nil, ErrNotFound
}

func (s *memScanStore) ListScans(_ context.Context, _ repository.DBTX, _, recoveryPointID string) ([]*Scan, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Scan
	for i := len(s.created) - 1; i >= 0; i-- {
		if s.created[i].RecoveryPointID == recoveryPointID {
			out = append(out, s.created[i])
		}
	}
	return out, nil
}

// recordingStager captures staged events instead of writing the outbox.
type recordingStager struct {
	types  []string
	bodies []map[string]any
}

func (s *recordingStager) Stage(_ context.Context, _ repository.DBTX, eventType, _ string, data map[string]any) error {
	s.types = append(s.types, eventType)
	s.bodies = append(s.bodies, data)
	return nil
}

// staticLookup returns a fixed RecoveryPointInfo.
type staticLookup struct {
	info RecoveryPointInfo
	err  error
}

func (l staticLookup) LookupRecoveryPoint(_ context.Context, _, pointID uuid.UUID) (RecoveryPointInfo, error) {
	if l.err != nil {
		return RecoveryPointInfo{}, l.err
	}
	info := l.info
	info.ID = pointID
	return info, nil
}

func newTestService(t *testing.T, data map[string][]byte, contentHash string, lookupErr error) (*Service, *memScanStore, *recordingStager, *memTenantRunner) {
	t.Helper()
	keys := make(map[string]string, len(data))
	for streamID := range data {
		keys[streamID] = "key/" + streamID
	}
	runner := &memTenantRunner{}
	store := &memScanStore{}
	stager := &recordingStager{}
	engine := NewEngine(memChunkReader{data: data}, NewSignatureScanner())
	svc, err := NewService(Config{
		TX:    runner,
		Store: store,
		Lookup: staticLookup{
			info: RecoveryPointInfo{
				GroupID:     uuid.New(),
				ContentHash: contentHash,
				ObjectKeys:  keys,
			},
			err: lookupErr,
		},
		Engine:  engine,
		Stager:  stager,
		Metrics: NewMetrics(nil),
		Logger:  zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, store, stager, runner
}

func TestService_ScanRecoveryPoint_CleanEmitsPassed(t *testing.T) {
	t.Parallel()
	data := map[string][]byte{"s1": []byte("clean-1"), "s2": []byte("clean-2")}
	svc, store, stager, runner := newTestService(t, data, sealedContentHash(data), nil)

	tenantID, pointID := uuid.New(), uuid.New()
	scan, err := svc.ScanRecoveryPoint(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("ScanRecoveryPoint: %v", err)
	}
	if scan.Verdict != VerdictClean {
		t.Fatalf("verdict: got %q want clean (detail %s)", scan.Verdict, scan.Detail)
	}
	if len(store.created) != 1 {
		t.Fatalf("expected 1 persisted scan, got %d", len(store.created))
	}
	if store.created[0].ID == "" {
		t.Fatal("persisted scan should have an id")
	}
	if len(stager.types) != 1 || stager.types[0] != EventTypeCleanroomPassed {
		t.Fatalf("expected one %s event, got %v", EventTypeCleanroomPassed, stager.types)
	}
	if runner.writes != 1 {
		t.Fatalf("expected 1 write tx, got %d", runner.writes)
	}
	if runner.reads != 1 {
		t.Fatalf("expected 1 read tx (lookup), got %d", runner.reads)
	}
	// The event body carries the verdict for downstream consumers.
	if got := stager.bodies[0]["verdict"]; got != VerdictClean {
		t.Fatalf("event verdict: got %v want clean", got)
	}
}

func TestService_ScanRecoveryPoint_DirtyEmitsFailed(t *testing.T) {
	t.Parallel()
	data := map[string][]byte{"s1": []byte("clean"), "s2": []byte("bad:" + EICAR)}
	svc, store, stager, _ := newTestService(t, data, sealedContentHash(data), nil)

	scan, err := svc.ScanRecoveryPoint(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("ScanRecoveryPoint: %v", err)
	}
	if scan.Verdict != VerdictMalware {
		t.Fatalf("verdict: got %q want malware (detail %s)", scan.Verdict, scan.Detail)
	}
	if len(store.created) != 1 {
		t.Fatalf("dirty verdict must still be persisted, got %d rows", len(store.created))
	}
	if len(stager.types) != 1 || stager.types[0] != EventTypeCleanroomFailed {
		t.Fatalf("expected one %s event, got %v", EventTypeCleanroomFailed, stager.types)
	}
}

func TestService_ScanRecoveryPoint_IntegrityFailedEmitsFailed(t *testing.T) {
	t.Parallel()
	data := map[string][]byte{"s1": []byte("clean")}
	svc, store, stager, _ := newTestService(t, data, "0000000000000000000000000000000000000000000000000000000000000000", nil)

	scan, err := svc.ScanRecoveryPoint(context.Background(), uuid.New(), uuid.New())
	if err != nil {
		t.Fatalf("ScanRecoveryPoint: %v", err)
	}
	if scan.Verdict != VerdictIntegrityFailed {
		t.Fatalf("verdict: got %q want integrity_failed", scan.Verdict)
	}
	if len(store.created) != 1 {
		t.Fatalf("expected 1 row, got %d", len(store.created))
	}
	if stager.types[0] != EventTypeCleanroomFailed {
		t.Fatalf("expected failed event, got %v", stager.types)
	}
}

func TestService_ScanRecoveryPoint_LookupError(t *testing.T) {
	t.Parallel()
	svc, store, stager, _ := newTestService(t, map[string][]byte{"s": []byte("x")}, "", errors.New("rp not found"))
	if _, err := svc.ScanRecoveryPoint(context.Background(), uuid.New(), uuid.New()); err == nil {
		t.Fatal("expected lookup error to propagate")
	}
	if len(store.created) != 0 || len(stager.types) != 0 {
		t.Fatal("no verdict or event should be written when lookup fails")
	}
}

func TestService_ScanRecoveryPoint_RejectsNilIDs(t *testing.T) {
	t.Parallel()
	svc, _, _, _ := newTestService(t, map[string][]byte{"s": []byte("x")}, "", nil)
	if _, err := svc.ScanRecoveryPoint(context.Background(), uuid.Nil, uuid.New()); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured for nil tenant, got %v", err)
	}
	if _, err := svc.ScanRecoveryPoint(context.Background(), uuid.New(), uuid.Nil); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("expected ErrNotConfigured for nil point, got %v", err)
	}
}

func TestService_LatestAndList(t *testing.T) {
	t.Parallel()
	data := map[string][]byte{"s": []byte("clean")}
	svc, _, _, _ := newTestService(t, data, sealedContentHash(data), nil)
	tenantID, pointID := uuid.New(), uuid.New()

	if _, err := svc.ScanRecoveryPoint(context.Background(), tenantID, pointID); err != nil {
		t.Fatalf("scan: %v", err)
	}
	latest, err := svc.LatestScan(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("LatestScan: %v", err)
	}
	if latest.RecoveryPointID != pointID.String() {
		t.Fatalf("latest scan point: got %q want %q", latest.RecoveryPointID, pointID.String())
	}
	list, err := svc.ListScans(context.Background(), tenantID, pointID)
	if err != nil {
		t.Fatalf("ListScans: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("expected 1 scan in history, got %d", len(list))
	}
}

func TestNewService_RequiresDeps(t *testing.T) {
	t.Parallel()
	base := Config{
		TX:     &memTenantRunner{},
		Store:  &memScanStore{},
		Lookup: staticLookup{},
		Engine: NewEngine(memChunkReader{}, NewSignatureScanner()),
		Logger: zerolog.Nop(),
	}
	cases := []func(*Config){
		func(c *Config) { c.TX = nil },
		func(c *Config) { c.Store = nil },
		func(c *Config) { c.Lookup = nil },
		func(c *Config) { c.Engine = nil },
	}
	for i, mutate := range cases {
		cfg := base
		mutate(&cfg)
		if _, err := NewService(cfg); err == nil {
			t.Fatalf("case %d: expected error for missing dependency", i)
		}
	}
	// Stager defaults to OutboxStager when nil.
	if _, err := NewService(base); err != nil {
		t.Fatalf("valid config should construct: %v", err)
	}
}

// sortedKeys is a tiny helper used to make assertions deterministic.
func sortedKeys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

var _ = sortedKeys
