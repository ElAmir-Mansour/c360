package migrate

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// GenerateWaveRunbook builds a REAL runbook structure in the DR Runbook Studio
// engine for a wave and persists the resulting linkage so the previously-inert
// dr_runbook_id / migrate_runbook_binding columns become live references.
//
// Structure (hardening design §7.2/§7.3): ONE parent runbook for the wave (a
// milestone per move group, chained in dependency order) plus ONE child runbook
// per move group (a manual task per workload, chained in intra-group dependency
// order). The move-group order and the intra-group order are computed by REUSING
// the existing DR topology graph engine (internal/dr/topology) — no second BFS.
//
// The DR-engine authoring happens over HTTP (separate service + database), so it
// runs OUTSIDE the migrate tenant transaction; the binding rows and wave link are
// then persisted atomically in one migrate write transaction. Regeneration
// supersedes the prior bindings rather than destroying them (audit history).
func (s *Service) GenerateWaveRunbook(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*WaveRunbook, error) {
	if !actor.Can(PermMigratePlan) {
		return nil, ErrUnauthorized
	}
	if s.dr == nil {
		return nil, ErrDRBridgeUnavailable
	}

	// 1. Load the wave (with its move groups + workloads) and resolve the connector
	//    task plan (the tenant's enabled connectors, when the webhook is wired)
	//    read-only.
	var wave *Wave
	var connPlan connectorTaskPlan
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		wave, err = s.store.GetWave(ctx, tx, tenantID, waveID)
		if err != nil {
			return err
		}
		// Wave cutover runbooks run via a window whose dr_run_id is resolved at run
		// time, so the connector tasks carry no window id (the webhook resolves it
		// from the run id) — pass nil.
		connPlan, err = s.resolveConnectorTaskPlan(ctx, tx, tenantID, nil, ConnectorSourceCutoverRun)
		return err
	}); err != nil {
		return nil, err
	}

	// 2. Project the wave + ordered move groups (+ connector tasks) into the runbook
	//    structure (pure).
	plan, err := buildWaveRunbookPlan(*wave, connPlan)
	if err != nil {
		return nil, err
	}

	// 3. Author the parent + child runbooks in the DR engine (HTTP; outside any tx).
	parentRB, err := s.dr.CreateRunbook(ctx, tenantID, plan.Parent)
	if err != nil {
		return nil, fmt.Errorf("generate wave parent runbook: %w", err)
	}
	type createdChild struct {
		plan childRunbookPlan
		rb   *DRRunbook
	}
	children := make([]createdChild, 0, len(plan.Children))
	for _, cp := range plan.Children {
		childRB, cerr := s.dr.CreateRunbook(ctx, tenantID, cp.Request)
		if cerr != nil {
			return nil, fmt.Errorf("generate move-group runbook %s: %w", cp.MoveGroupRef, cerr)
		}
		children = append(children, createdChild{plan: cp, rb: childRB})
	}

	// 4. Persist the bindings + wave link atomically. Regeneration supersedes the
	// previous active bindings first so the current set is unambiguous.
	now := s.now()
	var result WaveRunbook
	result.WaveID = waveID
	err = s.tx.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.store.SupersedeWaveBindings(ctx, tx, tenantID, waveID); err != nil {
			return err
		}
		var actorID *uuid.UUID
		if actor.UserID != uuid.Nil {
			id := actor.UserID
			actorID = &id
		}
		parentBinding := &RunbookBinding{
			TenantID:    tenantID,
			ProgramID:   wave.ProgramID,
			WaveID:      &waveID,
			DRRunbookID: parentRB.ID,
			Role:        BindingRoleParent,
			Source:      BindingSourceGenerated,
			Status:      BindingStatusGenerated,
			Ordinal:     0,
			Detail:      map[string]any{"name": parentRB.Name, "task_count": len(parentRB.Tasks), "move_group_count": len(children)},
			CreatedBy:   actorID,
		}
		if err := s.store.CreateRunbookBinding(ctx, tx, parentBinding); err != nil {
			return err
		}
		result.Parent = *parentBinding

		for _, c := range children {
			mgID, perr := uuid.Parse(c.plan.MoveGroupID)
			if perr != nil {
				return fmt.Errorf("invalid move group id %q: %w", c.plan.MoveGroupID, ErrValidation)
			}
			childBinding := &RunbookBinding{
				TenantID:        tenantID,
				ProgramID:       wave.ProgramID,
				WaveID:          &waveID,
				MoveGroupID:     &mgID,
				DRRunbookID:     c.rb.ID,
				Role:            BindingRoleChild,
				ParentBindingID: &parentBinding.ID,
				Source:          BindingSourceGenerated,
				Status:          BindingStatusGenerated,
				Ordinal:         c.plan.Ordinal,
				Detail:          map[string]any{"move_group_ref": c.plan.MoveGroupRef, "task_count": len(c.rb.Tasks)},
				CreatedBy:       actorID,
			}
			if err := s.store.CreateRunbookBinding(ctx, tx, childBinding); err != nil {
				return err
			}
			result.Children = append(result.Children, *childBinding)
		}

		if err := s.store.LinkWaveRunbook(ctx, tx, tenantID, waveID, parentRB.ID, wave.DRTopologyGroupID, now); err != nil {
			return err
		}

		return s.audit(ctx, tx, tenantID, wave.ProgramID, actorID, "wave.runbook_generated", &waveID, "wave",
			"Wave cutover runbook generated in DR Runbook Studio",
			map[string]any{"dr_runbook_id": parentRB.ID, "move_group_runbooks": len(children)}, now)
	})
	if err != nil {
		return nil, err
	}
	result.Runbook = parentRB
	s.logger.Info().Str("tenant_id", tenantID.String()).Str("wave_id", waveID.String()).
		Str("dr_runbook_id", parentRB.ID.String()).Int("move_group_runbooks", len(children)).
		Msg("migrate wave runbook generated")
	return &result, nil
}

// GetWaveRunbook returns the current generated runbook binding for a wave and,
// when the DR engine is reachable, hydrates the live parent runbook (and live run
// state if a run has been started) so the UI can render the generated structure.
func (s *Service) GetWaveRunbook(ctx context.Context, tenantID, waveID uuid.UUID, actor Actor) (*WaveRunbook, error) {
	if !actor.Can(PermMigrateRead) {
		return nil, ErrUnauthorized
	}
	var parent *RunbookBinding
	var bindings []RunbookBinding
	if err := s.tx.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		parent, err = s.store.GetParentBindingForWave(ctx, tx, tenantID, waveID)
		if err != nil {
			return err
		}
		bindings, err = s.store.ListBindingsForWave(ctx, tx, tenantID, waveID)
		return err
	}); err != nil {
		return nil, err
	}

	out := &WaveRunbook{WaveID: waveID, Parent: *parent}
	for _, b := range bindings {
		if b.Role == BindingRoleChild {
			out.Children = append(out.Children, b)
		}
	}

	// Hydrate live engine state. If the DR engine is unreachable we still return the
	// persisted bindings (the linkage is real and stored), so the read degrades
	// gracefully rather than failing the whole request.
	if s.dr != nil {
		if rb, err := s.dr.GetRunbook(ctx, tenantID, parent.DRRunbookID); err == nil {
			out.Runbook = rb
		} else if !errors.Is(err, ErrDRBridgeUnavailable) {
			return nil, err
		}
		if parent.DRRunID != nil {
			if ls, err := s.dr.GetRun(ctx, tenantID, *parent.DRRunID); err == nil {
				out.LiveState = ls
			} else if !errors.Is(err, ErrDRBridgeUnavailable) {
				return nil, err
			}
		}
	}
	return out, nil
}
