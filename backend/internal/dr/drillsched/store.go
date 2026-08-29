package drillsched

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so the store, the service, and
// the scheduler all speak the same execution-context type: a *pgxpool.Pool for a
// single read, or the caller's open transaction so a schedule/result write
// commits atomically with its outbox event. This package adds its OWN read/write
// methods for its two owned tables (dr_drill_schedule, dr_drill_result) via raw
// queries rather than editing the shared repository (the prompt permits this).
type DBTX = repository.DBTX

// Store persists scheduled drills and their results. It holds no state; the
// caller chooses the DBTX, so a request reads/writes under a tenant transaction
// while the leader-singleton scheduler scans due schedules under a system
// (RLS-bypass) transaction.
//
// Tenant isolation: request-path methods filter by tenant_id and run under SET
// LOCAL app.current_tenant_id so RLS is the backstop. The ONLY cross-tenant read
// is SystemClaimDueSchedules, used by the leader-singleton scheduler; it is
// documented "background-loop only; bypasses tenant RLS by design" (§7).
type Store struct{}

// NewStore constructs a stateless store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

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

func optionalFloat(f sql.NullFloat64) *float64 {
	if !f.Valid {
		return nil
	}
	v := f.Float64
	return &v
}

// scanRows is the minimal interface both pgx.Row and pgx.Rows satisfy.
type scanRows interface {
	Scan(dest ...any) error
}

// ---------------------------------------------------------------------------
// Group existence (read over the shared consistency_group table, RLS-scoped by
// the DBTX). Distinguishes a missing group from a group with no schedules.
// ---------------------------------------------------------------------------

// GroupExists reports the group's name and whether it exists in the DBTX's RLS
// scope. The service uses it so a schedule create against a missing group is a
// clean ErrGroupNotFound rather than an opaque FK violation.
func (s *Store) GroupExists(ctx context.Context, db DBTX, groupID string) (string, bool, error) {
	var name string
	err := db.QueryRow(ctx, `SELECT name FROM consistency_group WHERE id = $1`, groupID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("drillsched: checking group %s: %w", groupID, err)
	}
	return name, true, nil
}

// ---------------------------------------------------------------------------
// Schedule persistence (dr_drill_schedule).
// ---------------------------------------------------------------------------

const scheduleColumns = `id, tenant_id, group_id, name, cron_expr, profile,
rto_objective_seconds, enabled, next_run, last_fired_at, created_at, updated_at`

const scheduleClaimColumns = `sc.id, sc.tenant_id, sc.group_id, sc.name, sc.cron_expr, sc.profile,
sc.rto_objective_seconds, sc.enabled, sc.next_run, sc.last_fired_at, sc.created_at, sc.updated_at`

func scanSchedule(row scanRows) (*Schedule, error) {
	var sc Schedule
	var lastFired sql.NullTime
	if err := row.Scan(
		&sc.ID, &sc.TenantID, &sc.GroupID, &sc.Name, &sc.CronExpr, &sc.Profile,
		&sc.RTOObjectiveSeconds, &sc.Enabled, &sc.NextRun, &lastFired,
		&sc.CreatedAt, &sc.UpdatedAt,
	); err != nil {
		return nil, err
	}
	sc.LastFiredAt = optionalTime(lastFired)
	return &sc, nil
}

const insertScheduleSQL = `
INSERT INTO dr_drill_schedule (tenant_id, group_id, name, cron_expr, profile, rto_objective_seconds, enabled, next_run)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING id, created_at, updated_at`

// CreateSchedule inserts a drill schedule and populates its generated fields.
func (s *Store) CreateSchedule(ctx context.Context, db DBTX, sc *Schedule) error {
	err := db.QueryRow(ctx, insertScheduleSQL,
		sc.TenantID, sc.GroupID, sc.Name, sc.CronExpr, sc.Profile,
		sc.RTOObjectiveSeconds, sc.Enabled, sc.NextRun,
	).Scan(&sc.ID, &sc.CreatedAt, &sc.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("schedule %s: %w", sc.Name, ErrAlreadyExists)
		}
		if isForeignKeyViolation(err) {
			return fmt.Errorf("group %s: %w", sc.GroupID, ErrGroupNotFound)
		}
		return fmt.Errorf("drillsched: creating schedule %s: %w", sc.Name, err)
	}
	return nil
}

var selectScheduleSQL = `SELECT ` + scheduleColumns + `
FROM dr_drill_schedule WHERE tenant_id = $1 AND id = $2`

// GetSchedule loads one schedule scoped to the tenant.
func (s *Store) GetSchedule(ctx context.Context, db DBTX, tenantID, id string) (*Schedule, error) {
	sc, err := scanSchedule(db.QueryRow(ctx, selectScheduleSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("schedule %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("drillsched: loading schedule %s: %w", id, err)
	}
	return sc, nil
}

var listSchedulesSQL = `SELECT ` + scheduleColumns + `
FROM dr_drill_schedule WHERE tenant_id = $1 ORDER BY name`

// ListSchedules returns all schedules for the tenant, ordered by name.
func (s *Store) ListSchedules(ctx context.Context, db DBTX, tenantID string) ([]*Schedule, error) {
	rows, err := db.Query(ctx, listSchedulesSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("drillsched: listing schedules: %w", err)
	}
	defer rows.Close()
	return scanSchedules(rows)
}

func scanSchedules(rows pgx.Rows) ([]*Schedule, error) {
	var out []*Schedule
	for rows.Next() {
		sc, err := scanSchedule(rows)
		if err != nil {
			return nil, fmt.Errorf("drillsched: scanning schedule: %w", err)
		}
		out = append(out, sc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("drillsched: reading schedules: %w", err)
	}
	return out, nil
}

const advanceScheduleSQL = `
UPDATE dr_drill_schedule
SET next_run = $3, last_fired_at = $4, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// AdvanceSchedule records that a drill was fired: it stamps last_fired_at and
// advances next_run to the next cron fire time (computed by the caller). It is
// tenant-scoped (system callers pass the schedule's own tenant_id, which is in
// scope under the bypass policy).
func (s *Store) AdvanceSchedule(ctx context.Context, db DBTX, tenantID, id string, nextRun, firedAt time.Time) error {
	tag, err := db.Exec(ctx, advanceScheduleSQL, tenantID, id, nextRun, firedAt)
	if err != nil {
		return fmt.Errorf("drillsched: advancing schedule %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("schedule %s: %w", id, ErrNotFound)
	}
	return nil
}

const deleteScheduleSQL = `DELETE FROM dr_drill_schedule WHERE tenant_id = $1 AND id = $2`

// DeleteSchedule removes a schedule scoped to the tenant.
func (s *Store) DeleteSchedule(ctx context.Context, db DBTX, tenantID, id string) error {
	tag, err := db.Exec(ctx, deleteScheduleSQL, tenantID, id)
	if err != nil {
		return fmt.Errorf("drillsched: deleting schedule %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("schedule %s: %w", id, ErrNotFound)
	}
	return nil
}

// --- System (background-loop) path -----------------------------------------

var systemClaimDueSchedulesSQL = `
WITH due AS (
    SELECT id FROM dr_drill_schedule
    WHERE enabled = true AND next_run <= $1
    ORDER BY next_run
    FOR UPDATE SKIP LOCKED
    LIMIT $2
)
UPDATE dr_drill_schedule sc
SET updated_at = now()
FROM due d
WHERE sc.id = d.id
RETURNING ` + scheduleClaimColumns

// SystemClaimDueSchedules atomically claims up to limit enabled schedules whose
// next_run has come due (next_run <= now), ACROSS ALL TENANTS, for the
// leader-singleton scheduler (FOR UPDATE SKIP LOCKED, mirroring the outbox relay
// and the failover/failback claim loops). The touch of updated_at takes the row
// lock; the caller then requests the drill and advances next_run in the same
// transaction, so a schedule is never double-fired by overlapping ticks.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7). Only
// the leader-singleton Scheduler may call this; never the request path.
func (s *Store) SystemClaimDueSchedules(ctx context.Context, db DBTX, now time.Time, limit int) ([]*Schedule, error) {
	if limit <= 0 {
		limit = 1
	}
	rows, err := db.Query(ctx, systemClaimDueSchedulesSQL, now, limit)
	if err != nil {
		return nil, fmt.Errorf("drillsched: system claiming due schedules: %w", err)
	}
	defer rows.Close()
	return scanSchedules(rows)
}

// ---------------------------------------------------------------------------
// Result persistence (dr_drill_result).
// ---------------------------------------------------------------------------

const resultColumns = `id, tenant_id, group_id, schedule_id, run_id, passed,
rto_achieved_seconds, rpo_achieved_seconds, rto_objective_seconds,
recovery_point_id, validation_ratio, validation_outcome, steps, asset_fingerprint,
observed_at, created_at`

func scanResult(row scanRows) (*DrillResult, error) {
	var res DrillResult
	var scheduleID, recoveryPointID sql.NullString
	var validationRatio sql.NullFloat64
	var stepsJSON, fingerprintJSON []byte
	if err := row.Scan(
		&res.ID, &res.TenantID, &res.GroupID, &scheduleID, &res.RunID, &res.Passed,
		&res.RTOAchievedSeconds, &res.RPOAchievedSeconds, &res.RTOObjectiveSeconds,
		&recoveryPointID, &validationRatio, &res.ValidationOutcome, &stepsJSON,
		&fingerprintJSON, &res.ObservedAt, &res.CreatedAt,
	); err != nil {
		return nil, err
	}
	res.ScheduleID = optionalString(scheduleID)
	res.RecoveryPointID = optionalString(recoveryPointID)
	res.ValidationRatio = optionalFloat(validationRatio)
	if len(stepsJSON) > 0 {
		if err := json.Unmarshal(stepsJSON, &res.Steps); err != nil {
			return nil, fmt.Errorf("drillsched: unmarshaling steps: %w", err)
		}
	}
	if len(fingerprintJSON) > 0 {
		if err := json.Unmarshal(fingerprintJSON, &res.AssetFingerprint); err != nil {
			return nil, fmt.Errorf("drillsched: unmarshaling asset fingerprint: %w", err)
		}
	}
	return &res, nil
}

const insertResultSQL = `
INSERT INTO dr_drill_result (tenant_id, group_id, schedule_id, run_id, passed,
    rto_achieved_seconds, rpo_achieved_seconds, rto_objective_seconds,
    recovery_point_id, validation_ratio, validation_outcome, steps, asset_fingerprint, observed_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
RETURNING id, created_at`

// CreateResult inserts a drill result. The steps and asset fingerprint are
// stored as JSONB. A duplicate run_id (the same drill ingested twice) is a
// ErrAlreadyExists so ingest is safely idempotent.
func (s *Store) CreateResult(ctx context.Context, db DBTX, res *DrillResult) error {
	steps := res.Steps
	if steps == nil {
		steps = []DrillStep{}
	}
	stepsJSON, err := json.Marshal(steps)
	if err != nil {
		return fmt.Errorf("drillsched: marshaling steps: %w", err)
	}
	fingerprintJSON, err := json.Marshal(res.AssetFingerprint)
	if err != nil {
		return fmt.Errorf("drillsched: marshaling asset fingerprint: %w", err)
	}
	observedAt := res.ObservedAt
	if observedAt.IsZero() {
		observedAt = time.Now().UTC()
	}
	err = db.QueryRow(ctx, insertResultSQL,
		res.TenantID, res.GroupID, res.ScheduleID, res.RunID, res.Passed,
		res.RTOAchievedSeconds, res.RPOAchievedSeconds, res.RTOObjectiveSeconds,
		res.RecoveryPointID, res.ValidationRatio, res.ValidationOutcome,
		stepsJSON, fingerprintJSON, observedAt,
	).Scan(&res.ID, &res.CreatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("drill result for run %s: %w", res.RunID, ErrAlreadyExists)
		}
		if isForeignKeyViolation(err) {
			return fmt.Errorf("group %s: %w", res.GroupID, ErrGroupNotFound)
		}
		return fmt.Errorf("drillsched: creating drill result: %w", err)
	}
	res.ObservedAt = observedAt
	return nil
}

var selectResultSQL = `SELECT ` + resultColumns + `
FROM dr_drill_result WHERE tenant_id = $1 AND id = $2`

// GetResult loads one drill result scoped to the tenant.
func (s *Store) GetResult(ctx context.Context, db DBTX, tenantID, id string) (*DrillResult, error) {
	res, err := scanResult(db.QueryRow(ctx, selectResultSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("drill result %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("drillsched: loading drill result %s: %w", id, err)
	}
	return res, nil
}

var listResultsByGroupSQL = `SELECT ` + resultColumns + `
FROM dr_drill_result WHERE tenant_id = $1 AND group_id = $2 ORDER BY observed_at DESC, id DESC`

// ListResultsByGroup returns a group's drill results, newest first.
func (s *Store) ListResultsByGroup(ctx context.Context, db DBTX, tenantID, groupID string) ([]*DrillResult, error) {
	rows, err := db.Query(ctx, listResultsByGroupSQL, tenantID, groupID)
	if err != nil {
		return nil, fmt.Errorf("drillsched: listing drill results: %w", err)
	}
	defer rows.Close()
	return scanResults(rows)
}

func scanResults(rows pgx.Rows) ([]*DrillResult, error) {
	var out []*DrillResult
	for rows.Next() {
		res, err := scanResult(rows)
		if err != nil {
			return nil, fmt.Errorf("drillsched: scanning drill result: %w", err)
		}
		out = append(out, res)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("drillsched: reading drill results: %w", err)
	}
	return out, nil
}

// PreviousResultSQL selects the result immediately preceding a given result for
// the same diff scope. The scope is the schedule when the result belongs to one,
// else the whole group (an ad-hoc drill). "Preceding" is by observed_at then id
// so ties are deterministic. $3 is the reference result's observed_at, $4 its id.
var previousResultByScheduleSQL = `SELECT ` + resultColumns + `
FROM dr_drill_result
WHERE tenant_id = $1 AND schedule_id = $2
  AND (observed_at, id) < ($3, $4)
ORDER BY observed_at DESC, id DESC
LIMIT 1`

var previousResultByGroupSQL = `SELECT ` + resultColumns + `
FROM dr_drill_result
WHERE tenant_id = $1 AND group_id = $2 AND schedule_id IS NULL
  AND (observed_at, id) < ($3, $4)
ORDER BY observed_at DESC, id DESC
LIMIT 1`

// PreviousResult returns the result immediately before ref within ref's diff
// scope (its schedule when set, else its group's ad-hoc results), or ErrNoPrevious
// when ref is the first. This is what the diff endpoint compares against.
func (s *Store) PreviousResult(ctx context.Context, db DBTX, tenantID string, ref *DrillResult) (*DrillResult, error) {
	var row pgx.Row
	if ref.ScheduleID != nil {
		row = db.QueryRow(ctx, previousResultByScheduleSQL, tenantID, *ref.ScheduleID, ref.ObservedAt, ref.ID)
	} else {
		row = db.QueryRow(ctx, previousResultByGroupSQL, tenantID, ref.GroupID, ref.ObservedAt, ref.ID)
	}
	res, err := scanResult(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNoPrevious
		}
		return nil, fmt.Errorf("drillsched: loading previous result: %w", err)
	}
	return res, nil
}
