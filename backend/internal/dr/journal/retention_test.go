package journal

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// fakePruneSource yields a fixed set of targets.
type fakePruneSource struct {
	targets []PruneTarget
	calls   int
}

func (f *fakePruneSource) StreamsWithJournal(_ context.Context, _ int) ([]PruneTarget, error) {
	f.calls++
	return f.targets, nil
}

// recordingReclaimer records which object keys had their bytes reclaimed.
type recordingReclaimer struct {
	reclaimed []string
	fail      bool
}

func (r *recordingReclaimer) ReclaimSegment(_ context.Context, _ uuid.UUID, _, objectKey string) error {
	if r.fail {
		return context.DeadlineExceeded
	}
	r.reclaimed = append(r.reclaimed, objectKey)
	return nil
}

func newRetentionLoop(t *testing.T, store retentionStore, reclaimer segmentReclaimer, retention time.Duration, now func() time.Time) (*RetentionLoop, *recordingReclaimer) {
	t.Helper()
	runner := newFakeRunner()
	rr, _ := reclaimer.(*recordingReclaimer)
	loop, err := NewRetentionLoop(RetentionConfig{
		Runner:    runner,
		Source:    &fakePruneSource{},
		Store:     store,
		Reclaimer: reclaimer,
		Logger:    zerolog.Nop(),
		Retention: retention,
		Now:       now,
	})
	if err != nil {
		t.Fatalf("NewRetentionLoop: %v", err)
	}
	return loop, rr
}

// agedStore seeds four segments at known ages relative to the now-clock.
func agedStore(streamID string, now time.Time) *memStore {
	m := newMemStore()
	segs := []Segment{
		{ID: "old1", StreamID: streamID, MinSeq: 1, MaxSeq: 100, MinTS: now.Add(-10 * 24 * time.Hour), MaxTS: now.Add(-9 * 24 * time.Hour), ObjectKey: "obj/old1", FrameCount: 100},
		{ID: "old2", StreamID: streamID, MinSeq: 101, MaxSeq: 200, MinTS: now.Add(-9 * 24 * time.Hour), MaxTS: now.Add(-8 * 24 * time.Hour), ObjectKey: "obj/old2", FrameCount: 100},
		{ID: "recent1", StreamID: streamID, MinSeq: 201, MaxSeq: 300, MinTS: now.Add(-2 * 24 * time.Hour), MaxTS: now.Add(-1 * 24 * time.Hour), ObjectKey: "obj/recent1", FrameCount: 100},
		{ID: "recent2", StreamID: streamID, MinSeq: 301, MaxSeq: 400, MinTS: now.Add(-12 * time.Hour), MaxTS: now.Add(-1 * time.Hour), ObjectKey: "obj/recent2", FrameCount: 100},
	}
	m.segments[streamID] = segs
	return m
}

func TestRetention_PrunesAgedKeepsRecent(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	store := agedStore(testStream, now)
	reclaimer := &recordingReclaimer{}
	loop, rr := newRetentionLoop(t, store, reclaimer, 7*24*time.Hour, func() time.Time { return now })

	pruned, err := loop.PruneStream(context.Background(), uuid.MustParse(testTenant), uuid.MustParse(testStream), now.Add(-7*24*time.Hour))
	if err != nil {
		t.Fatalf("PruneStream: %v", err)
	}
	if pruned != 2 {
		t.Fatalf("pruned = %d, want 2 (old1, old2)", pruned)
	}
	// Confirm the two aged segments are tombstoned and the recent ones are not.
	for _, seg := range store.segments[testStream] {
		switch seg.ID {
		case "old1", "old2":
			if !seg.Pruned {
				t.Fatalf("segment %s should be pruned", seg.ID)
			}
		default:
			if seg.Pruned {
				t.Fatalf("recent segment %s must NOT be pruned", seg.ID)
			}
		}
	}
	// Bytes reclaimed for exactly the pruned segments.
	if len(rr.reclaimed) != 2 {
		t.Fatalf("reclaimed = %v, want 2 objects", rr.reclaimed)
	}
}

func TestRetention_NeverPrunesBookmarkedSegment(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	store := agedStore(testStream, now)
	// Bookmark inside old1 [1,100]: it must survive retention even though it is
	// older than the window. This is the ransomware-safe / protected-restore-point
	// guarantee.
	store.bookmarks[testStream] = []Bookmark{
		{ID: "bm-protect", StreamID: testStream, Name: "legal-hold", Kind: BookmarkBarrier, AtSeq: 50, AtTS: now.Add(-9 * 24 * time.Hour)},
	}
	loop, _ := newRetentionLoop(t, store, &recordingReclaimer{}, 7*24*time.Hour, func() time.Time { return now })

	pruned, err := loop.PruneStream(context.Background(), uuid.MustParse(testTenant), uuid.MustParse(testStream), now.Add(-7*24*time.Hour))
	if err != nil {
		t.Fatalf("PruneStream: %v", err)
	}
	if pruned != 1 {
		t.Fatalf("pruned = %d, want 1 (old1 is bookmark-protected)", pruned)
	}
	for _, seg := range store.segments[testStream] {
		if seg.ID == "old1" && seg.Pruned {
			t.Fatal("bookmarked segment old1 was pruned — retention must never prune a bookmarked segment")
		}
	}
}

func TestRetention_ReclaimFailureDoesNotRollbackTombstone(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	store := agedStore(testStream, now)
	reclaimer := &recordingReclaimer{fail: true}
	loop, _ := newRetentionLoop(t, store, reclaimer, 7*24*time.Hour, func() time.Time { return now })

	// Reclaim fails, but the index tombstone must still commit (the data is
	// logically gone from APIT; the object is retried on a later sweep).
	pruned, err := loop.PruneStream(context.Background(), uuid.MustParse(testTenant), uuid.MustParse(testStream), now.Add(-7*24*time.Hour))
	if err != nil {
		t.Fatalf("PruneStream: %v", err)
	}
	if pruned != 2 {
		t.Fatalf("pruned = %d, want 2", pruned)
	}
	for _, seg := range store.segments[testStream] {
		if (seg.ID == "old1" || seg.ID == "old2") && !seg.Pruned {
			t.Fatalf("segment %s should be tombstoned despite reclaim failure", seg.ID)
		}
	}
}

func TestRetention_TickSweepsTargets(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	store := agedStore(testStream, now)
	runner := newFakeRunner()
	source := &fakePruneSource{targets: []PruneTarget{
		{TenantID: uuid.MustParse(testTenant), StreamID: uuid.MustParse(testStream)},
	}}
	loop, err := NewRetentionLoop(RetentionConfig{
		Runner: runner, Source: source, Store: store,
		Logger: zerolog.Nop(), Retention: 7 * 24 * time.Hour, Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewRetentionLoop: %v", err)
	}

	pruned, err := loop.tick(context.Background())
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if pruned != 2 {
		t.Fatalf("tick pruned = %d, want 2", pruned)
	}
	if source.calls != 1 {
		t.Fatalf("source calls = %d, want 1", source.calls)
	}
}

func TestRetention_RunStopsOnContextCancel(t *testing.T) {
	t.Parallel()
	now := time.Now().UTC()
	store := agedStore(testStream, now)
	runner := newFakeRunner()
	source := &fakePruneSource{}
	loop, err := NewRetentionLoop(RetentionConfig{
		Runner: runner, Source: source, Store: store,
		Logger: zerolog.Nop(), Retention: time.Hour, Interval: time.Hour, Now: func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewRetentionLoop: %v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { loop.Run(ctx); close(done) }()
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not stop on context cancel")
	}
}

func TestNewRetentionLoop_Validation(t *testing.T) {
	t.Parallel()
	if _, err := NewRetentionLoop(RetentionConfig{}); err == nil {
		t.Fatal("expected error for missing runner")
	}
	if _, err := NewRetentionLoop(RetentionConfig{Runner: newFakeRunner()}); err == nil {
		t.Fatal("expected error for missing source")
	}
	if _, err := NewRetentionLoop(RetentionConfig{Runner: newFakeRunner(), Source: &fakePruneSource{}}); err == nil {
		t.Fatal("expected error for missing store")
	}
}
