package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/lex/model"
)

// Sync-run ledger (lex_integration_sync_runs). Every Syncer.Sync dispatched by the
// registry — and every failed attempt — appends one append-only row here so the
// admin console can render a sync timeline and reconciliation gaps. Rows are
// tenant-scoped (RLS) and carry only non-sensitive counts/detail; secrets are
// never written.

// SyncRunStatus is the terminal state of a recorded sync run.
type SyncRunStatus string

const (
	SyncRunStatusSucceeded SyncRunStatus = "succeeded"
	SyncRunStatusPartial   SyncRunStatus = "partial"
	SyncRunStatusFailed    SyncRunStatus = "failed"
)

// SyncRun is one append-only ledger row describing a sync attempt.
type SyncRun struct {
	ID         uuid.UUID             `json:"id"`
	TenantID   uuid.UUID             `json:"tenant_id"`
	EndpointID uuid.UUID             `json:"endpoint_id"`
	Kind       model.IntegrationKind `json:"kind"`
	Mode       SyncMode              `json:"mode"`
	Status     SyncRunStatus         `json:"status"`
	Processed  int                   `json:"processed"`
	Created    int                   `json:"created"`
	Updated    int                   `json:"updated"`
	Skipped    int                   `json:"skipped"`
	Failed     int                   `json:"failed"`
	Watermark  string                `json:"watermark,omitempty"`
	Detail     string                `json:"detail"`
	// Error is a sanitized failure message (secret-free), set when the run failed.
	Error       string         `json:"error,omitempty"`
	Metadata    map[string]any `json:"metadata,omitempty"`
	TriggeredBy *uuid.UUID     `json:"triggered_by,omitempty"`
	StartedAt   time.Time      `json:"started_at"`
	FinishedAt  time.Time      `json:"finished_at"`
	CreatedAt   time.Time      `json:"created_at"`
}

// StatusFromReport derives the ledger status from a SyncReport: failed when every
// processed record failed (or processed == 0 with failures), partial when some
// failed, succeeded otherwise.
func StatusFromReport(r SyncReport) SyncRunStatus {
	if r.Failed > 0 && r.Failed >= r.Processed {
		return SyncRunStatusFailed
	}
	if r.Failed > 0 {
		return SyncRunStatusPartial
	}
	return SyncRunStatusSucceeded
}

// SyncLedger persists and lists sync-run rows. It is a thin repository over the
// shared pgx pool; the registry service holds one and writes a row per dispatch.
type SyncLedger struct {
	db *pgxpool.Pool
}

// NewSyncLedger builds a ledger over the pool.
func NewSyncLedger(db *pgxpool.Pool) *SyncLedger {
	return &SyncLedger{db: db}
}

// Record appends a sync-run row. The caller sets ID (or leaves zero for a fresh
// one), TenantID, EndpointID, Kind, Mode, Status, counts, Watermark, Detail,
// Error, Metadata, TriggeredBy, StartedAt and FinishedAt. CreatedAt is assigned
// by the database default. Metadata/Error must already be sanitized.
func (l *SyncLedger) Record(ctx context.Context, run *SyncRun) error {
	if l == nil || l.db == nil {
		return fmt.Errorf("lex/integration: sync ledger has no database")
	}
	if run.ID == uuid.Nil {
		run.ID = uuid.New()
	}
	if run.StartedAt.IsZero() {
		run.StartedAt = time.Now().UTC()
	}
	if run.FinishedAt.IsZero() {
		run.FinishedAt = time.Now().UTC()
	}
	metaJSON, err := json.Marshal(orEmpty(run.Metadata))
	if err != nil {
		return fmt.Errorf("lex/integration: marshal sync-run metadata: %w", err)
	}
	const q = `
		INSERT INTO lex_integration_sync_runs (
			id, tenant_id, endpoint_id, kind, mode, status,
			processed, created, updated, skipped, failed,
			watermark, detail, error, metadata, triggered_by,
			started_at, finished_at
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12,$13,$14,$15::jsonb,$16,
			$17,$18
		)
		RETURNING created_at`
	return l.db.QueryRow(ctx, q,
		run.ID, run.TenantID, run.EndpointID, run.Kind, run.Mode, run.Status,
		run.Processed, run.Created, run.Updated, run.Skipped, run.Failed,
		run.Watermark, run.Detail, run.Error, metaJSON, run.TriggeredBy,
		run.StartedAt.UTC(), run.FinishedAt.UTC(),
	).Scan(&run.CreatedAt)
}

// List returns the most recent sync-run rows for an endpoint (tenant-scoped),
// newest first, capped at limit (defaulted/clamped to 1..200).
func (l *SyncLedger) List(ctx context.Context, tenantID, endpointID uuid.UUID, limit int) ([]SyncRun, error) {
	if l == nil || l.db == nil {
		return nil, fmt.Errorf("lex/integration: sync ledger has no database")
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	const q = `
		SELECT id, tenant_id, endpoint_id, kind, mode, status,
		       processed, created, updated, skipped, failed,
		       watermark, detail, COALESCE(error, ''),
		       COALESCE(metadata, '{}'::jsonb), triggered_by,
		       started_at, finished_at, created_at
		FROM lex_integration_sync_runs
		WHERE tenant_id = $1 AND endpoint_id = $2
		ORDER BY started_at DESC
		LIMIT $3`
	rows, err := l.db.Query(ctx, q, tenantID, endpointID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SyncRun, 0, limit)
	for rows.Next() {
		var (
			run     SyncRun
			metaRaw []byte
		)
		if err := rows.Scan(
			&run.ID, &run.TenantID, &run.EndpointID, &run.Kind, &run.Mode, &run.Status,
			&run.Processed, &run.Created, &run.Updated, &run.Skipped, &run.Failed,
			&run.Watermark, &run.Detail, &run.Error,
			&metaRaw, &run.TriggeredBy,
			&run.StartedAt, &run.FinishedAt, &run.CreatedAt,
		); err != nil {
			return nil, err
		}
		if len(metaRaw) > 0 {
			_ = json.Unmarshal(metaRaw, &run.Metadata)
		}
		if run.Metadata == nil {
			run.Metadata = map[string]any{}
		}
		out = append(out, run)
	}
	return out, rows.Err()
}

// LastSuccessfulSyncByEndpoint returns, for one tenant, the most recent
// successful-or-partial sync finish time per endpoint. It powers the scheduler's
// "due" decision (now - last success >= interval) with a single tenant-scoped
// query rather than a per-endpoint round-trip. A 'failed' run does NOT count as a
// completed sync, so a connector that keeps erroring is retried every tick.
// Endpoints with no qualifying run are simply absent from the map (the scheduler
// then treats them as never-synced → due, first sync runs full).
func (l *SyncLedger) LastSuccessfulSyncByEndpoint(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]time.Time, error) {
	if l == nil || l.db == nil {
		return nil, fmt.Errorf("lex/integration: sync ledger has no database")
	}
	const q = `
		SELECT endpoint_id, MAX(finished_at)
		FROM lex_integration_sync_runs
		WHERE tenant_id = $1 AND status IN ('succeeded', 'partial')
		GROUP BY endpoint_id`
	rows, err := l.db.Query(ctx, q, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[uuid.UUID]time.Time{}
	for rows.Next() {
		var (
			endpointID uuid.UUID
			finishedAt time.Time
		)
		if err := rows.Scan(&endpointID, &finishedAt); err != nil {
			return nil, err
		}
		out[endpointID] = finishedAt.UTC()
	}
	return out, rows.Err()
}

// CountByEndpointSince returns the number of sync-run rows recorded for an
// endpoint since `since` (tenant-scoped). It backs the observability #16
// sync_throughput metric (sync runs in the window) without re-querying the
// ledger from outside this package. A nil ledger reports 0.
func (l *SyncLedger) CountByEndpointSince(ctx context.Context, tenantID, endpointID uuid.UUID, since time.Time) (int64, error) {
	if l == nil || l.db == nil {
		return 0, nil
	}
	const q = `
		SELECT COUNT(*)::bigint
		FROM lex_integration_sync_runs
		WHERE tenant_id = $1 AND endpoint_id = $2 AND started_at >= $3`
	var n int64
	if err := l.db.QueryRow(ctx, q, tenantID, endpointID, since.UTC()).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

func orEmpty(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}
