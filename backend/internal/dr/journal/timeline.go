package journal

import "sort"

// BuildTimeline summarizes a stream's journal coverage from its segment and
// bookmark sets. It computes the earliest/latest recoverable instant from the
// live (non-pruned) segments and flags whether the live segments tile the Seq
// space contiguously — a gap (a pruned hole or a missing seal) means a resolve
// targeting that hole cannot be satisfied.
//
// segments may be passed in any order; BuildTimeline sorts copies.
func BuildTimeline(streamID string, segments []Segment, bookmarks []Bookmark) Timeline {
	tl := Timeline{
		StreamID:  streamID,
		Segments:  []Segment{},
		Bookmarks: []Bookmark{},
	}

	live := liveSorted(segments, false)
	tl.Segments = live

	bm := append([]Bookmark(nil), bookmarks...)
	sort.Slice(bm, func(i, j int) bool { return bm[i].AtSeq < bm[j].AtSeq })
	tl.Bookmarks = bm

	if len(live) == 0 {
		tl.Recoverable = false
		return tl
	}

	tl.Recoverable = true
	first := live[0]
	last := live[len(live)-1]
	tl.EarliestSeq = first.MinSeq
	tl.EarliestLSN = first.MinLSN
	tl.EarliestTS = first.MinTS
	tl.LatestSeq = last.MaxSeq
	tl.LatestLSN = last.MaxLSN
	tl.LatestTS = last.MaxTS

	// Contiguity: each live segment must open exactly one past the previous
	// segment's MaxSeq. A jump (prev.MaxSeq + 1 != next.MinSeq) is a gap.
	for i := 1; i < len(live); i++ {
		if live[i].MinSeq != live[i-1].MaxSeq+1 {
			tl.HasGaps = true
			break
		}
	}
	return tl
}
