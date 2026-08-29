// Package runbookstudio implements ClarioDR capability #11 — RUNBOOK STUDIO, the
// human-authored orchestration layer (the Cutover analogue,
// DESIGN_DataStream_DR.md §6 gated failover, §14.3 Recovery Asset Registry).
//
// This package COMPLEMENTS — it does not re-implement — the existing DR packages:
//
//   - internal/dr/registry AUTO-GENERATES a machine-maintained recovery runbook
//     from a consistency group's assets (versioned + diffed). Runbook Studio is
//     the HUMAN-AUTHORED, editable orchestration layer: an operator builds an
//     arbitrary DAG of TASKS with rich types (manual, automated, approval gate,
//     comms, milestone), owners/teams, planned durations, predecessors and
//     instructions, then runs it LIVE. A registry-generated step list can be
//     IMPORTED as an editable starting template (ImportFromSteps).
//   - internal/dr/failover is the gated FSM driver. Studio does not drive a
//     failover; it tracks human/automation orchestration progress with a real
//     dependency frontier and critical-path math.
//   - internal/dr/topology is the replication-SITE graph. The Studio DAG is a
//     TASK graph (predecessor edges), an entirely different object.
//
// The package owns a REAL engine (engine.go), not a model wrapper:
//
//   - Plan.Validate rejects a task DAG that contains a cycle at AUTHOR time
//     (three-colour DFS), so a run can never deadlock.
//   - Plan.CriticalPath computes the longest planned-duration chain (a real
//     longest-path-in-a-DAG over a topological order), the run's baseline.
//   - RunState.Frontier computes the runnable frontier — every not-yet-acted task
//     whose predecessors are ALL complete (or complete-equivalent), recomputed as
//     operators/automation complete/skip/fail tasks.
//   - RunState.Projection computes elapsed-vs-planned and the projected finish
//     from actual task durations plus the remaining critical path.
//
// Disjoint ownership: this package defines its OWN model types, its OWN store over
// repository.DBTX (raw queries; it does NOT edit the shared repository), its OWN
// chi.Router, its OWN background projection loop, and its OWN migration pair
// (000016). It reuses the repository.DBTX execution-context pattern,
// internal/events + outbox, internal/database, internal/auth + middleware, and
// internal/suiteapi.
package runbookstudio

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrNotFound is returned when a runbook, task, or run does not exist.
	ErrNotFound = errors.New("runbook studio object not found")
	// ErrAlreadyExists is returned when a runbook name or task key collides.
	ErrAlreadyExists = errors.New("runbook studio object already exists")
	// ErrCycle is returned when an authored task DAG (or a predecessor edit) would
	// create a cycle. The router maps it to HTTP 409.
	ErrCycle = errors.New("task predecessors would create a cycle in the runbook")
	// ErrUnknownPredecessor is returned when a task references a predecessor that
	// is not a task of the same runbook.
	ErrUnknownPredecessor = errors.New("task references an unknown predecessor")
	// ErrInvalidTaskType is returned when a task type is not one of the TaskType*.
	ErrInvalidTaskType = errors.New("invalid task type")
	// ErrInvalidStatus is returned when a runbook/run/task status is unrecognised.
	ErrInvalidStatus = errors.New("invalid status")
	// ErrEmptyRunbook is returned when starting a run over a runbook with no tasks.
	ErrEmptyRunbook = errors.New("runbook has no tasks; cannot start a run")
	// ErrRunNotActive is returned when acting on a task of a run that is not
	// running (already completed/failed/aborted).
	ErrRunNotActive = errors.New("run is not active")
	// ErrTaskNotRunnable is returned when an operator tries to complete/skip/fail a
	// task whose predecessors are not all complete (it is not on the frontier).
	ErrTaskNotRunnable = errors.New("task is not runnable; predecessors incomplete")
	// ErrApprovalRequired is returned when a non-approval action is taken on an
	// approval-gate task, or vice versa.
	ErrApprovalRequired = errors.New("approval-gate task requires an approval action")
	// ErrNoExecutor is returned when an automated task is driven but no Executor is
	// configured.
	ErrNoExecutor = errors.New("no executor configured for automated tasks")
	// ErrGroupNotFound is returned when a runbook binds to an absent group.
	ErrGroupNotFound = errors.New("consistency group not found")
)

// Task types — the rich orchestration task kinds (the Cutover task model).
const (
	// TaskTypeManual is a task a person performs and then marks complete.
	TaskTypeManual = "manual"
	// TaskTypeAutomated runs a registered action/script via the Executor.
	TaskTypeAutomated = "automated"
	// TaskTypeApprovalGate requires an explicit sign-off before downstream tasks
	// can run. A non-approval complete on it is rejected.
	TaskTypeApprovalGate = "approval_gate"
	// TaskTypeComms sends a notification (email/chat/page) to a recipient list.
	TaskTypeComms = "comms"
	// TaskTypeMilestone is a zero-work marker (a phase boundary). It is completed by
	// the engine automatically once its predecessors are all complete unless it is
	// also an approval gate; it carries no planned duration by default.
	TaskTypeMilestone = "milestone"
)

// ValidTaskType reports whether t is a recognised task type.
func ValidTaskType(t string) bool {
	switch t {
	case TaskTypeManual, TaskTypeAutomated, TaskTypeApprovalGate, TaskTypeComms, TaskTypeMilestone:
		return true
	default:
		return false
	}
}

// Runbook authoring statuses.
const (
	RunbookStatusDraft     = "draft"
	RunbookStatusPublished = "published"
	RunbookStatusArchived  = "archived"
)

// ValidRunbookStatus reports whether s is a recognised runbook status.
func ValidRunbookStatus(s string) bool {
	return s == RunbookStatusDraft || s == RunbookStatusPublished || s == RunbookStatusArchived
}

// Runbook source — authored from scratch, or imported from a registry runbook.
const (
	SourceAuthored = "authored"
	SourceRegistry = "registry"
)

// Run statuses — the live-run lifecycle.
const (
	RunStatusPending   = "pending"
	RunStatusRunning   = "running"
	RunStatusCompleted = "completed"
	RunStatusFailed    = "failed"
	RunStatusAborted   = "aborted"
)

// RunTerminal reports whether a run status is terminal (no further task actions).
func RunTerminal(s string) bool {
	return s == RunStatusCompleted || s == RunStatusFailed || s == RunStatusAborted
}

// Run modes.
const (
	RunModeLive      = "live"
	RunModeRehearsal = "rehearsal"
)

// Per-task execution statuses within a run.
const (
	// TaskRunPending means the task has not yet become runnable (predecessors
	// incomplete) — it is upstream of the current frontier.
	TaskRunPending = "pending"
	// TaskRunRunnable means every predecessor is complete; the task is on the
	// frontier and may be acted on.
	TaskRunRunnable = "runnable"
	// TaskRunRunning means an automated task's Executor is mid-flight.
	TaskRunRunning = "running"
	// TaskRunComplete means the task finished successfully.
	TaskRunComplete = "complete"
	// TaskRunSkipped means an operator skipped the task; it is complete-equivalent
	// for frontier purposes but does not satisfy a "required" completion.
	TaskRunSkipped = "skipped"
	// TaskRunFailed means the task (manual or automated) failed.
	TaskRunFailed = "failed"
	// TaskRunBlocked means the task can never run because an upstream task failed
	// and the failure was not resolved (a predecessor is in a non-complete terminal
	// state). It is a derived, surfaced state.
	TaskRunBlocked = "blocked"
)

// TaskRunDone reports whether a per-task status is a completed-equivalent terminal
// state for FRONTIER computation: a downstream task may become runnable once all
// its predecessors are complete or skipped. A failed/blocked predecessor does NOT
// satisfy readiness (the downstream task is blocked).
func TaskRunDone(s string) bool {
	return s == TaskRunComplete || s == TaskRunSkipped
}

// TaskRunTerminal reports whether a per-task status is terminal (no further state
// change without an explicit reset, which this engine does not support mid-run).
func TaskRunTerminal(s string) bool {
	return s == TaskRunComplete || s == TaskRunSkipped || s == TaskRunFailed
}

// Runbook is a named, editable orchestration runbook — a graph of tasks. The
// tasks live in their own rows (Task); a Runbook plus its Tasks form a Plan.
type Runbook struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenant_id"`
	GroupID     *string   `json:"group_id,omitempty"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Status      string    `json:"status"`
	Source      string    `json:"source"`
	CreatedBy   *string   `json:"created_by,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Task is one node of the runbook's task DAG. Predecessors are task IDs in the
// SAME runbook (the DAG edges); a task becomes runnable when all its predecessors
// are complete-equivalent. PlannedDuration feeds the critical-path math.
type Task struct {
	ID           string `json:"id"`
	TenantID     string `json:"tenant_id"`
	RunbookID    string `json:"runbook_id"`
	TaskKey      string `json:"task_key"`
	Name         string `json:"name"`
	TaskType     string `json:"task_type"`
	Required     bool   `json:"required"`
	Owner        string `json:"owner"`
	Team         string `json:"team"`
	Instructions string `json:"instructions"`
	// PlannedDurationSeconds is this task's expected wall-clock duration; the
	// critical path sums these along the longest dependency chain.
	PlannedDurationSeconds int `json:"planned_duration_seconds"`
	// AutomationAction is the registered action the Executor runs (AUTOMATED), or
	// the permission required (APPROVAL_GATE; empty defaults to dr:failover).
	AutomationAction string         `json:"automation_action"`
	Predecessors     []string       `json:"predecessors"`
	Params           map[string]any `json:"params,omitempty"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
}

// Run is one live execution of a runbook.
type Run struct {
	ID                         string     `json:"id"`
	TenantID                   string     `json:"tenant_id"`
	RunbookID                  string     `json:"runbook_id"`
	Mode                       string     `json:"mode"`
	Status                     string     `json:"status"`
	PlannedCriticalPathSeconds int        `json:"planned_critical_path_seconds"`
	StartedBy                  *string    `json:"started_by,omitempty"`
	StartedAt                  time.Time  `json:"started_at"`
	CompletedAt                *time.Time `json:"completed_at,omitempty"`
	ActualDurationSeconds      *int       `json:"actual_duration_seconds,omitempty"`
	LastError                  *string    `json:"last_error,omitempty"`
	ClaimedAt                  *time.Time `json:"claimed_at,omitempty"`
	UpdatedAt                  time.Time  `json:"updated_at"`
}

// TaskRun is the per-task execution state within a run.
type TaskRun struct {
	ID                    string         `json:"id"`
	TenantID              string         `json:"tenant_id"`
	RunID                 string         `json:"run_id"`
	TaskID                string         `json:"task_id"`
	Status                string         `json:"status"`
	ActedBy               *string        `json:"acted_by,omitempty"`
	StartedAt             *time.Time     `json:"started_at,omitempty"`
	FinishedAt            *time.Time     `json:"finished_at,omitempty"`
	ActualDurationSeconds *int           `json:"actual_duration_seconds,omitempty"`
	Detail                map[string]any `json:"detail,omitempty"`
	CreatedAt             time.Time      `json:"created_at"`
	UpdatedAt             time.Time      `json:"updated_at"`
}

// Plan is a runbook together with its full task set — the input the engine's
// pure graph algorithms (cycle detection, critical path) operate on.
type Plan struct {
	Runbook Runbook `json:"runbook"`
	Tasks   []Task  `json:"tasks"`
}

// LiveState is the payload GET /studio/runs/{id} returns: the run, every task and
// its execution row, the currently runnable frontier (task IDs), and the live
// projection (elapsed-vs-planned + projected finish).
type LiveState struct {
	Run        Run           `json:"run"`
	Tasks      []Task        `json:"tasks"`
	TaskRuns   []TaskRun     `json:"task_runs"`
	Frontier   []string      `json:"frontier"`
	Projection RunProjection `json:"projection"`
}
