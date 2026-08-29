package journal

import (
	"bytes"
	"context"
	"errors"
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

const (
	testTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	testStream = "11111111-1111-1111-1111-111111111111"
)

// fakeRunner runs fn with a recording DBTX (no real DB). It captures every
// staged outbox event so tests can assert state+event atomicity intent.
type fakeRunner struct {
	tx *recordingTx
}

func newFakeRunner() *fakeRunner { return &fakeRunner{tx: &recordingTx{}} }

func (r *fakeRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(r.tx)
}

func (r *fakeRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(repository.DBTX) error) error {
	return fn(r.tx)
}

// recordingTx is a repository.DBTX that records outbox Exec inserts and answers
// the LatestSealedSeq query from an injected value.
type recordingTx struct {
	mu         sync.Mutex
	outboxRows int
	execErr    error
}

func (t *recordingTx) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.execErr != nil {
		return pgconn.CommandTag{}, t.execErr
	}
	if bytes.Contains([]byte(sql), []byte("event_outbox")) {
		t.outboxRows++
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (t *recordingTx) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query in appender test")
}

func (t *recordingTx) QueryRow(context.Context, string, ...any) pgx.Row {
	return nil
}

// fakeSegmentStore records appended segments and answers LatestSealedSeq.
type fakeSegmentStore struct {
	mu         sync.Mutex
	appended   []Segment
	latestSeq  int64
	failAppend error
	dupOnSeq   int64 // when set, AppendSegment of this min_seq returns ErrAlreadyExists
}

func (f *fakeSegmentStore) AppendSegment(_ context.Context, _ repository.DBTX, s *Segment) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failAppend != nil {
		return f.failAppend
	}
	if f.dupOnSeq != 0 && s.MinSeq == f.dupOnSeq {
		return ErrAlreadyExists
	}
	s.ID = uuid.NewString()
	s.SealedAt = time.Now().UTC()
	f.appended = append(f.appended, *s)
	return nil
}

func (f *fakeSegmentStore) LatestSealedSeq(_ context.Context, _ repository.DBTX, _, _ string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.latestSeq, nil
}

// memSink records sealed payloads keyed by (stream,minSeq) and is idempotent.
type memSink struct {
	mu     sync.Mutex
	sealed map[string][]byte
	calls  int
	failOn int64
}

func newMemSink() *memSink { return &memSink{sealed: map[string][]byte{}} }

func (m *memSink) SealSegment(_ context.Context, _ uuid.UUID, streamID string, minSeq, maxSeq int64, payload []byte) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.calls++
	if m.failOn != 0 && minSeq == m.failOn {
		return "", errors.New("sink failure")
	}
	key := streamID + ":" + itoa(minSeq) + "-" + itoa(maxSeq)
	m.sealed[key] = append([]byte(nil), payload...)
	return "obj/" + key, nil
}

func itoa(n int64) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		b[i] = '-'
	}
	return string(b[i:])
}

func newTestAppender(t *testing.T, store *fakeSegmentStore, sink *memSink, cfg AppenderConfig) (*Appender, *fakeRunner) {
	t.Helper()
	runner := newFakeRunner()
	cfg.Runner = runner
	cfg.Store = store
	cfg.Sink = sink
	cfg.Logger = zerolog.Nop()
	a, err := NewAppender(cfg)
	if err != nil {
		t.Fatalf("NewAppender: %v", err)
	}
	return a, runner
}

func frame(seq uint64, kind core.FrameKind, lsn string, payload string, ts time.Time) core.Frame {
	return core.Frame{
		StreamID:  testStream,
		Seq:       seq,
		Kind:      kind,
		SourceLSN: lsn,
		Payload:   []byte(payload),
		EmittedAt: ts,
	}
}

func TestAppender_RollsBySizeAndSealsRealBytes(t *testing.T) {
	t.Parallel()
	store := &fakeSegmentStore{}
	sink := newMemSink()
	// Roll every 3 frames.
	a, runner := newTestAppender(t, store, sink, AppenderConfig{MaxFrames: 3, Now: func() time.Time { return t0 }})
	tid := uuid.MustParse(testTenant)

	for i := uint64(1); i <= 3; i++ {
		if err := a.Append(context.Background(), tid, frame(i, core.FrameKindWAL, "0/"+itoa(int64(i)), "p"+itoa(int64(i)), t0.Add(time.Duration(i)*time.Second))); err != nil {
			t.Fatalf("Append %d: %v", i, err)
		}
	}

	if len(store.appended) != 1 {
		t.Fatalf("appended segments = %d, want 1 (rolled at 3 frames)", len(store.appended))
	}
	seg := store.appended[0]
	if seg.MinSeq != 1 || seg.MaxSeq != 3 || seg.FrameCount != 3 {
		t.Fatalf("segment range wrong: %+v", seg)
	}
	if seg.MinLSN != "0/1" || seg.MaxLSN != "0/3" {
		t.Fatalf("segment LSN bounds wrong: %s..%s", seg.MinLSN, seg.MaxLSN)
	}
	// The sealed bytes must decode back to exactly the three frames in order.
	objKey := "obj/" + testStream + ":1-3"
	raw, ok := sink.sealed[testStream+":1-3"]
	if !ok {
		t.Fatalf("sink missing sealed object for [1,3]")
	}
	if seg.ObjectKey != objKey {
		t.Fatalf("object key = %q, want %q", seg.ObjectKey, objKey)
	}
	decoded, err := core.DecodeFrames(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("DecodeFrames: %v", err)
	}
	if len(decoded) != 3 {
		t.Fatalf("decoded frames = %d, want 3", len(decoded))
	}
	for i, f := range decoded {
		if f.Seq != uint64(i+1) || string(f.Payload) != "p"+itoa(int64(i+1)) {
			t.Fatalf("decoded frame %d wrong: seq=%d payload=%q", i, f.Seq, f.Payload)
		}
	}
	// One outbox event staged for the seal.
	if runner.tx.outboxRows != 1 {
		t.Fatalf("outbox rows = %d, want 1 (segment.sealed event)", runner.tx.outboxRows)
	}
	if seg.ContentHash == "" || len(seg.ContentHash) != 64 {
		t.Fatalf("content hash not a sha256 hex: %q", seg.ContentHash)
	}
}

func TestAppender_MarkerForcesImmediateSeal(t *testing.T) {
	t.Parallel()
	store := &fakeSegmentStore{}
	sink := newMemSink()
	// High frame threshold so only the MARKER forces a seal.
	a, _ := newTestAppender(t, store, sink, AppenderConfig{MaxFrames: 1000, Now: func() time.Time { return t0 }})
	tid := uuid.MustParse(testTenant)

	_ = a.Append(context.Background(), tid, frame(1, core.FrameKindWAL, "0/1", "a", t0))
	_ = a.Append(context.Background(), tid, frame(2, core.FrameKindMarker, "0/2", "", t0.Add(time.Second)))

	if len(store.appended) != 1 {
		t.Fatalf("appended = %d, want 1 (marker forces seal)", len(store.appended))
	}
	if store.appended[0].MaxSeq != 2 {
		t.Fatalf("segment max_seq = %d, want 2", store.appended[0].MaxSeq)
	}
}

func TestAppender_IdempotentDuplicate(t *testing.T) {
	t.Parallel()
	store := &fakeSegmentStore{}
	sink := newMemSink()
	a, _ := newTestAppender(t, store, sink, AppenderConfig{MaxFrames: 5, Now: func() time.Time { return t0 }})
	tid := uuid.MustParse(testTenant)

	_ = a.Append(context.Background(), tid, frame(1, core.FrameKindWAL, "0/1", "a", t0))
	_ = a.Append(context.Background(), tid, frame(2, core.FrameKindWAL, "0/2", "b", t0))
	// Re-deliver frame 1 (after a resume): must be an idempotent no-op.
	if err := a.Append(context.Background(), tid, frame(1, core.FrameKindWAL, "0/1", "a", t0)); err != nil {
		t.Fatalf("duplicate Append should be a no-op, got %v", err)
	}
	// Flush and confirm only 2 distinct frames were folded.
	if err := a.Flush(context.Background(), tid, testStream); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if len(store.appended) != 1 || store.appended[0].FrameCount != 2 {
		t.Fatalf("expected one 2-frame segment, got %+v", store.appended)
	}
}

func TestAppender_NonContiguousIsError(t *testing.T) {
	t.Parallel()
	store := &fakeSegmentStore{}
	sink := newMemSink()
	a, _ := newTestAppender(t, store, sink, AppenderConfig{MaxFrames: 5})
	tid := uuid.MustParse(testTenant)

	_ = a.Append(context.Background(), tid, frame(1, core.FrameKindWAL, "0/1", "a", t0))
	// Skip seq 2: a gap must be rejected (the journal must stay resolvable).
	err := a.Append(context.Background(), tid, frame(3, core.FrameKindWAL, "0/3", "c", t0))
	if !errors.Is(err, ErrInvalid) {
		t.Fatalf("gap Append err = %v, want ErrInvalid", err)
	}
}

func TestAppender_ResumesAfterSealedSeq(t *testing.T) {
	t.Parallel()
	// LatestSealedSeq reports 10 already sealed: a fresh buffer must open at 11
	// and a re-delivered seq <= 10 is an idempotent no-op.
	store := &fakeSegmentStore{latestSeq: 10}
	sink := newMemSink()
	a, _ := newTestAppender(t, store, sink, AppenderConfig{MaxFrames: 2})
	tid := uuid.MustParse(testTenant)

	if err := a.Append(context.Background(), tid, frame(5, core.FrameKindWAL, "0/5", "old", t0)); err != nil {
		t.Fatalf("re-delivered old frame should be a no-op, got %v", err)
	}
	if err := a.Append(context.Background(), tid, frame(11, core.FrameKindWAL, "0/B", "new", t0)); err != nil {
		t.Fatalf("Append 11: %v", err)
	}
	if err := a.Append(context.Background(), tid, frame(12, core.FrameKindWAL, "0/C", "new2", t0)); err != nil {
		t.Fatalf("Append 12: %v", err)
	}
	if len(store.appended) != 1 || store.appended[0].MinSeq != 11 {
		t.Fatalf("expected segment opening at 11, got %+v", store.appended)
	}
}

func TestAppender_DuplicateSealIsNoOp(t *testing.T) {
	t.Parallel()
	// Store reports ErrAlreadyExists for the sealed range (a replayed seal): the
	// appender must treat it as an idempotent success, not an error.
	store := &fakeSegmentStore{dupOnSeq: 1}
	sink := newMemSink()
	a, _ := newTestAppender(t, store, sink, AppenderConfig{MaxFrames: 2})
	tid := uuid.MustParse(testTenant)

	_ = a.Append(context.Background(), tid, frame(1, core.FrameKindWAL, "0/1", "a", t0))
	err := a.Append(context.Background(), tid, frame(2, core.FrameKindWAL, "0/2", "b", t0))
	if err != nil {
		t.Fatalf("duplicate seal should be a no-op, got %v", err)
	}
}

func TestAppender_FlushAll(t *testing.T) {
	t.Parallel()
	store := &fakeSegmentStore{}
	sink := newMemSink()
	a, _ := newTestAppender(t, store, sink, AppenderConfig{MaxFrames: 1000})
	tid := uuid.MustParse(testTenant)

	_ = a.Append(context.Background(), tid, frame(1, core.FrameKindWAL, "0/1", "a", t0))
	_ = a.Append(context.Background(), tid, frame(2, core.FrameKindWAL, "0/2", "b", t0))
	if len(store.appended) != 0 {
		t.Fatalf("nothing should have sealed yet, got %d", len(store.appended))
	}
	if err := a.FlushAll(context.Background()); err != nil {
		t.Fatalf("FlushAll: %v", err)
	}
	if len(store.appended) != 1 || store.appended[0].FrameCount != 2 {
		t.Fatalf("FlushAll should seal the open buffer, got %+v", store.appended)
	}
}

func TestNewAppender_Validation(t *testing.T) {
	t.Parallel()
	if _, err := NewAppender(AppenderConfig{}); err == nil {
		t.Fatal("expected error for missing runner")
	}
	if _, err := NewAppender(AppenderConfig{Runner: newFakeRunner()}); err == nil {
		t.Fatal("expected error for missing store")
	}
	if _, err := NewAppender(AppenderConfig{Runner: newFakeRunner(), Store: &fakeSegmentStore{}}); err == nil {
		t.Fatal("expected error for missing sink")
	}
}
