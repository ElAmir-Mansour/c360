package journal

import (
	"testing"
	"time"
)

func TestBuildTimeline_Contiguous(t *testing.T) {
	t.Parallel()
	segs := makeSegments()
	bms := []Bookmark{
		{ID: "bm2", StreamID: "s", Name: "after-migration", Kind: BookmarkManual, AtSeq: 250, AtTS: t0.Add(25 * time.Minute)},
		{ID: "bm1", StreamID: "s", Name: "barrier", Kind: BookmarkBarrier, AtSeq: 100, AtTS: t0.Add(10 * time.Minute)},
	}

	tl := BuildTimeline("s", segs, bms)
	if !tl.Recoverable {
		t.Fatal("Recoverable = false, want true")
	}
	if tl.HasGaps {
		t.Fatal("HasGaps = true, want false for a contiguous journal")
	}
	if tl.EarliestSeq != 1 || tl.LatestSeq != 400 {
		t.Fatalf("seq window = [%d,%d], want [1,400]", tl.EarliestSeq, tl.LatestSeq)
	}
	if !tl.EarliestTS.Equal(t0) || !tl.LatestTS.Equal(t0.Add(40*time.Minute)) {
		t.Fatalf("ts window = [%s,%s]", tl.EarliestTS, tl.LatestTS)
	}
	if tl.EarliestLSN != "0/1" || tl.LatestLSN != "0/190" {
		t.Fatalf("lsn window = [%s,%s], want [0/1,0/190]", tl.EarliestLSN, tl.LatestLSN)
	}
	// Bookmarks must come back sorted by at_seq.
	if len(tl.Bookmarks) != 2 || tl.Bookmarks[0].ID != "bm1" || tl.Bookmarks[1].ID != "bm2" {
		t.Fatalf("bookmarks not sorted by at_seq: %+v", tl.Bookmarks)
	}
}

func TestBuildTimeline_PrunedHoleHasGaps(t *testing.T) {
	t.Parallel()
	segs := makeSegments()
	prunedAt := t0.Add(time.Hour)
	segs[1].Pruned = true // prune B -> live A, C, D have a hole [101,200]
	segs[1].PrunedAt = &prunedAt

	tl := BuildTimeline("s", segs, nil)
	if !tl.Recoverable {
		t.Fatal("Recoverable = false, want true")
	}
	if len(tl.Segments) != 3 {
		t.Fatalf("live segments = %d, want 3 (B pruned)", len(tl.Segments))
	}
	if !tl.HasGaps {
		t.Fatal("HasGaps = false, want true (B pruned leaves a hole)")
	}
	// Earliest is still A; latest is still D.
	if tl.EarliestSeq != 1 || tl.LatestSeq != 400 {
		t.Fatalf("seq window = [%d,%d], want [1,400]", tl.EarliestSeq, tl.LatestSeq)
	}
}

func TestBuildTimeline_Empty(t *testing.T) {
	t.Parallel()
	tl := BuildTimeline("s", nil, nil)
	if tl.Recoverable {
		t.Fatal("Recoverable = true, want false for an empty journal")
	}
	if len(tl.Segments) != 0 || len(tl.Bookmarks) != 0 {
		t.Fatal("empty journal must have no segments/bookmarks")
	}
}

func TestBuildTimeline_AllPruned(t *testing.T) {
	t.Parallel()
	segs := makeSegments()
	prunedAt := t0
	for i := range segs {
		segs[i].Pruned = true
		segs[i].PrunedAt = &prunedAt
	}
	tl := BuildTimeline("s", segs, nil)
	if tl.Recoverable {
		t.Fatal("Recoverable = true, want false when every segment is pruned")
	}
}
