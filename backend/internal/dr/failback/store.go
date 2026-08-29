package failback

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/clario360/platform/internal/dr/repository"
)

// Store persists the failback FSM. Every method takes a repository.DBTX so the
// caller chooses the execution context: a pool for a single read, or an open
// transaction so a state change commits atomically with its outbox event
// (mirroring internal/dr/repository, DESIGN §4.1/§6.2).
//
// Tenant isolation: request-path methods filter by tenant_id and run under SET
// LOCAL app.current_tenant_id so RLS is the backstop. The ONLY cross-tenant read
// is SystemClaimRun, used by the leader-singleton failback driver; it is
// documented "background-loop only; bypasses tenant RLS by design" (§7).
type Store struct{}

// NewStore constructs a stateless failback store.
func NewStore() *Store { return &Store{} }

func optionalString(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	v := s.String
	return &v
}

func optionalTime(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time
	return &v
}

const failbackRunColumns = `id, tenant_id, group_id, failover_run_id, from_site, to_site,
    reverse_stream_id, status, delta_bytes_remaining, delta_seq_remaining,
    converge_threshold_bytes, source_lsn, applied_lsn, last_converged_at,
    cutover_window_open, initiated_by, approved_by, approved_at, new_direction,
    last_error, claimed_at, initiated_at, completed_at, updated_at`

// scanRun decodes one dr_failback_run row in failbackRunColumns order.
func scanRun(row pgx.Row) (*FailbackRun, error) {
	var (
		r             FailbackRun
		failoverRunID sql.NullString
		reverseStream sql.NullString
		sourceLSN     sql.NullString
		appliedLSN    sql.NullString
		lastConverged sql.NullTime
		approvedBy    sql.NullString
		approvedAt    sql.NullTime
		newDirection  sql.NullString
		lastError     sql.NullString
		claimedAt     sql.NullTime
		completedAt   sql.NullTime
	)
	if err := row.Scan(
		&r.ID, &r.TenantID, &r.GroupID, &failoverRunID, &r.FromSite, &r.ToSite,
		&reverseStream, &r.Status, &r.DeltaBytesRemaining, &r.DeltaSeqRemaining,
		&r.ConvergeThresholdBytes, &sourceLSN, &appliedLSN, &lastConverged,
		&r.CutoverWindowOpen, &r.InitiatedBy, &approvedBy, &approvedAt, &newDirection,
		&lastError, &claimedAt, &r.InitiatedAt, &completedAt, &r.UpdatedAt,
	); err != nil {
		return nil, err
	}
	r.FailoverRunID = optionalString(failoverRunID)
	r.ReverseStreamID = optionalString(reverseStream)
	r.SourceLSN = optionalString(sourceLSN)
	r.AppliedLSN = optionalString(appliedLSN)
	r.LastConvergedAt = optionalTime(lastConverged)
	r.ApprovedBy = optionalString(approvedBy)
	r.ApprovedAt = optionalTime(approvedAt)
	r.NewDirection = optionalString(newDirection)
	r.LastError = optionalString(lastError)
	r.ClaimedAt = optionalTime(claimedAt)
	r.CompletedAt = optionalTime(completedAt)
	return &r, nil
}

const insertRunSQL = `
INSERT INTO dr_failback_run (
    tenant_id, group_id, failover_run_id, from_site, to_site,
    converge_threshold_bytes, status, initiated_by
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING ` + failbackRunColumns

// CreateRun inserts a new failback run in PLANNING and populates its generated
// fields. The caller passes the open tx so the insert and its outbox event commit
// atomically.
func (s *Store) CreateRun(ctx context.Context, db repository.DBTX, r *FailbackRun) error {
	row := db.QueryRow(ctx, insertRunSQL,
		r.TenantID, r.GroupID, r.FailoverRunID, r.FromSite, r.ToSite,
		r.ConvergeThresholdBytes, StatusPlanning, r.InitiatedBy,
	)
	created, err := scanRun(row)
	if err != nil {
		return fmt.Errorf("creating failback run: %w", err)
	}
	*r = *created
	return nil
}

const getRunSQL = `
SELECT ` + failbackRunColumns + `
FROM dr_failback_run WHERE tenant_id = $1 AND id = $2`

// GetRun loads one failback run scoped to the tenant.
func (s *Store) GetRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*FailbackRun, error) {
	run, err := scanRun(db.QueryRow(ctx, getRunSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("failback run %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("loading failback run %s: %w", id, err)
	}
	return run, nil
}

const listRunsSQL = `
SELECT ` + failbackRunColumns + `
FROM dr_failback_run WHERE tenant_id = $1 ORDER BY initiated_at DESC`

// ListRuns returns a tenant's failback runs, newest first.
func (s *Store) ListRuns(ctx context.Context, db repository.DBTX, tenantID string) ([]*FailbackRun, error) {
	rows, err := db.Query(ctx, listRunsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing failback runs: %w", err)
	}
	defer rows.Close()

	var runs []*FailbackRun
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning failback run: %w", err)
		}
		runs = append(runs, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading failback runs: %w", err)
	}
	return runs, nil
}

const updateRunStatusSQL = `
UPDATE dr_failback_run
SET status = $4, last_error = $5, updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = $3`

// UpdateRunStatus transitions a run from expectedStatus to newStatus with a
// WHERE status guard, so a concurrent transition (or a stale read) is a no-op
// that returns ErrInvalidState. This is the durable gate of every FSM step,
// mirroring failover's UpdateFailoverRunStatus.
func (s *Store) UpdateRunStatus(ctx context.Context, db repository.DBTX, tenantID, id, newStatus, expectedStatus string, lastError *string) error {
	tag, err := db.Exec(ctx, updateRunStatusSQL, tenantID, id, expectedStatus, newStatus, lastError)
	if err != nil {
		return fmt.Errorf("updating failback run status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failback run %s expected status %q: %w", id, expectedStatus, ErrInvalidState)
	}
	return nil
}

const setReverseStreamSQL = `
UPDATE dr_failback_run
SET reverse_stream_id = $3, source_lsn = $4, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// SetReverseStream durably records the reverse stream id (and starting source
// LSN) established in REVERSE_SYNCING so a restart reuses the same stream rather
// than starting a duplicate.
func (s *Store) SetReverseStream(ctx context.Context, db repository.DBTX, tenantID, id, reverseStreamID string, sourceLSN *string) error {
	tag, err := db.Exec(ctx, setReverseStreamSQL, tenantID, id, reverseStreamID, sourceLSN)
	if err != nil {
		return fmt.Errorf("setting reverse stream: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failback run %s: %w", id, ErrNotFound)
	}
	return nil
}

const updateDeltaSQL = `
UPDATE dr_failback_run
SET delta_bytes_remaining = $3, delta_seq_remaining = $4, source_lsn = $5,
    applied_lsn = $6, cutover_window_open = $7, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// DeltaUpdate carries the measured convergence state written by the DeltaTracker.
type DeltaUpdate struct {
	BytesRemaining    int64
	SeqRemaining      int64
	SourceLSN         *string
	AppliedLSN        *string
	CutoverWindowOpen bool
}

// UpdateDelta persists the latest measured reverse-stream backlog and cutover
// window state. It is written on every REVERSE_SYNCING tick so GET reflects live
// convergence and the converge gate reads durable values.
func (s *Store) UpdateDelta(ctx context.Context, db repository.DBTX, tenantID, id string, d DeltaUpdate) error {
	tag, err := db.Exec(ctx, updateDeltaSQL, tenantID, id,
		d.BytesRemaining, d.SeqRemaining, d.SourceLSN, d.AppliedLSN, d.CutoverWindowOpen)
	if err != nil {
		return fmt.Errorf("updating failback delta: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failback run %s: %w", id, ErrNotFound)
	}
	return nil
}

const markConvergedSQL = `
UPDATE dr_failback_run
SET last_converged_at = now(), updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// MarkConverged stamps last_converged_at when DELTA_CONVERGED is first declared.
func (s *Store) MarkConverged(ctx context.Context, db repository.DBTX, tenantID, id string) error {
	if _, err := db.Exec(ctx, markConvergedSQL, tenantID, id); err != nil {
		return fmt.Errorf("marking failback converged: %w", err)
	}
	return nil
}

const approveCutbackSQL = `
UPDATE dr_failback_run
SET status = $4, approved_by = $3, approved_at = now(), updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = $5 AND approved_by IS NULL`

// ApproveCutback records the explicit human cutback approval and transitions
// AWAITING_CUTBACK_APPROVAL -> CUTTING_BACK in a single guarded statement, so a
// second concurrent approval is a no-op (approved_by IS NULL guard). The driver
// then picks the run up in CUTTING_BACK and executes the gated cutback. Returns
// ErrInvalidState when the run is not awaiting approval (already approved/wrong
// state), which the caller maps to a 409.
func (s *Store) ApproveCutback(ctx context.Context, db repository.DBTX, tenantID, id, approvedBy string) error {
	tag, err := db.Exec(ctx, approveCutbackSQL, tenantID, id, approvedBy, StatusCuttingBack, StatusAwaitingCutbackApproval)
	if err != nil {
		return fmt.Errorf("approving failback cutback: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failback run %s not awaiting cutback approval: %w", id, ErrInvalidState)
	}
	return nil
}

const completeRunSQL = `
UPDATE dr_failback_run
SET status = $4, new_direction = $5, completed_at = now(), last_error = NULL, updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = $3`

// CompleteRun transitions CUTTING_BACK -> COMPLETED and records the new
// replication direction. The status guard makes it idempotent under re-claim.
func (s *Store) CompleteRun(ctx context.Context, db repository.DBTX, tenantID, id, expectedStatus, newDirection string) error {
	tag, err := db.Exec(ctx, completeRunSQL, tenantID, id, expectedStatus, StatusCompleted, newDirection)
	if err != nil {
		return fmt.Errorf("completing failback run: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failback run %s expected status %q: %w", id, expectedStatus, ErrInvalidState)
	}
	return nil
}

const failRunSQL = `
UPDATE dr_failback_run
SET status = $4, last_error = $5, completed_at = now(), updated_at = now()
WHERE tenant_id = $1 AND id = $2 AND status = $3`

// FailRun transitions expectedStatus -> FAILED with a reason. The guard makes a
// re-recorded failure idempotent.
func (s *Store) FailRun(ctx context.Context, db repository.DBTX, tenantID, id, expectedStatus string, reason *string) error {
	tag, err := db.Exec(ctx, failRunSQL, tenantID, id, expectedStatus, StatusFailed, reason)
	if err != nil {
		return fmt.Errorf("failing failback run: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("failback run %s expected status %q: %w", id, expectedStatus, ErrInvalidState)
	}
	return nil
}

// --- Steps ----------------------------------------------------------------

const upsertStepSQL = `
INSERT INTO dr_failback_step (run_id, step, status, detail, finished_at)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (run_id, step) DO UPDATE SET
    status = EXCLUDED.status,
    detail = EXCLUDED.detail,
    finished_at = EXCLUDED.finished_at
RETURNING id, started_at`

// UpsertStep records (or updates) a per-step audit/idempotency row. UNIQUE
// (run_id, step) makes a re-claim after crash idempotent (§6.2): the driver
// reads detail to decide a no-op vs a side-effecting step.
func (s *Store) UpsertStep(ctx context.Context, db repository.DBTX, step *FailbackStep) error {
	var detailJSON []byte
	if step.Detail != nil {
		b, err := json.Marshal(step.Detail)
		if err != nil {
			return fmt.Errorf("marshaling failback step detail: %w", err)
		}
		detailJSON = b
	}
	err := db.QueryRow(ctx, upsertStepSQL, step.RunID, step.Step, step.Status, detailJSON, step.FinishedAt).
		Scan(&step.ID, &step.StartedAt)
	if err != nil {
		return fmt.Errorf("upserting failback step %s: %w", step.Step, err)
	}
	return nil
}

const listStepsSQL = `
SELECT id, run_id, step, status, detail, started_at, finished_at
FROM dr_failback_step WHERE run_id = $1 ORDER BY started_at`

// ListSteps returns a run's step timeline (used by GET and convergence resume).
func (s *Store) ListSteps(ctx context.Context, db repository.DBTX, runID string) ([]*FailbackStep, error) {
	rows, err := db.Query(ctx, listStepsSQL, runID)
	if err != nil {
		return nil, fmt.Errorf("listing failback steps: %w", err)
	}
	defer rows.Close()

	var steps []*FailbackStep
	for rows.Next() {
		var step FailbackStep
		var detailJSON []byte
		if err := rows.Scan(&step.ID, &step.RunID, &step.Step, &step.Status, &detailJSON, &step.StartedAt, &step.FinishedAt); err != nil {
			return nil, fmt.Errorf("scanning failback step: %w", err)
		}
		if len(detailJSON) > 0 {
			if err := json.Unmarshal(detailJSON, &step.Detail); err != nil {
				return nil, fmt.Errorf("unmarshaling failback step detail: %w", err)
			}
		}
		steps = append(steps, &step)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading failback steps: %w", err)
	}
	return steps, nil
}

// --- System (background-loop) path ----------------------------------------

var systemClaimRunSQL = `
WITH claimable AS (
    SELECT id FROM dr_failback_run
    WHERE status NOT IN ('COMPLETED','FAILED','AWAITING_CUTBACK_APPROVAL')
    ORDER BY initiated_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE dr_failback_run f
SET claimed_at = now(), updated_at = now()
FROM claimable c
WHERE f.id = c.id
RETURNING ` + prefixedColumns("f")

// SystemClaimRun atomically claims the next advanceable failback run ACROSS ALL
// TENANTS for the leader-singleton driver (FOR UPDATE SKIP LOCKED, §6.2). Returns
// (nil, nil) when there is nothing to claim. AWAITING_CUTBACK_APPROVAL is excluded
// so the human cutback gate parks without busy-looping.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7). Only the
// leader-singleton failback driver may call this; never the request path.
func (s *Store) SystemClaimRun(ctx context.Context, db repository.DBTX) (*FailbackRun, error) {
	run, err := scanRun(db.QueryRow(ctx, systemClaimRunSQL))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("system claiming failback run: %w", err)
	}
	return run, nil
}

// prefixedColumns aliases failbackRunColumns with a table alias for the
// RETURNING clause of the claim UPDATE...FROM, so column references are
// unambiguous.
func prefixedColumns(alias string) string {
	cols := []string{
		"id", "tenant_id", "group_id", "failover_run_id", "from_site", "to_site",
		"reverse_stream_id", "status", "delta_bytes_remaining", "delta_seq_remaining",
		"converge_threshold_bytes", "source_lsn", "applied_lsn", "last_converged_at",
		"cutover_window_open", "initiated_by", "approved_by", "approved_at", "new_direction",
		"last_error", "claimed_at", "initiated_at", "completed_at", "updated_at",
	}
	out := make([]byte, 0, len(cols)*16)
	for i, c := range cols {
		if i > 0 {
			out = append(out, ',', ' ')
		}
		out = append(out, alias...)
		out = append(out, '.')
		out = append(out, c...)
	}
	return string(out)
}
