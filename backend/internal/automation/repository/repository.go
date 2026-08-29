// Package repository persists the Automation engine domain. Every method takes a
// DBTX so callers choose the execution context: a pool for single reads, or the
// service's open transaction so a state change commits atomically with its
// outbox event(s) (DESIGN_Workflow_Forms_Automation.md §2/§8 — no dual writes).
//
// Request-path methods filter by tenant_id AND run under SET LOCAL
// app.current_tenant_id (RLS backstop). The single cross-tenant read used by the
// leader-singleton run driver is SystemClaimRunnableRuns — clearly marked
// "SYSTEM PATH" and run with app.bypass_rls = on, mirroring the DR failover
// driver (§6, §7).
package repository

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/automation/model"
)

// DBTX is the subset of pgx satisfied by both *pgxpool.Pool and pgx.Tx, so a
// repository method runs identically against a pool (read) or a transaction
// (state change + outbox).
type DBTX interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Repository holds no state; the service depends on it as a value and tests
// substitute a pgxmock pool.
type Repository struct{}

// New constructs a Repository.
func New() *Repository { return &Repository{} }

// isUniqueViolation reports whether err is a PostgreSQL unique-constraint error.
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

// marshalJSON marshals v to JSON, substituting an empty object/array when v is
// nil so a NOT NULL JSONB column never receives a literal SQL NULL.
func marshalJSON(v any) ([]byte, error) {
	if v == nil {
		return []byte("{}"), nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("marshaling json: %w", err)
	}
	return b, nil
}

// =============================================================================
// Runbooks
// =============================================================================

const insertRunbookSQL = `
INSERT INTO automation_runbooks (tenant_id, name)
VALUES ($1, $2)
RETURNING id, created_at, updated_at`

// CreateRunbook inserts a runbook header and its ordered steps. The caller must
// pass a transaction so header + steps commit atomically.
func (r *Repository) CreateRunbook(ctx context.Context, db DBTX, rb *model.Runbook) error {
	err := db.QueryRow(ctx, insertRunbookSQL, rb.TenantID, rb.Name).
		Scan(&rb.ID, &rb.CreatedAt, &rb.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("runbook %q: %w", rb.Name, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating runbook %q: %w", rb.Name, err)
	}
	for i := range rb.Steps {
		rb.Steps[i].RunbookID = rb.ID
		rb.Steps[i].Index = i
		if err := r.insertRunbookStep(ctx, db, rb.TenantID, &rb.Steps[i]); err != nil {
			return err
		}
	}
	return nil
}

const insertRunbookStepSQL = `
INSERT INTO automation_runbook_steps
    (tenant_id, runbook_id, step_index, step_type, action, approver_roles, quorum, timeout_seconds, timeout_action)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id`

func (r *Repository) insertRunbookStep(ctx context.Context, db DBTX, tenantID string, s *model.RunbookStep) error {
	actionJSON, err := marshalJSON(s.Action)
	if err != nil {
		return err
	}
	roles := s.ApproverRoles
	if roles == nil {
		roles = []string{}
	}
	timeoutAction := s.TimeoutAction
	if timeoutAction == "" {
		timeoutAction = model.TimeoutActionEscalate
	}
	quorum := s.Quorum
	if quorum < 1 {
		quorum = 1
	}
	err = db.QueryRow(ctx, insertRunbookStepSQL,
		tenantID, s.RunbookID, s.Index, s.Type, actionJSON, roles, quorum, s.TimeoutSeconds, timeoutAction,
	).Scan(&s.ID)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("runbook step %d: %w", s.Index, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating runbook step %d: %w", s.Index, err)
	}
	return nil
}

const selectRunbookSQL = `
SELECT id, tenant_id, name, created_at, updated_at
FROM automation_runbooks WHERE tenant_id = $1 AND id = $2`

// GetRunbook loads a runbook header and its ordered steps.
func (r *Repository) GetRunbook(ctx context.Context, db DBTX, tenantID, id string) (*model.Runbook, error) {
	var rb model.Runbook
	err := db.QueryRow(ctx, selectRunbookSQL, tenantID, id).
		Scan(&rb.ID, &rb.TenantID, &rb.Name, &rb.CreatedAt, &rb.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("runbook %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading runbook %s: %w", id, err)
	}
	steps, err := r.ListRunbookSteps(ctx, db, tenantID, rb.ID)
	if err != nil {
		return nil, err
	}
	rb.Steps = steps
	return &rb, nil
}

const listRunbookStepsSQL = `
SELECT id, runbook_id, step_index, step_type, action, approver_roles, quorum, timeout_seconds, timeout_action
FROM automation_runbook_steps
WHERE tenant_id = $1 AND runbook_id = $2
ORDER BY step_index`

// ListRunbookSteps returns a runbook's steps in index order.
func (r *Repository) ListRunbookSteps(ctx context.Context, db DBTX, tenantID, runbookID string) ([]model.RunbookStep, error) {
	rows, err := db.Query(ctx, listRunbookStepsSQL, tenantID, runbookID)
	if err != nil {
		return nil, fmt.Errorf("listing runbook steps: %w", err)
	}
	defer rows.Close()

	var steps []model.RunbookStep
	for rows.Next() {
		var s model.RunbookStep
		var actionJSON []byte
		if err := rows.Scan(&s.ID, &s.RunbookID, &s.Index, &s.Type, &actionJSON, &s.ApproverRoles, &s.Quorum, &s.TimeoutSeconds, &s.TimeoutAction); err != nil {
			return nil, fmt.Errorf("scanning runbook step: %w", err)
		}
		if len(actionJSON) > 0 {
			if err := json.Unmarshal(actionJSON, &s.Action); err != nil {
				return nil, fmt.Errorf("unmarshaling step action: %w", err)
			}
		}
		steps = append(steps, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading runbook steps: %w", err)
	}
	return steps, nil
}

// DeleteRunbook removes a runbook (its steps cascade).
func (r *Repository) DeleteRunbook(ctx context.Context, db DBTX, tenantID, id string) error {
	tag, err := db.Exec(ctx, `DELETE FROM automation_runbooks WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return fmt.Errorf("deleting runbook %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("runbook %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// =============================================================================
// Automations
// =============================================================================

const insertAutomationSQL = `
INSERT INTO automations (tenant_id, name, enabled, trigger, runbook_id, created_by)
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING id, created_at, updated_at`

// CreateAutomation inserts an automation and its rules (caller supplies a tx).
func (r *Repository) CreateAutomation(ctx context.Context, db DBTX, a *model.Automation) error {
	triggerJSON, err := marshalJSON(a.Trigger)
	if err != nil {
		return err
	}
	var createdBy *string
	if a.CreatedBy != "" {
		createdBy = &a.CreatedBy
	}
	err = db.QueryRow(ctx, insertAutomationSQL, a.TenantID, a.Name, a.Enabled, triggerJSON, a.RunbookID, createdBy).
		Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("automation %q: %w", a.Name, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating automation %q: %w", a.Name, err)
	}
	return r.SetAutomationRules(ctx, db, a.TenantID, a.ID, a.Rules)
}

const selectAutomationSQL = `
SELECT id, tenant_id, name, enabled, trigger, runbook_id, COALESCE(created_by::text, ''), created_at, updated_at
FROM automations WHERE tenant_id = $1 AND id = $2`

// GetAutomation loads an automation with its rules.
func (r *Repository) GetAutomation(ctx context.Context, db DBTX, tenantID, id string) (*model.Automation, error) {
	a, err := r.scanAutomation(db.QueryRow(ctx, selectAutomationSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("automation %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading automation %s: %w", id, err)
	}
	rules, err := r.ListAutomationRules(ctx, db, tenantID, a.ID)
	if err != nil {
		return nil, err
	}
	a.Rules = rules
	return a, nil
}

const listAutomationsSQL = `
SELECT id, tenant_id, name, enabled, trigger, runbook_id, COALESCE(created_by::text, ''), created_at, updated_at
FROM automations WHERE tenant_id = $1 ORDER BY name`

// ListAutomations returns all automations for a tenant (rules not eagerly
// loaded; callers needing rules use GetAutomation per row).
func (r *Repository) ListAutomations(ctx context.Context, db DBTX, tenantID string) ([]*model.Automation, error) {
	rows, err := db.Query(ctx, listAutomationsSQL, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing automations: %w", err)
	}
	defer rows.Close()

	var out []*model.Automation
	for rows.Next() {
		a, err := r.scanAutomation(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning automation: %w", err)
		}
		out = append(out, a)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading automations: %w", err)
	}
	return out, nil
}

// rowScanner abstracts pgx.Row and pgx.Rows for shared scan helpers.
type rowScanner interface {
	Scan(dest ...any) error
}

func (r *Repository) scanAutomation(row rowScanner) (*model.Automation, error) {
	var a model.Automation
	var triggerJSON []byte
	if err := row.Scan(&a.ID, &a.TenantID, &a.Name, &a.Enabled, &triggerJSON, &a.RunbookID, &a.CreatedBy, &a.CreatedAt, &a.UpdatedAt); err != nil {
		return nil, err
	}
	if len(triggerJSON) > 0 {
		if err := json.Unmarshal(triggerJSON, &a.Trigger); err != nil {
			return nil, fmt.Errorf("unmarshaling trigger: %w", err)
		}
	}
	return &a, nil
}

const updateAutomationSQL = `
UPDATE automations
SET name = $3, enabled = $4, trigger = $5, runbook_id = $6, updated_at = now()
WHERE tenant_id = $1 AND id = $2
RETURNING created_at, updated_at`

// UpdateAutomation replaces the mutable fields and rules of an automation.
func (r *Repository) UpdateAutomation(ctx context.Context, db DBTX, a *model.Automation) error {
	triggerJSON, err := marshalJSON(a.Trigger)
	if err != nil {
		return err
	}
	err = db.QueryRow(ctx, updateAutomationSQL, a.TenantID, a.ID, a.Name, a.Enabled, triggerJSON, a.RunbookID).
		Scan(&a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("automation %s: %w", a.ID, model.ErrNotFound)
		}
		if isUniqueViolation(err) {
			return fmt.Errorf("automation %q: %w", a.Name, model.ErrAlreadyExists)
		}
		return fmt.Errorf("updating automation %s: %w", a.ID, err)
	}
	return r.SetAutomationRules(ctx, db, a.TenantID, a.ID, a.Rules)
}

// SetEnabled toggles an automation on or off without rewriting its rules.
func (r *Repository) SetEnabled(ctx context.Context, db DBTX, tenantID, id string, enabled bool) error {
	tag, err := db.Exec(ctx,
		`UPDATE automations SET enabled = $3, updated_at = now() WHERE tenant_id = $1 AND id = $2`,
		tenantID, id, enabled)
	if err != nil {
		return fmt.Errorf("setting automation %s enabled: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("automation %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// DeleteAutomation removes an automation (its rules cascade).
func (r *Repository) DeleteAutomation(ctx context.Context, db DBTX, tenantID, id string) error {
	tag, err := db.Exec(ctx, `DELETE FROM automations WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return fmt.Errorf("deleting automation %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("automation %s: %w", id, model.ErrNotFound)
	}
	return nil
}

// =============================================================================
// Rules
// =============================================================================

const insertRuleSQL = `
INSERT INTO automation_rules (tenant_id, automation_id, priority, when_conditions, action)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, created_at`

// SetAutomationRules replaces an automation's rule set in priority order.
func (r *Repository) SetAutomationRules(ctx context.Context, db DBTX, tenantID, automationID string, rules []model.Rule) error {
	if _, err := db.Exec(ctx, `DELETE FROM automation_rules WHERE tenant_id = $1 AND automation_id = $2`, tenantID, automationID); err != nil {
		return fmt.Errorf("clearing rules: %w", err)
	}
	for i := range rules {
		whenJSON, err := json.Marshal(orEmptyConditions(rules[i].When))
		if err != nil {
			return fmt.Errorf("marshaling rule conditions: %w", err)
		}
		actionJSON, err := marshalJSON(rules[i].ActionRef)
		if err != nil {
			return err
		}
		var createdAt time.Time
		if err := db.QueryRow(ctx, insertRuleSQL, tenantID, automationID, rules[i].Priority, whenJSON, actionJSON).
			Scan(&rules[i].ID, &createdAt); err != nil {
			return fmt.Errorf("creating rule: %w", err)
		}
	}
	return nil
}

func orEmptyConditions(c []model.Condition) []model.Condition {
	if c == nil {
		return []model.Condition{}
	}
	return c
}

const listRulesSQL = `
SELECT id, priority, when_conditions, action
FROM automation_rules
WHERE tenant_id = $1 AND automation_id = $2
ORDER BY priority, id`

// ListAutomationRules returns an automation's rules in priority order (the order
// the rule engine evaluates them, FR-AUTOMATION-002).
func (r *Repository) ListAutomationRules(ctx context.Context, db DBTX, tenantID, automationID string) ([]model.Rule, error) {
	rows, err := db.Query(ctx, listRulesSQL, tenantID, automationID)
	if err != nil {
		return nil, fmt.Errorf("listing rules: %w", err)
	}
	defer rows.Close()

	var rules []model.Rule
	for rows.Next() {
		var rule model.Rule
		var whenJSON, actionJSON []byte
		if err := rows.Scan(&rule.ID, &rule.Priority, &whenJSON, &actionJSON); err != nil {
			return nil, fmt.Errorf("scanning rule: %w", err)
		}
		if len(whenJSON) > 0 {
			if err := json.Unmarshal(whenJSON, &rule.When); err != nil {
				return nil, fmt.Errorf("unmarshaling rule conditions: %w", err)
			}
		}
		if len(actionJSON) > 0 {
			if err := json.Unmarshal(actionJSON, &rule.ActionRef); err != nil {
				return nil, fmt.Errorf("unmarshaling rule action: %w", err)
			}
		}
		rules = append(rules, rule)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading rules: %w", err)
	}
	return rules, nil
}

// =============================================================================
// Runs (the durable FSM, §6)
// =============================================================================

// runColumns is the canonical, ordered column list for automation_runs scans.
const runColumns = `id, tenant_id, automation_id, runbook_id, status, source_event_id,
    replay_of, current_step, trigger, variables, COALESCE(last_error, ''),
    claimed_at, started_at, completed_at, updated_at`

const insertRunSQL = `
INSERT INTO automation_runs
    (tenant_id, automation_id, runbook_id, status, source_event_id, replay_of, current_step, trigger, variables)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING id, started_at, updated_at`

// CreateRun inserts a new run. The UNIQUE(tenant_id, source_event_id) backstop
// makes a duplicate trigger occurrence return ErrAlreadyExists rather than a
// second run (exactly-once, §4.3) — the caller treats that as "already handled".
func (r *Repository) CreateRun(ctx context.Context, db DBTX, run *model.Run) error {
	triggerJSON, err := marshalJSON(run.Trigger)
	if err != nil {
		return err
	}
	variablesJSON, err := marshalJSON(run.Variables)
	if err != nil {
		return err
	}
	if run.Status == "" {
		run.Status = model.RunStatusPending
	}
	err = db.QueryRow(ctx, insertRunSQL,
		run.TenantID, run.AutomationID, run.RunbookID, run.Status, run.SourceEventID,
		run.ReplayOf, run.CurrentStep, triggerJSON, variablesJSON,
	).Scan(&run.ID, &run.StartedAt, &run.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("run for source_event_id %s: %w", run.SourceEventID, model.ErrAlreadyExists)
		}
		return fmt.Errorf("creating run: %w", err)
	}
	return nil
}

const selectRunSQL = `SELECT ` + runColumns + ` FROM automation_runs WHERE tenant_id = $1 AND id = $2`

// GetRun loads a run by id within a tenant.
func (r *Repository) GetRun(ctx context.Context, db DBTX, tenantID, id string) (*model.Run, error) {
	run, err := scanRun(db.QueryRow(ctx, selectRunSQL, tenantID, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("run %s: %w", id, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading run %s: %w", id, err)
	}
	return run, nil
}

const listRunsSQL = `
SELECT ` + runColumns + `
FROM automation_runs
WHERE tenant_id = $1
ORDER BY started_at DESC
LIMIT $2 OFFSET $3`

// ListRuns returns a tenant's runs, newest first, paginated.
func (r *Repository) ListRuns(ctx context.Context, db DBTX, tenantID string, limit, offset int) ([]*model.Run, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := db.Query(ctx, listRunsSQL, tenantID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("listing runs: %w", err)
	}
	defer rows.Close()

	var out []*model.Run
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning run: %w", err)
		}
		out = append(out, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading runs: %w", err)
	}
	return out, nil
}

func scanRun(row rowScanner) (*model.Run, error) {
	var run model.Run
	var triggerJSON, variablesJSON []byte
	if err := row.Scan(
		&run.ID, &run.TenantID, &run.AutomationID, &run.RunbookID, &run.Status, &run.SourceEventID,
		&run.ReplayOf, &run.CurrentStep, &triggerJSON, &variablesJSON, &run.LastError,
		&run.ClaimedAt, &run.StartedAt, &run.CompletedAt, &run.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if len(triggerJSON) > 0 {
		if err := json.Unmarshal(triggerJSON, &run.Trigger); err != nil {
			return nil, fmt.Errorf("unmarshaling run trigger: %w", err)
		}
	}
	if len(variablesJSON) > 0 {
		if err := json.Unmarshal(variablesJSON, &run.Variables); err != nil {
			return nil, fmt.Errorf("unmarshaling run variables: %w", err)
		}
	}
	return &run, nil
}

const updateRunStateSQL = `
UPDATE automation_runs
SET status = $3, current_step = $4, variables = $5, last_error = NULLIF($6, ''),
    completed_at = $7, updated_at = now()
WHERE tenant_id = $1 AND id = $2`

// UpdateRunState advances a run's status/step/variables. The driver calls this
// in the advance transaction (separate from the claim, §6) after executing or
// parking a step. completed_at is set by the caller when entering a terminal
// state.
func (r *Repository) UpdateRunState(ctx context.Context, db DBTX, run *model.Run) error {
	variablesJSON, err := marshalJSON(run.Variables)
	if err != nil {
		return err
	}
	tag, err := db.Exec(ctx, updateRunStateSQL,
		run.TenantID, run.ID, run.Status, run.CurrentStep, variablesJSON, run.LastError, run.CompletedAt)
	if err != nil {
		return fmt.Errorf("updating run %s state: %w", run.ID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("run %s: %w", run.ID, model.ErrNotFound)
	}
	return nil
}

const cancelRunSQL = `
UPDATE automation_runs
SET status = 'CANCELLED', completed_at = now(), updated_at = now()
WHERE tenant_id = $1 AND id = $2
  AND status NOT IN ('COMPLETED','FAILED','ABORTED','CANCELLED')`

// CancelRun moves a non-terminal run to CANCELLED. It is a no-op (ErrConflict)
// on an already-terminal run so an operator cannot "cancel" a finished run.
func (r *Repository) CancelRun(ctx context.Context, db DBTX, tenantID, id string) error {
	tag, err := db.Exec(ctx, cancelRunSQL, tenantID, id)
	if err != nil {
		return fmt.Errorf("cancelling run %s: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		// Either the run does not exist or it is already terminal.
		return fmt.Errorf("run %s not cancellable: %w", id, model.ErrConflict)
	}
	return nil
}

// systemClaimRunnableRunsSQL claims up to $1 runnable runs ACROSS ALL TENANTS for
// the leader driver. The predicate matches the partial index
// idx_automation_runs_driver: PENDING|RUNNING only — an approval gate NEVER
// auto-advances (§6), so AWAITING_APPROVAL and ESCALATED are excluded, as are all
// terminal states. FOR UPDATE SKIP LOCKED lets multiple driver iterations (and a
// brief two-leader overlap during failover) make progress without blocking.
var systemClaimRunnableRunsSQL = `
WITH claimable AS (
    SELECT id FROM automation_runs
    WHERE status IN ('PENDING','RUNNING')
    ORDER BY started_at
    FOR UPDATE SKIP LOCKED
    LIMIT $1
)
UPDATE automation_runs r
SET claimed_at = now(), updated_at = now()
FROM claimable c
WHERE r.id = c.id
RETURNING ` + prefixedRunColumns

// SystemClaimRunnableRuns atomically claims up to limit runnable runs across all
// tenants and stamps their lease. Returns an empty slice when nothing is
// claimable.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7). Only
// the leader-singleton run driver may call this, and only with app.bypass_rls
// = on; never the request path. The exclusion of AWAITING_APPROVAL/ESCALATED is
// the FSM guarantee that the gate never auto-advances (§6).
func (r *Repository) SystemClaimRunnableRuns(ctx context.Context, db DBTX, limit int) ([]*model.Run, error) {
	if limit <= 0 {
		limit = 1
	}
	rows, err := db.Query(ctx, systemClaimRunnableRunsSQL, limit)
	if err != nil {
		return nil, fmt.Errorf("system claiming runnable runs: %w", err)
	}
	defer rows.Close()

	var out []*model.Run
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning claimed run: %w", err)
		}
		out = append(out, run)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading claimed runs: %w", err)
	}
	return out, nil
}

// =============================================================================
// Run steps (append-only execution log, §4.7)
// =============================================================================

const ensureRunStepSQL = `
INSERT INTO automation_run_steps
    (tenant_id, run_id, step_index, action, input, output, status, attempt, error, finished_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, ''), $10)
ON CONFLICT (run_id, step_index) DO UPDATE SET
    action      = EXCLUDED.action,
    input       = EXCLUDED.input,
    output      = EXCLUDED.output,
    status      = EXCLUDED.status,
    attempt     = EXCLUDED.attempt,
    error       = EXCLUDED.error,
    finished_at = EXCLUDED.finished_at
RETURNING id, started_at`

// EnsureRunStep upserts a run step on the UNIQUE(run_id, step_index) key. This is
// Ensure-not-Create (§6): a crash-restart re-claim updates the existing row
// rather than appending a duplicate, so the log stays one-row-per-step and the
// driver can read the prior status to decide a no-op vs a re-attempt.
func (r *Repository) EnsureRunStep(ctx context.Context, db DBTX, tenantID string, s *model.RunStep) error {
	actionJSON, err := marshalJSON(s.Action)
	if err != nil {
		return err
	}
	inputJSON, err := marshalJSON(s.InputJSON)
	if err != nil {
		return err
	}
	outputJSON, err := marshalJSON(s.OutputJSON)
	if err != nil {
		return err
	}
	attempt := s.Attempt
	if attempt < 1 {
		attempt = 1
	}
	err = db.QueryRow(ctx, ensureRunStepSQL,
		tenantID, s.RunID, s.Index, actionJSON, inputJSON, outputJSON, s.Status, attempt, s.Error, s.FinishedAt,
	).Scan(&s.ID, &s.StartedAt)
	if err != nil {
		return fmt.Errorf("ensuring run step %d: %w", s.Index, err)
	}
	return nil
}

const getRunStepSQL = `
SELECT id, run_id, step_index, action, input, output, status, attempt, COALESCE(error, ''), started_at, finished_at
FROM automation_run_steps WHERE run_id = $1 AND step_index = $2`

// GetRunStep loads a single step from the log, used by the driver to check
// whether a step already ran (idempotency) before side-effecting again.
// Returns ErrNotFound when the step has not been recorded yet.
func (r *Repository) GetRunStep(ctx context.Context, db DBTX, runID string, index int) (*model.RunStep, error) {
	s, err := scanRunStep(db.QueryRow(ctx, getRunStepSQL, runID, index))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("run step %d: %w", index, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading run step %d: %w", index, err)
	}
	return s, nil
}

const listRunStepsSQL = `
SELECT id, run_id, step_index, action, input, output, status, attempt, COALESCE(error, ''), started_at, finished_at
FROM automation_run_steps WHERE run_id = $1 ORDER BY step_index`

// ListRunSteps returns a run's full append-only log in index order — the basis
// for the execution-log API and the replay gap check (§4.7).
func (r *Repository) ListRunSteps(ctx context.Context, db DBTX, runID string) ([]*model.RunStep, error) {
	rows, err := db.Query(ctx, listRunStepsSQL, runID)
	if err != nil {
		return nil, fmt.Errorf("listing run steps: %w", err)
	}
	defer rows.Close()

	var out []*model.RunStep
	for rows.Next() {
		s, err := scanRunStep(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning run step: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading run steps: %w", err)
	}
	return out, nil
}

func scanRunStep(row rowScanner) (*model.RunStep, error) {
	var s model.RunStep
	var actionJSON, inputJSON, outputJSON []byte
	if err := row.Scan(&s.ID, &s.RunID, &s.Index, &actionJSON, &inputJSON, &outputJSON, &s.Status, &s.Attempt, &s.Error, &s.StartedAt, &s.FinishedAt); err != nil {
		return nil, err
	}
	if len(actionJSON) > 0 {
		if err := json.Unmarshal(actionJSON, &s.Action); err != nil {
			return nil, fmt.Errorf("unmarshaling step action: %w", err)
		}
	}
	if len(inputJSON) > 0 {
		if err := json.Unmarshal(inputJSON, &s.InputJSON); err != nil {
			return nil, fmt.Errorf("unmarshaling step input: %w", err)
		}
	}
	if len(outputJSON) > 0 {
		if err := json.Unmarshal(outputJSON, &s.OutputJSON); err != nil {
			return nil, fmt.Errorf("unmarshaling step output: %w", err)
		}
	}
	return &s, nil
}

// =============================================================================
// Approval gates (§4.5)
// =============================================================================

const upsertGateSQL = `
INSERT INTO automation_approval_gates
    (tenant_id, run_id, step_index, status, quorum, decisions, deadline_at, resolved_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (run_id, step_index) DO UPDATE SET
    status      = EXCLUDED.status,
    quorum      = EXCLUDED.quorum,
    decisions   = EXCLUDED.decisions,
    deadline_at = EXCLUDED.deadline_at,
    resolved_at = EXCLUDED.resolved_at
RETURNING id, opened_at`

// UpsertApprovalGate creates or updates the parked-decision record for a gate
// step. UNIQUE(run_id, step_index) keeps it idempotent across a driver re-claim.
func (r *Repository) UpsertApprovalGate(ctx context.Context, db DBTX, g *model.ApprovalGate) error {
	decisionsJSON, err := json.Marshal(orEmptyDecisions(g.Decisions))
	if err != nil {
		return fmt.Errorf("marshaling gate decisions: %w", err)
	}
	quorum := g.Quorum
	if quorum < 1 {
		quorum = 1
	}
	if g.Status == "" {
		g.Status = model.GateStatusOpen
	}
	err = db.QueryRow(ctx, upsertGateSQL,
		g.TenantID, g.RunID, g.StepIndex, g.Status, quorum, decisionsJSON, g.DeadlineAt, g.ResolvedAt,
	).Scan(&g.ID, &g.OpenedAt)
	if err != nil {
		return fmt.Errorf("upserting approval gate (run %s step %d): %w", g.RunID, g.StepIndex, err)
	}
	return nil
}

func orEmptyDecisions(d []model.Decision) []model.Decision {
	if d == nil {
		return []model.Decision{}
	}
	return d
}

const getGateSQL = `
SELECT id, tenant_id, run_id, step_index, status, quorum, decisions, opened_at, deadline_at, resolved_at
FROM automation_approval_gates WHERE tenant_id = $1 AND run_id = $2 AND step_index = $3`

// GetApprovalGate loads the gate for a run step.
func (r *Repository) GetApprovalGate(ctx context.Context, db DBTX, tenantID, runID string, stepIndex int) (*model.ApprovalGate, error) {
	g, err := scanGate(db.QueryRow(ctx, getGateSQL, tenantID, runID, stepIndex))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("approval gate (run %s step %d): %w", runID, stepIndex, model.ErrNotFound)
		}
		return nil, fmt.Errorf("loading approval gate: %w", err)
	}
	return g, nil
}

// systemListExpiredGatesSQL finds OPEN gates whose deadline has passed, across
// all tenants, for the leader gate-timeout sweeper. SYSTEM PATH — like the run
// driver, runs with app.bypass_rls = on.
const systemListExpiredGatesSQL = `
SELECT id, tenant_id, run_id, step_index, status, quorum, decisions, opened_at, deadline_at, resolved_at
FROM automation_approval_gates
WHERE status = 'OPEN' AND deadline_at IS NOT NULL AND deadline_at <= now()
ORDER BY deadline_at
LIMIT $1`

// SystemListExpiredGates returns OPEN gates past their deadline for the sweeper.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (§7).
func (r *Repository) SystemListExpiredGates(ctx context.Context, db DBTX, limit int) ([]*model.ApprovalGate, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := db.Query(ctx, systemListExpiredGatesSQL, limit)
	if err != nil {
		return nil, fmt.Errorf("system listing expired gates: %w", err)
	}
	defer rows.Close()

	var out []*model.ApprovalGate
	for rows.Next() {
		g, err := scanGate(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning expired gate: %w", err)
		}
		out = append(out, g)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reading expired gates: %w", err)
	}
	return out, nil
}

func scanGate(row rowScanner) (*model.ApprovalGate, error) {
	var g model.ApprovalGate
	var decisionsJSON []byte
	if err := row.Scan(&g.ID, &g.TenantID, &g.RunID, &g.StepIndex, &g.Status, &g.Quorum, &decisionsJSON, &g.OpenedAt, &g.DeadlineAt, &g.ResolvedAt); err != nil {
		return nil, err
	}
	if len(decisionsJSON) > 0 {
		if err := json.Unmarshal(decisionsJSON, &g.Decisions); err != nil {
			return nil, fmt.Errorf("unmarshaling gate decisions: %w", err)
		}
	}
	return &g, nil
}
