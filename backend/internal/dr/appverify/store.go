package appverify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared DR repository so the store and the
// projection consumer speak the same execution-context type: a *pgxpool.Pool for
// a single read or the caller's open transaction.
type DBTX = repository.DBTX

// ErrResultNotFound is returned when a stored app-verification result id does not
// exist in the tenant's scope.
var ErrResultNotFound = errors.New("appverify: result not found")

// StoredResult is one persisted app-verification outcome for a recovered workload
// (dr_appverify_result): the projection of an executor Result captured at the
// failover VALIDATING gate. The full Result (per-check detail) is retained for
// drill-down; the tallies are denormalised for cheap history/trend listing.
type StoredResult struct {
	ID             uuid.UUID `json:"id"`
	TenantID       uuid.UUID `json:"tenant_id"`
	GroupID        uuid.UUID `json:"group_id"`
	RunID          string    `json:"run_id"`
	SiteID         string    `json:"site_id"`
	WorkloadID     string    `json:"workload_id,omitempty"`
	WorkloadKind   string    `json:"workload_kind,omitempty"`
	Passed         bool      `json:"passed"`
	ChecksTotal    int       `json:"checks_total"`
	ChecksPassed   int       `json:"checks_passed"`
	RequiredTotal  int       `json:"required_total"`
	RequiredPassed int       `json:"required_passed"`
	FailedChecks   []string  `json:"failed_checks"`
	DurationMS     int64     `json:"duration_ms"`
	FinishedAt     time.Time `json:"finished_at"`
	Result         Result    `json:"result"`
	CreatedAt      time.Time `json:"created_at"`
}

// Store persists and queries app-verification results. It holds no state; the
// caller supplies the DBTX so a request runs under a tenant transaction (RLS
// backstop). This package owns dr_appverify_result via raw queries.
type Store struct{}

// NewStore constructs a stateless store.
func NewStore() *Store { return &Store{} }

// txRunner runs a function inside a tenant-scoped transaction.
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform tenant
// transaction helpers (SET LOCAL app.current_tenant_id; RLS backstop).
type PGXRunner struct {
	Pool *pgxpool.Pool
}

// RunWithTenant runs fn in a read-write tenant transaction.
func (r PGXRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// RunReadWithTenant runs fn in a read-only tenant transaction.
func (r PGXRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// Save upserts one app-verification result, idempotent on (run_id, site_id) so a
// redelivered recovery.validated event re-projects the same row rather than
// duplicating it. It populates the generated id and created_at on rec.
func (s *Store) Save(ctx context.Context, db DBTX, rec *StoredResult) error {
	failed := rec.FailedChecks
	if failed == nil {
		failed = []string{}
	}
	failedJSON, err := json.Marshal(failed)
	if err != nil {
		return fmt.Errorf("marshal failed checks: %w", err)
	}
	resultJSON, err := json.Marshal(rec.Result)
	if err != nil {
		return fmt.Errorf("marshal result: %w", err)
	}
	const q = `
INSERT INTO dr_appverify_result
    (tenant_id, group_id, run_id, site_id, workload_id, workload_kind, passed,
     checks_total, checks_passed, required_total, required_passed, failed_checks,
     duration_ms, finished_at, result)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
ON CONFLICT (run_id, site_id) DO UPDATE SET
    group_id = EXCLUDED.group_id,
    workload_id = EXCLUDED.workload_id,
    workload_kind = EXCLUDED.workload_kind,
    passed = EXCLUDED.passed,
    checks_total = EXCLUDED.checks_total,
    checks_passed = EXCLUDED.checks_passed,
    required_total = EXCLUDED.required_total,
    required_passed = EXCLUDED.required_passed,
    failed_checks = EXCLUDED.failed_checks,
    duration_ms = EXCLUDED.duration_ms,
    finished_at = EXCLUDED.finished_at,
    result = EXCLUDED.result
RETURNING id, created_at`
	if err := db.QueryRow(ctx, q,
		rec.TenantID, rec.GroupID, rec.RunID, rec.SiteID, rec.WorkloadID, rec.WorkloadKind,
		rec.Passed, rec.ChecksTotal, rec.ChecksPassed, rec.RequiredTotal, rec.RequiredPassed,
		failedJSON, rec.DurationMS, rec.FinishedAt, resultJSON,
	).Scan(&rec.ID, &rec.CreatedAt); err != nil {
		return fmt.Errorf("upsert appverify result: %w", err)
	}
	return nil
}

// ListByGroup returns the most recent app-verification results for a group
// (newest first) within the db's RLS scope, capped at limit.
func (s *Store) ListByGroup(ctx context.Context, db DBTX, groupID uuid.UUID, limit int) ([]StoredResult, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	const q = `
SELECT id, tenant_id, group_id, run_id, site_id, workload_id, workload_kind, passed,
       checks_total, checks_passed, required_total, required_passed, failed_checks,
       duration_ms, finished_at, result, created_at
FROM dr_appverify_result
WHERE group_id = $1
ORDER BY finished_at DESC, id DESC
LIMIT $2`
	rows, err := db.Query(ctx, q, groupID, limit)
	if err != nil {
		return nil, fmt.Errorf("query appverify results: %w", err)
	}
	defer rows.Close()
	out := make([]StoredResult, 0)
	for rows.Next() {
		rec, err := scanResult(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate appverify results: %w", err)
	}
	return out, nil
}

// GetByID loads one result by id within the db's RLS scope. Returns
// ErrResultNotFound when no row matches.
func (s *Store) GetByID(ctx context.Context, db DBTX, id uuid.UUID) (*StoredResult, error) {
	const q = `
SELECT id, tenant_id, group_id, run_id, site_id, workload_id, workload_kind, passed,
       checks_total, checks_passed, required_total, required_passed, failed_checks,
       duration_ms, finished_at, result, created_at
FROM dr_appverify_result
WHERE id = $1`
	rec, err := scanResult(db.QueryRow(ctx, q, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrResultNotFound
	}
	if err != nil {
		return nil, err
	}
	return &rec, nil
}

// rowScanner is the one-row scan surface shared by Query rows and QueryRow.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanResult(row rowScanner) (StoredResult, error) {
	var (
		rec        StoredResult
		failedJSON []byte
		resultJSON []byte
	)
	if err := row.Scan(
		&rec.ID, &rec.TenantID, &rec.GroupID, &rec.RunID, &rec.SiteID, &rec.WorkloadID,
		&rec.WorkloadKind, &rec.Passed, &rec.ChecksTotal, &rec.ChecksPassed,
		&rec.RequiredTotal, &rec.RequiredPassed, &failedJSON, &rec.DurationMS,
		&rec.FinishedAt, &resultJSON, &rec.CreatedAt,
	); err != nil {
		return StoredResult{}, err
	}
	if len(failedJSON) > 0 {
		if err := json.Unmarshal(failedJSON, &rec.FailedChecks); err != nil {
			return StoredResult{}, fmt.Errorf("unmarshal failed checks: %w", err)
		}
	}
	if rec.FailedChecks == nil {
		rec.FailedChecks = []string{}
	}
	if len(resultJSON) > 0 {
		if err := json.Unmarshal(resultJSON, &rec.Result); err != nil {
			return StoredResult{}, fmt.Errorf("unmarshal result: %w", err)
		}
	}
	return rec, nil
}
