package journal

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// memStore is a full in-memory journal store used by the service and retention
// tests. It records outbox staging via the runner, not here.
type memStore struct {
	mu        sync.Mutex
	segments  map[string][]Segment  // testStream -> segments
	bookmarks map[string][]Bookmark // testStream -> bookmarks
	created   []Bookmark
	deleted   []string
	pruned    []string
}

func newMemStore() *memStore {
	return &memStore{segments: map[string][]Segment{}, bookmarks: map[string][]Bookmark{}}
}

func (m *memStore) ListSegments(_ context.Context, _ repository.DBTX, _, streamID string) ([]Segment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Segment(nil), m.segments[streamID]...), nil
}

func (m *memStore) ListBookmarks(_ context.Context, _ repository.DBTX, _, streamID string) ([]Bookmark, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]Bookmark(nil), m.bookmarks[streamID]...), nil
}

func (m *memStore) GetBookmark(_ context.Context, _ repository.DBTX, _, streamID, id string) (*Bookmark, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, b := range m.bookmarks[streamID] {
		if b.ID == id {
			cp := b
			return &cp, nil
		}
	}
	return nil, ErrNotFound
}

func (m *memStore) CreateBookmark(_ context.Context, _ repository.DBTX, b *Bookmark) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, ex := range m.bookmarks[b.StreamID] {
		if ex.Name == b.Name {
			return ErrAlreadyExists
		}
	}
	b.ID = uuid.NewString()
	b.CreatedAt = time.Now().UTC()
	m.bookmarks[b.StreamID] = append(m.bookmarks[b.StreamID], *b)
	m.created = append(m.created, *b)
	return nil
}

func (m *memStore) DeleteBookmark(_ context.Context, _ repository.DBTX, _, streamID, id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := m.bookmarks[streamID][:0]
	found := false
	for _, b := range m.bookmarks[streamID] {
		if b.ID == id {
			found = true
			continue
		}
		out = append(out, b)
	}
	m.bookmarks[streamID] = out
	if !found {
		return ErrNotFound
	}
	m.deleted = append(m.deleted, id)
	return nil
}

func (m *memStore) PruneCandidates(_ context.Context, _ repository.DBTX, _, streamID string, olderThan any, _ int) ([]Segment, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	horizon := olderThan.(time.Time)
	var out []Segment
	for _, seg := range m.segments[streamID] {
		if seg.Pruned || !seg.MaxTS.Before(horizon) {
			continue
		}
		if m.bookmarkInside(streamID, seg) {
			continue
		}
		out = append(out, seg)
	}
	return out, nil
}

func (m *memStore) bookmarkInside(streamID string, seg Segment) bool {
	for _, b := range m.bookmarks[streamID] {
		if b.AtSeq >= seg.MinSeq && b.AtSeq <= seg.MaxSeq {
			return true
		}
	}
	return false
}

func (m *memStore) MarkPruned(_ context.Context, _ repository.DBTX, in PruneInput) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, seg := range m.segments[in.StreamID] {
		if seg.ID != in.ID {
			continue
		}
		if seg.Pruned || m.bookmarkInside(in.StreamID, seg) {
			return false, nil
		}
		now := time.Now().UTC()
		m.segments[in.StreamID][i].Pruned = true
		m.segments[in.StreamID][i].PrunedAt = &now
		m.pruned = append(m.pruned, in.ID)
		return true, nil
	}
	return false, nil
}

func newTestService(t *testing.T, store journalStore) (*Service, *fakeRunner) {
	t.Helper()
	runner := newFakeRunner()
	svc, err := NewService(ServiceConfig{Runner: runner, Store: store, Logger: zerolog.Nop(), Now: func() time.Time { return t0 }})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, runner
}

func seedSegments(m *memStore, streamID string) {
	segs := makeSegments()
	for i := range segs {
		segs[i].ID = uuid.NewString()
		segs[i].StreamID = streamID
	}
	m.segments[streamID] = segs
}

func TestService_Timeline(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, _ := newTestService(t, store)

	tl, err := svc.Timeline(context.Background(), uuid.MustParse(testTenant), uuid.MustParse(testStream))
	if err != nil {
		t.Fatalf("Timeline: %v", err)
	}
	if !tl.Recoverable || tl.HasGaps {
		t.Fatalf("timeline flags wrong: recoverable=%v gaps=%v", tl.Recoverable, tl.HasGaps)
	}
	if tl.EarliestSeq != 1 || tl.LatestSeq != 400 {
		t.Fatalf("window = [%d,%d], want [1,400]", tl.EarliestSeq, tl.LatestSeq)
	}
}

func TestService_CreateBookmark_PinsBySeq(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, runner := newTestService(t, store)
	uid := uuid.New()

	bm, err := svc.CreateBookmark(context.Background(), uuid.MustParse(testTenant), uuid.MustParse(testStream), &uid,
		CreateBookmarkInput{Name: "pre-upgrade", Kind: BookmarkPreChange, AtSeq: 150})
	if err != nil {
		t.Fatalf("CreateBookmark: %v", err)
	}
	if bm.AtSeq != 150 {
		t.Fatalf("AtSeq = %d, want 150", bm.AtSeq)
	}
	// TS/LSN backfilled from the segment containing seq 150 (segment B).
	if bm.AtLSN == "" || bm.AtTS.IsZero() {
		t.Fatalf("bookmark not backfilled: lsn=%q ts=%s", bm.AtLSN, bm.AtTS)
	}
	if bm.CreatedBy == nil || *bm.CreatedBy != uid.String() {
		t.Fatalf("created_by not set: %v", bm.CreatedBy)
	}
	// The bookmark-created event was staged in the same tx.
	if runner.tx.outboxRows != 1 {
		t.Fatalf("outbox rows = %d, want 1", runner.tx.outboxRows)
	}
}

func TestService_CreateBookmark_PinsByTimestamp(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, _ := newTestService(t, store)

	at := t0.Add(25 * time.Minute) // inside segment C
	bm, err := svc.CreateBookmark(context.Background(), uuid.MustParse(testTenant), uuid.MustParse(testStream), nil,
		CreateBookmarkInput{Name: "ts-pin", AtTS: &at})
	if err != nil {
		t.Fatalf("CreateBookmark: %v", err)
	}
	// Resolved to segment C's MaxSeq (300).
	if bm.AtSeq != 300 {
		t.Fatalf("AtSeq = %d, want 300 (segment C boundary)", bm.AtSeq)
	}
	if bm.Kind != BookmarkManual {
		t.Fatalf("default kind = %q, want manual", bm.Kind)
	}
}

func TestService_CreateBookmark_Validation(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, _ := newTestService(t, store)
	tid := uuid.MustParse(testTenant)
	sid := uuid.MustParse(testStream)

	if _, err := svc.CreateBookmark(context.Background(), tid, sid, nil, CreateBookmarkInput{Kind: BookmarkManual, AtSeq: 1}); !errors.Is(err, ErrInvalid) {
		t.Fatal("expected ErrInvalid for missing name")
	}
	if _, err := svc.CreateBookmark(context.Background(), tid, sid, nil, CreateBookmarkInput{Name: "x"}); !errors.Is(err, ErrInvalid) {
		t.Fatal("expected ErrInvalid for missing pin")
	}
	if _, err := svc.CreateBookmark(context.Background(), tid, sid, nil, CreateBookmarkInput{Name: "x", Kind: "bad", AtSeq: 1}); !errors.Is(err, ErrInvalid) {
		t.Fatal("expected ErrInvalid for bad kind")
	}
}

func TestService_CreateBookmark_DuplicateName(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, _ := newTestService(t, store)
	tid := uuid.MustParse(testTenant)
	sid := uuid.MustParse(testStream)

	if _, err := svc.CreateBookmark(context.Background(), tid, sid, nil, CreateBookmarkInput{Name: "dup", AtSeq: 50}); err != nil {
		t.Fatalf("first CreateBookmark: %v", err)
	}
	if _, err := svc.CreateBookmark(context.Background(), tid, sid, nil, CreateBookmarkInput{Name: "dup", AtSeq: 60}); !errors.Is(err, ErrAlreadyExists) {
		t.Fatalf("got %v, want ErrAlreadyExists", err)
	}
}

func TestService_Resolve_RejectsAmbiguousTarget(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, _ := newTestService(t, store)
	tid := uuid.MustParse(testTenant)
	sid := uuid.MustParse(testStream)

	at := t0
	seq := int64(5)
	// Two targets set -> invalid.
	if _, err := svc.Resolve(context.Background(), tid, sid, ResolveRequest{At: &at, Seq: &seq}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got %v, want ErrInvalid for two targets", err)
	}
	// No target -> invalid.
	if _, err := svc.Resolve(context.Background(), tid, sid, ResolveRequest{}); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got %v, want ErrInvalid for no target", err)
	}
}

func TestService_Resolve_BySeq(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, _ := newTestService(t, store)

	seq := int64(250)
	res, err := svc.Resolve(context.Background(), uuid.MustParse(testTenant), uuid.MustParse(testStream), ResolveRequest{Seq: &seq})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if res.StreamID != testStream {
		t.Fatalf("StreamID = %q, want %q", res.StreamID, testStream)
	}
	if res.CutSeq != 250 || len(res.Segments) != 3 {
		t.Fatalf("resolution wrong: cut=%d segs=%d", res.CutSeq, len(res.Segments))
	}
}

func TestService_DeleteBookmark(t *testing.T) {
	t.Parallel()
	store := newMemStore()
	seedSegments(store, testStream)
	svc, _ := newTestService(t, store)
	tid := uuid.MustParse(testTenant)
	sid := uuid.MustParse(testStream)

	bm, err := svc.CreateBookmark(context.Background(), tid, sid, nil, CreateBookmarkInput{Name: "tmp", AtSeq: 50})
	if err != nil {
		t.Fatalf("CreateBookmark: %v", err)
	}
	if err := svc.DeleteBookmark(context.Background(), tid, sid, uuid.MustParse(bm.ID)); err != nil {
		t.Fatalf("DeleteBookmark: %v", err)
	}
	bms, _ := svc.ListBookmarks(context.Background(), tid, sid)
	if len(bms) != 0 {
		t.Fatalf("bookmarks remaining = %d, want 0", len(bms))
	}
}
