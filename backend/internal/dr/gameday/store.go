package gameday

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/dr/repository"
)

// DBTX is re-exported from the shared repository so the store, the service, and
// the orchestrator all speak the same execution-context type: a *pgxpool.Pool
// for a single read, or the caller's open transaction so a write commits
// atomically with its outbox event. This package adds its OWN read/write methods
// for its three owned tables via raw queries rather than editing the shared
// repository (the prompt explicitly permits this).
type DBTX = repository.DBTX

// Store persists the three game-day tables — dr_gameday_scenario,
// dr_gameday_run, dr_gameday_step_result. It holds no state; the caller chooses
// the DBTX, so a request reads/writes under a tenant transaction and the
// leader-singleton orchestrator claims/advances runs under a system
// (RLS-bypass) transaction. It also reads the consistency group the scenario is
// bound over (to resolve the group's name/existence).
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func optionalString(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}

// ---------------------------------------------------------------------------
// Scenario persistence (dr_gameday_scenario).
// ---------------------------------------------------------------------------

// CreateScenario inserts a scenario and populates its generated fields. The
// steps are stored as JSONB. A duplicate (tenant, name) maps to ErrScenarioExists.
func (s *Store) CreateScenario(ctx context.Context, db DBTX, sc *Scenario) error {
	stepsJSON, err := json.Marshal(sc.Steps)
	if err != nil {
		return fmt.Errorf("gameday: marshaling scenario steps: %w", err)
	}
	err = db.QueryRow(ctx, `
		INSERT INTO dr_gameday_scenario (tenant_id, group_id, name, description, scope, steps)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at, updated_at`,
		sc.TenantID, sc.GroupID, sc.Name, sc.Description, sc.Scope, stepsJSON,
	).Scan(&sc.ID, &sc.CreatedAt, &sc.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("scenario %s: %w", sc.Name, ErrScenarioExists)
		}
		return fmt.Errorf("gameday: creating scenario %s: %w", sc.Name, err)
	}
	return nil
}

const scenarioColumns = `id, tenant_id, group_id, name, description, scope, steps, created_at, updated_at`

func scanScenario(row scanRow) (*Scenario, error) {
	var sc Scenario
	var stepsJSON []byte
	if err := row.Scan(
		&sc.ID, &sc.TenantID, &sc.GroupID, &sc.Name, &sc.Description, &sc.Scope,
		&stepsJSON, &sc.CreatedAt, &sc.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(stepsJSON) > 0 {
		if err := json.Unmarshal(stepsJSON, &sc.Steps); err != nil {
			return nil, fmt.Errorf("gameday: unmarshaling scenario steps: %w", err)
		}
	}
	return &sc, nil
}

// scanRow is the minimal interface both pgx.Row and pgx.Rows satisfy for Scan.
type scanRow interface {
	Scan(dest ...any) error
}

// GetScenario loads one scenario scoped to the tenant (RLS-backed).
func (s *Store) GetScenario(ctx context.Context, db DBTX, tenantID, id string) (*Scenario, error) {
	row := db.QueryRow(ctx, `SELECT `+scenarioColumns+`
		FROM dr_gameday_scenario WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	sc, err := scanScenario(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("scenario %s: %w", id, ErrScenarioNotFound)
		}
		return nil, fmt.Errorf("gameday: loading scenario %s: %w", id, err)
	}
	return sc, nil
}

// SystemGetScenario loads one scenario by id WITHOUT a tenant filter, for the
// leader-singleton orchestrator which claims runs across tenants and must load
// the scenario the run executes.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (s *Store) SystemGetScenario(ctx context.Context, db DBTX, id string) (*Scenario, error) {
	row := db.QueryRow(ctx, `SELECT `+scenarioColumns+`
		FROM dr_gameday_scenario WHERE id = $1`, id)
	sc, err := scanScenario(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("scenario %s: %w", id, ErrScenarioNotFound)
		}
		return nil, fmt.Errorf("gameday: system loading scenario %s: %w", id, err)
	}
	return sc, nil
}

// ListScenarios returns all scenarios for the tenant, newest first.
func (s *Store) ListScenarios(ctx context.Context, db DBTX, tenantID string) ([]*Scenario, error) {
	rows, err := db.Query(ctx, `SELECT `+scenarioColumns+`
		FROM dr_gameday_scenario WHERE tenant_id = $1 ORDER BY created_at DESC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("gameday: listing scenarios: %w", err)
	}
	defer rows.Close()

	var out []*Scenario
	for rows.Next() {
		sc, serr := scanScenario(rows)
		if serr != nil {
			return nil, fmt.Errorf("gameday: scanning scenario: %w", serr)
		}
		out = append(out, sc)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("gameday: reading scenarios: %w", err)
	}
	return out, nil
}

// GroupExists reports whether the consistency group exists in the DBTX's RLS
// context. It is the binding check before a scenario is created.
func (s *Store) GroupExists(ctx context.Context, db DBTX, groupID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM consistency_group WHERE id = $1)`, groupID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("gameday: checking group %s: %w", groupID, err)
	}
	return exists, nil
}

// ---------------------------------------------------------------------------
// Run persistence (dr_gameday_run).
// ---------------------------------------------------------------------------

// CreateRun inserts a run row (status pending, safety verdict pending) and
// populates generated fields.
func (s *Store) CreateRun(ctx context.Context, db DBTX, run *Run) error {
	if run.Status == "" {
		run.Status = RunStatusPending
	}
	if run.SafetyVerdict == "" {
		run.SafetyVerdict = SafetyPending
	}
	err := db.QueryRow(ctx, `
		INSERT INTO dr_gameday_run
		    (tenant_id, scenario_id, group_id, scope, status, steps_total, safety_verdict, initiated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, initiated_at, updated_at`,
		run.TenantID, run.ScenarioID, run.GroupID, run.Scope, run.Status,
		run.StepsTotal, run.SafetyVerdict, optionalString(run.InitiatedBy),
	).Scan(&run.ID, &run.InitiatedAt, &run.UpdatedAt)
	if err != nil {
		return fmt.Errorf("gameday: creating run: %w", err)
	}
	return nil
}

const runColumns = `id, tenant_id, scenario_id, group_id, scope, status, steps_total, steps_passed,
score, all_faults_reverted, safety_verdict, last_error, initiated_by, initiated_at,
started_at, completed_at, claimed_at, updated_at`

const runClaimColumns = `r.id, r.tenant_id, r.scenario_id, r.group_id, r.scope, r.status, r.steps_total, r.steps_passed,
r.score, r.all_faults_reverted, r.safety_verdict, r.last_error, r.initiated_by, r.initiated_at,
r.started_at, r.completed_at, r.claimed_at, r.updated_at`

func scanRun(row scanRow) (*Run, error) {
	var run Run
	var score *float64
	var lastError, initiatedBy *string
	var startedAt, completedAt, claimedAt *time.Time
	if err := row.Scan(
		&run.ID, &run.TenantID, &run.ScenarioID, &run.GroupID, &run.Scope, &run.Status,
		&run.StepsTotal, &run.StepsPassed, &score, &run.AllFaultsReverted, &run.SafetyVerdict,
		&lastError, &initiatedBy, &run.InitiatedAt, &startedAt, &completedAt, &claimedAt, &run.UpdatedAt,
	); err != nil {
		return nil, err
	}
	run.Score = score
	run.LastError = lastError
	run.InitiatedBy = initiatedBy
	run.StartedAt = startedAt
	run.CompletedAt = completedAt
	run.ClaimedAt = claimedAt
	return &run, nil
}

// GetRun loads one run scoped to the tenant.
func (s *Store) GetRun(ctx context.Context, db DBTX, tenantID, id string) (*Run, error) {
	row := db.QueryRow(ctx, `SELECT `+runColumns+`
		FROM dr_gameday_run WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	run, err := scanRun(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("run %s: %w", id, ErrRunNotFound)
		}
		return nil, fmt.Errorf("gameday: loading run %s: %w", id, err)
	}
	return run, nil
}

// SystemGetRun loads one run by id WITHOUT a tenant filter, for the
// leader-singleton orchestrator.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (s *Store) SystemGetRun(ctx context.Context, db DBTX, id string) (*Run, error) {
	row := db.QueryRow(ctx, `SELECT `+runColumns+`
		FROM dr_gameday_run WHERE id = $1`, id)
	run, err := scanRun(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("run %s: %w", id, ErrRunNotFound)
		}
		return nil, fmt.Errorf("gameday: system loading run %s: %w", id, err)
	}
	return run, nil
}

// SystemClaimRun atomically claims the oldest pending run across all tenants
// (FOR UPDATE SKIP LOCKED, §6.2 driver pattern), stamping claimed_at and moving
// it to running. Returns (nil, nil) when there is nothing to claim. The claim
// transaction commits immediately to release the row lock before the
// orchestrator executes (so per-step writes do not deadlock on the FK lock).
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (s *Store) SystemClaimRun(ctx context.Context, db DBTX) (*Run, error) {
	row := db.QueryRow(ctx, `
		WITH claimed AS (
		    SELECT id FROM dr_gameday_run
		     WHERE status = $1
		     ORDER BY initiated_at
		     FOR UPDATE SKIP LOCKED
		     LIMIT 1
		)
			UPDATE dr_gameday_run r
			   SET status = $2, claimed_at = now(), started_at = COALESCE(r.started_at, now()), updated_at = now()
			  FROM claimed
			 WHERE r.id = claimed.id
			RETURNING `+runClaimColumns,
		RunStatusPending, RunStatusRunning)
	run, err := scanRun(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("gameday: claiming run: %w", err)
	}
	return run, nil
}

// SystemMarkRunStarted moves a pending run to running, stamping started_at and
// recording the safety verdict that allowed it. Guarded on the expected status
// so a second attempt is a no-op. Used when the orchestrator runs a run inline
// (synchronous execute) rather than via the claim loop.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (s *Store) SystemMarkRunStarted(ctx context.Context, db DBTX, id string) (bool, error) {
	tag, err := db.Exec(ctx, `
		UPDATE dr_gameday_run
		   SET status = $2, started_at = COALESCE(started_at, now()),
		       safety_verdict = $3, updated_at = now()
		 WHERE id = $1 AND status = $4`,
		id, RunStatusRunning, SafetyAllowed, RunStatusPending)
	if err != nil {
		return false, fmt.Errorf("gameday: marking run started: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// SystemCompleteRun writes the terminal status, aggregate score, revert flag and
// completion time of a run. lastError is recorded when non-empty.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (s *Store) SystemCompleteRun(ctx context.Context, db DBTX, id, status string, stepsTotal, stepsPassed int, allReverted bool, lastErr string) error {
	score := scoreRatio(stepsPassed, stepsTotal)
	var lastErrArg any
	if lastErr != "" {
		lastErrArg = lastErr
	}
	tag, err := db.Exec(ctx, `
		UPDATE dr_gameday_run
		   SET status = $2, steps_total = $3, steps_passed = $4, score = $5,
		       all_faults_reverted = $6, last_error = $7, completed_at = now(), updated_at = now()
		 WHERE id = $1`,
		id, status, stepsTotal, stepsPassed, score, allReverted, lastErrArg)
	if err != nil {
		return fmt.Errorf("gameday: completing run %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("run %s: %w", id, ErrRunNotFound)
	}
	return nil
}

// SystemRejectRunForProduction marks a run aborted with the production-scope
// safety verdict — the durable record that the safety guard refused it.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (s *Store) SystemRejectRunForProduction(ctx context.Context, db DBTX, id, reason string) error {
	tag, err := db.Exec(ctx, `
		UPDATE dr_gameday_run
		   SET status = $2, safety_verdict = $3, last_error = $4,
		       completed_at = now(), updated_at = now()
		 WHERE id = $1`,
		id, RunStatusAborted, SafetyRejectedProduction, reason)
	if err != nil {
		return fmt.Errorf("gameday: rejecting run %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("run %s: %w", id, ErrRunNotFound)
	}
	return nil
}

// ListRunsByScenario returns a scenario's runs for the tenant, newest first.
func (s *Store) ListRunsByScenario(ctx context.Context, db DBTX, tenantID, scenarioID string) ([]*Run, error) {
	rows, err := db.Query(ctx, `SELECT `+runColumns+`
		FROM dr_gameday_run WHERE tenant_id = $1 AND scenario_id = $2 ORDER BY initiated_at DESC`,
		tenantID, scenarioID)
	if err != nil {
		return nil, fmt.Errorf("gameday: listing runs: %w", err)
	}
	defer rows.Close()
	var out []*Run
	for rows.Next() {
		run, serr := scanRun(rows)
		if serr != nil {
			return nil, fmt.Errorf("gameday: scanning run: %w", serr)
		}
		out = append(out, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("gameday: reading runs: %w", err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Step-result persistence (dr_gameday_step_result).
// ---------------------------------------------------------------------------

// UpsertStepResult writes (or replaces, on re-claim) one step's scorecard row,
// keyed UNIQUE (run_id, step_index) for idempotency. It populates the row's
// generated id/started_at on first insert.
func (s *Store) UpsertStepResult(ctx context.Context, db DBTX, r *StepResult) error {
	if r.Observability == "" {
		r.Observability = ObservabilityHarnessOnly
	}
	err := db.QueryRow(ctx, `
		INSERT INTO dr_gameday_step_result
		    (tenant_id, run_id, step_index, action, target, observability, expected_signal,
		     detect_within_ms, recover_within_ms, signal_observed, observed_signal,
		     detection_latency_ms, recovery_latency_ms, fault_reverted, passed, detail, finished_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
		ON CONFLICT (run_id, step_index) DO UPDATE SET
		    action = EXCLUDED.action,
		    target = EXCLUDED.target,
		    observability = EXCLUDED.observability,
		    expected_signal = EXCLUDED.expected_signal,
		    detect_within_ms = EXCLUDED.detect_within_ms,
		    recover_within_ms = EXCLUDED.recover_within_ms,
		    signal_observed = EXCLUDED.signal_observed,
		    observed_signal = EXCLUDED.observed_signal,
		    detection_latency_ms = EXCLUDED.detection_latency_ms,
		    recovery_latency_ms = EXCLUDED.recovery_latency_ms,
		    fault_reverted = EXCLUDED.fault_reverted,
		    passed = EXCLUDED.passed,
		    detail = EXCLUDED.detail,
		    finished_at = EXCLUDED.finished_at
		RETURNING id, started_at`,
		r.TenantID, r.RunID, r.StepIndex, r.Action, r.Target, r.Observability, r.ExpectedSignal,
		r.DetectWithinMS, r.RecoverWithinMS, r.SignalObserved, r.ObservedSignal,
		r.DetectionLatencyMS, r.RecoveryLatencyMS, r.FaultReverted, r.Passed, r.Detail, r.FinishedAt,
	).Scan(&r.ID, &r.StartedAt)
	if err != nil {
		return fmt.Errorf("gameday: upserting step result (run %s step %d): %w", r.RunID, r.StepIndex, err)
	}
	return nil
}

const stepResultColumns = `id, tenant_id, run_id, step_index, action, target, observability, expected_signal,
detect_within_ms, recover_within_ms, signal_observed, observed_signal,
detection_latency_ms, recovery_latency_ms, fault_reverted, passed, detail, started_at, finished_at`

func scanStepResult(row scanRow) (*StepResult, error) {
	var r StepResult
	if err := row.Scan(
		&r.ID, &r.TenantID, &r.RunID, &r.StepIndex, &r.Action, &r.Target, &r.Observability, &r.ExpectedSignal,
		&r.DetectWithinMS, &r.RecoverWithinMS, &r.SignalObserved, &r.ObservedSignal,
		&r.DetectionLatencyMS, &r.RecoveryLatencyMS, &r.FaultReverted, &r.Passed, &r.Detail,
		&r.StartedAt, &r.FinishedAt,
	); err != nil {
		return nil, err
	}
	return &r, nil
}

// ListStepResults returns a run's step results in order, scoped to the tenant.
func (s *Store) ListStepResults(ctx context.Context, db DBTX, tenantID, runID string) ([]*StepResult, error) {
	rows, err := db.Query(ctx, `SELECT `+stepResultColumns+`
		FROM dr_gameday_step_result WHERE tenant_id = $1 AND run_id = $2 ORDER BY step_index`,
		tenantID, runID)
	if err != nil {
		return nil, fmt.Errorf("gameday: listing step results: %w", err)
	}
	defer rows.Close()
	return scanStepResults(rows)
}

// SystemListStepResults returns a run's step results in order WITHOUT a tenant
// filter, for the leader-singleton orchestrator (idempotent re-claim reads prior
// step outcomes; final aggregation reads the recorded verdicts).
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (s *Store) SystemListStepResults(ctx context.Context, db DBTX, runID string) ([]*StepResult, error) {
	rows, err := db.Query(ctx, `SELECT `+stepResultColumns+`
		FROM dr_gameday_step_result WHERE run_id = $1 ORDER BY step_index`, runID)
	if err != nil {
		return nil, fmt.Errorf("gameday: system listing step results: %w", err)
	}
	defer rows.Close()
	return scanStepResults(rows)
}

func scanStepResults(rows pgx.Rows) ([]*StepResult, error) {
	var out []*StepResult
	for rows.Next() {
		r, err := scanStepResult(rows)
		if err != nil {
			return nil, fmt.Errorf("gameday: scanning step result: %w", err)
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("gameday: reading step results: %w", err)
	}
	return out, nil
}
