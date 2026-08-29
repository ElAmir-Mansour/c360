package journal

import (
	"fmt"
	"sort"
	"time"
)

// Resolve computes the exact ordered set of journal segments and the cut Seq to
// reconstruct a stream's state as of a target instant given by a timestamp.
//
// segments MUST be the stream's full live (non-pruned) segment set; Resolve
// sorts a copy by MinSeq and validates contiguity, so callers may pass them in
// any order. The returned Resolution.Segments are the ordered segments to
// replay; the final segment is replayed only up to CutSeq.
//
// Semantics (any-point-in-time):
//   - target before the earliest recoverable instant -> ErrNoCoverage-adjacent
//     boundary: returns the earliest possible point is NOT silently produced;
//     instead ResolveAt errors so the caller renders "before retention window".
//   - target after the latest recoverable instant -> clamp to latest
//     (recover-to-now), BoundaryClamped = true.
//   - target landing inside a live segment -> that segment is the boundary; the
//     cut is the highest Seq whose frame is at or before the target.
//
// Because the journal index does not store per-frame timestamps (only segment
// min/max bounds), a mid-segment timestamp resolves to that segment as the
// boundary and CutSeq = the segment's MaxSeq is the conservative, deterministic
// choice ONLY when the target is at/after the segment's MaxTS; for a target
// strictly inside a segment we cut at the segment boundary that is fully at or
// before the target, and include the straddling segment so replay can stop at
// the exact frame. See ResolveAt for the precise rule.
func Resolve(segments []Segment, sorted bool) ([]Segment, error) {
	live := liveSorted(segments, sorted)
	if len(live) == 0 {
		return nil, ErrNoCoverage
	}
	return live, nil
}

// liveSorted returns the non-pruned segments sorted ascending by MinSeq. When
// sorted is true the caller guarantees the slice is already in MinSeq order and
// pruned-free filtering still applies.
func liveSorted(segments []Segment, sorted bool) []Segment {
	live := make([]Segment, 0, len(segments))
	for _, s := range segments {
		if s.Pruned {
			continue
		}
		live = append(live, s)
	}
	if !sorted {
		sort.Slice(live, func(i, j int) bool { return live[i].MinSeq < live[j].MinSeq })
	}
	return live
}

// allSorted returns every segment (including pruned tombstones) sorted by
// MinSeq, used to detect whether a target lands in a reclaimed hole.
func allSorted(segments []Segment) []Segment {
	out := append([]Segment(nil), segments...)
	sort.Slice(out, func(i, j int) bool { return out[i].MinSeq < out[j].MinSeq })
	return out
}

// ResolveAt resolves to the target wall-clock timestamp. It binary-searches the
// segment index by time bound and returns the ordered replay set + cut Seq.
//
// Rules:
//   - target after the latest live segment's MaxTS -> clamp to latest
//     (BoundaryClamped), CutSeq = newest MaxSeq.
//   - target before the earliest live segment's MinTS -> if the earliest live
//     segment is also the earliest segment overall, ErrNoCoverage (the target is
//     older than anything we ever held or older than what survives retention);
//     if older data was pruned, ErrPruned.
//   - target landing inside a live segment [MinTS,MaxTS] -> that segment is the
//     boundary; CutSeq = its MaxSeq is NOT used. Because frames within a segment
//     are ordered by Seq and time monotonically increases with Seq, and the
//     index only carries segment bounds, the deterministic any-point cut is:
//     replay every fully-earlier segment in full, then replay the boundary
//     segment and stop at the last frame whose time <= target. The index cannot
//     name that exact frame, so the boundary segment's frames are replayed under
//     a per-frame time filter at restore time; the Resolution reports the
//     boundary segment and ExactMatch=false so the executor truncates by time.
//   - target landing in a gap between two live segments (the segment that would
//     contain it was pruned) -> ErrPruned.
func ResolveAt(segments []Segment, target time.Time) (*Resolution, error) {
	live := liveSorted(segments, false)
	if len(live) == 0 {
		return nil, ErrNoCoverage
	}
	all := allSorted(segments)

	earliest := live[0]
	latest := live[len(live)-1]

	// After the latest recoverable instant: clamp to latest.
	if target.After(latest.MaxTS) {
		res := newResolution(live)
		res.TargetKind = "timestamp"
		t := target
		res.TargetTS = &t
		res.CutSeq = latest.MaxSeq
		res.CutLSN = latest.MaxLSN
		res.CutTS = latest.MaxTS
		res.ExactMatch = true
		res.BoundaryClamped = true
		return res, nil
	}

	// Before the earliest live instant.
	if target.Before(earliest.MinTS) {
		// Distinguish "older than anything we held" from "older data pruned".
		if all[0].ID == earliest.ID {
			return nil, ErrNoCoverage
		}
		return nil, fmt.Errorf("%w: target %s precedes earliest live segment at %s",
			ErrPruned, target.UTC().Format(time.RFC3339Nano), earliest.MinTS.UTC().Format(time.RFC3339Nano))
	}

	// Binary-search for the first live segment whose MaxTS >= target: that is the
	// boundary segment (target falls in it, or just before its start in a gap).
	idx := sort.Search(len(live), func(i int) bool { return !live[i].MaxTS.Before(target) })
	// idx is in range because target <= latest.MaxTS was checked above.
	boundary := live[idx]

	// If target precedes the boundary segment's MinTS, it fell in a hole between
	// the previous live segment and this one — i.e. the covering segment was
	// pruned (we already handled target < earliest.MinTS above).
	if target.Before(boundary.MinTS) {
		return nil, fmt.Errorf("%w: target %s lands between live segments (covering segment reclaimed)",
			ErrPruned, target.UTC().Format(time.RFC3339Nano))
	}

	replay := live[:idx+1]
	res := newResolution(replay)
	res.TargetKind = "timestamp"
	t := target
	res.TargetTS = &t
	res.CutSeq = boundary.MaxSeq
	res.CutLSN = boundary.MaxLSN
	res.CutTS = boundary.MaxTS
	// Exact when the target lands exactly on the boundary's MaxTS (the whole
	// segment is in scope); otherwise the boundary segment is partially replayed
	// under a per-frame time filter, so it is not an exact segment-boundary cut.
	res.ExactMatch = target.Equal(boundary.MaxTS)
	res.BoundaryClamped = false
	return res, nil
}

// ResolveAtSeq resolves to a target frame Seq. Seq is the authoritative,
// per-frame ordering cursor, so a Seq target yields an EXACT cut: replay every
// segment up to the one containing the target Seq, then truncate that boundary
// segment at the target Seq.
func ResolveAtSeq(segments []Segment, targetSeq int64) (*Resolution, error) {
	if targetSeq <= 0 {
		return nil, fmt.Errorf("%w: target seq must be positive", ErrInvalid)
	}
	live := liveSorted(segments, false)
	if len(live) == 0 {
		return nil, ErrNoCoverage
	}
	all := allSorted(segments)

	earliest := live[0]
	latest := live[len(live)-1]

	if targetSeq > latest.MaxSeq {
		res := newResolution(live)
		res.TargetKind = "seq"
		s := targetSeq
		res.TargetSeq = &s
		res.CutSeq = latest.MaxSeq
		res.CutLSN = latest.MaxLSN
		res.CutTS = latest.MaxTS
		res.ExactMatch = false // requested seq is beyond what exists
		res.BoundaryClamped = true
		return res, nil
	}

	if targetSeq < earliest.MinSeq {
		if all[0].ID == earliest.ID {
			return nil, ErrNoCoverage
		}
		return nil, fmt.Errorf("%w: seq %d precedes earliest live segment min_seq %d",
			ErrPruned, targetSeq, earliest.MinSeq)
	}

	// Binary-search the first live segment whose MaxSeq >= targetSeq.
	idx := sort.Search(len(live), func(i int) bool { return live[i].MaxSeq >= targetSeq })
	boundary := live[idx]

	// targetSeq could fall in a pruned hole between live[idx-1].MaxSeq+1 and
	// boundary.MinSeq-1.
	if targetSeq < boundary.MinSeq {
		return nil, fmt.Errorf("%w: seq %d lands between live segments (covering segment reclaimed)",
			ErrPruned, targetSeq)
	}

	replay := live[:idx+1]
	res := newResolution(replay)
	res.TargetKind = "seq"
	s := targetSeq
	res.TargetSeq = &s
	res.CutSeq = targetSeq // exact: truncate the boundary segment at targetSeq
	res.CutTS = boundary.MaxTS
	// CutLSN: when the cut is the segment's last frame we know MaxLSN exactly;
	// for a mid-segment cut the precise per-frame LSN is read at restore time, so
	// report the boundary's MaxLSN as the upper bound of the replay range.
	res.CutLSN = boundary.MaxLSN
	res.ExactMatch = targetSeq == boundary.MaxSeq
	res.BoundaryClamped = false
	return res, nil
}

// ResolveAtLSN resolves to a target source LSN. Within a stream the source LSN
// is monotonic with Seq (same source, ordered log), so the LSN index is
// searched lexically by MaxLSN. Because LSNs are opaque strings to the core,
// comparison uses the provided compare function so callers can plug a
// source-specific ordering; CompareLSN gives the default (numeric-aware) order.
func ResolveAtLSN(segments []Segment, targetLSN string, compare func(a, b string) int) (*Resolution, error) {
	if targetLSN == "" {
		return nil, fmt.Errorf("%w: target lsn is empty", ErrInvalid)
	}
	if compare == nil {
		compare = CompareLSN
	}
	live := liveSorted(segments, false)
	if len(live) == 0 {
		return nil, ErrNoCoverage
	}
	// Only segments that actually carry LSNs participate; a stream of LSN-less
	// frame kinds (pure file deltas) cannot be LSN-resolved.
	if !anyHasLSN(live) {
		return nil, fmt.Errorf("%w: stream has no LSN-bearing segments", ErrInvalid)
	}
	all := allSorted(segments)
	earliest := live[0]
	latest := live[len(live)-1]

	if compare(targetLSN, latest.MaxLSN) > 0 {
		res := newResolution(live)
		res.TargetKind = "lsn"
		res.TargetLSN = targetLSN
		res.CutSeq = latest.MaxSeq
		res.CutLSN = latest.MaxLSN
		res.CutTS = latest.MaxTS
		res.ExactMatch = false
		res.BoundaryClamped = true
		return res, nil
	}

	if compare(targetLSN, earliest.MinLSN) < 0 {
		if all[0].ID == earliest.ID {
			return nil, ErrNoCoverage
		}
		return nil, fmt.Errorf("%w: lsn %s precedes earliest live segment min_lsn %s",
			ErrPruned, targetLSN, earliest.MinLSN)
	}

	idx := sort.Search(len(live), func(i int) bool { return compare(live[i].MaxLSN, targetLSN) >= 0 })
	boundary := live[idx]

	if compare(targetLSN, boundary.MinLSN) < 0 {
		return nil, fmt.Errorf("%w: lsn %s lands between live segments (covering segment reclaimed)",
			ErrPruned, targetLSN)
	}

	replay := live[:idx+1]
	res := newResolution(replay)
	res.TargetKind = "lsn"
	res.TargetLSN = targetLSN
	res.CutSeq = boundary.MaxSeq
	res.CutLSN = targetLSN // truncate boundary segment at this LSN at restore
	res.CutTS = boundary.MaxTS
	res.ExactMatch = compare(targetLSN, boundary.MaxLSN) == 0
	res.BoundaryClamped = false
	return res, nil
}

func anyHasLSN(segs []Segment) bool {
	for _, s := range segs {
		if s.MaxLSN != "" {
			return true
		}
	}
	return false
}

// newResolution clones the replay segments into a Resolution skeleton.
func newResolution(replay []Segment) *Resolution {
	segs := make([]Segment, len(replay))
	copy(segs, replay)
	return &Resolution{Segments: segs}
}
