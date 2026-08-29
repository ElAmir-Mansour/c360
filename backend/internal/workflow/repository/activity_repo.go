package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// activityDBTX is the minimal pgx surface the activity repository needs. Both
// *pgxpool.Pool and pgxmock satisfy it, so the repository is unit-testable without
// a live database (mirrors definitionDBTX). Query is included so the stale-pending
// reconciler (WAVE-2) can scan the ledger.
type activityDBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ActivityExecutionRepository is the persistence surface for the outbound-activity
// idempotency ledger (workflow_activity_executions). It lets the engine record a
// stable idempotency key per activity attempt BEFORE the outbound call so a
// recovered/retried instance never double-fires an external effect.
type ActivityExecutionRepository struct {
	db activityDBTX
}

// NewActivityExecutionRepository creates a repository backed by the pool.
func NewActivityExecutionRepository(pool *pgxpool.Pool) *ActivityExecutionRepository {
	return &ActivityExecutionRepository{db: pool}
}

// newActivityExecutionRepositoryWithDB builds a repository over any activityDBTX
// (used by tests to inject a pgxmock pool).
func newActivityExecutionRepositoryWithDB(db activityDBTX) *ActivityExecutionRepository {
	return &ActivityExecutionRepository{db: db}
}

// Claim attempts to insert a 'pending' ledger row for the given idempotency key.
// It returns (claimed, existing, err):
//
//   - claimed == true, existing == nil: this caller won the race and now owns the
//     attempt; it must perform the outbound call and then MarkCompleted/MarkFailed.
//   - claimed == false, existing != nil: a prior attempt already exists for this
//     exact key. The caller must NOT re-issue the outbound call; if
//     existing.Status == completed it replays existing.ResponseData.
//
// The INSERT ... ON CONFLICT DO NOTHING makes the claim atomic across concurrent
// re-entries and across process restarts (durable dedup).
func (r *ActivityExecutionRepository) Claim(ctx context.Context, act *model.ActivityExecution) (bool, *model.ActivityExecution, error) {
	ct, err := r.db.Exec(ctx, `
		INSERT INTO workflow_activity_executions (
			idempotency_key, instance_id, step_id, attempt, status
		) VALUES ($1, $2, $3, $4, 'pending')
		ON CONFLICT (idempotency_key) DO NOTHING`,
		act.IdempotencyKey, act.InstanceID, act.StepID, act.Attempt,
	)
	if err != nil {
		return false, nil, fmt.Errorf("claiming activity idempotency key: %w", err)
	}
	if ct.RowsAffected() == 1 {
		return true, nil, nil
	}

	// Lost the race (or a prior attempt exists): load the existing record so the
	// caller can decide to replay a completed result or treat as in-flight.
	existing, err := r.Get(ctx, act.IdempotencyKey)
	if err != nil {
		return false, nil, err
	}
	return false, existing, nil
}

// Get loads a ledger row by idempotency key. Returns model.ErrNotFound if absent.
func (r *ActivityExecutionRepository) Get(ctx context.Context, idempotencyKey string) (*model.ActivityExecution, error) {
	row := r.db.QueryRow(ctx, `
		SELECT idempotency_key, instance_id, step_id, attempt, status,
		       response_data, error_message, created_at, updated_at
		FROM workflow_activity_executions
		WHERE idempotency_key = $1`, idempotencyKey)

	var (
		act          model.ActivityExecution
		responseData []byte
	)
	err := row.Scan(
		&act.IdempotencyKey,
		&act.InstanceID,
		&act.StepID,
		&act.Attempt,
		&act.Status,
		&responseData,
		&act.ErrorMessage,
		&act.CreatedAt,
		&act.UpdatedAt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("activity execution: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning activity execution: %w", err)
	}
	if responseData != nil {
		act.ResponseData = json.RawMessage(responseData)
	}
	return &act, nil
}

// MarkCompleted records a successful outbound call and caches its response so a
// later recovery/retry can replay it instead of re-firing.
func (r *ActivityExecutionRepository) MarkCompleted(ctx context.Context, idempotencyKey string, responseData json.RawMessage) error {
	var data []byte
	if len(responseData) > 0 {
		data = []byte(responseData)
	}
	ct, err := r.db.Exec(ctx, `
		UPDATE workflow_activity_executions
		SET status = 'completed', response_data = $2, error_message = NULL, updated_at = now()
		WHERE idempotency_key = $1`,
		idempotencyKey, data,
	)
	if err != nil {
		return fmt.Errorf("marking activity completed: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("activity execution %s: %w", idempotencyKey, model.ErrNotFound)
	}
	return nil
}

// MarkFailed records that this attempt failed terminally. A later attempt uses a
// new key (different attempt number) so retries remain distinct ledger rows.
func (r *ActivityExecutionRepository) MarkFailed(ctx context.Context, idempotencyKey, errMsg string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE workflow_activity_executions
		SET status = 'failed', error_message = $2, updated_at = now()
		WHERE idempotency_key = $1`,
		idempotencyKey, errMsg,
	)
	if err != nil {
		return fmt.Errorf("marking activity failed: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return fmt.Errorf("activity execution %s: %w", idempotencyKey, model.ErrNotFound)
	}
	return nil
}

// ListStalePending returns idempotency-ledger rows that have been stuck in
// 'pending' for longer than olderThan (i.e. an outbound call was CLAIMED but the
// process died before MarkCompleted/MarkFailed ran). Such rows are the exact
// stuck state the reconciler unsticks: on replay, the service-task executor sees
// an existing 'pending' row for the SAME key and REFUSES to re-fire (it cannot
// tell a genuinely-in-flight call from an abandoned one), so the step can never
// advance. The scan is cross-tenant (the ledger has no tenant_id column and is
// engine-internal); callers run it under a system/bypass scope. Rows are returned
// oldest-first, capped by limit.
func (r *ActivityExecutionRepository) ListStalePending(ctx context.Context, olderThan time.Duration, limit int) ([]*model.ActivityExecution, error) {
	if limit <= 0 {
		limit = 100
	}
	cutoff := time.Now().UTC().Add(-olderThan)
	rows, err := r.db.Query(ctx, `
		SELECT idempotency_key, instance_id, step_id, attempt, status,
		       response_data, error_message, created_at, updated_at
		FROM workflow_activity_executions
		WHERE status = 'pending' AND updated_at < $1
		ORDER BY updated_at ASC
		LIMIT $2`, cutoff, limit)
	if err != nil {
		return nil, fmt.Errorf("listing stale pending activities: %w", err)
	}
	defer rows.Close()

	var out []*model.ActivityExecution
	for rows.Next() {
		var (
			act          model.ActivityExecution
			responseData []byte
		)
		if err := rows.Scan(
			&act.IdempotencyKey,
			&act.InstanceID,
			&act.StepID,
			&act.Attempt,
			&act.Status,
			&responseData,
			&act.ErrorMessage,
			&act.CreatedAt,
			&act.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scanning stale pending activity: %w", err)
		}
		if responseData != nil {
			act.ResponseData = json.RawMessage(responseData)
		}
		out = append(out, &act)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating stale pending activities: %w", err)
	}
	return out, nil
}

// ExpireStalePending atomically flips a stale 'pending' ledger row to 'failed'
// with a reconciliation marker, but ONLY when it is still pending AND still older
// than the cutoff (a CAS guard: WHERE status = 'pending' AND updated_at < cutoff),
// so it never races a call that resolved (Mark*) in the meantime. Returning the
// row to 'failed' lets the normal replay path proceed: a re-execute of the SAME
// attempt refuses to re-fire (correctly, the effect is of unknown outcome) and
// surfaces a step failure, which the engine's retry logic re-drives under a NEW
// attempt key (fresh claim → re-fires) or, when retries are exhausted, escalates
// to a GOVERNED incident — never a silent stuck instance. Returns true when this
// call performed the expiry.
func (r *ActivityExecutionRepository) ExpireStalePending(ctx context.Context, idempotencyKey string, olderThan time.Duration, reason string) (bool, error) {
	cutoff := time.Now().UTC().Add(-olderThan)
	ct, err := r.db.Exec(ctx, `
		UPDATE workflow_activity_executions
		SET status = 'failed', error_message = $2, updated_at = now()
		WHERE idempotency_key = $1 AND status = 'pending' AND updated_at < $3`,
		idempotencyKey, reason, cutoff,
	)
	if err != nil {
		return false, fmt.Errorf("expiring stale pending activity: %w", err)
	}
	return ct.RowsAffected() == 1, nil
}
