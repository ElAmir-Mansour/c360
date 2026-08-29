package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

// ErrFrameConflict means a duplicate (tenant, stream, seq) append did not
// match the already-durable frame bytes/metadata. Idempotent replays must be
// byte-identical; anything else would make recovery-point sealing ambiguous.
var ErrFrameConflict = errors.New("applied frame conflict")

// AppendAppliedFrameInput is one durable applied frame payload for a stream.
type AppendAppliedFrameInput struct {
	TenantID      string
	StreamID      string
	Seq           int64
	Kind          string
	SourceMarker  string
	Payload       []byte
	PayloadSHA256 string
	PayloadBytes  int64
	AppliedAt     time.Time
}

// AppliedFrame is a stored frame row in deterministic stream order.
type AppliedFrame struct {
	ID            string
	TenantID      string
	StreamID      string
	Seq           int64
	Kind          string
	SourceMarker  string
	Payload       []byte
	PayloadSHA256 string
	PayloadBytes  int64
	AppliedAt     time.Time
	CreatedAt     time.Time
}

const appendAppliedFrameSQL = `
INSERT INTO dr_applied_frame
    (tenant_id, stream_id, seq, kind, source_marker, payload, payload_sha256, payload_bytes, applied_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (tenant_id, stream_id, seq) DO UPDATE SET
    source_marker = dr_applied_frame.source_marker
WHERE dr_applied_frame.kind = EXCLUDED.kind
  AND dr_applied_frame.source_marker = EXCLUDED.source_marker
  AND dr_applied_frame.payload_sha256 = EXCLUDED.payload_sha256
  AND dr_applied_frame.payload_bytes = EXCLUDED.payload_bytes
RETURNING id, created_at`

// AppendAppliedFrame durably records the exact stream bytes that were applied.
// Replaying the same frame is a no-op that returns the existing row identity;
// replaying the same seq with different bytes or source marker returns
// ErrFrameConflict.
func (r *Repository) AppendAppliedFrame(ctx context.Context, db DBTX, in AppendAppliedFrameInput) (*AppliedFrame, error) {
	if in.PayloadBytes == 0 && len(in.Payload) > 0 {
		in.PayloadBytes = int64(len(in.Payload))
	}
	var out AppliedFrame
	err := db.QueryRow(ctx, appendAppliedFrameSQL,
		in.TenantID,
		in.StreamID,
		in.Seq,
		in.Kind,
		in.SourceMarker,
		in.Payload,
		in.PayloadSHA256,
		in.PayloadBytes,
		in.AppliedAt,
	).Scan(&out.ID, &out.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("applied frame stream=%s seq=%d: %w", in.StreamID, in.Seq, ErrFrameConflict)
		}
		return nil, fmt.Errorf("appending applied frame stream=%s seq=%d: %w", in.StreamID, in.Seq, err)
	}
	out.TenantID = in.TenantID
	out.StreamID = in.StreamID
	out.Seq = in.Seq
	out.Kind = in.Kind
	out.SourceMarker = in.SourceMarker
	out.Payload = append([]byte(nil), in.Payload...)
	out.PayloadSHA256 = in.PayloadSHA256
	out.PayloadBytes = in.PayloadBytes
	out.AppliedAt = in.AppliedAt
	return &out, nil
}

const listContiguousAppliedFramesSQL = `
WITH ordered AS (
    SELECT
        id, tenant_id, stream_id, seq, kind, source_marker, payload,
        payload_sha256, payload_bytes, applied_at, created_at,
        row_number() OVER (ORDER BY seq) AS expected_seq
    FROM dr_applied_frame
    WHERE tenant_id = $1 AND stream_id = $2 AND seq <= $3
)
SELECT id, tenant_id, stream_id, seq, kind, source_marker, payload,
       payload_sha256, payload_bytes, applied_at, created_at
FROM ordered
WHERE seq = expected_seq
ORDER BY seq`

// ListContiguousAppliedFrames returns the latest contiguous prefix of applied
// frame bytes for a stream, starting at seq=1 and stopping before the first
// gap. The tenant predicate is part of the query even though RLS is also
// enabled, so request-path callers have isolation at both layers.
func (r *Repository) ListContiguousAppliedFrames(ctx context.Context, db DBTX, tenantID, streamID string, throughSeq int64) ([]AppliedFrame, error) {
	if throughSeq <= 0 {
		return nil, nil
	}
	rows, err := db.Query(ctx, listContiguousAppliedFramesSQL, tenantID, streamID, throughSeq)
	if err != nil {
		return nil, fmt.Errorf("listing applied frames stream=%s: %w", streamID, err)
	}
	defer rows.Close()

	frames, err := scanAppliedFrames(rows)
	if err != nil {
		return nil, fmt.Errorf("listing applied frames stream=%s: %w", streamID, err)
	}
	return frames, nil
}

const listAppliedFramesRangeSQL = `
SELECT id, tenant_id, stream_id, seq, kind, source_marker, payload,
       payload_sha256, payload_bytes, applied_at, created_at
FROM dr_applied_frame
WHERE tenant_id = $1 AND stream_id = $2 AND seq > $3 AND seq <= $4
ORDER BY seq`

// ListAppliedFramesRange returns durable applied frame bytes in (afterSeq,
// throughSeq]. Callers that depend on an unbroken apply window must validate
// contiguity; this method deliberately returns the raw ordered range so replay
// tools can detect and report gaps precisely.
func (r *Repository) ListAppliedFramesRange(ctx context.Context, db DBTX, tenantID, streamID string, afterSeq, throughSeq int64) ([]AppliedFrame, error) {
	if throughSeq <= afterSeq {
		return nil, nil
	}
	rows, err := db.Query(ctx, listAppliedFramesRangeSQL, tenantID, streamID, afterSeq, throughSeq)
	if err != nil {
		return nil, fmt.Errorf("listing applied frame range stream=%s after=%d through=%d: %w", streamID, afterSeq, throughSeq, err)
	}
	defer rows.Close()

	frames, err := scanAppliedFrames(rows)
	if err != nil {
		return nil, fmt.Errorf("listing applied frame range stream=%s after=%d through=%d: %w", streamID, afterSeq, throughSeq, err)
	}
	return frames, nil
}

func scanAppliedFrames(rows pgx.Rows) ([]AppliedFrame, error) {
	var frames []AppliedFrame
	for rows.Next() {
		var f AppliedFrame
		if err := rows.Scan(
			&f.ID,
			&f.TenantID,
			&f.StreamID,
			&f.Seq,
			&f.Kind,
			&f.SourceMarker,
			&f.Payload,
			&f.PayloadSHA256,
			&f.PayloadBytes,
			&f.AppliedAt,
			&f.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning applied frame: %w", err)
		}
		f.Payload = append([]byte(nil), f.Payload...)
		frames = append(frames, f)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading applied frames: %w", err)
	}
	return frames, nil
}
