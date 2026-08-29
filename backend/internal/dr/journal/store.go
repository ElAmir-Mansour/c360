package journal

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists dr_journal_segment and dr_journal_bookmark rows. It holds no
// state and takes a repository.DBTX on every method so the caller chooses the
// execution context: the appender's open transaction makes the segment-index
// insert atomic with its outbox event, while a pool/read-tx serves reads.
//
// The cross-tenant retention path uses the bypass_rls system transaction (set by
// the caller's TenantRunner); those methods are documented as background-loop
// only, matching the dr_db system-query convention.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

const insertSegmentSQL = `
INSERT INTO dr_journal_segment
    (tenant_id, stream_id, min_seq, max_seq, frame_count,
     min_lsn, max_lsn, min_ts, max_ts, object_key, payload_bytes, content_hash)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
RETURNING id, pruned, sealed_at`

// AppendSegment inserts a sealed journal-segment index row and populates its
// generated fields. A duplicate (tenant, stream, min_seq) — a replayed seal of
// the same range — returns ErrAlreadyExists so the appender treats it as an
// idempotent no-op rather than corrupting the index.
func (Store) AppendSegment(ctx context.Context, db repository.DBTX, s *Segment) error {
	if s.StreamID == "" {
		return fmt.Errorf("%w: stream id is required", ErrInvalid)
	}
	if s.MinSeq <= 0 || s.MaxSeq < s.MinSeq {
		return fmt.Errorf("%w: seq range [%d,%d] is invalid", ErrInvalid, s.MinSeq, s.MaxSeq)
	}
	if s.ObjectKey == "" {
		return fmt.Errorf("%w: object key is required", ErrInvalid)
	}
	err := db.QueryRow(ctx, insertSegmentSQL,
		s.TenantID, s.StreamID, s.MinSeq, s.MaxSeq, s.FrameCount,
		s.MinLSN, s.MaxLSN, s.MinTS, s.MaxTS, s.ObjectKey, s.PayloadBytes, s.ContentHash,
	).Scan(&s.ID, &s.Pruned, &s.SealedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("segment stream=%s min_seq=%d: %w", s.StreamID, s.MinSeq, ErrAlreadyExists)
		}
		return fmt.Errorf("appending journal segment stream=%s min_seq=%d: %w", s.StreamID, s.MinSeq, err)
	}
	return nil
}

const segmentColumns = `
id, tenant_id, stream_id, min_seq, max_seq, frame_count,
min_lsn, max_lsn, min_ts, max_ts, object_key, payload_bytes, content_hash,
pruned, pruned_at, sealed_at`

func scanSegment(row interface{ Scan(...any) error }) (*Segment, error) {
	var s Segment
	if err := row.Scan(
		&s.ID, &s.TenantID, &s.StreamID, &s.MinSeq, &s.MaxSeq, &s.FrameCount,
		&s.MinLSN, &s.MaxLSN, &s.MinTS, &s.MaxTS, &s.ObjectKey, &s.PayloadBytes, &s.ContentHash,
		&s.Pruned, &s.PrunedAt, &s.SealedAt,
	); err != nil {
		return nil, err
	}
	return &s, nil
}

const listSegmentsSQL = `SELECT ` + segmentColumns + `
FROM dr_journal_segment
WHERE tenant_id = $1 AND stream_id = $2
ORDER BY min_seq`

// ListSegments returns every segment (live and pruned tombstones) for a stream
// in Seq order — the resolver needs the pruned rows to distinguish "before
// retention" from "fell in a reclaimed hole".
func (Store) ListSegments(ctx context.Context, db repository.DBTX, tenantID, streamID string) ([]Segment, error) {
	rows, err := db.Query(ctx, listSegmentsSQL, tenantID, streamID)
	if err != nil {
		return nil, fmt.Errorf("listing journal segments stream=%s: %w", streamID, err)
	}
	defer rows.Close()

	var segs []Segment
	for rows.Next() {
		s, err := scanSegment(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning journal segment: %w", err)
		}
		segs = append(segs, *s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading journal segments stream=%s: %w", streamID, err)
	}
	return segs, nil
}

const latestSegmentMaxSeqSQL = `
SELECT COALESCE(MAX(max_seq), 0)
FROM dr_journal_segment
WHERE tenant_id = $1 AND stream_id = $2`

// LatestSealedSeq returns the highest Seq already sealed into a segment for a
// stream (0 when none), so the appender knows where the next segment opens and
// never overlaps an existing range.
func (Store) LatestSealedSeq(ctx context.Context, db repository.DBTX, tenantID, streamID string) (int64, error) {
	var maxSeq int64
	if err := db.QueryRow(ctx, latestSegmentMaxSeqSQL, tenantID, streamID).Scan(&maxSeq); err != nil {
		return 0, fmt.Errorf("loading latest sealed seq stream=%s: %w", streamID, err)
	}
	return maxSeq, nil
}

// --- Retention ----------------------------------------------------------

// PruneInput names a segment to reclaim by the retention loop.
type PruneInput struct {
	TenantID string
	StreamID string
	ID       string
}

const candidatePruneSQL = `
SELECT ` + segmentColumns + `
FROM dr_journal_segment seg
WHERE seg.tenant_id = $1
  AND seg.stream_id = $2
  AND seg.pruned = false
  AND seg.max_ts < $3
  AND NOT EXISTS (
      SELECT 1 FROM dr_journal_bookmark bm
      WHERE bm.stream_id = seg.stream_id
        AND bm.at_seq BETWEEN seg.min_seq AND seg.max_seq
  )
ORDER BY seg.min_seq
LIMIT $4`

// PruneCandidates returns live segments for a stream whose entire wall-clock
// range is older than olderThan AND that no bookmark falls inside — the
// retention loop reclaims exactly these and never a bookmarked segment. The
// bookmark guard is part of the query so the protection is enforced atomically
// against the same snapshot, not in two round trips. olderThan is an RFC3339
// upper bound; pass it as the prune horizon (now - retention window).
func (Store) PruneCandidates(ctx context.Context, db repository.DBTX, tenantID, streamID string, olderThan any, limit int) ([]Segment, error) {
	if limit <= 0 {
		limit = 100
	}
	rows, err := db.Query(ctx, candidatePruneSQL, tenantID, streamID, olderThan, limit)
	if err != nil {
		return nil, fmt.Errorf("listing prune candidates stream=%s: %w", streamID, err)
	}
	defer rows.Close()

	var segs []Segment
	for rows.Next() {
		s, err := scanSegment(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning prune candidate: %w", err)
		}
		segs = append(segs, *s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading prune candidates stream=%s: %w", streamID, err)
	}
	return segs, nil
}

const markPrunedSQL = `
UPDATE dr_journal_segment
SET pruned = true, pruned_at = now()
WHERE tenant_id = $1 AND stream_id = $2 AND id = $3 AND pruned = false
  AND NOT EXISTS (
      SELECT 1 FROM dr_journal_bookmark bm
      WHERE bm.stream_id = $2
        AND bm.at_seq BETWEEN
            (SELECT min_seq FROM dr_journal_segment WHERE id = $3)
        AND (SELECT max_seq FROM dr_journal_segment WHERE id = $3)
  )`

// MarkPruned tombstones a segment as reclaimed. The WHERE clause re-checks the
// bookmark guard so a bookmark created between candidate selection and the
// update still protects the segment (no TOCTOU). It returns whether a row was
// updated; false means the segment was already pruned or just became protected.
func (Store) MarkPruned(ctx context.Context, db repository.DBTX, in PruneInput) (bool, error) {
	tag, err := db.Exec(ctx, markPrunedSQL, in.TenantID, in.StreamID, in.ID)
	if err != nil {
		return false, fmt.Errorf("marking segment pruned stream=%s id=%s: %w", in.StreamID, in.ID, err)
	}
	return tag.RowsAffected() == 1, nil
}

// --- Bookmarks ----------------------------------------------------------

const insertBookmarkSQL = `
INSERT INTO dr_journal_bookmark
    (tenant_id, stream_id, name, kind, at_seq, at_lsn, at_ts, note, created_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, created_at`

// CreateBookmark inserts a named restore point. A reused (tenant, stream, name)
// returns ErrAlreadyExists. created_by is nil for system-created bookmarks
// (barriers, drill markers).
func (Store) CreateBookmark(ctx context.Context, db repository.DBTX, b *Bookmark) error {
	if b.StreamID == "" || b.Name == "" {
		return fmt.Errorf("%w: stream id and name are required", ErrInvalid)
	}
	if b.AtSeq <= 0 {
		return fmt.Errorf("%w: at_seq must be positive", ErrInvalid)
	}
	if b.Kind == "" {
		b.Kind = BookmarkManual
	}
	if !ValidBookmarkKind(b.Kind) {
		return fmt.Errorf("%w: bookmark kind %q", ErrInvalid, b.Kind)
	}
	err := db.QueryRow(ctx, insertBookmarkSQL,
		b.TenantID, b.StreamID, b.Name, b.Kind, b.AtSeq, b.AtLSN, b.AtTS, b.Note, b.CreatedBy,
	).Scan(&b.ID, &b.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("bookmark %s: %w", b.Name, ErrAlreadyExists)
		}
		return fmt.Errorf("creating bookmark %s: %w", b.Name, err)
	}
	return nil
}

const bookmarkColumns = `
id, tenant_id, stream_id, name, kind, at_seq, at_lsn, at_ts, note, created_by, created_at`

func scanBookmark(row interface{ Scan(...any) error }) (*Bookmark, error) {
	var b Bookmark
	if err := row.Scan(
		&b.ID, &b.TenantID, &b.StreamID, &b.Name, &b.Kind,
		&b.AtSeq, &b.AtLSN, &b.AtTS, &b.Note, &b.CreatedBy, &b.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &b, nil
}

const listBookmarksSQL = `SELECT ` + bookmarkColumns + `
FROM dr_journal_bookmark
WHERE tenant_id = $1 AND stream_id = $2
ORDER BY at_seq`

// ListBookmarks returns a stream's restore points in Seq order.
func (Store) ListBookmarks(ctx context.Context, db repository.DBTX, tenantID, streamID string) ([]Bookmark, error) {
	rows, err := db.Query(ctx, listBookmarksSQL, tenantID, streamID)
	if err != nil {
		return nil, fmt.Errorf("listing bookmarks stream=%s: %w", streamID, err)
	}
	defer rows.Close()

	var bms []Bookmark
	for rows.Next() {
		b, err := scanBookmark(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning bookmark: %w", err)
		}
		bms = append(bms, *b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading bookmarks stream=%s: %w", streamID, err)
	}
	return bms, nil
}

const getBookmarkSQL = `SELECT ` + bookmarkColumns + `
FROM dr_journal_bookmark
WHERE tenant_id = $1 AND stream_id = $2 AND id = $3`

// GetBookmark loads one bookmark scoped to the tenant + stream.
func (Store) GetBookmark(ctx context.Context, db repository.DBTX, tenantID, streamID, id string) (*Bookmark, error) {
	b, err := scanBookmark(db.QueryRow(ctx, getBookmarkSQL, tenantID, streamID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("bookmark %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("loading bookmark %s: %w", id, err)
	}
	return b, nil
}

const deleteBookmarkSQL = `
DELETE FROM dr_journal_bookmark
WHERE tenant_id = $1 AND stream_id = $2 AND id = $3`

// DeleteBookmark removes a restore point. It returns ErrNotFound when no row
// matched so the API can answer 404 rather than a silent 204.
func (Store) DeleteBookmark(ctx context.Context, db repository.DBTX, tenantID, streamID, id string) error {
	tag, err := db.Exec(ctx, deleteBookmarkSQL, tenantID, streamID, id)
	if err != nil {
		return fmt.Errorf("deleting bookmark %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("bookmark %s: %w", id, ErrNotFound)
	}
	return nil
}

// isUniqueViolation reports whether err is a PostgreSQL unique constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
