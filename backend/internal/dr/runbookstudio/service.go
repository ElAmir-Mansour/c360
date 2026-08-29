package runbookstudio

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service"

// Event types this package stages on the shared datastream.dr.events topic
// (DESIGN §8). They are this package's OWN dr.<feature>.* types, distinct from
// the registry/topology types, so they never trigger another package's reconcile.
const (
	eventRunbookCreated = "com.clario360.datastream.dr.studio.runbook.created"
	eventRunStarted     = "com.clario360.datastream.dr.studio.run.started"
	eventTaskCompleted  = "com.clario360.datastream.dr.studio.task.completed"
	eventTaskFailed     = "com.clario360.datastream.dr.studio.task.failed"
	eventRunFinished    = "com.clario360.datastream.dr.studio.run.finished"
)

// Executor runs an AUTOMATED task's registered action. It is the integration
// seam: production wires a real action dispatcher (script/runbook-action runner);
// tests substitute a fake that records the call. Ensure-style idempotency is the
// caller's concern — Run is invoked once per automated task per run, inside the
// task action handler. A non-nil error fails the task.
type Executor interface {
	// Run executes the named action with the task's params for a given run/task,
	// returning a structured outcome recorded on the task-run detail. The context
	// carries deadlines/cancellation from the request or projection loop.
	Run(ctx context.Context, action string, in ExecutorInput) (ExecutorOutcome, error)
}

// ExecutorInput is the immutable context an automated action receives.
type ExecutorInput struct {
	TenantID  string
	RunID     string
	TaskID    string
	TaskKey   string
	RunbookID string
	GroupID   string
	RunMode   string
	ActedBy   *string
	Params    map[string]any
}

// ExecutorOutcome is the structured result recorded on the task-run detail.
type ExecutorOutcome struct {
	// ExternalID identifies any resource the action created (for idempotent
	// re-runs / auditing).
	ExternalID string         `json:"external_id,omitempty"`
	Message    string         `json:"message,omitempty"`
	Data       map[string]any `json:"data,omitempty"`
}

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// storeAPI is the persistence surface the service needs. *Store satisfies it;
// tests substitute an in-memory fake so the orchestration logic is exercised
// without a database while the engine algorithms are tested directly.
type storeAPI interface {
	GroupExists(ctx context.Context, db DBTX, groupID string) (bool, error)
	CreateRunbook(ctx context.Context, db DBTX, rb *Runbook) error
	GetRunbook(ctx context.Context, db DBTX, id string) (*Runbook, error)
	UpdateRunbook(ctx context.Context, db DBTX, id, name, description, status string) (*Runbook, error)
	CreateTask(ctx context.Context, db DBTX, t *Task) error
	ListTasks(ctx context.Context, db DBTX, runbookID string) ([]Task, error)
	ListTasksForUpdate(ctx context.Context, db DBTX, runbookID string) ([]Task, error)
	CreateRun(ctx context.Context, db DBTX, run *Run) error
	GetRun(ctx context.Context, db DBTX, id string) (*Run, error)
	SetRunStatus(ctx context.Context, db DBTX, id, status string, completedAt *time.Time, actualDur *int, lastError *string) error
	CreateTaskRun(ctx context.Context, db DBTX, tr *TaskRun) error
	ListTaskRuns(ctx context.Context, db DBTX, runID string) ([]TaskRun, error)
	ListTaskRunsForUpdate(ctx context.Context, db DBTX, runID string) ([]TaskRun, error)
	UpdateTaskRunStatus(ctx context.Context, db DBTX, runID, taskID, status string, actedBy *string, startedAt, finishedAt *time.Time, actualDur *int, detail map[string]any) error
	BulkSetTaskRunStatus(ctx context.Context, db DBTX, runID string, taskIDs []string, toStatus string, fromStatuses []string) (int64, error)
}

// txRunner runs a function inside a tenant-scoped or system transaction, mirroring
// the topology package. Request paths commit state + outbox atomically under the
// tenant; the projection loop uses RunSystem (cross-tenant).
type txRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error
	RunSystem(ctx context.Context, fn func(DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(DBTX) error) error
}

// PGXRunner adapts a *pgxpool.Pool to txRunner using the platform's tenant and
// system transaction helpers.
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

// RunSystem runs fn in a read-write system transaction (RLS bypassed).
func (r PGXRunner) RunSystem(ctx context.Context, fn func(DBTX) error) error {
	return database.RunSystemTx(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// RunSystemRead runs fn in a read-only system transaction (RLS bypassed).
func (r PGXRunner) RunSystemRead(ctx context.Context, fn func(DBTX) error) error {
	return database.RunSystemRead(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// eventStager stages a lifecycle event in the caller's transaction. The default
// writes to the transactional outbox so the event commits atomically with the
// studio write.
type eventStager interface {
	Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error
}

type outboxStager struct{}

func (outboxStager) Stage(ctx context.Context, tx DBTX, eventType, tenantID string, data map[string]any) error {
	evt, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("studio: building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, tx, events.Topics.DREvents, evt)
}

// Service is the Runbook Studio orchestration service: authoring runbooks and
// tasks (with author-time cycle rejection), importing a registry-generated step
// list as an editable template, starting live runs, computing the runnable
// frontier / critical-path projection, and driving task actions (manual
// complete/skip/fail, automated execution via the Executor, approval gates). The
// graph algorithms themselves live in engine.go as pure functions; this type
// wires persistence, transactions, events, the executor, and metrics around them.
type Service struct {
	store    storeAPI
	runner   txRunner
	stager   eventStager
	executor Executor
	metrics  *Metrics
	now      func() time.Time
	logger   zerolog.Logger
}

// Config wires a Service.
type Config struct {
	Store  storeAPI
	Runner txRunner
	// Stager is optional; defaults to the transactional-outbox stager.
	Stager eventStager
	// Executor drives AUTOMATED tasks; optional (automated tasks fail with
	// ErrNoExecutor when unset).
	Executor Executor
	Metrics  *Metrics
	// Now is optional; defaults to time.Now. Injected for deterministic tests.
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewService constructs a Service. Store and Runner are required.
func NewService(cfg Config) (*Service, error) {
	if cfg.Store == nil {
		return nil, errors.New("studio service: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("studio service: runner is required")
	}
	stager := cfg.Stager
	if stager == nil {
		stager = outboxStager{}
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:    cfg.Store,
		runner:   cfg.Runner,
		stager:   stager,
		executor: cfg.Executor,
		metrics:  cfg.Metrics,
		now:      now,
		logger:   cfg.Logger,
	}, nil
}

// ---------------------------------------------------------------------------
// Authoring.
// ---------------------------------------------------------------------------

// CreateRunbookInput is the request to author a new runbook.
type CreateRunbookInput struct {
	Name        string
	Description string
	GroupID     string // optional binding to a consistency group
	CreatedBy   *string
	// ImportSteps, when non-empty, materializes the runbook from a
	// registry-generated step list (the import-as-template path). Each step becomes
	// an editable task; the ordered list is chained into a linear predecessor DAG
	// preserving the registry order so the imported runbook runs in sequence by
	// default. The operator can then re-wire predecessors freely.
	ImportSteps []ImportStep
}

// ImportStep is one registry-generated step accepted by the import path. It maps
// the registry's RunbookStep shape (key/title/description/kind/params) onto a
// studio task without this package importing the registry package (disjoint
// ownership): the caller (or the handler) projects a registry version's steps
// into this neutral shape.
type ImportStep struct {
	Key              string
	Name             string
	TaskType         string // mapped from the registry step kind; defaults to manual
	Required         bool
	Owner            string
	Team             string
	Instructions     string
	PlannedDuration  int
	AutomationAction string
	Params           map[string]any
}

// CreateRunbook authors a new runbook. When ImportSteps is supplied the runbook is
// materialized from those steps as an editable starting template (source
// 'registry'): each step becomes a task and the steps are chained into a linear
// predecessor DAG in the given order. The whole operation — runbook row, every
// task, the lifecycle event — runs in ONE tenant transaction so a failure leaves
// nothing behind. The materialized task DAG is validated for acyclicity before
// commit (a linear chain is trivially acyclic, but validating is the invariant).
func (s *Service) CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateRunbookInput) (*Runbook, []Task, error) {
	if in.Name == "" {
		return nil, nil, fmt.Errorf("runbook name is required: %w", ErrInvalidStatus)
	}
	for i := range in.ImportSteps {
		st := &in.ImportSteps[i]
		if st.TaskType == "" {
			st.TaskType = TaskTypeManual
		}
		if !ValidTaskType(st.TaskType) {
			return nil, nil, fmt.Errorf("import step %q: %w", st.Key, ErrInvalidTaskType)
		}
	}

	var rb *Runbook
	var tasks []Task
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		var groupID *string
		if in.GroupID != "" {
			ok, gerr := s.store.GroupExists(ctx, tx, in.GroupID)
			if gerr != nil {
				return gerr
			}
			if !ok {
				return fmt.Errorf("group %s: %w", in.GroupID, ErrGroupNotFound)
			}
			gid := in.GroupID
			groupID = &gid
		}

		source := SourceAuthored
		if len(in.ImportSteps) > 0 {
			source = SourceRegistry
		}
		rb = &Runbook{
			TenantID:    tenantID.String(),
			GroupID:     groupID,
			Name:        in.Name,
			Description: in.Description,
			Status:      RunbookStatusDraft,
			Source:      source,
			CreatedBy:   in.CreatedBy,
		}
		if cerr := s.store.CreateRunbook(ctx, tx, rb); cerr != nil {
			return cerr
		}

		// Materialize imported steps as a linear-chain task DAG (each task depends on
		// the previous one), preserving the registry order. The previous task's UUID
		// is captured AFTER its insert so the chain references real IDs.
		var prevID string
		for _, st := range in.ImportSteps {
			t := &Task{
				TenantID:               tenantID.String(),
				RunbookID:              rb.ID,
				TaskKey:                st.Key,
				Name:                   st.Name,
				TaskType:               st.TaskType,
				Required:               st.Required,
				Owner:                  st.Owner,
				Team:                   st.Team,
				Instructions:           st.Instructions,
				PlannedDurationSeconds: st.PlannedDuration,
				AutomationAction:       st.AutomationAction,
				Params:                 st.Params,
			}
			if prevID != "" {
				t.Predecessors = []string{prevID}
			}
			if cerr := s.store.CreateTask(ctx, tx, t); cerr != nil {
				return cerr
			}
			tasks = append(tasks, *t)
			prevID = t.ID
		}

		// Validate the materialized DAG (acyclic, predecessors present). A linear
		// chain always passes, but the invariant is enforced uniformly.
		if verr := (Plan{Runbook: *rb, Tasks: tasks}).Validate(); verr != nil {
			return verr
		}

		return s.stager.Stage(ctx, tx, eventRunbookCreated, tenantID.String(), map[string]any{
			"runbook_id": rb.ID,
			"name":       rb.Name,
			"source":     rb.Source,
			"task_count": len(tasks),
		})
	})
	if err != nil {
		return nil, nil, err
	}
	s.metrics.observeRunbookCreated()
	for range tasks {
		s.metrics.observeTaskCreated()
	}
	return rb, tasks, nil
}

// GetRunbook returns a runbook plus its full task set (the Plan).
func (s *Service) GetRunbook(ctx context.Context, tenantID uuid.UUID, runbookID string) (Plan, error) {
	var plan Plan
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		rb, gerr := s.store.GetRunbook(ctx, tx, runbookID)
		if gerr != nil {
			return gerr
		}
		tasks, terr := s.store.ListTasks(ctx, tx, runbookID)
		if terr != nil {
			return terr
		}
		plan = Plan{Runbook: *rb, Tasks: tasks}
		return nil
	})
	if err != nil {
		return Plan{}, err
	}
	return plan, nil
}

// UpdateRunbookInput edits a runbook's header.
type UpdateRunbookInput struct {
	Name        string
	Description string
	Status      string
}

// UpdateRunbook edits a runbook's header (name/description/status). Status must be
// a valid authoring status.
func (s *Service) UpdateRunbook(ctx context.Context, tenantID uuid.UUID, runbookID string, in UpdateRunbookInput) (*Runbook, error) {
	if in.Status != "" && !ValidRunbookStatus(in.Status) {
		return nil, fmt.Errorf("status %q: %w", in.Status, ErrInvalidStatus)
	}
	var rb *Runbook
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		existing, gerr := s.store.GetRunbook(ctx, tx, runbookID)
		if gerr != nil {
			return gerr
		}
		name := in.Name
		if name == "" {
			name = existing.Name
		}
		desc := in.Description
		status := in.Status
		if status == "" {
			status = existing.Status
		}
		var uerr error
		rb, uerr = s.store.UpdateRunbook(ctx, tx, runbookID, name, desc, status)
		return uerr
	})
	if err != nil {
		return nil, err
	}
	return rb, nil
}

// AddTaskInput is the request to author a task on a runbook. Predecessors are
// existing task IDs of the same runbook.
type AddTaskInput struct {
	TaskKey          string
	Name             string
	TaskType         string
	Required         *bool // defaults to true
	Owner            string
	Team             string
	Instructions     string
	PlannedDuration  int
	AutomationAction string
	Predecessors     []string
	Params           map[string]any
}

// AddTask authors a task on a runbook after proving the resulting task DAG stays
// acyclic. The whole operation — lock the runbook's tasks, build the plan with the
// proposed task, validate (cycle / unknown predecessor), insert — runs in ONE
// tenant transaction, so a rejected cycle leaves the runbook untouched. ErrCycle
// (409) when the predecessors would close a loop; ErrUnknownPredecessor (400)
// when a predecessor is not a task of this runbook; ErrInvalidTaskType (400) on a
// bad type.
func (s *Service) AddTask(ctx context.Context, tenantID uuid.UUID, runbookID string, in AddTaskInput) (*Task, error) {
	if in.TaskKey == "" || in.Name == "" {
		return nil, fmt.Errorf("task_key and name are required: %w", ErrInvalidStatus)
	}
	if in.TaskType == "" {
		in.TaskType = TaskTypeManual
	}
	if !ValidTaskType(in.TaskType) {
		return nil, fmt.Errorf("type %q: %w", in.TaskType, ErrInvalidTaskType)
	}
	required := true
	if in.Required != nil {
		required = *in.Required
	}
	if in.PlannedDuration < 0 {
		return nil, fmt.Errorf("planned_duration must be >= 0: %w", ErrInvalidStatus)
	}

	var stored *Task
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, gerr := s.store.GetRunbook(ctx, tx, runbookID); gerr != nil {
			return gerr
		}
		// Lock the runbook's tasks so a concurrent add is serialised.
		existing, lerr := s.store.ListTasksForUpdate(ctx, tx, runbookID)
		if lerr != nil {
			return lerr
		}

		// Every declared predecessor must be an existing task of THIS runbook.
		ids := make(map[string]bool, len(existing))
		for _, t := range existing {
			ids[t.ID] = true
		}
		for _, pre := range in.Predecessors {
			if !ids[pre] {
				return ErrUnknownPredecessor
			}
		}

		// Build the proposed task with a provisional ID so the cycle check sees the
		// complete graph-plus-proposed-task. The provisional ID is replaced by the DB
		// id on insert; it is unique so it cannot collide with a real predecessor.
		provisional := "proposed:" + uuid.NewString()
		proposed := Task{
			ID:                     provisional,
			RunbookID:              runbookID,
			TaskKey:                in.TaskKey,
			Name:                   in.Name,
			TaskType:               in.TaskType,
			PlannedDurationSeconds: in.PlannedDuration,
			Predecessors:           append([]string(nil), in.Predecessors...),
		}
		plan := Plan{Tasks: append(append([]Task(nil), existing...), proposed)}
		if verr := plan.Validate(); verr != nil {
			if errors.Is(verr, ErrCycle) {
				s.metrics.observeCycleRejected()
			}
			return verr
		}

		stored = &Task{
			TenantID:               tenantID.String(),
			RunbookID:              runbookID,
			TaskKey:                in.TaskKey,
			Name:                   in.Name,
			TaskType:               in.TaskType,
			Required:               required,
			Owner:                  in.Owner,
			Team:                   in.Team,
			Instructions:           in.Instructions,
			PlannedDurationSeconds: in.PlannedDuration,
			AutomationAction:       in.AutomationAction,
			Predecessors:           append([]string(nil), in.Predecessors...),
			Params:                 in.Params,
		}
		return s.store.CreateTask(ctx, tx, stored)
	})
	if err != nil {
		return nil, err
	}
	s.metrics.observeTaskCreated()
	return stored, nil
}

// ---------------------------------------------------------------------------
// Live run engine.
// ---------------------------------------------------------------------------

// StartRunInput starts a live run of a runbook.
type StartRunInput struct {
	Mode      string // live | rehearsal; defaults to live
	StartedBy *string
}

// StartRun starts a live run: it snapshots the runbook's task DAG into per-task
// execution rows, computes and pins the planned critical path, marks the initial
// frontier RUNNABLE, and stages the run-started event — all in ONE tenant
// transaction. ErrEmptyRunbook when the runbook has no tasks; ErrCycle if the
// (already-persisted) DAG is somehow cyclic (defence in depth — AddTask prevents
// it). Returns the run and its initial live state.
func (s *Service) StartRun(ctx context.Context, tenantID uuid.UUID, runbookID string, in StartRunInput) (LiveState, error) {
	mode := in.Mode
	if mode == "" {
		mode = RunModeLive
	}
	if mode != RunModeLive && mode != RunModeRehearsal {
		return LiveState{}, fmt.Errorf("mode %q: %w", mode, ErrInvalidStatus)
	}

	var state LiveState
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		rb, gerr := s.store.GetRunbook(ctx, tx, runbookID)
		if gerr != nil {
			return gerr
		}
		tasks, terr := s.store.ListTasks(ctx, tx, runbookID)
		if terr != nil {
			return terr
		}
		if len(tasks) == 0 {
			return ErrEmptyRunbook
		}
		plan := Plan{Runbook: *rb, Tasks: tasks}
		if verr := plan.Validate(); verr != nil {
			return verr
		}

		cp := plan.CriticalPath()
		run := &Run{
			TenantID:                   tenantID.String(),
			RunbookID:                  runbookID,
			Mode:                       mode,
			Status:                     RunStatusRunning,
			PlannedCriticalPathSeconds: cp.TotalSeconds,
			StartedBy:                  in.StartedBy,
		}
		if cerr := s.store.CreateRun(ctx, tx, run); cerr != nil {
			return cerr
		}

		// Snapshot every task as a pending execution row.
		for _, t := range tasks {
			tr := &TaskRun{
				TenantID: tenantID.String(),
				RunID:    run.ID,
				TaskID:   t.ID,
				Status:   TaskRunPending,
			}
			if cerr := s.store.CreateTaskRun(ctx, tx, tr); cerr != nil {
				return cerr
			}
		}

		// Compute the initial frontier (root tasks: no predecessors) and mark those
		// runnable. We auto-advance milestones whose predecessors are already met
		// (root milestones complete immediately) before recomputing.
		rs := NewRunState(plan, nil)
		if aerr := s.advanceAutoTasks(ctx, tx, run.ID, plan, rs, in.StartedBy); aerr != nil {
			return aerr
		}
		frontier := rs.Frontier()
		if _, berr := s.store.BulkSetTaskRunStatus(ctx, tx, run.ID, frontier, TaskRunRunnable, []string{TaskRunPending}); berr != nil {
			return berr
		}

		if serr := s.stager.Stage(ctx, tx, eventRunStarted, tenantID.String(), map[string]any{
			"run_id":                run.ID,
			"runbook_id":            runbookID,
			"mode":                  mode,
			"planned_critical_path": cp.TotalSeconds,
			"task_count":            len(tasks),
		}); serr != nil {
			return serr
		}

		// Decide the run's outcome at birth: a runbook whose required work is already
		// satisfied once root milestones auto-complete (e.g. an all-milestone runbook)
		// must be finalised here — the request-driven action path never fires (nothing
		// is on the frontier) and the reconcile loop only fails stalls, never
		// completes. A zero action never sets explicitFailRun, and for a normal
		// runbook the frontier is non-empty so the run is left RUNNING.
		if derr := s.decideRunOutcome(ctx, tx, tenantID, run, rs, s.now(), ActOnTaskInput{}); derr != nil {
			return derr
		}

		// Build the returned live state from the in-tx values.
		var lerr error
		state, lerr = s.assembleState(ctx, tx, run.ID, plan)
		return lerr
	})
	if err != nil {
		return LiveState{}, err
	}
	s.metrics.observeRunStarted(mode)
	s.metrics.observeFrontier(state.Run.ID, len(state.Frontier))
	if RunTerminal(state.Run.Status) {
		s.metrics.observeRunFinished(state.Run.Status)
	}
	return state, nil
}

// GetRun returns the live state of a run: the run, its tasks, every task-run, the
// current runnable frontier, and the elapsed-vs-planned projection.
func (s *Service) GetRun(ctx context.Context, tenantID uuid.UUID, runID string) (LiveState, error) {
	var state LiveState
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		run, gerr := s.store.GetRun(ctx, tx, runID)
		if gerr != nil {
			return gerr
		}
		tasks, terr := s.store.ListTasks(ctx, tx, run.RunbookID)
		if terr != nil {
			return terr
		}
		var aerr error
		state, aerr = s.assembleStateWithRun(ctx, tx, *run, Plan{Tasks: tasks})
		return aerr
	})
	if err != nil {
		return LiveState{}, err
	}
	return state, nil
}

// TaskAction is the kind of action an operator/automation takes on a task.
type TaskAction string

const (
	// ActionComplete marks a task complete (manual/comms/milestone) or runs the
	// Executor (automated) and marks it complete on success.
	ActionComplete TaskAction = "complete"
	// ActionSkip skips a task (complete-equivalent for the frontier but not a
	// required completion).
	ActionSkip TaskAction = "skip"
	// ActionFail fails a task. If the task is required, the run fails.
	ActionFail TaskAction = "fail"
)

// ActOnTaskInput parameterises a task action.
type ActOnTaskInput struct {
	Action  TaskAction
	ActedBy *string
	// Note / FailureReason / approval note recorded on the task-run detail.
	Note string
	// FailRun, when true on an ActionFail of a NON-required task, still fails the
	// whole run (operator escalation). Required-task failures always fail the run.
	FailRun bool
}

// ActOnTask applies an operator/automation action to a task of a live run, then
// recomputes the runnable frontier and the run-completion decision — the core of
// the live engine. It runs in ONE tenant transaction with the task-runs locked so
// concurrent actions are serialised:
//
//  1. Load the run (must be active), its plan, and the locked task-runs.
//  2. Reject the action if the task is not on the current runnable frontier
//     (predecessors incomplete) — ErrTaskNotRunnable.
//  3. ActionComplete on an AUTOMATED task drives the Executor; a non-nil error
//     fails the task (and the run if required). On success the task is complete.
//  4. Recompute the frontier over the new statuses, mark newly-runnable tasks
//     RUNNABLE and newly-blocked tasks BLOCKED.
//  5. Decide run completion: all required complete -> COMPLETED; a required task
//     failed or the run stalled -> FAILED.
//
// The Executor is invoked INSIDE the transaction so the task-run row, the run
// status, and the lifecycle event commit atomically with the automation outcome.
func (s *Service) ActOnTask(ctx context.Context, tenantID uuid.UUID, runID, taskID string, in ActOnTaskInput) (LiveState, error) {
	switch in.Action {
	case ActionComplete, ActionSkip, ActionFail:
	default:
		return LiveState{}, fmt.Errorf("action %q: %w", in.Action, ErrInvalidStatus)
	}

	var state LiveState
	var automationOutcome string
	err := s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		run, gerr := s.store.GetRun(ctx, tx, runID)
		if gerr != nil {
			return gerr
		}
		rb, rberr := s.store.GetRunbook(ctx, tx, run.RunbookID)
		if rberr != nil {
			return rberr
		}
		if RunTerminal(run.Status) {
			return ErrRunNotActive
		}
		tasks, terr := s.store.ListTasks(ctx, tx, run.RunbookID)
		if terr != nil {
			return terr
		}

		taskRuns, lerr := s.store.ListTaskRunsForUpdate(ctx, tx, runID)
		if lerr != nil {
			return lerr
		}
		// Reason over the DAG SNAPSHOTTED at run start (the tasks that have an
		// execution row), never the runbook's CURRENT tasks: a task authored after
		// this run started has no task-run row and must not perturb this run's
		// frontier or completion decision (the migration's snapshot contract).
		plan := Plan{Runbook: *rb, Tasks: snapshotTasks(tasks, taskRuns)}
		statuses := make(map[string]string, len(taskRuns))
		for _, tr := range taskRuns {
			statuses[tr.TaskID] = tr.Status
		}
		rs := NewRunState(plan, statuses)

		task, ok := planTask(plan, taskID)
		if !ok {
			return fmt.Errorf("task %s: %w", taskID, ErrNotFound)
		}

		// The task must be on the current runnable frontier.
		if !onFrontier(rs.Frontier(), taskID) {
			return ErrTaskNotRunnable
		}

		now := s.now()
		var newStatus string
		detail := map[string]any{}
		if in.Note != "" {
			detail["note"] = in.Note
		}

		// An APPROVAL_GATE is signed off via ActionComplete, but it requires a known
		// approver identity (the sign-off is attributable). A skip/fail of a gate is
		// allowed (an operator can skip an unneeded gate or fail the run at it).
		if task.TaskType == TaskTypeApprovalGate && in.Action == ActionComplete && in.ActedBy == nil {
			return ErrApprovalRequired
		}

		switch in.Action {
		case ActionComplete:
			if task.TaskType == TaskTypeAutomated {
				if s.executor == nil {
					return ErrNoExecutor
				}
				// Mark running so the row reflects in-flight automation, then invoke.
				if uerr := s.store.UpdateTaskRunStatus(ctx, tx, runID, taskID, TaskRunRunning, in.ActedBy, &now, nil, nil, detail); uerr != nil {
					return uerr
				}
				outcome, rerr := s.executor.Run(ctx, task.AutomationAction, ExecutorInput{
					TenantID:  tenantID.String(),
					RunID:     runID,
					TaskID:    taskID,
					TaskKey:   task.TaskKey,
					RunbookID: run.RunbookID,
					GroupID:   stringValue(rb.GroupID),
					RunMode:   run.Mode,
					ActedBy:   in.ActedBy,
					Params:    task.Params,
				})
				if rerr != nil {
					automationOutcome = "failure"
					detail["error"] = rerr.Error()
					newStatus = TaskRunFailed
				} else {
					automationOutcome = "success"
					detail["external_id"] = outcome.ExternalID
					detail["message"] = outcome.Message
					if outcome.Data != nil {
						detail["data"] = outcome.Data
					}
					newStatus = TaskRunComplete
				}
			} else {
				newStatus = TaskRunComplete
			}
		case ActionSkip:
			newStatus = TaskRunSkipped
		case ActionFail:
			newStatus = TaskRunFailed
		}

		// Persist the acted task's terminal state with duration.
		dur := durationSeconds(run.StartedAt, now, taskRunStartedAt(taskRuns, taskID), now)
		if perr := s.store.UpdateTaskRunStatus(ctx, tx, runID, taskID, newStatus, in.ActedBy, &now, &now, &dur, detail); perr != nil {
			return perr
		}
		statuses[taskID] = newStatus
		rs = NewRunState(plan, statuses)

		// Auto-advance milestones now unblocked, then recompute the frontier.
		if aerr := s.advanceAutoTasks(ctx, tx, runID, plan, rs, in.ActedBy); aerr != nil {
			return aerr
		}

		frontier := rs.Frontier()
		if _, berr := s.store.BulkSetTaskRunStatus(ctx, tx, runID, frontier, TaskRunRunnable, []string{TaskRunPending}); berr != nil {
			return berr
		}
		// Mark newly-blocked tasks (downstream of a failure) BLOCKED.
		blocked := rs.Blocked()
		if _, berr := s.store.BulkSetTaskRunStatus(ctx, tx, runID, blocked, TaskRunBlocked, []string{TaskRunPending, TaskRunRunnable}); berr != nil {
			return berr
		}

		// Decide run completion.
		if derr := s.decideRunOutcome(ctx, tx, tenantID, run, rs, now, in); derr != nil {
			return derr
		}

		// Reload the run for the returned state (status may have changed).
		updatedRun, rerr := s.store.GetRun(ctx, tx, runID)
		if rerr != nil {
			return rerr
		}
		var serr error
		state, serr = s.assembleStateWithRun(ctx, tx, *updatedRun, plan)
		return serr
	})
	if err != nil {
		return LiveState{}, err
	}
	s.metrics.observeTaskAction(string(in.Action), taskTypeOf(state.Tasks, taskID))
	if automationOutcome != "" {
		s.metrics.observeAutomation(automationOutcome)
	}
	s.metrics.observeFrontier(state.Run.ID, len(state.Frontier))
	if RunTerminal(state.Run.Status) {
		s.metrics.observeRunFinished(state.Run.Status)
	}
	return state, nil
}

// decideRunOutcome transitions the run to a terminal status when warranted: a
// required task failed -> FAILED; the run stalled (no frontier, required work
// outstanding) -> FAILED; all required tasks complete -> COMPLETED. It stages the
// run-finished event in the same transaction. A still-progressing run is left
// RUNNING.
func (s *Service) decideRunOutcome(ctx context.Context, tx DBTX, tenantID uuid.UUID, run *Run, rs RunState, now time.Time, in ActOnTaskInput) error {
	explicitFailRun := in.Action == ActionFail && in.FailRun

	switch {
	case rs.HasFailedRequired() || explicitFailRun || rs.Stalled():
		dur := int(now.Sub(run.StartedAt).Seconds())
		reason := "a required task failed"
		if explicitFailRun {
			reason = "operator failed the run"
		} else if rs.Stalled() && !rs.HasFailedRequired() {
			reason = "run stalled: no runnable tasks and required work outstanding"
		}
		if serr := s.store.SetRunStatus(ctx, tx, run.ID, RunStatusFailed, &now, &dur, &reason); serr != nil {
			return serr
		}
		return s.stager.Stage(ctx, tx, eventRunFinished, tenantID.String(), map[string]any{
			"run_id": run.ID, "runbook_id": run.RunbookID, "status": RunStatusFailed, "reason": reason,
		})
	case rs.AllRequiredDone():
		dur := int(now.Sub(run.StartedAt).Seconds())
		if serr := s.store.SetRunStatus(ctx, tx, run.ID, RunStatusCompleted, &now, &dur, nil); serr != nil {
			return serr
		}
		return s.stager.Stage(ctx, tx, eventRunFinished, tenantID.String(), map[string]any{
			"run_id": run.ID, "runbook_id": run.RunbookID, "status": RunStatusCompleted,
			"actual_duration_seconds": dur,
		})
	default:
		return nil // still running
	}
}

// advanceAutoTasks auto-completes MILESTONE tasks whose predecessors are all
// complete-equivalent (a milestone is a zero-work phase marker; it should not
// require a human click). It loops to a fixed point because completing one
// milestone can unblock another. Approval-gate and other types are never
// auto-advanced. The provided RunState's TaskStatus map is mutated in place to
// reflect the auto-completions.
func (s *Service) advanceAutoTasks(ctx context.Context, tx DBTX, runID string, plan Plan, rs RunState, actedBy *string) error {
	for {
		advanced := false
		for _, t := range plan.Tasks {
			if t.TaskType != TaskTypeMilestone {
				continue
			}
			if TaskRunTerminal(rs.TaskStatus[t.ID]) || rs.TaskStatus[t.ID] == TaskRunRunning {
				continue
			}
			if rs.predecessorFailed(t) {
				continue
			}
			if !rs.predecessorsComplete(t) {
				continue
			}
			now := s.now()
			zero := 0
			if uerr := s.store.UpdateTaskRunStatus(ctx, tx, runID, t.ID, TaskRunComplete, actedBy, &now, &now, &zero, map[string]any{"auto": "milestone"}); uerr != nil {
				return uerr
			}
			rs.TaskStatus[t.ID] = TaskRunComplete
			advanced = true
		}
		if !advanced {
			return nil
		}
	}
}

// assembleState reads the run and assembles its live state (within a tx).
func (s *Service) assembleState(ctx context.Context, tx DBTX, runID string, plan Plan) (LiveState, error) {
	run, err := s.store.GetRun(ctx, tx, runID)
	if err != nil {
		return LiveState{}, err
	}
	return s.assembleStateWithRun(ctx, tx, *run, plan)
}

// assembleStateWithRun assembles the live state from a known run + plan, reading
// the current task-runs and computing the frontier + projection.
func (s *Service) assembleStateWithRun(ctx context.Context, tx DBTX, run Run, plan Plan) (LiveState, error) {
	taskRuns, err := s.store.ListTaskRuns(ctx, tx, run.ID)
	if err != nil {
		return LiveState{}, err
	}
	// A run's live state is computed over exactly the tasks it snapshotted at start
	// (those with an execution row), not the runbook's current tasks.
	plan.Tasks = snapshotTasks(plan.Tasks, taskRuns)
	statuses := make(map[string]string, len(taskRuns))
	for _, tr := range taskRuns {
		statuses[tr.TaskID] = tr.Status
	}
	rs := NewRunState(plan, statuses)
	proj := rs.Projection(run.StartedAt, s.now(), run.PlannedCriticalPathSeconds)
	// A terminal run has no actionable frontier by definition; surface it as empty
	// rather than listing optional tasks that were never required to complete.
	var frontier []string
	if !RunTerminal(run.Status) {
		frontier = rs.Frontier()
	}
	return LiveState{
		Run:        run,
		Tasks:      plan.Tasks,
		TaskRuns:   taskRuns,
		Frontier:   frontier,
		Projection: proj,
	}, nil
}

// ReconcileRun is the projection loop's per-run reconciliation: it loads the run
// and its task-runs under a SYSTEM transaction (the loop scans runs across
// tenants), and if the run has STALLED — no runnable frontier, work in neither
// flight nor done, required tasks outstanding — it transitions the run to FAILED
// and stages the run-finished event. A still-progressing run is left untouched
// (the API-driven ActOnTask path handles normal completion). It returns whether
// the run was transitioned. The loop never double-completes: a run already in a
// terminal status is skipped by the caller, and the SetRunStatus is idempotent on
// a re-scan because the run is no longer active.
func (s *Service) ReconcileRun(ctx context.Context, run Run) (bool, error) {
	if RunTerminal(run.Status) {
		return false, nil
	}
	var changed bool
	err := s.runner.RunSystem(ctx, func(tx DBTX) error {
		// Re-read under the tx to avoid acting on a stale snapshot.
		current, gerr := s.store.GetRun(ctx, tx, run.ID)
		if gerr != nil {
			return gerr
		}
		if RunTerminal(current.Status) {
			return nil
		}
		plan, perr := s.systemPlan(ctx, tx, current.RunbookID)
		if perr != nil {
			return perr
		}
		taskRuns, lerr := s.store.ListTaskRunsForUpdate(ctx, tx, current.ID)
		if lerr != nil {
			return lerr
		}
		// Reason over the run's snapshot, not the runbook's current tasks.
		plan.Tasks = snapshotTasks(plan.Tasks, taskRuns)
		statuses := make(map[string]string, len(taskRuns))
		for _, tr := range taskRuns {
			statuses[tr.TaskID] = tr.Status
		}
		rs := NewRunState(plan, statuses)

		// Only act when the run cannot make progress AND has not met its objective.
		if !rs.Stalled() && !rs.HasFailedRequired() {
			return nil
		}
		now := s.now()
		dur := int(now.Sub(current.StartedAt).Seconds())
		reason := "run stalled: no runnable tasks and required work outstanding"
		if rs.HasFailedRequired() {
			reason = "a required task failed"
		}
		if serr := s.store.SetRunStatus(ctx, tx, current.ID, RunStatusFailed, &now, &dur, &reason); serr != nil {
			return serr
		}
		changed = true
		return s.stager.Stage(ctx, tx, eventRunFinished, current.TenantID, map[string]any{
			"run_id": current.ID, "runbook_id": current.RunbookID, "status": RunStatusFailed, "reason": reason,
		})
	})
	if err != nil {
		return false, err
	}
	if changed {
		s.metrics.observeRunFinished(RunStatusFailed)
	}
	return changed, nil
}

// systemPlan loads a plan via the system-path store methods when present (the
// loop), falling back to the request-path reads otherwise (so an in-memory fake
// store without the system methods still works in tests).
func (s *Service) systemPlan(ctx context.Context, tx DBTX, runbookID string) (Plan, error) {
	if sp, ok := s.store.(interface {
		SystemGetPlan(ctx context.Context, db DBTX, runbookID string) (Plan, error)
	}); ok {
		return sp.SystemGetPlan(ctx, tx, runbookID)
	}
	rb, err := s.store.GetRunbook(ctx, tx, runbookID)
	if err != nil {
		return Plan{}, err
	}
	tasks, terr := s.store.ListTasks(ctx, tx, runbookID)
	if terr != nil {
		return Plan{}, terr
	}
	return Plan{Runbook: *rb, Tasks: tasks}, nil
}

// ---------------------------------------------------------------------------
// Small pure helpers.
// ---------------------------------------------------------------------------

// snapshotTasks restricts a runbook's current task list to the tasks captured in
// a run's snapshot — those that have a per-task execution row (TaskRun). StartRun
// snapshots the whole DAG into task-run rows at start, so during a live run the
// only divergence between the runbook's CURRENT tasks and the run's snapshot is a
// task authored AFTER the run started: it has no execution row and must be
// invisible to this run (its frontier, completion decision, and live state are all
// computed over exactly the DAG it began with). Existing tasks' predecessor edges
// are immutable (AddTask only appends new tasks), so the snapshot is always a
// self-contained sub-DAG — no snapshot task can reference a non-snapshot one.
func snapshotTasks(tasks []Task, taskRuns []TaskRun) []Task {
	inRun := make(map[string]bool, len(taskRuns))
	for _, tr := range taskRuns {
		inRun[tr.TaskID] = true
	}
	out := make([]Task, 0, len(taskRuns))
	for _, t := range tasks {
		if inRun[t.ID] {
			out = append(out, t)
		}
	}
	return out
}

func planTask(plan Plan, taskID string) (Task, bool) {
	for _, t := range plan.Tasks {
		if t.ID == taskID {
			return t, true
		}
	}
	return Task{}, false
}

func onFrontier(frontier []string, taskID string) bool {
	for _, id := range frontier {
		if id == taskID {
			return true
		}
	}
	return false
}

func taskTypeOf(tasks []Task, taskID string) string {
	for _, t := range tasks {
		if t.ID == taskID {
			return t.TaskType
		}
	}
	return ""
}

// taskRunStartedAt returns the persisted started_at of a task-run, or nil.
func taskRunStartedAt(taskRuns []TaskRun, taskID string) *time.Time {
	for _, tr := range taskRuns {
		if tr.TaskID == taskID {
			return tr.StartedAt
		}
	}
	return nil
}

// durationSeconds computes a task's actual duration: from its own start (if it had
// one) else from runStart, to now. It never returns negative.
func durationSeconds(runStart, _ time.Time, taskStart *time.Time, now time.Time) int {
	start := runStart
	if taskStart != nil {
		start = *taskStart
	}
	d := int(now.Sub(start).Seconds())
	if d < 0 {
		d = 0
	}
	return d
}

// compile-time checks.
var (
	_ storeAPI    = (*Store)(nil)
	_ txRunner    = PGXRunner{}
	_ eventStager = outboxStager{}
	_ repository.DBTX
)
