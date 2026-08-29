package failback

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

const (
	ReverseStreamStatusSyncing = "syncing"
	ReverseStreamStatusDrained = "drained"
	ReverseStreamStatusCutback = "cutback"
	ReverseStreamStatusClosed  = "closed"
	ReverseStreamStatusError   = "error"
)

// ReverseStreamUpsert is the durable identity of one failback reverse stream.
type ReverseStreamUpsert struct {
	StreamID       string
	RunID          string
	TenantID       string
	GroupID        string
	FromSite       string
	ToSite         string
	SourceStreamID string
	TargetStreamID string
}

// ReverseStreamProgress is the measured/applied state of a reverse stream.
type ReverseStreamProgress struct {
	HeadSeq           int64
	AppliedSeq        int64
	HeadLSN           *string
	AppliedLSN        *string
	BytesPending      int64
	CutoverWindowOpen bool
	Status            string
	LastError         *string
}

// ReverseStreamRecord is one durable reverse-stream ledger row.
type ReverseStreamRecord struct {
	StreamID          string
	RunID             string
	TenantID          string
	GroupID           string
	FromSite          string
	ToSite            string
	SourceStreamID    string
	TargetStreamID    string
	HeadSeq           int64
	AppliedSeq        int64
	HeadLSN           *string
	AppliedLSN        *string
	BytesPending      int64
	CutoverWindowOpen bool
	Status            string
	LastError         *string
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

const reverseStreamColumns = `stream_id, run_id, tenant_id, group_id, from_site, to_site,
    source_stream_id, target_stream_id, head_seq, applied_seq, head_lsn, applied_lsn,
    bytes_pending, cutover_window_open, status, last_error, created_at, updated_at`

func scanReverseStream(row pgx.Row) (*ReverseStreamRecord, error) {
	var (
		r          ReverseStreamRecord
		headLSN    sql.NullString
		appliedLSN sql.NullString
		lastError  sql.NullString
	)
	if err := row.Scan(
		&r.StreamID, &r.RunID, &r.TenantID, &r.GroupID, &r.FromSite, &r.ToSite,
		&r.SourceStreamID, &r.TargetStreamID, &r.HeadSeq, &r.AppliedSeq,
		&headLSN, &appliedLSN, &r.BytesPending, &r.CutoverWindowOpen,
		&r.Status, &lastError, &r.CreatedAt, &r.UpdatedAt,
	); err != nil {
		return nil, err
	}
	r.HeadLSN = optionalString(headLSN)
	r.AppliedLSN = optionalString(appliedLSN)
	r.LastError = optionalString(lastError)
	return &r, nil
}

const upsertReverseStreamSQL = `
INSERT INTO dr_failback_reverse_stream (
    stream_id, run_id, tenant_id, group_id, from_site, to_site,
    source_stream_id, target_stream_id, status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'syncing')
ON CONFLICT (stream_id) DO UPDATE SET
    tenant_id = EXCLUDED.tenant_id,
    group_id = EXCLUDED.group_id,
    from_site = EXCLUDED.from_site,
    to_site = EXCLUDED.to_site,
    source_stream_id = EXCLUDED.source_stream_id,
    target_stream_id = EXCLUDED.target_stream_id,
    updated_at = now()
RETURNING ` + reverseStreamColumns

// UpsertReverseStream creates or returns the durable reverse-stream ledger row.
// It is idempotent for stream_id/run_id and does not reset progress on retries.
func (s *Store) UpsertReverseStream(ctx context.Context, db repository.DBTX, in ReverseStreamUpsert) (*ReverseStreamRecord, error) {
	rec, err := scanReverseStream(db.QueryRow(ctx, upsertReverseStreamSQL,
		in.StreamID, in.RunID, in.TenantID, in.GroupID, in.FromSite, in.ToSite,
		in.SourceStreamID, in.TargetStreamID,
	))
	if err != nil {
		return nil, fmt.Errorf("upserting failback reverse stream %s: %w", in.StreamID, err)
	}
	return rec, nil
}

const getReverseStreamSQL = `
SELECT ` + reverseStreamColumns + `
FROM dr_failback_reverse_stream WHERE stream_id = $1`

// GetReverseStream loads one reverse-stream ledger row.
func (s *Store) GetReverseStream(ctx context.Context, db repository.DBTX, streamID string) (*ReverseStreamRecord, error) {
	rec, err := scanReverseStream(db.QueryRow(ctx, getReverseStreamSQL, streamID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("reverse stream %s: %w", streamID, ErrNotFound)
		}
		return nil, fmt.Errorf("loading failback reverse stream %s: %w", streamID, err)
	}
	return rec, nil
}

const updateReverseProgressSQL = `
UPDATE dr_failback_reverse_stream
SET head_seq = $2,
    applied_seq = $3,
    head_lsn = $4,
    applied_lsn = $5,
    bytes_pending = $6,
    cutover_window_open = $7,
    status = $8,
    last_error = $9,
    updated_at = now()
WHERE stream_id = $1`

// UpdateReverseProgress persists the latest reverse head/apply cursors and byte
// backlog. It is the only source the failback DeltaTracker should probe.
func (s *Store) UpdateReverseProgress(ctx context.Context, db repository.DBTX, streamID string, p ReverseStreamProgress) error {
	if p.Status == "" {
		p.Status = ReverseStreamStatusSyncing
	}
	if p.HeadSeq < 0 {
		p.HeadSeq = 0
	}
	if p.AppliedSeq < 0 {
		p.AppliedSeq = 0
	}
	if p.BytesPending < 0 {
		p.BytesPending = 0
	}
	tag, err := db.Exec(ctx, updateReverseProgressSQL,
		streamID, p.HeadSeq, p.AppliedSeq, p.HeadLSN, p.AppliedLSN,
		p.BytesPending, p.CutoverWindowOpen, p.Status, p.LastError,
	)
	if err != nil {
		return fmt.Errorf("updating failback reverse stream %s: %w", streamID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("reverse stream %s: %w", streamID, ErrNotFound)
	}
	return nil
}

// Probe converts the durable record into the failback convergence probe shape.
func (r *ReverseStreamRecord) Probe() ReverseStreamProbe {
	if r == nil {
		return ReverseStreamProbe{}
	}
	var headSeq, appliedSeq uint64
	if r.HeadSeq > 0 {
		headSeq = uint64(r.HeadSeq)
	}
	if r.AppliedSeq > 0 {
		appliedSeq = uint64(r.AppliedSeq)
	}
	return ReverseStreamProbe{
		StreamID:          r.StreamID,
		HeadSeq:           headSeq,
		AppliedSeq:        appliedSeq,
		HeadLSN:           stringValue(r.HeadLSN),
		AppliedLSN:        stringValue(r.AppliedLSN),
		BytesPending:      r.BytesPending,
		CutoverWindowOpen: r.CutoverWindowOpen,
	}
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
