package migrate

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// rollback_execution.go (Wave 3, P8) generates and executes a ROLLBACK runbook
// for a cutover window through the existing DR Runbook Studio engine. The
// rollback runbook is its OWN DR runbook (BindingRoleRollback): it carries one
// task per workload in REVERSE cutover order (a migrated workload is reverted
// after the workloads that depend on it have been reverted), produced by reusing
// the same wave→runbook generation seams. ExecuteRollback records the
// trigger-decision provenance (who + why) and starts the rollback run via the
// bridge; on success the wave and its workloads transition into the RolledBack
// states, making those previously-unreachable enum states reachable through a
// real, gated execution path.

// GenerateRollbackRunbook authors an isolated rollback runbook in the DR engine
// for a window's wave and persists a role='rollback' binding plus the runbook id
// on the window's rollback plan. It requires an approved rollback plan (the same
// precondition as executing a rollback) so an unplanned rollback can never be
// generated. Regeneration supersedes the prior rollback binding (audit history).
func (s *Service) GenerateRollbackRunbook(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*RunbookBinding, error) {
	if !actor.Can(PermMigrateRollback) {
		return nil, ErrUnauthorized
	}
	if s.dr == nil {
		return nil, ErrDRBridgeUnavailable
	}

	var window *CutoverWindow
	var wave *Wave
	var plan *RollbackPlan
	var connPlan connectorTaskPlan
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		plan, err = s.store.GetRollbackPlanForWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		if plan.Decision != DecisionApproved {
			return ErrRollbackPlanRequired
		}
		wave, err = s.store.GetWave(ctx, tx, tenantID, window.WaveID)
		if err != nil {
			return err
		}
		// The window is known at rollback generation, so the connector tasks carry
		// its id directly (the webhook resolves the window from it rather than a run).
		connPlan, err = s.resolveConnectorTaskPlan(ctx, tx, tenantID, &windowID, ConnectorSourceRollbackRun)
		return err
	}); err != nil {
		return nil, err
	}

	req, err := buildRollbackRunbookRequest(*wave, *window, connPlan)
	if err != nil {
		return nil, err
	}

	// Author the isolated rollback runbook in the DR engine (HTTP; outside any tx).
	rollbackRB, err := s.dr.CreateRunbook(ctx, tenantID, req)
	if err != nil {
		return nil, fmt.Errorf("generate rollback runbook: %w", err)
	}

	now := s.now()
	var binding *RunbookBinding
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.store.SupersedeWindowRollbackBindings(ctx, tx, tenantID, windowID); err != nil {
			return err
		}
		b := &RunbookBinding{
			TenantID:    tenantID,
			ProgramID:   window.ProgramID,
			WaveID:      &window.WaveID,
			WindowID:    &windowID,
			DRRunbookID: rollbackRB.ID,
			Role:        BindingRoleRollback,
			Source:      BindingSourceGenerated,
			Status:      BindingStatusGenerated,
			Ordinal:     0,
			Detail:      map[string]any{"name": rollbackRB.Name, "task_count": len(rollbackRB.Tasks), "kind": "rollback"},
			CreatedBy:   actorPtr(actor.UserID),
		}
		if err := s.store.CreateRunbookBinding(ctx, tx, b); err != nil {
			return err
		}
		binding = b
		if err := s.store.LinkRollbackPlanRunbook(ctx, tx, tenantID, plan.ID, rollbackRB.ID); err != nil {
			return err
		}
		return s.audit(ctx, tx, tenantID, window.ProgramID, actorPtr(actor.UserID), "rollback.runbook_generated", &windowID, "cutover_window",
			"Rollback runbook generated in DR Runbook Studio", map[string]any{"dr_runbook_id": rollbackRB.ID, "task_count": len(rollbackRB.Tasks)}, now)
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("window_id", windowID.String()).
		Str("dr_runbook_id", rollbackRB.ID.String()).Msg("migrate rollback runbook generated")
	return binding, nil
}

// ExecuteRollback records the trigger-decision provenance (who triggered it +
// reason) and STARTS the rollback runbook run via the bridge. It auto-generates
// the rollback runbook if one has not been generated yet, so a single call is
// sufficient to trigger a rollback. The started run id is exposed via
// GetRollbackRun / GetWindowRun. It requires the rollback permission and an
// approved rollback plan; the reason is mandatory provenance.
func (s *Service) ExecuteRollback(ctx context.Context, tenantID, windowID uuid.UUID, reason, mode string, actor Actor) (*RollbackRun, error) {
	if !actor.Can(PermMigrateRollback) {
		return nil, ErrUnauthorized
	}
	if s.dr == nil {
		return nil, ErrDRBridgeUnavailable
	}
	reason = strings.TrimSpace(reason)
	if reason == "" {
		return nil, fmt.Errorf("a rollback reason is required for provenance: %w", ErrValidation)
	}
	if mode == "" {
		mode = "live"
	}
	if actor.UserID == uuid.Nil {
		return nil, ErrUnauthorized
	}

	// Ensure a rollback runbook binding exists (generate on demand).
	var binding *RunbookBinding
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		binding, err = s.store.GetActiveRollbackBindingForWindow(ctx, tx, tenantID, windowID)
		return err
	}); err != nil {
		if !errors.Is(err, ErrNotFound) {
			return nil, err
		}
		if _, err := s.GenerateRollbackRunbook(ctx, tenantID, windowID, actor); err != nil {
			return nil, err
		}
		if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
			var rerr error
			binding, rerr = s.store.GetActiveRollbackBindingForWindow(ctx, tx, tenantID, windowID)
			return rerr
		}); err != nil {
			return nil, err
		}
	}

	// Load + gate the window/plan read-only before touching the DR engine.
	var window *CutoverWindow
	var plan *RollbackPlan
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		plan, err = s.store.GetRollbackPlanForWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		if plan.Decision != DecisionApproved {
			return ErrRollbackPlanRequired
		}
		return nil
	}); err != nil {
		return nil, err
	}

	// Start the rollback run in the DR engine (HTTP, outside any migrate tx).
	live, err := s.dr.StartRun(ctx, tenantID, binding.DRRunbookID, mode)
	if err != nil {
		return nil, fmt.Errorf("start rollback run: %w", err)
	}

	now := s.now()
	var run *RollbackRun
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		planID := plan.ID
		bindingID := binding.ID
		run = &RollbackRun{
			TenantID:       tenantID,
			ProgramID:      window.ProgramID,
			WindowID:       windowID,
			WaveID:         window.WaveID,
			RollbackPlanID: &planID,
			BindingID:      &bindingID,
			DRRunbookID:    binding.DRRunbookID,
			DRRunID:        live.RunID,
			TriggeredBy:    actor.UserID,
			Reason:         reason,
			Status:         RollbackRunRunning,
		}
		if err := s.store.CreateRollbackRun(ctx, tx, run); err != nil {
			return err
		}
		if err := s.store.SetBindingRun(ctx, tx, tenantID, binding.ID, live.RunID, BindingStatusRunning); err != nil {
			return err
		}
		if err := s.audit(ctx, tx, tenantID, window.ProgramID, actorPtr(actor.UserID), "rollback.run_started", &windowID, "cutover_window",
			"Rollback DR runbook run started", map[string]any{
				"dr_runbook_id": binding.DRRunbookID, "dr_run_id": live.RunID, "reason": reason, "triggered_by": actor.UserID,
			}, now); err != nil {
			return err
		}
		// Rollback initiated — stage the event in the SAME tx as the provenance
		// record so executors/managers are notified the moment a rollback starts.
		return s.stageEvent(ctx, tx, tenantID, EventRollbackInitiated, actorPtr(actor.UserID), RollbackEvent{
			ProgramID:   window.ProgramID,
			WaveID:      window.WaveID,
			WindowID:    windowID,
			Reference:   window.Reference,
			Reason:      reason,
			DRRunbookID: binding.DRRunbookID.String(),
			DRRunID:     live.RunID.String(),
			RunStatus:   live.Status,
			TriggeredBy: actor.UserID.String(),
		})
	})
	if err != nil {
		return nil, err
	}
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("window_id", windowID.String()).
		Str("dr_run_id", live.RunID.String()).Str("triggered_by", actor.UserID.String()).
		Msg("migrate rollback run started")
	return run, nil
}

// GetRollbackRun returns the latest rollback-run provenance for a window plus its
// live DR run state. When the rollback run has SUCCEEDED in the DR engine, this
// is also the transition point: the wave and its member workloads are moved into
// the RolledBack states (idempotently), making those enum states reachable
// through this real, success-gated path.
func (s *Service) GetRollbackRun(ctx context.Context, tenantID, windowID uuid.UUID, actor Actor) (*RollbackRun, *DRRunLiveState, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, nil, ErrUnauthorized
	}

	var run *RollbackRun
	var window *CutoverWindow
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		run, err = s.store.LatestRollbackRunForWindow(ctx, tx, tenantID, windowID)
		if err != nil {
			return err
		}
		window, err = s.store.GetWindow(ctx, tx, tenantID, windowID)
		return err
	}); err != nil {
		return nil, nil, err
	}

	if s.dr == nil {
		return run, nil, nil
	}
	live, err := s.dr.GetRun(ctx, tenantID, run.DRRunID)
	if err != nil {
		if errors.Is(err, ErrDRBridgeUnavailable) {
			return run, nil, nil
		}
		return nil, nil, err
	}

	// Success-criteria gate + transitions: only on a genuinely COMPLETED rollback
	// run (the DR engine's "all required tasks done" signal) do we move the wave +
	// workloads to rolled_back. This is idempotent and runs at most once.
	if live.Succeeded() && run.Status != RollbackRunCompleted {
		now := s.now()
		if err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
			return s.applyRollbackSuccess(ctx, tx, tenantID, window, run, actor.UserID, now)
		}); err != nil {
			return nil, nil, err
		}
		// Re-read the updated provenance row.
		if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
			var rerr error
			run, rerr = s.store.GetRollbackRunByID(ctx, tx, tenantID, run.ID)
			return rerr
		}); err != nil {
			return nil, nil, err
		}
	} else if live.Failed() && run.Status == RollbackRunRunning {
		now := s.now()
		failStatus := status2RollbackStatus(live.Status)
		if err := s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
			if err := s.store.SetRollbackRunStatus(ctx, tx, tenantID, run.ID, failStatus); err != nil {
				return err
			}
			if run.BindingID != nil {
				if err := s.store.SetBindingStatus(ctx, tx, tenantID, *run.BindingID, BindingStatusFailed); err != nil {
					return err
				}
			}
			return s.audit(ctx, tx, tenantID, window.ProgramID, actorPtr(actor.UserID), "rollback.run_failed", &windowID, "cutover_window",
				"Rollback DR run failed", map[string]any{"dr_run_id": run.DRRunID, "run_status": live.Status}, now)
		}); err != nil {
			return nil, nil, err
		}
		run.Status = failStatus
	}

	return run, live, nil
}

func status2RollbackStatus(drStatus string) RollbackRunStatus {
	if drStatus == DRRunStatusAborted {
		return RollbackRunAborted
	}
	return RollbackRunFailed
}

// applyRollbackSuccess moves the wave and its member workloads into the
// rolled_back states and marks the provenance + binding complete. It is the
// single real path that makes WaveRolledBack / WorkloadRolledBack reachable.
func (s *Service) applyRollbackSuccess(ctx context.Context, tx DBTX, tenantID uuid.UUID, window *CutoverWindow, run *RollbackRun, actorUserID uuid.UUID, at time.Time) error {
	wave, err := s.store.GetWave(ctx, tx, tenantID, window.WaveID)
	if err != nil {
		return err
	}
	if wave.Status != WaveRolledBack {
		if _, err := s.store.UpdateWaveStatus(ctx, tx, tenantID, wave.ID, wave.Status, WaveRolledBack, wave.RowVersion, at); err != nil && !errors.Is(err, ErrVersionConflict) {
			return err
		}
	}
	if _, err := s.advanceWaveWorkloads(ctx, tx, tenantID, window.ProgramID, wave.ID, "rollback", actorUserID, at); err != nil {
		return err
	}
	if err := s.store.SetRollbackRunStatus(ctx, tx, tenantID, run.ID, RollbackRunCompleted); err != nil {
		return err
	}
	if run.BindingID != nil {
		if err := s.store.SetBindingStatus(ctx, tx, tenantID, *run.BindingID, BindingStatusCompleted); err != nil {
			return err
		}
	}
	if err := s.audit(ctx, tx, tenantID, window.ProgramID, actorPtr(actorUserID), "rollback.run_completed", &window.ID, "cutover_window",
		"Rollback DR run completed; wave and workloads rolled back", map[string]any{
			"dr_run_id": run.DRRunID, "wave_id": wave.ID, "reason": run.Reason,
		}, at); err != nil {
		return err
	}
	// Rollback completed — wave + workloads are rolled back. Stage the completion
	// event in the SAME tx as the terminal state change.
	return s.stageEvent(ctx, tx, tenantID, EventRollbackCompleted, actorPtr(actorUserID), RollbackEvent{
		ProgramID:   window.ProgramID,
		WaveID:      wave.ID,
		WindowID:    window.ID,
		Reference:   window.Reference,
		Reason:      run.Reason,
		DRRunbookID: run.DRRunbookID.String(),
		DRRunID:     run.DRRunID.String(),
		TriggeredBy: actorIDString(run.TriggeredBy),
	})
}

// buildRollbackRunbookRequest projects a wave into a rollback runbook request:
// one manual task per workload, in REVERSE cutover order (so a workload is
// reverted only after the workloads that depend on it have been reverted),
// flattened across the wave's move groups. It reuses the same ordering engine
// (orderMoveGroups / orderWorkloads) as the forward generator and then reverses
// the result — no second algorithm. The runbook is bound to the wave's DR
// topology group when one exists, mirroring the forward runbook.
func buildRollbackRunbookRequest(wave Wave, window CutoverWindow, connPlan connectorTaskPlan) (CreateDRRunbookRequest, error) {
	orderedGroups, err := orderMoveGroups(wave.MoveGroups)
	if err != nil {
		return CreateDRRunbookRequest{}, err
	}

	// Forward execution order across the whole wave (groups in dependency order,
	// workloads in intra-group dependency order).
	var forward []Workload
	groupRefByApp := map[string]string{}
	for _, g := range orderedGroups {
		wls, werr := orderWorkloads(g)
		if werr != nil {
			return CreateDRRunbookRequest{}, werr
		}
		for _, wl := range wls {
			forward = append(forward, wl)
			groupRefByApp[wl.AppKey] = g.Reference
		}
	}
	if len(forward) == 0 {
		return CreateDRRunbookRequest{}, fmt.Errorf("wave %s has no workloads to roll back: %w", wave.Reference, ErrValidation)
	}

	req := CreateDRRunbookRequest{
		Name:        runbookName("Rollback", wave.Reference, wave.Name),
		Description: fmt.Sprintf("Rollback runbook for wave %s (window %s) — reverts %d workload(s) in reverse cutover order", wave.Reference, window.Reference, len(forward)),
	}
	if wave.DRTopologyGroupID != nil {
		req.GroupID = wave.DRTopologyGroupID.String()
	}

	// Reverse order: the last-migrated workload is reverted first.
	for i := len(forward) - 1; i >= 0; i-- {
		wl := forward[i]
		dur, src := workloadDurationSeconds(wl)
		req.ImportSteps = append(req.ImportSteps, DRImportStep{
			Key:                    "rb-" + sanitizeKey(wl.AppKey),
			Name:                   "Roll back " + workloadTaskName(wl),
			TaskType:               "manual",
			Required:               true,
			Owner:                  firstNonEmpty(wl.OwnerName),
			Instructions:           rollbackInstructions(wl),
			PlannedDurationSeconds: dur,
			Params: map[string]any{
				"migrate_workload_id": wl.ID.String(),
				"app_key":             wl.AppKey,
				"move_group_ref":      groupRefByApp[wl.AppKey],
				"strategy":            string(wl.Strategy),
				"duration_source":     src,
				"kind":                "rollback",
			},
		})
	}

	// P10a: emit one AUTOMATED connector-invocation task per configured, enabled
	// connector AFTER the reversion tasks, so each connector is invoked (via
	// migrate's webhook, dispatched by the DR engine's Executor) once the wave's
	// workloads have been reverted. The "rollback" action tells the connector this
	// is the revert phase; the window is known at rollback generation, so its id is
	// carried in the task params for the webhook to resolve.
	for _, connector := range connPlan.connectors {
		req.ImportSteps = append(req.ImportSteps, connPlan.automationTask(connector, "rollback", "rollback"))
	}
	return req, nil
}

func rollbackInstructions(w Workload) string {
	parts := []string{fmt.Sprintf("Revert %s (%s migration) to its source environment", w.AppKey, w.Strategy)}
	if strings.TrimSpace(w.SourceEnv) != "" {
		parts = append(parts, "restore "+w.SourceEnv)
	}
	if strings.TrimSpace(w.TargetCloud) != "" {
		parts = append(parts, "decommission target in "+w.TargetCloud)
	}
	return strings.Join(parts, "; ") + "."
}
