package runbookstudio

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
// the projection loop all speak the same execution-context type: a *pgxpool.Pool
// for a single read, or the caller's open transaction so a studio write commits
// atomically with its outbox event. This package adds its OWN read/write methods
// for its four owned tables (dr_studio_runbook, dr_studio_task, dr_studio_run,
// dr_studio_task_run) via raw queries rather than editing the shared repository.
type DBTX = repository.DBTX

// Store persists Runbook Studio's four owned tables. It holds no state; the
// caller chooses the DBTX, so a request reads/writes under a tenant transaction
// and the projection loop reads/writes under a system (RLS-bypass) transaction.
type Store struct{}

// NewStore constructs a Store.
func NewStore() *Store { return &Store{} }

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func isForeignKeyViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

// ---------------------------------------------------------------------------
// Runbook persistence (dr_studio_runbook).
// ---------------------------------------------------------------------------

// GroupExists reports whether a consistency group with the given id is visible in
// the current RLS context. The service uses it to validate an optional group
// binding when a runbook is created/imported against a group.
func (s *Store) GroupExists(ctx context.Context, db DBTX, groupID string) (bool, error) {
	var exists bool
	err := db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM consistency_group WHERE id = $1)`, groupID).Scan(&exists)
	if err != nil {
		return false, fmt.Errorf("studio: checking group %s: %w", groupID, err)
	}
	return exists, nil
}

// CreateRunbook inserts a runbook and populates its generated fields.
func (s *Store) CreateRunbook(ctx context.Context, db DBTX, rb *Runbook) error {
	if rb.Status == "" {
		rb.Status = RunbookStatusDraft
	}
	if rb.Source == "" {
		rb.Source = SourceAuthored
	}
	err := db.QueryRow(ctx, `
		INSERT INTO dr_studio_runbook (tenant_id, group_id, name, description, status, source_runbook, created_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, created_at, updated_at`,
		rb.TenantID, rb.GroupID, rb.Name, rb.Description, rb.Status, rb.Source, rb.CreatedBy,
	).Scan(&rb.ID, &rb.CreatedAt, &rb.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("runbook %q: %w", rb.Name, ErrAlreadyExists)
		}
		return fmt.Errorf("studio: creating runbook %q: %w", rb.Name, err)
	}
	return nil
}

const runbookColumns = `id, tenant_id, group_id, name, description, status, source_runbook, created_by, created_at, updated_at`

func scanRunbook(row interface{ Scan(...any) error }) (*Runbook, error) {
	var rb Runbook
	var groupID, createdBy *string
	if err := row.Scan(
		&rb.ID, &rb.TenantID, &groupID, &rb.Name, &rb.Description,
		&rb.Status, &rb.Source, &createdBy, &rb.CreatedAt, &rb.UpdatedAt,
	); err != nil {
		return nil, err
	}
	rb.GroupID = groupID
	rb.CreatedBy = createdBy
	return &rb, nil
}

// GetRunbook loads one runbook (RLS-scoped) or ErrNotFound.
func (s *Store) GetRunbook(ctx context.Context, db DBTX, id string) (*Runbook, error) {
	rb, err := scanRunbook(db.QueryRow(ctx, `SELECT `+runbookColumns+` FROM dr_studio_runbook WHERE id = $1`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("runbook %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("studio: loading runbook %s: %w", id, err)
	}
	return rb, nil
}

// UpdateRunbook updates the editable header fields (name, description, status) of
// a runbook. Returns ErrNotFound if no row matched, ErrAlreadyExists on a name
// collision.
func (s *Store) UpdateRunbook(ctx context.Context, db DBTX, id, name, description, status string) (*Runbook, error) {
	rb, err := scanRunbook(db.QueryRow(ctx, `
		UPDATE dr_studio_runbook
		   SET name = $2, description = $3, status = $4, updated_at = now()
		 WHERE id = $1
		RETURNING `+runbookColumns, id, name, description, status))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("runbook %s: %w", id, ErrNotFound)
		}
		if isUniqueViolation(err) {
			return nil, fmt.Errorf("runbook %q: %w", name, ErrAlreadyExists)
		}
		return nil, fmt.Errorf("studio: updating runbook %s: %w", id, err)
	}
	return rb, nil
}

// ---------------------------------------------------------------------------
// Task persistence (dr_studio_task).
// ---------------------------------------------------------------------------

const taskColumns = `id, tenant_id, runbook_id, task_key, name, task_type, required, owner, team,
	instructions, planned_duration_seconds, automation_action, predecessors, params, created_at, updated_at`

func scanTask(row interface{ Scan(...any) error }) (*Task, error) {
	var t Task
	var paramsJSON []byte
	if err := row.Scan(
		&t.ID, &t.TenantID, &t.RunbookID, &t.TaskKey, &t.Name, &t.TaskType, &t.Required,
		&t.Owner, &t.Team, &t.Instructions, &t.PlannedDurationSeconds, &t.AutomationAction,
		&t.Predecessors, &paramsJSON, &t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if t.Predecessors == nil {
		t.Predecessors = []string{}
	}
	if len(paramsJSON) > 0 {
		if err := json.Unmarshal(paramsJSON, &t.Params); err != nil {
			return nil, fmt.Errorf("studio: unmarshaling task params: %w", err)
		}
	}
	return &t, nil
}

// CreateTask inserts a task. Predecessors must be task IDs of the same runbook;
// the service validates the DAG (no cycle / unknown predecessor) inside the same
// transaction before calling this. A predecessor referencing a missing task row
// surfaces as a foreign-key-free text mismatch handled at the service layer; here
// a duplicate (runbook_id, task_key) maps to ErrAlreadyExists.
func (s *Store) CreateTask(ctx context.Context, db DBTX, t *Task) error {
	if t.Predecessors == nil {
		t.Predecessors = []string{}
	}
	params := t.Params
	if params == nil {
		params = map[string]any{}
	}
	paramsJSON, err := json.Marshal(params)
	if err != nil {
		return fmt.Errorf("studio: marshaling task params: %w", err)
	}
	err = db.QueryRow(ctx, `
		INSERT INTO dr_studio_task
		    (tenant_id, runbook_id, task_key, name, task_type, required, owner, team,
		     instructions, planned_duration_seconds, automation_action, predecessors, params)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		RETURNING `+taskColumns,
		t.TenantID, t.RunbookID, t.TaskKey, t.Name, t.TaskType, t.Required, t.Owner, t.Team,
		t.Instructions, t.PlannedDurationSeconds, t.AutomationAction, t.Predecessors, paramsJSON,
	).Scan(
		&t.ID, &t.TenantID, &t.RunbookID, &t.TaskKey, &t.Name, &t.TaskType, &t.Required,
		&t.Owner, &t.Team, &t.Instructions, &t.PlannedDurationSeconds, &t.AutomationAction,
		&t.Predecessors, &paramsJSON, &t.CreatedAt, &t.UpdatedAt,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("task %q: %w", t.TaskKey, ErrAlreadyExists)
		}
		return fmt.Errorf("studio: creating task %q: %w", t.TaskKey, err)
	}
	if t.Predecessors == nil {
		t.Predecessors = []string{}
	}
	return nil
}

// ListTasks returns every task of a runbook, ordered by task_key for
// determinism. The result is the task set of the Plan the engine reasons over.
func (s *Store) ListTasks(ctx context.Context, db DBTX, runbookID string) ([]Task, error) {
	rows, err := db.Query(ctx, `SELECT `+taskColumns+`
		FROM dr_studio_task WHERE runbook_id = $1 ORDER BY task_key`, runbookID)
	if err != nil {
		return nil, fmt.Errorf("studio: listing tasks of runbook %s: %w", runbookID, err)
	}
	defer rows.Close()
	var out []Task
	for rows.Next() {
		t, serr := scanTask(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("studio: reading tasks of runbook %s: %w", runbookID, err)
	}
	return out, nil
}

// ListTasksForUpdate reads a runbook's tasks FOR UPDATE so the author-time cycle
// check and the subsequent task insert are serialised against a concurrent task
// add to the same runbook — two simultaneous adds cannot each pass the cycle
// check against a DAG that omits the other's edges. Called inside the service's
// write transaction. It locks the runbook row's tasks; the runbook header row is
// not locked (the cycle test only needs the current task set).
func (s *Store) ListTasksForUpdate(ctx context.Context, db DBTX, runbookID string) ([]Task, error) {
	rows, err := db.Query(ctx, `SELECT `+taskColumns+`
		FROM dr_studio_task WHERE runbook_id = $1 ORDER BY task_key FOR UPDATE`, runbookID)
	if err != nil {
		return nil, fmt.Errorf("studio: locking tasks of runbook %s: %w", runbookID, err)
	}
	defer rows.Close()
	var out []Task
	for rows.Next() {
		t, serr := scanTask(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *t)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("studio: reading locked tasks of runbook %s: %w", runbookID, err)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Run + task-run persistence (dr_studio_run, dr_studio_task_run).
// ---------------------------------------------------------------------------

const runColumns = `id, tenant_id, runbook_id, mode, status, planned_critical_path_seconds,
	started_by, started_at, completed_at, actual_duration_seconds, last_error, claimed_at, updated_at`

func scanRun(row interface{ Scan(...any) error }) (*Run, error) {
	var r Run
	var startedBy, lastError *string
	var completedAt, claimedAt *time.Time
	var actualDur *int
	if err := row.Scan(
		&r.ID, &r.TenantID, &r.RunbookID, &r.Mode, &r.Status, &r.PlannedCriticalPathSeconds,
		&startedBy, &r.StartedAt, &completedAt, &actualDur, &lastError, &claimedAt, &r.UpdatedAt,
	); err != nil {
		return nil, err
	}
	r.StartedBy = startedBy
	r.CompletedAt = completedAt
	r.ActualDurationSeconds = actualDur
	r.LastError = lastError
	r.ClaimedAt = claimedAt
	return &r, nil
}

// CreateRun inserts a run and populates generated fields.
func (s *Store) CreateRun(ctx context.Context, db DBTX, run *Run) error {
	if run.Mode == "" {
		run.Mode = RunModeLive
	}
	if run.Status == "" {
		run.Status = RunStatusRunning
	}
	err := db.QueryRow(ctx, `
		INSERT INTO dr_studio_run (tenant_id, runbook_id, mode, status, planned_critical_path_seconds, started_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, started_at, updated_at`,
		run.TenantID, run.RunbookID, run.Mode, run.Status, run.PlannedCriticalPathSeconds, run.StartedBy,
	).Scan(&run.ID, &run.StartedAt, &run.UpdatedAt)
	if err != nil {
		return fmt.Errorf("studio: creating run: %w", err)
	}
	return nil
}

// GetRun loads one run (RLS-scoped) or ErrNotFound.
func (s *Store) GetRun(ctx context.Context, db DBTX, id string) (*Run, error) {
	run, err := scanRun(db.QueryRow(ctx, `SELECT `+runColumns+` FROM dr_studio_run WHERE id = $1`, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("run %s: %w", id, ErrNotFound)
		}
		return nil, fmt.Errorf("studio: loading run %s: %w", id, err)
	}
	return run, nil
}

// SetRunStatus transitions a run's status, optionally setting completion fields.
// When status is terminal-completed/failed/aborted, completedAt and the actual
// duration are recorded. Returns ErrNotFound when no row matched.
func (s *Store) SetRunStatus(ctx context.Context, db DBTX, id, status string, completedAt *time.Time, actualDur *int, lastError *string) error {
	tag, err := db.Exec(ctx, `
		UPDATE dr_studio_run
		   SET status = $2, completed_at = $3, actual_duration_seconds = $4, last_error = $5, updated_at = now()
		 WHERE id = $1`, id, status, completedAt, actualDur, lastError)
	if err != nil {
		return fmt.Errorf("studio: setting run %s status: %w", id, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("run %s: %w", id, ErrNotFound)
	}
	return nil
}

const taskRunColumns = `id, tenant_id, run_id, task_id, status, acted_by, started_at, finished_at,
	actual_duration_seconds, detail, created_at, updated_at`

func scanTaskRun(row interface{ Scan(...any) error }) (*TaskRun, error) {
	var tr TaskRun
	var actedBy *string
	var startedAt, finishedAt *time.Time
	var actualDur *int
	var detailJSON []byte
	if err := row.Scan(
		&tr.ID, &tr.TenantID, &tr.RunID, &tr.TaskID, &tr.Status, &actedBy,
		&startedAt, &finishedAt, &actualDur, &detailJSON, &tr.CreatedAt, &tr.UpdatedAt,
	); err != nil {
		return nil, err
	}
	tr.ActedBy = actedBy
	tr.StartedAt = startedAt
	tr.FinishedAt = finishedAt
	tr.ActualDurationSeconds = actualDur
	if len(detailJSON) > 0 {
		if err := json.Unmarshal(detailJSON, &tr.Detail); err != nil {
			return nil, fmt.Errorf("studio: unmarshaling task-run detail: %w", err)
		}
	}
	return &tr, nil
}

// CreateTaskRun inserts the per-task execution row for a run (one per task,
// snapshotted at run start). Returns ErrAlreadyExists on the (run,task) unique
// violation.
func (s *Store) CreateTaskRun(ctx context.Context, db DBTX, tr *TaskRun) error {
	if tr.Status == "" {
		tr.Status = TaskRunPending
	}
	detail := tr.Detail
	if detail == nil {
		detail = map[string]any{}
	}
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("studio: marshaling task-run detail: %w", err)
	}
	err = db.QueryRow(ctx, `
		INSERT INTO dr_studio_task_run (tenant_id, run_id, task_id, status, detail)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at, updated_at`,
		tr.TenantID, tr.RunID, tr.TaskID, tr.Status, detailJSON,
	).Scan(&tr.ID, &tr.CreatedAt, &tr.UpdatedAt)
	if err != nil {
		if isUniqueViolation(err) {
			return fmt.Errorf("task-run for task %s: %w", tr.TaskID, ErrAlreadyExists)
		}
		if isForeignKeyViolation(err) {
			return fmt.Errorf("task-run for task %s: %w", tr.TaskID, ErrNotFound)
		}
		return fmt.Errorf("studio: creating task-run: %w", err)
	}
	return nil
}

// ListTaskRuns returns every per-task execution row for a run, ordered by task_id.
func (s *Store) ListTaskRuns(ctx context.Context, db DBTX, runID string) ([]TaskRun, error) {
	rows, err := db.Query(ctx, `SELECT `+taskRunColumns+`
		FROM dr_studio_task_run WHERE run_id = $1 ORDER BY task_id`, runID)
	if err != nil {
		return nil, fmt.Errorf("studio: listing task-runs of run %s: %w", runID, err)
	}
	defer rows.Close()
	var out []TaskRun
	for rows.Next() {
		tr, serr := scanTaskRun(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *tr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("studio: reading task-runs of run %s: %w", runID, err)
	}
	return out, nil
}

// ListTaskRunsForUpdate reads a run's task-runs FOR UPDATE so a task action
// (complete/skip/fail) is serialised against a concurrent action on the same run
// — the frontier recompute and the run-completion decision see a consistent
// snapshot. Called inside the service's write transaction.
func (s *Store) ListTaskRunsForUpdate(ctx context.Context, db DBTX, runID string) ([]TaskRun, error) {
	rows, err := db.Query(ctx, `SELECT `+taskRunColumns+`
		FROM dr_studio_task_run WHERE run_id = $1 ORDER BY task_id FOR UPDATE`, runID)
	if err != nil {
		return nil, fmt.Errorf("studio: locking task-runs of run %s: %w", runID, err)
	}
	defer rows.Close()
	var out []TaskRun
	for rows.Next() {
		tr, serr := scanTaskRun(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *tr)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("studio: reading locked task-runs of run %s: %w", runID, err)
	}
	return out, nil
}

// UpdateTaskRunStatus transitions a single task-run's status and acting metadata.
// startedAt is set when transitioning into a running state; finishedAt and the
// actual duration are set on a terminal transition. detail is merged-replaced.
// Returns ErrNotFound when no row matched.
func (s *Store) UpdateTaskRunStatus(ctx context.Context, db DBTX, runID, taskID, status string, actedBy *string, startedAt, finishedAt *time.Time, actualDur *int, detail map[string]any) error {
	if detail == nil {
		detail = map[string]any{}
	}
	detailJSON, err := json.Marshal(detail)
	if err != nil {
		return fmt.Errorf("studio: marshaling task-run detail: %w", err)
	}
	tag, err := db.Exec(ctx, `
		UPDATE dr_studio_task_run
		   SET status = $3,
		       acted_by = COALESCE($4, acted_by),
		       started_at = COALESCE($5, started_at),
		       finished_at = $6,
		       actual_duration_seconds = $7,
		       detail = $8,
		       updated_at = now()
		 WHERE run_id = $1 AND task_id = $2`,
		runID, taskID, status, actedBy, startedAt, finishedAt, actualDur, detailJSON)
	if err != nil {
		return fmt.Errorf("studio: updating task-run (%s,%s): %w", runID, taskID, err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("task-run (%s,%s): %w", runID, taskID, ErrNotFound)
	}
	return nil
}

// SystemListActiveRuns returns every non-terminal run (pending|running) ACROSS
// ALL TENANTS, oldest first, for the leader-singleton projection loop. It reads
// without a tenant filter.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (dr_db §7).
// Only the leader-singleton projection Loop may call this; never the request
// path.
func (s *Store) SystemListActiveRuns(ctx context.Context, db DBTX) ([]Run, error) {
	rows, err := db.Query(ctx, `SELECT `+runColumns+`
		FROM dr_studio_run WHERE status IN ('pending','running') ORDER BY started_at`)
	if err != nil {
		return nil, fmt.Errorf("studio: system listing active runs: %w", err)
	}
	defer rows.Close()
	var out []Run
	for rows.Next() {
		r, serr := scanRun(rows)
		if serr != nil {
			return nil, serr
		}
		out = append(out, *r)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("studio: reading active runs: %w", err)
	}
	return out, nil
}

// SystemGetPlan loads a run's runbook + tasks WITHOUT a tenant filter, for the
// projection loop which iterates runs across tenants.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (dr_db §7).
func (s *Store) SystemGetPlan(ctx context.Context, db DBTX, runbookID string) (Plan, error) {
	rb, err := s.GetRunbook(ctx, db, runbookID)
	if err != nil {
		return Plan{}, err
	}
	tasks, terr := s.ListTasks(ctx, db, runbookID)
	if terr != nil {
		return Plan{}, terr
	}
	return Plan{Runbook: *rb, Tasks: tasks}, nil
}

// BulkSetTaskRunStatus sets the status of MANY task-runs of a run in one
// statement (used to mark the frontier RUNNABLE after an action, and to mark
// downstream tasks BLOCKED). taskIDs that are not part of the run are ignored. It
// only moves rows currently in one of fromStatuses (so it never clobbers a
// terminal or running state). Returns the number of rows updated.
func (s *Store) BulkSetTaskRunStatus(ctx context.Context, db DBTX, runID string, taskIDs []string, toStatus string, fromStatuses []string) (int64, error) {
	if len(taskIDs) == 0 {
		return 0, nil
	}
	tag, err := db.Exec(ctx, `
		UPDATE dr_studio_task_run
		   SET status = $3, updated_at = now()
		 WHERE run_id = $1
		   AND task_id = ANY($2)
		   AND status = ANY($4)`,
		runID, taskIDs, toStatus, fromStatuses)
	if err != nil {
		return 0, fmt.Errorf("studio: bulk setting task-run status for run %s: %w", runID, err)
	}
	return tag.RowsAffected(), nil
}
