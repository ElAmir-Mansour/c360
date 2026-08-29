// Package journal implements ClarioDR Continuous Data Protection (CDP):
// a time-ordered, durable journal of every replicated change frame per stream,
// indexed so state can be reconstructed as of ANY point in time or LSN within a
// retention window (any-point-in-time / APIT recovery). This is the core CDP
// value over snapshot-only DR (DESIGN_DataStream_DR.md capability #6).
//
// The package is self-contained: it defines its own model types, its own DBTX
// store over internal/dr/repository.DBTX, its own chi.Router, and its own
// leader-singleton retention loop. The integration phase wires it into
// cmd/clario-dr-service/main.go.
package journal

import (
	"errors"
	"time"
)

// Sentinel errors surfaced to callers and HTTP handlers.
var (
	// ErrNotFound is returned when no segment or bookmark matches a query.
	ErrNotFound = errors.New("journal: not found")
	// ErrAlreadyExists is returned when a bookmark name is reused for a stream.
	ErrAlreadyExists = errors.New("journal: already exists")
	// ErrInvalid is returned when an input is malformed (empty stream, bad seq).
	ErrInvalid = errors.New("journal: invalid input")
	// ErrNoCoverage is returned by the resolver when the journal holds no live
	// segments for the stream — nothing is recoverable.
	ErrNoCoverage = errors.New("journal: no recoverable coverage for stream")
	// ErrPruned is returned when a resolve target lands inside a segment whose
	// bytes have been reclaimed by retention — recoverable in principle but the
	// data is gone. The caller renders "beyond retention window".
	ErrPruned = errors.New("journal: target falls in a pruned segment")
)

// Bookmark kinds (mirror the dr_journal_bookmark.kind CHECK).
const (
	// BookmarkBarrier marks an app-consistent barrier (a MARKER frame): the
	// safest restore points because the source was quiescent.
	BookmarkBarrier = "barrier"
	// BookmarkDrill marks a drill / rehearsal point.
	BookmarkDrill = "drill"
	// BookmarkPreChange marks a pre-change safety point before a risky op.
	BookmarkPreChange = "pre_change"
	// BookmarkManual is an operator-named restore point.
	BookmarkManual = "manual"
)

// validBookmarkKinds is the set accepted by the API and store.
var validBookmarkKinds = map[string]struct{}{
	BookmarkBarrier:   {},
	BookmarkDrill:     {},
	BookmarkPreChange: {},
	BookmarkManual:    {},
}

// ValidBookmarkKind reports whether kind is one of the defined bookmark kinds.
func ValidBookmarkKind(kind string) bool {
	_, ok := validBookmarkKinds[kind]
	return ok
}

// Segment is one sealed journal segment: the index row over a contiguous,
// gap-free Seq range of a stream's applied frames, with the LSN/wall-clock
// bounds and the object key holding the exact sealed bytes.
type Segment struct {
	ID           string     `json:"id"`
	TenantID     string     `json:"tenant_id"`
	StreamID     string     `json:"stream_id"`
	MinSeq       int64      `json:"min_seq"`
	MaxSeq       int64      `json:"max_seq"`
	FrameCount   int        `json:"frame_count"`
	MinLSN       string     `json:"min_lsn"`
	MaxLSN       string     `json:"max_lsn"`
	MinTS        time.Time  `json:"min_ts"`
	MaxTS        time.Time  `json:"max_ts"`
	ObjectKey    string     `json:"object_key"`
	PayloadBytes int64      `json:"payload_bytes"`
	ContentHash  string     `json:"content_hash"`
	Pruned       bool       `json:"pruned"`
	PrunedAt     *time.Time `json:"pruned_at,omitempty"`
	SealedAt     time.Time  `json:"sealed_at"`
}

// ContainsSeq reports whether seq falls inside this segment's range.
func (s Segment) ContainsSeq(seq int64) bool {
	return seq >= s.MinSeq && seq <= s.MaxSeq
}

// ContainsTime reports whether t falls inside this segment's wall-clock range
// (inclusive of both bounds).
func (s Segment) ContainsTime(t time.Time) bool {
	return !t.Before(s.MinTS) && !t.After(s.MaxTS)
}

// Bookmark is a named restore point pinning a stream at a Seq/LSN/wall-clock.
// Retention never prunes a segment whose Seq range contains a bookmark's at_seq.
type Bookmark struct {
	ID        string    `json:"id"`
	TenantID  string    `json:"tenant_id"`
	StreamID  string    `json:"stream_id"`
	Name      string    `json:"name"`
	Kind      string    `json:"kind"`
	AtSeq     int64     `json:"at_seq"`
	AtLSN     string    `json:"at_lsn"`
	AtTS      time.Time `json:"at_ts"`
	Note      string    `json:"note"`
	CreatedBy *string   `json:"created_by,omitempty"`
	CreatedAt time.Time `json:"created_at"`
}

// Timeline summarizes a stream's journal coverage: the contiguous segment
// runs and the earliest/latest recoverable instant. It backs
// GET /streams/{id}/journal/timeline.
type Timeline struct {
	StreamID string `json:"stream_id"`
	// Segments are the live (non-pruned) segments, oldest first.
	Segments []Segment `json:"segments"`
	// Bookmarks are the stream's restore points, oldest first.
	Bookmarks []Bookmark `json:"bookmarks"`
	// EarliestSeq/LSN/TS is the earliest still-recoverable instant (the start of
	// the oldest live segment). Nil-ish zero values mean nothing is recoverable.
	EarliestSeq int64     `json:"earliest_seq"`
	EarliestLSN string    `json:"earliest_lsn"`
	EarliestTS  time.Time `json:"earliest_ts"`
	// LatestSeq/LSN/TS is the most recent recoverable instant (end of newest
	// live segment).
	LatestSeq int64     `json:"latest_seq"`
	LatestLSN string    `json:"latest_lsn"`
	LatestTS  time.Time `json:"latest_ts"`
	// Recoverable is true when the journal holds at least one live segment.
	Recoverable bool `json:"recoverable"`
	// HasGaps is true when the live segments do not tile the Seq space
	// contiguously (a pruned hole or a missing seal in the middle) — a resolve
	// that targets a hole cannot be satisfied.
	HasGaps bool `json:"has_gaps"`
}

// Resolution is the resolver's output: the exact ordered set of journal
// segments to replay and the precise cut to apply within the final segment to
// reconstruct state as of the target instant. It backs
// GET /streams/{id}/journal/resolve.
type Resolution struct {
	StreamID string `json:"stream_id"`
	// Target echoes how the resolve was requested.
	TargetKind string     `json:"target_kind"` // "timestamp" | "lsn" | "seq"
	TargetTS   *time.Time `json:"target_ts,omitempty"`
	TargetLSN  string     `json:"target_lsn,omitempty"`
	TargetSeq  *int64     `json:"target_seq,omitempty"`
	// Segments are the ordered segments to replay in full, EXCEPT the last one,
	// which is replayed only up to CutSeq (the others are replayed whole).
	Segments []Segment `json:"segments"`
	// CutSeq is the highest frame Seq to apply: replay every frame with
	// Seq <= CutSeq across the resolved segments, and TRUNCATE (discard) any
	// frame with Seq > CutSeq in the final boundary segment. This is the exact
	// reconstruction point.
	CutSeq int64 `json:"cut_seq"`
	// CutLSN is the source LSN at the cut frame (for log-based replay that
	// rewinds the source cursor to this LSN).
	CutLSN string `json:"cut_lsn"`
	// CutTS is the wall-clock of the cut frame's segment (its max_ts when the
	// whole segment is replayed, or the boundary segment's max_ts).
	CutTS time.Time `json:"cut_ts"`
	// ExactMatch is true when the target instant falls exactly on a segment
	// boundary (no partial-segment truncation needed); false when the cut lands
	// mid-segment and the boundary segment must be partially replayed.
	ExactMatch bool `json:"exact_match"`
	// BoundaryClamped is true when the requested target was after the latest
	// recoverable instant and was clamped to it (recover-to-latest semantics).
	BoundaryClamped bool `json:"boundary_clamped"`
}
