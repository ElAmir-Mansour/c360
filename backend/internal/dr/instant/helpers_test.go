package instant

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// These helpers implement the REAL persistence + base-read contracts in memory
// so the COW semantics, hydration accounting, and state machine are exercised
// end-to-end without a database. They are NOT no-op mocks: memStore really keeps
// per-session overlay maps with origin tracking and enforces the same
// "write wins over hydrate, hydrate never overwrites" rules as the SQL store,
// and memBase really returns distinct deterministic bytes per chunk index.

// ---------------------------------------------------------------------------
// In-memory base recovery point (known, distinct contents per chunk).
// ---------------------------------------------------------------------------

type memBase struct {
	chunks    [][]byte
	chunkSize int
	mu        sync.Mutex
	reads     map[int]int // index -> number of times the base was read (for read-through assertions)
}

func newMemBase(chunks [][]byte, chunkSize int) *memBase {
	return &memBase{chunks: chunks, chunkSize: chunkSize, reads: make(map[int]int)}
}

// baseChunkBytes builds a deterministic, content-distinct byte slice for index i
// so tests can assert that a read returned the base (not the overlay) value.
func baseChunkBytes(i int) []byte {
	return []byte(fmt.Sprintf("BASE-CHUNK-%04d-payload", i))
}

func newSequentialBase(n, chunkSize int) *memBase {
	chunks := make([][]byte, n)
	for i := 0; i < n; i++ {
		chunks[i] = baseChunkBytes(i)
	}
	return newMemBase(chunks, chunkSize)
}

func (b *memBase) ChunkCount(context.Context) (int, error) { return len(b.chunks), nil }
func (b *memBase) ChunkSize(context.Context) (int, error)  { return b.chunkSize, nil }

func (b *memBase) ReadBaseChunk(_ context.Context, i int) ([]byte, error) {
	if i < 0 || i >= len(b.chunks) {
		return nil, fmt.Errorf("memBase: index %d out of range", i)
	}
	b.mu.Lock()
	b.reads[i]++
	// Return a copy so a caller cannot mutate the immutable base in place — the
	// real WORM read returns fresh decrypted bytes each call.
	out := make([]byte, len(b.chunks[i]))
	copy(out, b.chunks[i])
	b.mu.Unlock()
	return out, nil
}

func (b *memBase) readCount(i int) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.reads[i]
}

// snapshot returns a copy of the base contents so tests can prove the base was
// never mutated after writes/hydration.
func (b *memBase) snapshot() [][]byte {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := make([][]byte, len(b.chunks))
	for i := range b.chunks {
		c := make([]byte, len(b.chunks[i]))
		copy(c, b.chunks[i])
		out[i] = c
	}
	return out
}

// memBaseFactory resolves the same base for every recovery point (tests use one).
type memBaseFactory struct{ base BaseReader }

func (f memBaseFactory) BaseReader(context.Context, uuid.UUID, uuid.UUID) (BaseReader, error) {
	return f.base, nil
}

// ---------------------------------------------------------------------------
// In-memory store: real COW overlay + session lifecycle.
// ---------------------------------------------------------------------------

type overlayEntry struct {
	data   []byte
	origin string
}

type memSession struct {
	sess    *Session
	overlay map[int64]*overlayEntry
}

type memStore struct {
	mu       sync.Mutex
	sessions map[uuid.UUID]*memSession
}

func newMemStore() *memStore {
	return &memStore{sessions: make(map[uuid.UUID]*memSession)}
}

func (m *memStore) get(id uuid.UUID) (*memSession, error) {
	ms, ok := m.sessions[id]
	if !ok {
		return nil, ErrNotFound
	}
	return ms, nil
}

func cloneSession(s *Session) *Session {
	c := *s
	if s.GroupID != nil {
		g := *s.GroupID
		c.GroupID = &g
	}
	if s.FinalizedLocation != nil {
		l := *s.FinalizedLocation
		c.FinalizedLocation = &l
	}
	if s.LastError != nil {
		e := *s.LastError
		c.LastError = &e
	}
	if s.ReadyAt != nil {
		t := *s.ReadyAt
		c.ReadyAt = &t
	}
	if s.FinalizedAt != nil {
		t := *s.FinalizedAt
		c.FinalizedAt = &t
	}
	return &c
}

func (m *memStore) CreateSession(_ context.Context, _ repository.DBTX, sess *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if sess.ID == uuid.Nil {
		sess.ID = uuid.New()
	}
	if sess.State == "" {
		sess.State = StateHydrating
	}
	sess.StartedAt = time.Now().UTC()
	sess.UpdatedAt = sess.StartedAt
	sess.ChunksHydrated = 0
	m.sessions[sess.ID] = &memSession{sess: cloneSession(sess), overlay: make(map[int64]*overlayEntry)}
	return nil
}

func (m *memStore) GetSession(_ context.Context, _ repository.DBTX, tenantID, id uuid.UUID) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(id)
	if err != nil {
		return nil, err
	}
	if ms.sess.TenantID != tenantID {
		return nil, ErrNotFound
	}
	return cloneSession(ms.sess), nil
}

func (m *memStore) GetSessionSystem(_ context.Context, _ repository.DBTX, id uuid.UUID) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(id)
	if err != nil {
		return nil, err
	}
	return cloneSession(ms.sess), nil
}

func (m *memStore) ClaimActiveSessions(_ context.Context, _ repository.DBTX, limit int) ([]*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*Session
	for _, ms := range m.sessions {
		if ms.sess.State == StateHydrating || ms.sess.State == StateFinalizing {
			out = append(out, cloneSession(ms.sess))
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.Before(out[j].StartedAt) })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *memStore) SetChunksHydrated(_ context.Context, _ repository.DBTX, id uuid.UUID, hydrated int) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(id)
	if err != nil {
		return err
	}
	ms.sess.ChunksHydrated = hydrated
	ms.sess.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *memStore) TransitionToReady(_ context.Context, _ repository.DBTX, id uuid.UUID, hydrated int) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(id)
	if err != nil {
		return false, err
	}
	if ms.sess.State != StateHydrating {
		return false, nil
	}
	ms.sess.State = StateReady
	ms.sess.ChunksHydrated = hydrated
	now := time.Now().UTC()
	ms.sess.ReadyAt = &now
	ms.sess.UpdatedAt = now
	return true, nil
}

func (m *memStore) TransitionToFinalizing(_ context.Context, _ repository.DBTX, id uuid.UUID) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(id)
	if err != nil {
		return false, err
	}
	if ms.sess.State != StateReady {
		return false, nil
	}
	ms.sess.State = StateFinalizing
	ms.sess.UpdatedAt = time.Now().UTC()
	return true, nil
}

func (m *memStore) TransitionToFinalized(_ context.Context, _ repository.DBTX, id uuid.UUID, location string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(id)
	if err != nil {
		return false, err
	}
	if ms.sess.State != StateFinalizing {
		return false, nil
	}
	ms.sess.State = StateFinalized
	loc := location
	ms.sess.FinalizedLocation = &loc
	now := time.Now().UTC()
	ms.sess.FinalizedAt = &now
	ms.sess.UpdatedAt = now
	return true, nil
}

func (m *memStore) FailSession(_ context.Context, _ repository.DBTX, id uuid.UUID, reason string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(id)
	if err != nil {
		return false, err
	}
	if IsTerminal(ms.sess.State) {
		return false, nil
	}
	ms.sess.State = StateFailed
	r := reason
	ms.sess.LastError = &r
	ms.sess.UpdatedAt = time.Now().UTC()
	return true, nil
}

// --- overlay methods (the real COW semantics) ---

func (m *memStore) GetOverlayChunk(_ context.Context, _ repository.DBTX, sessionID uuid.UUID, index int64) ([]byte, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(sessionID)
	if err != nil {
		return nil, false, err
	}
	e, ok := ms.overlay[index]
	if !ok {
		return nil, false, nil
	}
	out := make([]byte, len(e.data))
	copy(out, e.data)
	return out, true, nil
}

func (m *memStore) PutWriteChunk(_ context.Context, _ repository.DBTX, _, sessionID uuid.UUID, index int64, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(sessionID)
	if err != nil {
		return err
	}
	buf := make([]byte, len(data))
	copy(buf, data)
	// write always wins (upsert to origin=write), matching the SQL ON CONFLICT.
	ms.overlay[index] = &overlayEntry{data: buf, origin: OriginWrite}
	return nil
}

func (m *memStore) PutHydrateChunk(_ context.Context, _ repository.DBTX, _, sessionID uuid.UUID, index int64, data []byte) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(sessionID)
	if err != nil {
		return false, err
	}
	// DO NOTHING on conflict: never overwrite a write or re-hydrate.
	if _, exists := ms.overlay[index]; exists {
		return false, nil
	}
	buf := make([]byte, len(data))
	copy(buf, data)
	ms.overlay[index] = &overlayEntry{data: buf, origin: OriginHydrate}
	return true, nil
}

func (m *memStore) PresentIndices(_ context.Context, _ repository.DBTX, sessionID uuid.UUID) (map[int64]bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	present := make(map[int64]bool, len(ms.overlay))
	for idx := range ms.overlay {
		present[idx] = true
	}
	return present, nil
}

func (m *memStore) CountHydrated(_ context.Context, _ repository.DBTX, sessionID uuid.UUID) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(sessionID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, e := range ms.overlay {
		if e.origin == OriginHydrate {
			n++
		}
	}
	return n, nil
}

func (m *memStore) ListOverlayChunks(_ context.Context, _ repository.DBTX, sessionID uuid.UUID) ([]OverlayChunk, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(sessionID)
	if err != nil {
		return nil, err
	}
	idxs := make([]int64, 0, len(ms.overlay))
	for idx := range ms.overlay {
		idxs = append(idxs, idx)
	}
	sort.Slice(idxs, func(i, j int) bool { return idxs[i] < idxs[j] })
	out := make([]OverlayChunk, 0, len(idxs))
	for _, idx := range idxs {
		e := ms.overlay[idx]
		sum := sha256.Sum256(e.data)
		buf := make([]byte, len(e.data))
		copy(buf, e.data)
		out = append(out, OverlayChunk{
			SessionID:   sessionID,
			ChunkIndex:  idx,
			Origin:      e.origin,
			Data:        buf,
			ContentHash: hex.EncodeToString(sum[:]),
			ByteLen:     len(e.data),
		})
	}
	return out, nil
}

// overlayOrigin exposes the stored origin for a chunk so a test can assert that
// a redirect-on-write stays 'write' even after the hydrator runs.
func (m *memStore) overlayOrigin(sessionID uuid.UUID, index int64) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	ms, err := m.get(sessionID)
	if err != nil {
		return "", false
	}
	e, ok := ms.overlay[index]
	if !ok {
		return "", false
	}
	return e.origin, true
}

// ---------------------------------------------------------------------------
// In-memory runners. They invoke fn with a recording DBTX. The memStore ignores
// the DBTX (its state lives in maps), but the service's real outbox.Write code
// path runs against it: it Execs the INSERT, which the recordingDB accepts and
// counts. This keeps the lifecycle-event emission a REAL code path (state +
// event in one fn) without a database, instead of stubbing emit out.
// ---------------------------------------------------------------------------

// recordingDB is a repository.DBTX whose Exec succeeds (and counts outbox
// inserts) and whose Query paths are never used by the memStore. It models the
// caller-supplied execution context the real runners provide.
type recordingDB struct {
	mu         sync.Mutex
	outboxRows int
	lastOutbox string
}

func (d *recordingDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(sql) >= len("INSERT INTO event_outbox") && sql[:len("INSERT INTO event_outbox")] == "INSERT INTO event_outbox" {
		d.outboxRows++
		if len(args) >= 4 {
			if t, ok := args[3].(string); ok {
				d.lastOutbox = t
			}
		}
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (d *recordingDB) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, fmt.Errorf("recordingDB: Query not supported (memStore holds state in memory)")
}

func (d *recordingDB) QueryRow(context.Context, string, ...any) pgx.Row {
	return errRow{}
}

func (d *recordingDB) outboxCount() int {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.outboxRows
}

// errRow is a pgx.Row that always errors; the memStore never reaches it.
type errRow struct{}

func (errRow) Scan(...any) error {
	return fmt.Errorf("recordingDB: QueryRow not supported (memStore holds state in memory)")
}

type memRunner struct {
	db *recordingDB
}

func newMemRunner() memRunner { return memRunner{db: &recordingDB{}} }

func (r memRunner) dbtx() repository.DBTX {
	if r.db == nil {
		return &recordingDB{}
	}
	return r.db
}

func (r memRunner) RunWithTenant(_ context.Context, _ string, fn func(repository.DBTX) error) error {
	return fn(r.dbtx())
}
func (r memRunner) RunReadWithTenant(_ context.Context, _ string, fn func(repository.DBTX) error) error {
	return fn(r.dbtx())
}
func (r memRunner) RunSystemTx(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(r.dbtx())
}
func (r memRunner) RunSystemRead(_ context.Context, fn func(repository.DBTX) error) error {
	return fn(r.dbtx())
}

// ---------------------------------------------------------------------------
// In-memory finalize sink (records the assembled standalone copy).
// ---------------------------------------------------------------------------

type memSink struct {
	mu       sync.Mutex
	chunks   map[int][]byte
	closed   bool
	location string
}

func newMemSink(location string) *memSink {
	return &memSink{chunks: make(map[int][]byte), location: location}
}

func (s *memSink) WriteChunk(_ context.Context, i int, data []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	buf := make([]byte, len(data))
	copy(buf, data)
	s.chunks[i] = buf
	return nil
}

func (s *memSink) Close(context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return nil
}

func (s *memSink) Location() string { return s.location }

type memSinkFactory struct{ sink *memSink }

func (f memSinkFactory) FinalizeSink(context.Context, uuid.UUID, uuid.UUID) (FinalizeSink, error) {
	return f.sink, nil
}

// newTestService builds a fully real-wired Service over the in-memory pieces.
func newTestService(t testingTB, store *memStore, base BaseReader, sink *memSink, ratePerSec float64) *Service {
	t.Helper()
	hyd, err := NewHydrator(HydratorConfig{Store: store, RatePerSec: ratePerSec, Burst: 64})
	if err != nil {
		t.Fatalf("NewHydrator: %v", err)
	}
	runner := newMemRunner()
	svc, err := NewService(Deps{
		Store:       store,
		Runner:      runner,
		System:      runner,
		BaseReaders: memBaseFactory{base: base},
		Sinks:       memSinkFactory{sink: sink},
		Hydrator:    hyd,
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

// testingTB is the minimal subset of *testing.T the helpers use.
type testingTB interface {
	Helper()
	Fatalf(format string, args ...any)
}
