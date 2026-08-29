// Package service implements the Automation engine's runbook orchestrator: a
// durable, restart-safe, idempotent, leader-singleton state machine that drives
// an automation Run through its runbook one step at a time
// (DESIGN_Workflow_Forms_Automation.md §4.5, §6).
//
// The design deliberately mirrors the proven DR gated-failover driver
// (internal/dr/failover) and the DR clean-room loop (internal/dr/cleanroom):
// a leader-singleton loop claims runnable runs with FOR UPDATE SKIP LOCKED,
// claim and advance happen in SEPARATE transactions, a step is Ensured-not-
// Created so a crash-restart never double-fires an action, and an approval gate
// NEVER auto-advances — the claim query excludes AWAITING_APPROVAL/ESCALATED, so
// a parked run waits for a human decision (or the timeout sweeper) before the
// driver touches it again.
//
// EXECUTE-OUTSIDE-TX (the integrate-phase contract, §4.6 — auditor-flagged):
// an ActionExecutor performs REAL external I/O (HTTP, Kafka publish) and is
// deliberately invoked OUTSIDE any DB transaction. Advancing an action step is
// therefore split across THREE transaction boundaries, exactly like the DR
// clean-room loop's "validate (no tx) then persist (tx)" shape:
//
//  1. claim/prepare tx — Ensure the step row RUNNING (durable marker), commit.
//     This commits the claim of the action BEFORE any side effect runs, so a
//     crash mid-action leaves a durable RUNNING row the driver re-reads.
//  2. Execute (NO tx)  — call action.Dispatcher.Execute. The executor holds no
//     DB handle and may freely open its own connections; a tx rollback can never
//     un-send an external action because no tx is open while it runs.
//  3. persist tx       — record the step's OK/FAILED result, stage the
//     platform.automation.events outbox event, and advance CurrentStep (or fail
//     the run), all atomically.
//
// Idempotency (UNIQUE(run_id, step_index) Ensure-not-Create) plus the recorded
// step result make a retry safe: if step 3 rolls back after a successful
// Execute, the next claim re-reads the RUNNING row, re-attempts Execute (the
// executor is documented idempotent for a (run, step)), and records the result;
// if Execute already committed OK, the next claim reads OK and advances without
// re-firing. A tx rollback can never un-send an external action.
//
// Every transition is persisted (automation_runs + automation_run_steps) and
// stages a platform.automation.events outbox event in the SAME transaction as
// the state change, so the run state and the platform's event history can never
// disagree (§8).
//
// Advance advances a claimed run by AT MOST ONE step per call and reports
// whether the run made progress (so the loop can re-tick immediately to drain a
// multi-step run without an interval wait per step). Gate steps, run completion,
// run start, and idempotent no-ops each run in a single short transaction with no
// external I/O; only an action step's Execute crosses the three-boundary path.
//
// This file (WP-11) defines:
//   - the durable Repository surface the orchestrator needs;
//   - the ActionExecutor seam (WP-12 implements the five real action targets);
//   - the RunbookOrchestrator that advances a claimed run by exactly one step;
//   - the approval-gate operations (approve / reject) and the gate-timeout
//     escalation/abort applied by the sweeper (gates.go).
//
// The leader-singleton claim loop and the gate-timeout sweeper live in loop.go.
package service

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// eventSource is the CloudEvents source recorded on every automation event.
const eventSource = "automation-service"

// Automation lifecycle event types (§8). NewEvent prefixes "com.clario360.".
const (
	eventRunStarted        = "platform.automation.run.started"
	eventRunStepCompleted  = "platform.automation.run.step.completed"
	eventRunAwaitingApprov = "platform.automation.run.awaiting_approval"
	eventRunApproved       = "platform.automation.run.approved"
	eventRunRejected       = "platform.automation.run.rejected"
	eventRunEscalated      = "platform.automation.run.escalated"
	eventRunCompleted      = "platform.automation.run.completed"
	eventRunFailed         = "platform.automation.run.failed"
	eventRunCancelled      = "platform.automation.run.cancelled"
)

// Repository is the durable state surface the orchestrator needs.
// *repository.Repository satisfies it directly; unit tests substitute an
// in-memory fake. Every method takes a repository.DBTX so the orchestrator
// chooses the transaction boundary (claim and advance run in separate txns,
// §6) and the state change commits atomically with its outbox event.
type Repository interface {
	GetRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Run, error)
	UpdateRunState(ctx context.Context, db repository.DBTX, run *model.Run) error
	GetRunbook(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Runbook, error)
	EnsureRunStep(ctx context.Context, db repository.DBTX, tenantID string, s *model.RunStep) error
	GetRunStep(ctx context.Context, db repository.DBTX, runID string, index int) (*model.RunStep, error)
	UpsertApprovalGate(ctx context.Context, db repository.DBTX, g *model.ApprovalGate) error
	GetApprovalGate(ctx context.Context, db repository.DBTX, tenantID, runID string, stepIndex int) (*model.ApprovalGate, error)
}

// TxRunner opens a single short transaction, runs fn inside it, and commits on
// nil / rolls back on non-nil. The orchestrator uses it to own its OWN
// transaction boundaries so an action's Execute runs strictly between two
// committed transactions (never inside one). In production this wraps
// database.RunSystemTx (the leader loop is a cross-tenant system path); unit
// tests inject an in-memory runner so the three-boundary discipline is exercised
// without a live database. fn receives a repository.DBTX (pgx.Tx satisfies it).
type TxRunner func(ctx context.Context, fn func(db repository.DBTX) error) error

// Output is the result an ActionExecutor returns for a single action step. It is
// recorded verbatim in the run's append-only log (the target's response, §4.7)
// and merged into the run Variables under the step's output key so later steps
// (and rules) can reference it.
type Output struct {
	// Data is the structured response from the action target (e.g. the created
	// workflow instance id, the HTTP body, the published event id). Recorded as
	// the run step's output JSON for audit and replay.
	Data map[string]any
}

// ActionExecutor is the SEAM between the orchestrator (WP-11) and the five real
// action targets (WP-12: start_workflow, integration, notification, dr_runbook,
// http_call). The orchestrator calls Execute exactly once per action step
// attempt; the executor performs the side effect (always via API or event,
// FR-XC-004 — never another engine's DB) and returns its recorded output.
//
// Execute is invoked OUTSIDE any DB transaction (the integrate-phase contract,
// §4.6): the executors hold no DB handle and reach their targets via HTTP or the
// bus, so a tx rollback can never un-send an external action.
//
// Implementations MUST treat Execute as idempotent for a given (run, step):
// the orchestrator backs external effects with the platform idempotency guard,
// but a re-attempt after a transient error may call Execute again, so the target
// should be safe to call twice for the same logical action.
type ActionExecutor interface {
	Execute(ctx context.Context, step *model.RunStep) (Output, error)
}

// EventSink stages an automation lifecycle event in the same transaction as the
// state change (the in-tx outbox, §8). OutboxSink is the production
// implementation; tests inject a recording fake.
type EventSink interface {
	Emit(ctx context.Context, db repository.DBTX, tenantID, eventType string, payload map[string]any) error
}

// OutboxSink stages automation events in event_outbox on the platform
// automation topic.
type OutboxSink struct{}

// Emit writes the event to the outbox in the caller's transaction.
func (OutboxSink) Emit(ctx context.Context, db repository.DBTX, tenantID, eventType string, payload map[string]any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID, payload)
	if err != nil {
		return fmt.Errorf("building automation event %s: %w", eventType, err)
	}
	return outbox.Write(ctx, db, events.Topics.AutomationEvents, event)
}

// nopSink discards events (used when no sink is configured).
type nopSink struct{}

func (nopSink) Emit(context.Context, repository.DBTX, string, string, map[string]any) error {
	return nil
}

// RecordedFailureError signals that an action collaborator failed and the
// orchestrator has ALREADY durably recorded the failed step, the terminal FAILED
// run status, and the failure outbox event (its persist transaction committed).
// The loop treats this as a successful, durable terminal outcome. Plain errors
// from Advance are persistence or programming failures that left the run
// unchanged (or rolled back) and MUST leave the run claimable so it retries
// cleanly. This mirrors the DR driver's RecordedFailureError contract.
type RecordedFailureError struct {
	RunID string
	Cause error
}

// Error returns the underlying cause's message.
func (e *RecordedFailureError) Error() string {
	if e == nil || e.Cause == nil {
		return "automation: recorded run failure"
	}
	return e.Cause.Error()
}

// Unwrap exposes the underlying cause to errors.Is/As.
func (e *RecordedFailureError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// IsRecordedFailure reports whether err is an action failure whose terminal
// state has already been written transactionally.
func IsRecordedFailure(err error) bool {
	var rec *RecordedFailureError
	return errors.As(err, &rec)
}

// RunbookOrchestrator advances a claimed automation run one durable step at a
// time. It is safe to re-run after a crash because every transition is keyed by
// the run's persisted status + CurrentStep and every step row is keyed by
// UNIQUE(run_id, step_index) (Ensure-not-Create).
type RunbookOrchestrator struct {
	repo        Repository
	exec        ActionExecutor
	events      EventSink
	now         func() time.Time
	maxAttempts int
}

// OrchestratorConfig wires a RunbookOrchestrator.
type OrchestratorConfig struct {
	// Repository is the durable state surface (required).
	Repository Repository
	// Executor performs action side effects (required — WP-12 supplies the real
	// five-target executor; tests supply a fake).
	Executor ActionExecutor
	// Events stages lifecycle events in the advance transaction. Defaults to a
	// no-op sink when nil (e.g. unit tests that don't assert events).
	Events EventSink
	// Now is the clock, injectable for deterministic tests. Defaults to
	// time.Now().UTC().
	Now func() time.Time
	// MaxAttempts caps action retries before a step (and the run) FAILs.
	// Defaults to 1 (no retry) when <= 0.
	MaxAttempts int
}

// NewRunbookOrchestrator constructs the orchestrator.
func NewRunbookOrchestrator(cfg OrchestratorConfig) (*RunbookOrchestrator, error) {
	if cfg.Repository == nil {
		return nil, errors.New("automation: orchestrator repository is required")
	}
	if cfg.Executor == nil {
		return nil, errors.New("automation: orchestrator action executor is required")
	}
	if cfg.Events == nil {
		cfg.Events = nopSink{}
	}
	if cfg.Now == nil {
		cfg.Now = func() time.Time { return time.Now().UTC() }
	}
	if cfg.MaxAttempts <= 0 {
		cfg.MaxAttempts = 1
	}
	return &RunbookOrchestrator{
		repo:        cfg.Repository,
		exec:        cfg.Executor,
		events:      cfg.Events,
		now:         cfg.Now,
		maxAttempts: cfg.MaxAttempts,
	}, nil
}

// Advance advances one claimed run by AT MOST one step and reports whether the
// run made durable progress (so the loop can re-tick immediately). The
// orchestrator owns its transaction boundaries through txRun so an action step's
// Execute runs strictly OUTSIDE any DB transaction (the §4.6 integrate-phase
// contract):
//
//	PENDING  -> open tx: start the run (RUNNING, emit run.started), commit. (progress)
//	RUNNING  -> resolve the step at CurrentStep:
//	              action step  -> prepare tx (record RUNNING) -> Execute (NO tx)
//	                              -> persist tx (record result, advance or FAIL)
//	              gate step    -> open tx: park the run AWAITING_APPROVAL, commit
//	              past last    -> open tx: COMPLETE the run, commit
//	  (a human ApproveGate/RejectGate or the timeout sweeper resolves a gate and
//	   moves the run back to RUNNING; the driver never auto-advances a gate)
//
// A terminal or parked run is a no-op (progress=false). An action step that
// fails past its retry policy returns a RecordedFailureError whose terminal
// FAILED state and outbox event have already committed; the loop treats it as a
// durable terminal outcome (progress=false). A plain error means a
// persistence/programming failure left the run unchanged and it stays claimable.
func (o *RunbookOrchestrator) Advance(ctx context.Context, run *model.Run, txRun TxRunner) (progress bool, err error) {
	if run == nil {
		return false, errors.New("automation: run is required")
	}
	if txRun == nil {
		return false, errors.New("automation: advance requires a transaction runner")
	}
	if run.IsTerminal() {
		return false, nil
	}
	switch run.Status {
	case model.RunStatusPending:
		return o.startRun(ctx, run, txRun)
	case model.RunStatusRunning:
		return o.advanceRunning(ctx, run, txRun)
	case model.RunStatusAwaitingApproval, model.RunStatusEscalated:
		// Parked on a gate; the driver never auto-advances it (§6). The claim
		// query excludes these, so reaching here means a stale in-memory run was
		// passed — treat as a no-op rather than corrupting state.
		return false, nil
	default:
		return false, fmt.Errorf("automation: cannot advance run %s in state %q: %w", run.ID, run.Status, model.ErrInvalidTransition)
	}
}

// startRun transitions PENDING -> RUNNING and emits run.started in one short
// transaction. It does NOT dispatch the first step in the same call: the loop
// re-ticks immediately (Advance reported progress), and the next tick advances
// the now-RUNNING run — keeping the start transition free of any external I/O.
func (o *RunbookOrchestrator) startRun(ctx context.Context, run *model.Run, txRun TxRunner) (bool, error) {
	err := txRun(ctx, func(db repository.DBTX) error {
		run.Status = model.RunStatusRunning
		if run.CurrentStep < 0 {
			run.CurrentStep = 0
		}
		if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
			return fmt.Errorf("starting run %s: %w", run.ID, err)
		}
		return o.emit(ctx, db, run, eventRunStarted, map[string]any{"runbook_id": run.RunbookID})
	})
	if err != nil {
		// Roll back the in-memory transition so the caller does not act on a state
		// the database rejected.
		run.Status = model.RunStatusPending
		return false, err
	}
	return true, nil
}

// advanceRunning resolves the step at CurrentStep and advances the run by one
// step. An action step crosses the three-boundary path (prepare tx -> Execute
// outside any tx -> persist tx); a gate step or run completion runs in a single
// short transaction with no external I/O.
func (o *RunbookOrchestrator) advanceRunning(ctx context.Context, run *model.Run, txRun TxRunner) (bool, error) {
	// Resolve the current step in a read transaction (the runbook + any prior
	// step row), so the executor dispatch decision is made against committed
	// state and NOT while holding a write transaction open.
	var (
		rb         *model.Runbook
		priorStep  *model.RunStep
		priorFound bool
	)
	if err := txRun(ctx, func(db repository.DBTX) error {
		var lerr error
		rb, lerr = o.repo.GetRunbook(ctx, db, run.TenantID, run.RunbookID)
		if lerr != nil {
			return fmt.Errorf("loading runbook %s for run %s: %w", run.RunbookID, run.ID, lerr)
		}
		if run.CurrentStep < len(rb.Steps) {
			ps, gerr := o.repo.GetRunStep(ctx, db, run.ID, run.CurrentStep)
			switch {
			case gerr == nil:
				priorStep, priorFound = ps, true
			case errors.Is(gerr, model.ErrNotFound):
				// no prior row yet
			default:
				return fmt.Errorf("reading prior run step %d: %w", run.CurrentStep, gerr)
			}
		}
		return nil
	}); err != nil {
		return false, err
	}

	if run.CurrentStep >= len(rb.Steps) {
		return o.completeRun(ctx, run, txRun)
	}

	step := rb.Steps[run.CurrentStep]
	switch step.Type {
	case model.StepTypeApprovalGate:
		return o.openGate(ctx, run, step, txRun)
	case model.StepTypeAction:
		return o.runActionStep(ctx, run, step, priorStep, priorFound, txRun)
	default:
		return o.failRun(ctx, run, run.CurrentStep,
			fmt.Errorf("runbook step %d has unknown type %q: %w", step.Index, step.Type, model.ErrInvalidConfig), txRun)
	}
}

// runActionStep executes a single action step idempotently across the three
// transaction boundaries (prepare -> Execute outside tx -> persist):
//
//   - If a prior attempt already committed OK (a crash-restart re-claim after the
//     persist tx), the action is NOT re-fired — the run just advances (a single
//     persist tx). This is the crash-restart idempotency guarantee.
//   - Otherwise: the step row is recorded RUNNING in the PREPARE tx (committed
//     before any side effect), Execute runs OUTSIDE any tx, and the PERSIST tx
//     records the OK/FAILED result, stages the outbox event, and advances the run
//     (or fails it once attempts are exhausted).
func (o *RunbookOrchestrator) runActionStep(ctx context.Context, run *model.Run, step model.RunbookStep, prior *model.RunStep, priorFound bool, txRun TxRunner) (bool, error) {
	idx := step.Index

	// Idempotency: a prior attempt already succeeded — advance without re-firing.
	if priorFound && prior.Status == model.StepStatusOK {
		if err := o.persistAdvance(ctx, run, prior, txRun); err != nil {
			return false, err
		}
		return true, nil
	}

	attempt := 1
	if priorFound {
		attempt = prior.Attempt + 1
	}

	// --- PREPARE tx: record the RUNNING attempt before side-effecting so a crash
	// mid-action leaves a durable marker the driver sees on restart. This commits
	// the claim of the action BEFORE Execute runs. ---
	now := o.now()
	rs := &model.RunStep{
		RunID:     run.ID,
		Index:     idx,
		Action:    step.Action,
		InputJSON: o.stepInput(run, step),
		Status:    model.StepStatusRunning,
		Attempt:   attempt,
		StartedAt: now,
	}
	if err := txRun(ctx, func(db repository.DBTX) error {
		return o.repo.EnsureRunStep(ctx, db, run.TenantID, rs)
	}); err != nil {
		return false, fmt.Errorf("recording run step %d start: %w", idx, err)
	}

	// --- Execute: REAL external I/O, with NO DB transaction open. The executor
	// resolves the run's tenant from the context (auth.TenantFromContext), so the
	// run's tenant is stamped onto the execution context here. A tx rollback can
	// never un-send what Execute did because no tx is open while it runs. ---
	execCtx := auth.WithTenantID(ctx, run.TenantID)
	out, execErr := o.exec.Execute(execCtx, rs)
	finished := o.now()

	// --- PERSIST tx: record the result + outbox event + advance/fail, atomically. ---
	if execErr != nil {
		rs.Status = model.StepStatusFailed
		rs.Error = execErr.Error()
		rs.FinishedAt = &finished
		if attempt >= o.maxAttempts {
			// Terminal: record the failed step AND the terminal run state + outbox
			// event in one persist tx, then signal a recorded failure to the loop.
			return o.failActionStep(ctx, run, rs, idx, attempt, execErr, txRun)
		}
		// Retryable: record the failed attempt and a retryable step.completed event,
		// leaving the run RUNNING and CurrentStep unchanged so the next claim
		// re-attempts with an incremented count until MaxAttempts.
		err := txRun(ctx, func(db repository.DBTX) error {
			if err := o.repo.EnsureRunStep(ctx, db, run.TenantID, rs); err != nil {
				return fmt.Errorf("recording run step %d failure: %w", idx, err)
			}
			run.LastError = execErr.Error()
			if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
				return fmt.Errorf("recording retryable run error %s: %w", run.ID, err)
			}
			return o.emit(ctx, db, run, eventRunStepCompleted, map[string]any{
				"step_index": idx,
				"status":     model.StepStatusFailed,
				"attempt":    attempt,
				"retryable":  true,
				"error":      execErr.Error(),
			})
		})
		if err != nil {
			return false, err
		}
		return true, nil
	}

	rs.Status = model.StepStatusOK
	rs.OutputJSON = out.Data
	rs.Error = ""
	rs.FinishedAt = &finished
	err := txRun(ctx, func(db repository.DBTX) error {
		if err := o.repo.EnsureRunStep(ctx, db, run.TenantID, rs); err != nil {
			return fmt.Errorf("recording run step %d success: %w", idx, err)
		}
		if err := o.emit(ctx, db, run, eventRunStepCompleted, map[string]any{
			"step_index": idx,
			"status":     model.StepStatusOK,
			"attempt":    attempt,
		}); err != nil {
			return err
		}
		return o.advanceInTx(ctx, db, run, rs)
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

// failActionStep records the failed step row AND the terminal FAILED run state +
// outbox event in one persist tx, returning a RecordedFailureError so the loop
// treats it as a durable terminal outcome.
func (o *RunbookOrchestrator) failActionStep(ctx context.Context, run *model.Run, rs *model.RunStep, idx, attempt int, cause error, txRun TxRunner) (bool, error) {
	wrapped := fmt.Errorf("action step %d failed after %d attempt(s): %w", idx, attempt, cause)
	now := o.now()
	persistErr := txRun(ctx, func(db repository.DBTX) error {
		if err := o.repo.EnsureRunStep(ctx, db, run.TenantID, rs); err != nil {
			return fmt.Errorf("recording run step %d failure: %w", idx, err)
		}
		run.Status = model.RunStatusFailed
		run.CompletedAt = &now
		run.LastError = wrapped.Error()
		if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
			return fmt.Errorf("terminal status write: %w", err)
		}
		return o.emit(ctx, db, run, eventRunFailed, map[string]any{
			"step_index": idx,
			"error":      wrapped.Error(),
		})
	})
	if persistErr != nil {
		return false, fmt.Errorf("automation: failed to durably record failure for run %s: %w; original cause: %v",
			run.ID, persistErr, wrapped)
	}
	return false, &RecordedFailureError{RunID: run.ID, Cause: wrapped}
}

// persistAdvance advances a run past an already-OK step in a single persist tx
// (the idempotent crash-restart path: the step's OK row is already committed, so
// no action is re-fired — only the run state moves forward).
func (o *RunbookOrchestrator) persistAdvance(ctx context.Context, run *model.Run, rs *model.RunStep, txRun TxRunner) error {
	return txRun(ctx, func(db repository.DBTX) error {
		return o.advanceInTx(ctx, db, run, rs)
	})
}

// advanceInTx records the step's output into the run Variables (so later steps
// and rules can reference it) and moves CurrentStep forward, completing the run
// when it was the last step. It runs inside the caller's persist transaction.
// It does NOT dispatch the next step: the loop re-ticks and the next Advance
// resolves the next step (so each Execute stays on its own three-boundary path).
func (o *RunbookOrchestrator) advanceInTx(ctx context.Context, db repository.DBTX, run *model.Run, rs *model.RunStep) error {
	o.mergeStepOutput(run, rs)
	run.CurrentStep = rs.Index + 1
	run.LastError = ""
	if run.CurrentStep >= o.stepCount(ctx, db, run) {
		now := o.now()
		run.Status = model.RunStatusCompleted
		run.CompletedAt = &now
		if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
			return fmt.Errorf("completing run %s: %w", run.ID, err)
		}
		return o.emit(ctx, db, run, eventRunCompleted, map[string]any{"steps": run.CurrentStep})
	}
	if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
		return fmt.Errorf("advancing run %s past step %d: %w", run.ID, rs.Index, err)
	}
	return nil
}

// stepCount returns the number of steps in the run's runbook, loaded in the
// caller's transaction. A load error returns a sentinel large count so the run
// is NOT spuriously completed; the next UpdateRunState would then surface the
// underlying error. In practice the runbook was already loaded this tick.
func (o *RunbookOrchestrator) stepCount(ctx context.Context, db repository.DBTX, run *model.Run) int {
	rb, err := o.repo.GetRunbook(ctx, db, run.TenantID, run.RunbookID)
	if err != nil {
		return run.CurrentStep + 1 // do not complete on a load error
	}
	return len(rb.Steps)
}

// openGate parks the run on an approval gate in one short transaction (no
// external I/O). It records the gate's log step as AWAITING, upserts the durable
// ApprovalGate (with its deadline), moves the run to AWAITING_APPROVAL, and emits
// run.awaiting_approval. The run is NOT advanced — only a human decision or the
// timeout sweeper resolves the gate. The claim query excludes AWAITING_APPROVAL,
// so the driver will not touch this run again.
//
// An idempotent re-open (crash-restart) reacts to an already-resolved gate: an
// approved gate resumes the run; a rejected/expired gate fails it.
func (o *RunbookOrchestrator) openGate(ctx context.Context, run *model.Run, step model.RunbookStep, txRun TxRunner) (bool, error) {
	idx := step.Index
	progressed := false
	var resumeGate *model.ApprovalGate

	err := txRun(ctx, func(db repository.DBTX) error {
		existing, gerr := o.repo.GetApprovalGate(ctx, db, run.TenantID, run.ID, idx)
		if gerr != nil && !errors.Is(gerr, model.ErrNotFound) {
			return fmt.Errorf("reading approval gate (run %s step %d): %w", run.ID, idx, gerr)
		}
		if existing != nil {
			switch existing.Status {
			case model.GateStatusApproved:
				// Resolve after this tx commits via resumeAfterGate (its own tx).
				resumeGate = existing
				return nil
			case model.GateStatusRejected, model.GateStatusExpired:
				return o.failRunInTx(ctx, db, run, idx,
					fmt.Errorf("approval gate %d resolved %s: %w", idx, existing.Status, model.ErrInvalidTransition))
			default:
				// OPEN or ESCALATED: already parked; nothing to re-do.
				return nil
			}
		}

		quorum := step.Quorum
		if quorum < 1 {
			quorum = 1
		}
		now := o.now()
		var deadline *time.Time
		if step.TimeoutSeconds > 0 {
			d := now.Add(time.Duration(step.TimeoutSeconds) * time.Second)
			deadline = &d
		}
		gate := &model.ApprovalGate{
			RunID:      run.ID,
			TenantID:   run.TenantID,
			StepIndex:  idx,
			Status:     model.GateStatusOpen,
			Quorum:     quorum,
			OpenedAt:   now,
			DeadlineAt: deadline,
		}
		if err := o.repo.UpsertApprovalGate(ctx, db, gate); err != nil {
			return fmt.Errorf("opening approval gate (run %s step %d): %w", run.ID, idx, err)
		}

		rs := &model.RunStep{
			RunID:     run.ID,
			Index:     idx,
			Action:    model.ActionRef{Kind: model.StepTypeApprovalGate},
			InputJSON: o.stepInput(run, step),
			Status:    model.StepStatusAwaiting,
			Attempt:   1,
			StartedAt: now,
		}
		if err := o.repo.EnsureRunStep(ctx, db, run.TenantID, rs); err != nil {
			return fmt.Errorf("recording gate step %d: %w", idx, err)
		}

		run.Status = model.RunStatusAwaitingApproval
		if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
			return fmt.Errorf("parking run %s on gate %d: %w", run.ID, idx, err)
		}
		progressed = true
		return o.emit(ctx, db, run, eventRunAwaitingApprov, map[string]any{
			"step_index":      idx,
			"approver_roles":  orEmptyStrings(step.ApproverRoles),
			"quorum":          quorum,
			"timeout_seconds": step.TimeoutSeconds,
			"timeout_action":  step.TimeoutAction,
		})
	})
	if err != nil {
		if IsRecordedFailure(err) {
			return false, err
		}
		return false, err
	}
	if resumeGate != nil {
		return o.resumeAfterGate(ctx, run, resumeGate, txRun)
	}
	return progressed, nil
}

// resumeAfterGate moves an approved-gate run back to RUNNING, records the gate
// step OK, and advances past the gate — all in one short transaction (no
// external I/O). It does NOT dispatch the next step; the loop re-ticks.
func (o *RunbookOrchestrator) resumeAfterGate(ctx context.Context, run *model.Run, gate *model.ApprovalGate, txRun TxRunner) (bool, error) {
	idx := gate.StepIndex
	now := o.now()
	rs := &model.RunStep{
		RunID:      run.ID,
		Index:      idx,
		Action:     model.ActionRef{Kind: model.StepTypeApprovalGate},
		Status:     model.StepStatusApproved,
		Attempt:    1,
		StartedAt:  gate.OpenedAt,
		FinishedAt: &now,
		OutputJSON: map[string]any{
			"approvals": gate.Approvals(),
			"quorum":    gate.Quorum,
			"decisions": decisionsAsData(gate.Decisions),
		},
	}
	err := txRun(ctx, func(db repository.DBTX) error {
		if err := o.repo.EnsureRunStep(ctx, db, run.TenantID, rs); err != nil {
			return fmt.Errorf("recording approved gate step %d: %w", idx, err)
		}
		run.Status = model.RunStatusRunning
		run.CurrentStep = idx + 1
		run.LastError = ""
		if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
			return fmt.Errorf("resuming run %s after gate %d: %w", run.ID, idx, err)
		}
		return o.emit(ctx, db, run, eventRunApproved, map[string]any{
			"step_index": idx,
			"approvals":  gate.Approvals(),
			"quorum":     gate.Quorum,
		})
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

// completeRun moves a run to COMPLETED in one short transaction (no I/O) and
// emits run.completed.
func (o *RunbookOrchestrator) completeRun(ctx context.Context, run *model.Run, txRun TxRunner) (bool, error) {
	now := o.now()
	err := txRun(ctx, func(db repository.DBTX) error {
		run.Status = model.RunStatusCompleted
		run.CompletedAt = &now
		run.LastError = ""
		if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
			return fmt.Errorf("completing run %s: %w", run.ID, err)
		}
		return o.emit(ctx, db, run, eventRunCompleted, map[string]any{"steps": run.CurrentStep})
	})
	if err != nil {
		return false, err
	}
	return true, nil
}

// failRun records the FAILED terminal state and a failure event in its OWN short
// transaction, then returns a RecordedFailureError so the loop treats it as a
// durable terminal outcome. Used for non-action failures (unknown step type,
// gate resolved adversely on re-open).
func (o *RunbookOrchestrator) failRun(ctx context.Context, run *model.Run, stepIndex int, cause error, txRun TxRunner) (bool, error) {
	if cause == nil {
		cause = errors.New("automation: run failed")
	}
	persistErr := txRun(ctx, func(db repository.DBTX) error {
		return o.failRunInTx(ctx, db, run, stepIndex, cause)
	})
	if persistErr != nil {
		if IsRecordedFailure(persistErr) {
			return false, persistErr
		}
		return false, fmt.Errorf("automation: failed to durably record failure for run %s: %w; original cause: %v",
			run.ID, persistErr, cause)
	}
	return false, &RecordedFailureError{RunID: run.ID, Cause: cause}
}

// failRunInTx writes the terminal FAILED state + failure outbox event in the
// caller's transaction and returns a RecordedFailureError so a caller that runs
// this inside its own txRun can detect the recorded-failure outcome.
func (o *RunbookOrchestrator) failRunInTx(ctx context.Context, db repository.DBTX, run *model.Run, stepIndex int, cause error) error {
	now := o.now()
	run.Status = model.RunStatusFailed
	run.CompletedAt = &now
	run.LastError = cause.Error()
	if err := o.repo.UpdateRunState(ctx, db, run); err != nil {
		return fmt.Errorf("terminal status write: %w", err)
	}
	if err := o.emit(ctx, db, run, eventRunFailed, map[string]any{
		"step_index": stepIndex,
		"error":      cause.Error(),
	}); err != nil {
		return fmt.Errorf("failure event write: %w", err)
	}
	return &RecordedFailureError{RunID: run.ID, Cause: cause}
}

// stepInput records the resolved trigger + step config for replay (§4.7). The
// recorded inputs are a snapshot of the action config and the run trigger/vars at
// execution time so a replay re-executes from exactly these inputs.
func (o *RunbookOrchestrator) stepInput(run *model.Run, step model.RunbookStep) map[string]any {
	input := map[string]any{
		"step_index": step.Index,
		"step_type":  step.Type,
	}
	if step.Type == model.StepTypeAction {
		input["action_kind"] = step.Action.Kind
		input["action_config"] = step.Action.Config
	}
	if len(run.Trigger) > 0 {
		input["trigger"] = run.Trigger
	}
	if len(run.Variables) > 0 {
		input["variables"] = copyMap(run.Variables)
	}
	return input
}

// mergeStepOutput records an action step's output into the run Variables under
// "steps.<index>" so later steps and rules can reference prior outputs via the
// expression DSL / variable resolver.
func (o *RunbookOrchestrator) mergeStepOutput(run *model.Run, rs *model.RunStep) {
	if rs.OutputJSON == nil {
		return
	}
	if run.Variables == nil {
		run.Variables = map[string]any{}
	}
	steps, _ := run.Variables["steps"].(map[string]any)
	if steps == nil {
		steps = map[string]any{}
	}
	steps[fmt.Sprintf("%d", rs.Index)] = rs.OutputJSON
	run.Variables["steps"] = steps
}

// emit stamps run identity onto the payload and stages the event in the caller's
// transaction.
func (o *RunbookOrchestrator) emit(ctx context.Context, db repository.DBTX, run *model.Run, eventType string, payload map[string]any) error {
	data := copyMap(payload)
	if data == nil {
		data = map[string]any{}
	}
	data["run_id"] = run.ID
	data["automation_id"] = run.AutomationID
	data["runbook_id"] = run.RunbookID
	data["status"] = run.Status
	return o.events.Emit(ctx, db, run.TenantID, eventType, data)
}

func copyMap(in map[string]any) map[string]any {
	if in == nil {
		return nil
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}

func orEmptyStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func decisionsAsData(decisions []model.Decision) []map[string]any {
	out := make([]map[string]any, 0, len(decisions))
	for _, d := range decisions {
		out = append(out, map[string]any{
			"user_id":    d.UserID,
			"approved":   d.Approved,
			"comment":    d.Comment,
			"decided_at": d.DecidedAt,
		})
	}
	return out
}
