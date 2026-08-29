package journal

import (
	"errors"
	"testing"
	"time"
)

// base time for synthetic journals.
var t0 = time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

// makeSegments builds a contiguous synthetic journal of four 100-Seq segments
// with known LSN and timestamp ranges:
//
//	seg A: seq [1,100]    ts [t0,      t0+10m]  lsn [0/1,   0/64]
//	seg B: seq [101,200]  ts [t0+10m,  t0+20m]  lsn [0/65,  0/C8]
//	seg C: seq [201,300]  ts [t0+20m,  t0+30m]  lsn [0/C9,  0/12C]
//	seg D: seq [301,400]  ts [t0+30m,  t0+40m]  lsn [0/12D, 0/190]
func makeSegments() []Segment {
	return []Segment{
		{ID: "A", StreamID: "s", MinSeq: 1, MaxSeq: 100, MinLSN: "0/1", MaxLSN: "0/64", MinTS: t0, MaxTS: t0.Add(10 * time.Minute), FrameCount: 100},
		{ID: "B", StreamID: "s", MinSeq: 101, MaxSeq: 200, MinLSN: "0/65", MaxLSN: "0/C8", MinTS: t0.Add(10 * time.Minute), MaxTS: t0.Add(20 * time.Minute), FrameCount: 100},
		{ID: "C", StreamID: "s", MinSeq: 201, MaxSeq: 300, MinLSN: "0/C9", MaxLSN: "0/12C", MinTS: t0.Add(20 * time.Minute), MaxTS: t0.Add(30 * time.Minute), FrameCount: 100},
		{ID: "D", StreamID: "s", MinSeq: 301, MaxSeq: 400, MinLSN: "0/12D", MaxLSN: "0/190", MinTS: t0.Add(30 * time.Minute), MaxTS: t0.Add(40 * time.Minute), FrameCount: 100},
	}
}

func segIDs(segs []Segment) []string {
	ids := make([]string, len(segs))
	for i, s := range segs {
		ids[i] = s.ID
	}
	return ids
}

func equalIDs(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestResolveAt_MidSegment(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	// Target 25 minutes in: lands inside segment C [t0+20m, t0+30m].
	target := t0.Add(25 * time.Minute)
	res, err := ResolveAt(segs, target)
	if err != nil {
		t.Fatalf("ResolveAt: %v", err)
	}
	if want := []string{"A", "B", "C"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want %v", segIDs(res.Segments), want)
	}
	// Boundary segment is C; the cut is C's MaxSeq with a per-frame time filter
	// (ExactMatch=false because the target is strictly inside C).
	if res.CutSeq != 300 {
		t.Fatalf("CutSeq = %d, want 300", res.CutSeq)
	}
	if res.ExactMatch {
		t.Fatal("ExactMatch = true, want false for a mid-segment timestamp")
	}
	if res.BoundaryClamped {
		t.Fatal("BoundaryClamped = true, want false")
	}
	if res.CutLSN != "0/12C" {
		t.Fatalf("CutLSN = %q, want 0/12C", res.CutLSN)
	}
}

func TestResolveAt_ExactBoundary(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	// Target exactly at segment B's MaxTS: whole of A+B is in scope, exact cut.
	res, err := ResolveAt(segs, t0.Add(20*time.Minute))
	if err != nil {
		t.Fatalf("ResolveAt: %v", err)
	}
	// Note: sort.Search finds the first segment with MaxTS >= target. B.MaxTS ==
	// target, so B is the boundary; the result is A+B with an exact cut at 200.
	if want := []string{"A", "B"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want %v", segIDs(res.Segments), want)
	}
	if res.CutSeq != 200 {
		t.Fatalf("CutSeq = %d, want 200", res.CutSeq)
	}
	if !res.ExactMatch {
		t.Fatal("ExactMatch = false, want true for an exact segment boundary")
	}
}

func TestResolveAt_AfterLatest_Clamps(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	res, err := ResolveAt(segs, t0.Add(2*time.Hour))
	if err != nil {
		t.Fatalf("ResolveAt: %v", err)
	}
	if want := []string{"A", "B", "C", "D"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want all", segIDs(res.Segments))
	}
	if res.CutSeq != 400 || !res.BoundaryClamped || !res.ExactMatch {
		t.Fatalf("clamp wrong: cut=%d clamped=%v exact=%v", res.CutSeq, res.BoundaryClamped, res.ExactMatch)
	}
}

func TestResolveAt_BeforeEarliest_NoCoverage(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	_, err := ResolveAt(segs, t0.Add(-time.Hour))
	if !errors.Is(err, ErrNoCoverage) {
		t.Fatalf("got err %v, want ErrNoCoverage", err)
	}
}

func TestResolveAt_BeforeEarliestLive_AfterPrune_ErrPruned(t *testing.T) {
	t.Parallel()
	segs := makeSegments()
	// Prune the oldest segment A: the earliest live is now B, but A still exists
	// as a tombstone, so a target before B's start is ErrPruned (data reclaimed),
	// not ErrNoCoverage.
	prunedAt := t0.Add(time.Hour)
	segs[0].Pruned = true
	segs[0].PrunedAt = &prunedAt

	_, err := ResolveAt(segs, t0.Add(5*time.Minute)) // inside the pruned A range
	if !errors.Is(err, ErrPruned) {
		t.Fatalf("got err %v, want ErrPruned", err)
	}
}

func TestResolveAt_MiddleHolePruned_ErrPruned(t *testing.T) {
	t.Parallel()
	segs := makeSegments()
	// Prune the middle segment C: a target inside C's old range falls in a
	// reclaimed hole between live B and live D.
	prunedAt := t0.Add(time.Hour)
	segs[2].Pruned = true
	segs[2].PrunedAt = &prunedAt

	_, err := ResolveAt(segs, t0.Add(25*time.Minute))
	if !errors.Is(err, ErrPruned) {
		t.Fatalf("got err %v, want ErrPruned", err)
	}
}

func TestResolveAtSeq_MidSegment_ExactCut(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	// Seq 250 lands inside segment C [201,300]: replay A+B+C, truncate C at 250.
	res, err := ResolveAtSeq(segs, 250)
	if err != nil {
		t.Fatalf("ResolveAtSeq: %v", err)
	}
	if want := []string{"A", "B", "C"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want %v", segIDs(res.Segments), want)
	}
	if res.CutSeq != 250 {
		t.Fatalf("CutSeq = %d, want 250 (exact seq cut)", res.CutSeq)
	}
	if res.ExactMatch {
		t.Fatal("ExactMatch = true, want false (250 is mid-segment, not C.MaxSeq)")
	}
}

func TestResolveAtSeq_OnBoundary_ExactMatch(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	res, err := ResolveAtSeq(segs, 200) // exactly B.MaxSeq
	if err != nil {
		t.Fatalf("ResolveAtSeq: %v", err)
	}
	if want := []string{"A", "B"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want %v", segIDs(res.Segments), want)
	}
	if res.CutSeq != 200 || !res.ExactMatch {
		t.Fatalf("cut=%d exact=%v, want 200 true", res.CutSeq, res.ExactMatch)
	}
}

func TestResolveAtSeq_Boundaries(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	// After latest -> clamp.
	res, err := ResolveAtSeq(segs, 999)
	if err != nil {
		t.Fatalf("ResolveAtSeq clamp: %v", err)
	}
	if res.CutSeq != 400 || !res.BoundaryClamped {
		t.Fatalf("clamp wrong: cut=%d clamped=%v", res.CutSeq, res.BoundaryClamped)
	}

	// Before earliest with no prune -> no coverage.
	if _, err := ResolveAtSeq(segs, 0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("seq 0 err = %v, want ErrInvalid", err)
	}

	// Prune A, then target inside A -> pruned.
	prunedAt := t0
	segs[0].Pruned = true
	segs[0].PrunedAt = &prunedAt
	if _, err := ResolveAtSeq(segs, 50); !errors.Is(err, ErrPruned) {
		t.Fatalf("seq 50 (pruned A) err = %v, want ErrPruned", err)
	}
}

func TestResolveAtLSN_MidSegment(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	// LSN 0/100 (=256) lands inside segment C [0/C9=201, 0/12C=300].
	res, err := ResolveAtLSN(segs, "0/100", nil)
	if err != nil {
		t.Fatalf("ResolveAtLSN: %v", err)
	}
	if want := []string{"A", "B", "C"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want %v", segIDs(res.Segments), want)
	}
	if res.CutLSN != "0/100" {
		t.Fatalf("CutLSN = %q, want 0/100 (truncate boundary at this LSN)", res.CutLSN)
	}
	if res.CutSeq != 300 {
		t.Fatalf("CutSeq = %d, want 300 (C.MaxSeq replay range)", res.CutSeq)
	}
	if res.ExactMatch {
		t.Fatal("ExactMatch = true, want false (0/100 != C.MaxLSN 0/12C)")
	}
}

func TestResolveAtLSN_ExactBoundary(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	res, err := ResolveAtLSN(segs, "0/C8", nil) // exactly B.MaxLSN
	if err != nil {
		t.Fatalf("ResolveAtLSN: %v", err)
	}
	if want := []string{"A", "B"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want %v", segIDs(res.Segments), want)
	}
	if !res.ExactMatch {
		t.Fatal("ExactMatch = false, want true at an exact LSN boundary")
	}
}

func TestResolveAtLSN_AfterLatest_Clamps(t *testing.T) {
	t.Parallel()
	segs := makeSegments()

	res, err := ResolveAtLSN(segs, "9/0", nil)
	if err != nil {
		t.Fatalf("ResolveAtLSN: %v", err)
	}
	if res.CutSeq != 400 || !res.BoundaryClamped {
		t.Fatalf("clamp wrong: cut=%d clamped=%v", res.CutSeq, res.BoundaryClamped)
	}
}

func TestResolveAtLSN_NoLSNSegments_Invalid(t *testing.T) {
	t.Parallel()
	// A file-delta-only stream: segments carry no LSNs.
	segs := []Segment{
		{ID: "A", StreamID: "s", MinSeq: 1, MaxSeq: 100, MinTS: t0, MaxTS: t0.Add(time.Minute), FrameCount: 100},
	}
	if _, err := ResolveAtLSN(segs, "0/100", nil); !errors.Is(err, ErrInvalid) {
		t.Fatalf("got err %v, want ErrInvalid for LSN-less stream", err)
	}
}

func TestResolve_NoSegments(t *testing.T) {
	t.Parallel()
	if _, err := Resolve(nil, false); !errors.Is(err, ErrNoCoverage) {
		t.Fatalf("Resolve(nil) err = %v, want ErrNoCoverage", err)
	}
	if _, err := ResolveAt(nil, t0); !errors.Is(err, ErrNoCoverage) {
		t.Fatalf("ResolveAt(nil) err = %v, want ErrNoCoverage", err)
	}
	if _, err := ResolveAtSeq(nil, 5); !errors.Is(err, ErrNoCoverage) {
		t.Fatalf("ResolveAtSeq(nil) err = %v, want ErrNoCoverage", err)
	}
}

func TestResolve_UnsortedInput(t *testing.T) {
	t.Parallel()
	segs := makeSegments()
	// Shuffle: D, B, A, C — the resolver must sort before searching.
	shuffled := []Segment{segs[3], segs[1], segs[0], segs[2]}
	res, err := ResolveAtSeq(shuffled, 150)
	if err != nil {
		t.Fatalf("ResolveAtSeq: %v", err)
	}
	if want := []string{"A", "B"}; !equalIDs(segIDs(res.Segments), want) {
		t.Fatalf("segments = %v, want %v (resolver must sort unsorted input)", segIDs(res.Segments), want)
	}
}
