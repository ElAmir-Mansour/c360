package migrate

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// cutover_execution.go (Wave 3, P7) drives the LIVE EXECUTION of a wave's
// generated cutover runbook through the existing DR Runbook Studio engine via the
// Wave-2 bridge. It never builds a second engine: it starts a DR run of the
// wave's generated parent runbook, proxies per-task actions, exposes the live
// run state, and ties the validation gate to the REAL run state (the DR engine
// reports "completed" only once every required task is done — see
// runbookstudio.Service.decideRunOutcome). On real cutover success the member
// workloads are advanced through their lifecycle via the Wave-1 transition path.

// StartWindowRun starts a live DR run of the wave's generated cutover runbook for
// a window and persists the returned DR run id into BOTH the window
// (LinkWindowRun → dr_run_id stops being write-only) and the wave's parent
// binding (SetBindingRun). It is gated exactly like StartCutover: a go decision,
// an approved rollback plan, and passing required readiness checks. It also
// drives member workloads into the migration/cutover phase, so starting the live
// run and progressing the workloads happen atomically.
func (s *Service) StartWindowRun(ctx context.Context, tenantID, windowID uuid.UUID, mode string, actor Actor) (*WindowRun, error) {
	if !actor.Can(PermMigrateCutover) {
		return nil, ErrUnauthorized
	}
	if s.dr == nil {
		return nil, ErrDRBridgeUnavailable
	}
	if mode == "" {
		mode = "live"
	}

	now := s.now()
	var out WindowRun
	out.WindowID = windowID

	// 1. Load + gate-check the window and resolve the wave's generated parent
	//    binding, all read-only, before touching the DR engine.
	var window *CutoverWindow
	var parentBinding *RunbookBinding
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		if window.Decision != DecisionGo {
			return ErrGoNoGoRequired
		}
		plan, err := s.store.GetRollbackPlanForWindow(ctx, tx, tenantID, windowID)
		if err != nil || plan.Decision != DecisionApproved {
			return ErrRollbackPlanRequired
		}
		readinessKind := CheckReadiness
		checks, err := s.store.ListGateChecks(ctx, tx, tenantID, windowID, &readinessKind)
		if err != nil {
			return err
		}
		if requiredChecksBlock(checks) {
			return ErrReadinessBlocked
		}
		parentBinding, err = s.store.GetParentBindingForWave(ctx, tx, tenantID, window.WaveID)
		return err
	}); err != nil {
		return nil, err
	}
	out.WaveID = window.WaveID

	// Idempotency: if this window already started a cutover run that is still live
	// (non-terminal) in the DR engine, return THAT run rather than starting a
	// second one — a double start-run must not spawn a duplicate cutover run. A
	// terminal prior run (completed/failed/aborted) is not reusable, so we fall
	// through and start a fresh run.
	if window.DRRunID != nil {
		if existing, gerr := s.dr.GetRun(ctx, tenantID, *window.DRRunID); gerr == nil && !existing.Terminal() {
			out.LiveState = existing
			if refreshed, berr := s.reloadBinding(ctx, tenantID, parentBinding.ID); berr == nil {
				out.Binding = refreshed
			} else {
				out.Binding = parentBinding
			}
			s.logger.Info().Str("tenant_id", tenantID.String()).Str("window_id", windowID.String()).
				Str("dr_run_id", existing.RunID.String()).Msg("migrate cutover run already live; returning existing run (idempotent)")
			return &out, nil
		} else if gerr != nil && !errors.Is(gerr, ErrDRBridgeUnavailable) && !errors.Is(gerr, ErrDRBridgeRejected) && !errors.Is(gerr, ErrNotFound) {
			return nil, gerr
		}
	}

	// 2. Start the live run in the DR engine (HTTP, outside any migrate tx).
	live, err := s.dr.StartRun(ctx, tenantID, parentBinding.DRRunbookID, mode)
	if err != nil {
		return nil, fmt.Errorf("start cutover run: %w", err)
	}
	out.LiveState = live

	// 3. Persist the run linkage + advance member workloads atomically.
	var actorID *uuid.UUID
	if actor.UserID != uuid.Nil {
		id := actor.UserID
		actorID = &id
	}
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.store.LinkWindowRun(ctx, tx, tenantID, windowID, parentBinding.DRRunbookID, live.RunID, actorID, now); err != nil {
			return err
		}
		if err := s.store.SetBindingRun(ctx, tx, tenantID, parentBinding.ID, live.RunID, BindingStatusRunning); err != nil {
			return err
		}
		// Move the wave to in_progress (idempotent: tolerate a concurrent change).
		wave, err := s.store.GetWave(ctx, tx, tenantID, window.WaveID)
		if err != nil {
			return err
		}
		if wave.Status == WaveReady || wave.Status == WavePlanned || wave.Status == WavePaused {
			if _, err := s.store.UpdateWaveStatus(ctx, tx, tenantID, wave.ID, wave.Status, WaveInProgress, wave.RowVersion, now); err != nil && !errors.Is(err, ErrVersionConflict) {
				return err
			}
		}
		// Drive member workloads planned -> in_migration -> cutover.
		if _, err := s.advanceWaveWorkloads(ctx, tx, tenantID, window.ProgramID, wave.ID, "start", actor.UserID, now); err != nil {
			return err
		}
		refreshed, err := s.store.GetBindingByID(ctx, tx, tenantID, parentBinding.ID)
		if err != nil {
			return err
		}
		out.Binding = refreshed
		if err := s.audit(ctx, tx, tenantID, window.ProgramID, actorID, "cutover.run_started", &windowID, "cutover_window",
			"Cutover DR runbook run started", map[string]any{
				"dr_runbook_id": parentBinding.DRRunbookID, "dr_run_id": live.RunID, "mode": mode,
			}, now); err != nil {
			return err
		}
		// Stage the cutover-started event in the SAME tx as the run linkage +
		// workload advance, so executors/managers are notified the moment the live
		// cutover run begins — atomically with the state change.
		return s.stageEvent(ctx, tx, tenantID, EventCutoverStarted, actorID, CutoverEvent{
			ProgramID:   window.ProgramID,
			WaveID:      window.WaveID,
			WindowID:    windowID,
			Reference:   window.Reference,
			Mode:        mode,
			DRRunbookID: parentBinding.DRRunbookID.String(),
			DRRunID:     live.RunID.String(),
			RunStatus:   live.Status,
			ActorID:     actor.UserID.String(),
		})
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("window_id", windowID.String()).
		Str("dr_run_id", live.RunID.String()).Msg("migrate cutover run started")
	return &out, nil
}

// ActOnWindowTask completes/skips/fails one task of the window's live cutover run
// by PROXYING to the DR engine, then returns the recomputed live state. When the
// action drives the run to a successful completion, the member workloads are
// advanced to live and the wave is completed — the validation gate is therefore
// the DR engine's own "all required tasks done" determination, not a canned
// string. A run that fails is reflected on the binding status.
func (s *Service) ActOnWindowTask(ctx context.Context, tenantID, windowID, taskID uuid.UUID, action DRTaskAction, note string, failRun bool, actor Actor) (*WindowRun, error) {
	if !actor.Can(PermMigrateCutover) {
		return nil, ErrUnauthorized
	}
	if s.dr == nil {
		return nil, ErrDRBridgeUnavailable
	}
	if !action.Valid() {
		return nil, fmt.Errorf("%w: action must be complete, skip, or fail", ErrValidation)
	}

	var window *CutoverWindow
	var parentBinding *RunbookBinding
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		if window.DRRunID == nil {
			return fmt.Errorf("%w: cutover run not started", ErrInvalidStatus)
		}
		parentBinding, err = s.store.GetParentBindingForWave(ctx, tx, tenantID, window.WaveID)
		return err
	}); err != nil {
		return nil, err
	}

	live, err := s.dr.ActOnTask(ctx, tenantID, *window.DRRunID, taskID, action, note, failRun)
	if err != nil {
		return nil, fmt.Errorf("act on cutover task: %w", err)
	}

	out := &WindowRun{WindowID: windowID, WaveID: window.WaveID, LiveState: live}
	now := s.now()
	var actorID *uuid.UUID
	if actor.UserID != uuid.Nil {
		id := actor.UserID
		actorID = &id
	}

	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.reconcileCutoverRunState(ctx, tx, tenantID, window, parentBinding, live, actor.UserID, now); err != nil {
			return err
		}
		refreshed, err := s.store.GetBindingByID(ctx, tx, tenantID, parentBinding.ID)
		if err != nil {
			return err
		}
		out.Binding = refreshed
		return s.audit(ctx, tx, tenantID, window.ProgramID, actorID, "cutover.task_acted", &windowID, "cutover_window",
			fmt.Sprintf("Cutover task %s on run %s", action, *window.DRRunID), map[string]any{
				"task_id": taskID, "action": string(action), "run_status": live.Status,
			}, now)
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// GetWindowRun returns the live cutover run state for a window by proxying
// GetRun, plus the persisted binding + any rollback-run provenance.
func (s *Service) GetWindowRun(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*WindowRun, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}

	var window *CutoverWindow
	var parentBinding *RunbookBinding
	var rollback *RollbackRun
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		parentBinding, err = s.store.GetParentBindingForWave(ctx, tx, tenantID, window.WaveID)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		rollback, err = s.store.LatestRollbackRunForWindow(ctx, tx, tenantID, windowID)
		if err != nil && !errors.Is(err, ErrNotFound) {
			return err
		}
		if errors.Is(err, ErrNotFound) {
			rollback = nil
		}
		return nil
	}); err != nil {
		return nil, err
	}

	out := &WindowRun{WindowID: windowID, WaveID: window.WaveID, Binding: parentBinding, RollbackRun: rollback}
	if window.DRRunID == nil {
		return out, nil
	}
	if s.dr == nil {
		return out, nil
	}
	live, err := s.dr.GetRun(ctx, tenantID, *window.DRRunID)
	if err != nil {
		// Degrade gracefully: the persisted linkage is real even if the engine is
		// momentarily unreachable.
		if errors.Is(err, ErrDRBridgeUnavailable) {
			return out, nil
		}
		return nil, err
	}
	out.LiveState = live

	// Reconcile a terminal run that has not yet been finalized in the migrate
	// domain (e.g. the run completed out-of-band, or a prior reconcile was held
	// back by a then-failing validation check that now passes). This is
	// idempotent and only an actor permitted to drive a cutover triggers it, so a
	// pure reader never causes state changes.
	if parentBinding != nil && live.Terminal() &&
		parentBinding.Status != BindingStatusCompleted && parentBinding.Status != BindingStatusFailed &&
		actor.Can(PermMigrateCutover) {
		now := s.now()
		if rerr := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
			return s.reconcileCutoverRunState(ctx, tx, tenantID, window, parentBinding, live, actor.UserID, now)
		}); rerr != nil {
			// A still-blocking validation check is not an error for a read; surface
			// the live state and let the caller act on the gate.
			if !errors.Is(rerr, ErrValidationBlocked) {
				return nil, rerr
			}
		} else if refreshed, gerr := s.reloadBinding(ctx, tenantID, parentBinding.ID); gerr == nil {
			out.Binding = refreshed
		}
	}
	return out, nil
}

// reloadBinding re-reads a binding row after a reconcile so the response carries
// the finalized status.
func (s *Service) reloadBinding(ctx context.Context, tenantID, bindingID uuid.UUID) (*RunbookBinding, error) {
	var b *RunbookBinding
	err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var rerr error
		b, rerr = s.store.GetBindingByID(ctx, tx, tenantID, bindingID)
		return rerr
	})
	return b, err
}

// reconcileCutoverRunState reflects a cutover run's terminal outcome into the
// migrate domain. On SUCCESS (the DR engine's "completed" — all required tasks
// done) it completes the wave and advances member workloads to live, gated on
// any required validation checks. On FAILURE it marks the binding failed. While
// the run is still running nothing terminal is applied. This is the REAL
// validation gate: it reacts to the engine's own run state, not a canned string.
func (s *Service) reconcileCutoverRunState(ctx context.Context, tx DBTX, tenantID uuid.UUID, window *CutoverWindow, binding *RunbookBinding, live *DRRunLiveState, actorUserID uuid.UUID, at time.Time) error {
	switch {
	case live.Succeeded():
		if err := s.store.SetBindingStatus(ctx, tx, tenantID, binding.ID, BindingStatusCompleted); err != nil {
			return err
		}
		// Any operator-defined required validation checks must also pass before
		// the workloads are declared live (belt-and-braces over the run signal).
		validationKind := CheckValidation
		checks, err := s.store.ListGateChecks(ctx, tx, tenantID, window.ID, &validationKind)
		if err != nil {
			return err
		}
		if validationChecksDefinedAndBlock(checks) {
			return ErrValidationBlocked
		}
		wave, err := s.store.GetWave(ctx, tx, tenantID, window.WaveID)
		if err != nil {
			return err
		}
		if wave.Status == WaveInProgress || wave.Status == WaveCutover {
			from := wave.Status
			// Two legal hops may be required: in_progress -> cutover -> completed.
			if from == WaveInProgress {
				updated, err := s.store.UpdateWaveStatus(ctx, tx, tenantID, wave.ID, WaveInProgress, WaveCutover, wave.RowVersion, at)
				if err != nil && !errors.Is(err, ErrVersionConflict) {
					return err
				}
				if err == nil {
					wave = updated
				}
			}
			if wave.Status == WaveCutover {
				if _, err := s.store.UpdateWaveStatus(ctx, tx, tenantID, wave.ID, WaveCutover, WaveCompleted, wave.RowVersion, at); err != nil && !errors.Is(err, ErrVersionConflict) {
					return err
				}
			}
		}
		if _, err := s.advanceWaveWorkloads(ctx, tx, tenantID, window.ProgramID, window.WaveID, "complete", actorUserID, at); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, window.ProgramID, actorPtr(actorUserID), "cutover.run_completed", &window.ID, "cutover_window",
			"Cutover DR run completed; workloads advanced to live", map[string]any{"dr_run_id": binding.DRRunID}, at); err != nil {
			return err
		}
		// Cutover completed — workloads are live. Stage the completion event in the
		// SAME tx as the terminal state change.
		return s.stageEvent(ctx, tx, tenantID, EventCutoverCompleted, actorPtr(actorUserID), CutoverEvent{
			ProgramID:   window.ProgramID,
			WaveID:      window.WaveID,
			WindowID:    window.ID,
			Reference:   window.Reference,
			DRRunbookID: binding.DRRunbookID.String(),
			DRRunID:     drRunIDString(binding.DRRunID),
			RunStatus:   live.Status,
			ActorID:     actorIDString(actorUserID),
		})
	case live.Failed():
		if err := s.store.SetBindingStatus(ctx, tx, tenantID, binding.ID, BindingStatusFailed); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, window.ProgramID, actorPtr(actorUserID), "cutover.run_failed", &window.ID, "cutover_window",
			"Cutover DR run failed", map[string]any{"dr_run_id": binding.DRRunID, "run_status": live.Status}, at); err != nil {
			return err
		}
		return s.stageEvent(ctx, tx, tenantID, EventCutoverFailed, actorPtr(actorUserID), CutoverEvent{
			ProgramID:   window.ProgramID,
			WaveID:      window.WaveID,
			WindowID:    window.ID,
			Reference:   window.Reference,
			DRRunbookID: binding.DRRunbookID.String(),
			DRRunID:     drRunIDString(binding.DRRunID),
			RunStatus:   live.Status,
			ActorID:     actorIDString(actorUserID),
		})
	default:
		return nil // still running; nothing terminal to apply
	}
}

// validationChecksDefinedAndBlock reports whether any REQUIRED validation check
// is defined and not yet passing. Unlike requiredChecksBlock, the absence of any
// required check does NOT block here — the DR run's own "all required tasks done"
// signal is the primary gate, and operators may add validation checks on top.
func validationChecksDefinedAndBlock(checks []GateCheck) bool {
	for _, c := range checks {
		if !c.Required {
			continue
		}
		if c.Status != CheckPassed && c.Status != CheckOverridden {
			return true
		}
	}
	return false
}

func actorPtr(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}
