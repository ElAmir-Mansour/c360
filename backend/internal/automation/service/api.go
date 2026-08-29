// api.go adds the request-path surface the WP-13 handler drives: automation and
// runbook CRUD, run history + the append-only execution log read paths, the
// approval-gate decision wrappers, and the run REPLAY operation
// (DESIGN_Workflow_Forms_Automation.md §4.7, §9).
//
// Every method here runs its repository calls inside the service's own
// transaction runners (the same tenantTx/tenantRead installed by NewService), so
// a write commits atomically under RLS and a read is tenant-scoped. The handler
// never touches the repository, the pool, or a raw transaction — it calls these
// methods, exactly mirroring how the trigger sources call Dispatch.
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
	"github.com/clario360/platform/internal/cron"
)

// =============================================================================
// Automation CRUD (POST/GET/PUT/DELETE /automations)
// =============================================================================

// CreateAutomation validates and persists a new automation (its trigger + rules)
// and, when the automation declares an inline runbook id, leaves it bound. The
// trigger, every rule's action, and (for schedule triggers) the cron expression
// are validated before any write so a malformed automation never reaches the DB.
// The created automation (with its generated id and timestamps) is returned.
func (s *AutomationService) CreateAutomation(ctx context.Context, tenantID string, a *model.Automation) (*model.Automation, error) {
	if a == nil {
		return nil, fmt.Errorf("%w: automation is required", model.ErrInvalidConfig)
	}
	a.TenantID = tenantID
	if err := s.validateAutomation(a); err != nil {
		return nil, err
	}
	err := s.tenantTx(ctx, tenantID, func(db repository.DBTX) error {
		return s.repo.CreateAutomation(ctx, db, a)
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("tenant_id", tenantID).Str("automation_id", a.ID).Str("name", a.Name).Msg("automation created")
	return a, nil
}

// GetAutomationByID loads one automation (with its rules) for the tenant, or
// model.ErrNotFound. It is the request-path read used by GET /automations/{id};
// the trigger-side Dispatch uses the lower-level GetAutomation in its own tx.
func (s *AutomationService) GetAutomationByID(ctx context.Context, tenantID, id string) (*model.Automation, error) {
	var out *model.Automation
	err := s.tenantRead(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		out, gerr = s.repo.GetAutomation(ctx, db, tenantID, id)
		return gerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ListAutomations returns all of the tenant's automations (rules not eagerly
// loaded; GET /automations/{id} fetches a single one with rules).
func (s *AutomationService) ListAutomations(ctx context.Context, tenantID string) ([]*model.Automation, error) {
	var out []*model.Automation
	err := s.tenantRead(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.repo.ListAutomations(ctx, db, tenantID)
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// UpdateAutomation validates and replaces an automation's mutable fields + rules.
// The id and tenant come from the request path; the body supplies the new state.
func (s *AutomationService) UpdateAutomation(ctx context.Context, tenantID, id string, a *model.Automation) (*model.Automation, error) {
	if a == nil {
		return nil, fmt.Errorf("%w: automation is required", model.ErrInvalidConfig)
	}
	a.ID = id
	a.TenantID = tenantID
	if err := s.validateAutomation(a); err != nil {
		return nil, err
	}
	err := s.tenantTx(ctx, tenantID, func(db repository.DBTX) error {
		return s.repo.UpdateAutomation(ctx, db, a)
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("tenant_id", tenantID).Str("automation_id", id).Msg("automation updated")
	return a, nil
}

// DeleteAutomation removes an automation (its rules cascade).
func (s *AutomationService) DeleteAutomation(ctx context.Context, tenantID, id string) error {
	err := s.tenantTx(ctx, tenantID, func(db repository.DBTX) error {
		return s.repo.DeleteAutomation(ctx, db, tenantID, id)
	})
	if err != nil {
		return err
	}
	s.logger.Info().Str("tenant_id", tenantID).Str("automation_id", id).Msg("automation deleted")
	return nil
}

// validateAutomation enforces the structural and semantic invariants the model's
// own Validate helpers and the cron parser check, so a bad automation is rejected
// at the API boundary (a 400) rather than failing a trigger later. Returns a
// model.ErrInvalidConfig-wrapped error the handler maps to 400.
func (s *AutomationService) validateAutomation(a *model.Automation) error {
	if a.Name == "" {
		return fmt.Errorf("%w: automation name is required", model.ErrInvalidConfig)
	}
	if a.RunbookID == "" {
		return fmt.Errorf("%w: automation requires a runbook_id", model.ErrInvalidConfig)
	}
	if err := a.Trigger.Validate(); err != nil {
		return err
	}
	// Schedule triggers must carry a parseable cron expression (the model's
	// structural Validate only checks it is non-empty, §4.3).
	if a.Trigger.Type == model.TriggerTypeSchedule {
		if _, err := cron.ParseCron(a.Trigger.Cron); err != nil {
			return fmt.Errorf("%w: invalid cron expression %q: %v", model.ErrInvalidConfig, a.Trigger.Cron, err)
		}
	}
	for i := range a.Rules {
		if err := a.Rules[i].ActionRef.Validate(); err != nil {
			return fmt.Errorf("rule %d: %w", i, err)
		}
	}
	return nil
}

// =============================================================================
// Runbook CRUD (POST/GET /runbooks)
// =============================================================================

// CreateRunbook validates and persists a runbook (header + ordered steps). Every
// action step's action kind, and every approval-gate step's timeout action, are
// validated before the write.
func (s *AutomationService) CreateRunbook(ctx context.Context, tenantID string, rb *model.Runbook) (*model.Runbook, error) {
	if rb == nil {
		return nil, fmt.Errorf("%w: runbook is required", model.ErrInvalidConfig)
	}
	rb.TenantID = tenantID
	if err := validateRunbook(rb); err != nil {
		return nil, err
	}
	err := s.tenantTx(ctx, tenantID, func(db repository.DBTX) error {
		return s.repo.CreateRunbook(ctx, db, rb)
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("tenant_id", tenantID).Str("runbook_id", rb.ID).Str("name", rb.Name).Int("steps", len(rb.Steps)).Msg("runbook created")
	return rb, nil
}

// GetRunbookByID loads a runbook (header + steps) for the tenant.
func (s *AutomationService) GetRunbookByID(ctx context.Context, tenantID, id string) (*model.Runbook, error) {
	var out *model.Runbook
	err := s.tenantRead(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		out, gerr = s.repo.GetRunbook(ctx, db, tenantID, id)
		return gerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// validateRunbook enforces the runbook's structural invariants.
func validateRunbook(rb *model.Runbook) error {
	if rb.Name == "" {
		return fmt.Errorf("%w: runbook name is required", model.ErrInvalidConfig)
	}
	if len(rb.Steps) == 0 {
		return fmt.Errorf("%w: runbook requires at least one step", model.ErrInvalidConfig)
	}
	for i := range rb.Steps {
		st := &rb.Steps[i]
		if !model.ValidStepTypes[st.Type] {
			return fmt.Errorf("%w: step %d type %q is not one of action|approval_gate", model.ErrInvalidConfig, i, st.Type)
		}
		switch st.Type {
		case model.StepTypeAction:
			if err := st.Action.Validate(); err != nil {
				return fmt.Errorf("step %d: %w", i, err)
			}
		case model.StepTypeApprovalGate:
			if st.TimeoutAction != "" && !model.ValidTimeoutActions[st.TimeoutAction] {
				return fmt.Errorf("%w: step %d timeout_action %q is not one of abort|escalate|auto_approve",
					model.ErrInvalidConfig, i, st.TimeoutAction)
			}
		}
	}
	return nil
}

// =============================================================================
// Run history + execution log (GET /runs, GET /runs/{id})
// =============================================================================

// ListRuns returns the tenant's runs newest-first, paginated.
func (s *AutomationService) ListRuns(ctx context.Context, tenantID string, limit, offset int) ([]*model.Run, error) {
	var out []*model.Run
	err := s.tenantRead(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.repo.ListRuns(ctx, db, tenantID, limit, offset)
		return lerr
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// RunWithLog bundles a run with its append-only step log (§4.7) for GET
// /runs/{id}. Replayable reports whether the run can be replayed: a terminal run
// whose step log has no gap. GapAt is the first missing step index when the log
// is incomplete (Replayable false), or -1 when there is no gap.
type RunWithLog struct {
	Run        *model.Run       `json:"run"`
	Steps      []*model.RunStep `json:"steps"`
	Replayable bool             `json:"replayable"`
	GapAt      int              `json:"gap_at"`
}

// GetRunWithLog loads a run and its full execution log, computing replayability.
func (s *AutomationService) GetRunWithLog(ctx context.Context, tenantID, runID string) (*RunWithLog, error) {
	var run *model.Run
	var steps []*model.RunStep
	err := s.tenantRead(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		run, gerr = s.repo.GetRun(ctx, db, tenantID, runID)
		if gerr != nil {
			return gerr
		}
		steps, gerr = s.repo.ListRunSteps(ctx, db, runID)
		return gerr
	})
	if err != nil {
		return nil, err
	}
	gap := firstStepGap(run, steps)
	return &RunWithLog{
		Run:        run,
		Steps:      steps,
		Replayable: run.IsReplayable() && gap < 0,
		GapAt:      gap,
	}, nil
}

// firstStepGap returns the first step index in [0, run.CurrentStep) that has no
// recorded log row, or -1 when the log covers every executed step. A COMPLETED
// run records one step per runbook step (indices 0..CurrentStep-1); a missing
// index means the append-only log lost a record, which makes the run
// non-replayable (§4.7). A FAILED/ABORTED run that stopped mid-runbook is allowed
// to have fewer recorded steps than the runbook length — replay re-executes from
// recorded inputs only as far as the log goes — so the gap check only spans the
// indices the run actually advanced through (CurrentStep), and the final
// in-progress step of a FAILED run (at CurrentStep) is not required.
func firstStepGap(run *model.Run, steps []*model.RunStep) int {
	if run == nil {
		return -1
	}
	have := make(map[int]bool, len(steps))
	for _, st := range steps {
		have[st.Index] = true
	}
	for i := 0; i < run.CurrentStep; i++ {
		if !have[i] {
			return i
		}
	}
	return -1
}

// =============================================================================
// Approval-gate decisions (POST /runs/{id}/approve, /reject)
// =============================================================================

// ApproveRun records an affirmative decision on the run's currently-open approval
// gate. The run must be parked AWAITING_APPROVAL (or ESCALATED); its CurrentStep
// is the open gate's step index (openGate parks without advancing). The decision
// is applied in a tenant transaction so the gate row, the run row, and the outbox
// event commit atomically; when quorum is met the run is re-armed RUNNING for the
// leader driver to advance. Returns the resolved/updated gate.
func (s *AutomationService) ApproveRun(ctx context.Context, tenantID, runID, userID, comment string) (*model.ApprovalGate, error) {
	return s.decideRun(ctx, tenantID, runID, userID, comment, true)
}

// RejectRun records a rejection on the run's open gate; a single rejection FAILs
// the run (a runbook cannot proceed past a rejected gate).
func (s *AutomationService) RejectRun(ctx context.Context, tenantID, runID, userID, comment string) (*model.ApprovalGate, error) {
	return s.decideRun(ctx, tenantID, runID, userID, comment, false)
}

// decideRun resolves the gate's step index from the parked run, then delegates to
// the GateService inside one tenant transaction.
func (s *AutomationService) decideRun(ctx context.Context, tenantID, runID, userID, comment string, approved bool) (*model.ApprovalGate, error) {
	if userID == "" {
		return nil, fmt.Errorf("%w: a decider user id is required", model.ErrInvalidConfig)
	}
	var gate *model.ApprovalGate
	err := s.tenantTx(ctx, tenantID, func(db repository.DBTX) error {
		run, gerr := s.gates.repo.GetRun(ctx, db, tenantID, runID)
		if gerr != nil {
			return gerr
		}
		if run.Status != model.RunStatusAwaitingApproval && run.Status != model.RunStatusEscalated {
			return fmt.Errorf("run %s is %s, not awaiting approval: %w", runID, run.Status, model.ErrConflict)
		}
		decision := model.Decision{UserID: userID, Approved: approved, Comment: comment, DecidedAt: s.now()}
		var derr error
		if approved {
			gate, derr = s.gates.ApproveGate(ctx, db, tenantID, runID, run.CurrentStep, decision)
		} else {
			gate, derr = s.gates.RejectGate(ctx, db, tenantID, runID, run.CurrentStep, decision)
		}
		return derr
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().
		Str("tenant_id", tenantID).Str("run_id", runID).Str("user_id", userID).Bool("approved", approved).
		Msg("automation approval gate decision recorded")
	return gate, nil
}

// =============================================================================
// Replay (POST /runs/{id}/replay) — re-execute a completed run from recorded
// inputs (§4.7, FR-AUTOMATION-004).
// =============================================================================

// ErrNonReplayable is returned when a run cannot be replayed: it is not in a
// terminal state, or its append-only step log has a gap (a lost step record), so
// re-execution from recorded inputs is not safe. The handler maps it to 409.
var ErrNonReplayable = errors.New("run is non-replayable")

// Replay creates a NEW run that re-executes the original run's runbook from the
// original's RECORDED inputs (its trigger payload), linked back via replay_of
// (§4.7). It does NOT mutate the original. Preconditions, each enforced before
// any write:
//
//   - the original exists and is in a terminal, replayable state (COMPLETED /
//     FAILED / ABORTED) — a live run is still producing its log;
//   - the original's append-only log has NO gap over the steps it advanced
//     through — a missing step record means the recorded inputs are incomplete,
//     so the run is non_replayable and Replay returns ErrNonReplayable.
//
// The new run is created PENDING with replay_of = originalID and the original's
// recorded trigger as its trigger (the replay input). The leader driver claims it
// and re-executes the runbook step by step from those inputs, exactly as a fresh
// run would, so replay re-uses the whole durable/idempotent orchestration path.
// A fresh source_event_id ("replay:<original>:<n>") keeps the (tenant_id,
// source_event_id) backstop satisfied while letting an operator replay the same
// run more than once.
func (s *AutomationService) Replay(ctx context.Context, tenantID, originalID string) (*model.Run, error) {
	var newRun *model.Run
	err := s.tenantTx(ctx, tenantID, func(db repository.DBTX) error {
		original, gerr := s.repo.GetRun(ctx, db, tenantID, originalID)
		if gerr != nil {
			return gerr
		}
		if !original.IsReplayable() {
			return fmt.Errorf("%w: run %s is %s, only a terminal (COMPLETED/FAILED/ABORTED) run can be replayed",
				ErrNonReplayable, originalID, original.Status)
		}
		// Gap check: the recorded inputs must cover every step the original
		// advanced through, else replay would re-execute from an incomplete record.
		steps, lerr := s.repo.ListRunSteps(ctx, db, originalID)
		if lerr != nil {
			return lerr
		}
		if gap := firstStepGap(original, steps); gap >= 0 {
			return fmt.Errorf("%w: run %s has a step-log gap at index %d; recorded inputs are incomplete",
				ErrNonReplayable, originalID, gap)
		}

		replayOf := original.ID
		newRun = &model.Run{
			TenantID:      tenantID,
			AutomationID:  original.AutomationID,
			RunbookID:     original.RunbookID,
			Status:        model.RunStatusPending,
			SourceEventID: s.newReplaySourceEventID(original),
			ReplayOf:      &replayOf,
			CurrentStep:   0,
			Trigger:       copyMap(original.Trigger), // the recorded replay input (§4.7)
			Variables:     map[string]any{},
		}
		return s.repo.CreateRun(ctx, db, newRun)
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().
		Str("tenant_id", tenantID).Str("replay_run_id", newRun.ID).Str("replay_of", originalID).
		Msg("automation run replay created from recorded inputs")
	return newRun, nil
}

// newReplaySourceEventID derives a fresh, deterministic-prefixed exactly-once key
// for a replay run so the (tenant_id, source_event_id) backstop is satisfied and
// repeated replays of the same original do not collide (the UUID suffix differs
// each call).
func (s *AutomationService) newReplaySourceEventID(original *model.Run) string {
	return fmt.Sprintf("replay:%s:%s", original.ID, s.newRunID())
}
