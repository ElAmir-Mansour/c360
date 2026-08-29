package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// GAP 4 — Incident + dead-letter model with governed operator intervention.
//
// This file builds on the transactional advance path (Impl-A): the step
// transition is committed atomically (CommitStepTransition), the hot execute /
// advance entry is serialized per-instance (SerializeInstance + local mutex), and
// the retry loop is bounded. Here we replace the "retry exhaustion terminates the
// WHOLE instance" behaviour (failInstance) with:
//
//   * raiseIncident        — park the failed step, open an incident, put the
//                            instance into the 'incident' status ATOMICALLY (the
//                            instance row locked FOR UPDATE) so a crash between
//                            opening the incident and parking the instance cannot
//                            tear state. Other steps / parallel branches survive.
//   * RetryIncident        — re-run the failed step (not sensitive → no override).
//   * SkipIncidentStep     — mark the step done + advance (SENSITIVE → override).
//   * ModifyVariablesAndRetryIncident — mutate variables then retry (SENSITIVE).
//   * RequestOverride/ApproveOverride/RejectOverride — maker-checker (four-eyes)
//                            using the approval-chain distinct-actor primitive,
//                            fail-closed: the maker may NOT approve.
//   * AbandonIncident      — dead-letter an incident with full replay context.
//
// Every incident + every override (who / what / old / new) is written into the
// audit trail the engine emits (publishEvent → workflow events → audit pipeline).

// raiseIncident parks the failed step under a governed incident instead of
// failing the whole instance. The caller (handleStepFailure) MUST already hold
// the per-instance critical section, and inst must reflect the failed step in
// CurrentStepID. currentExec is the exhausted attempt.
func (s *EngineService) raiseIncident(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition, currentExec *model.StepExecution, execErr error, maxRetries int) error {
	// Mark the failed step-execution row as an incident (distinct from a plain
	// 'failed' attempt) so the history shows it is parked under an incident.
	currentExec.Status = model.StepStatusIncident
	if err := s.instanceRepo.UpdateStepExecution(ctx, currentExec); err != nil {
		s.logger.Error().Err(err).
			Str("instance_id", inst.ID).
			Str("step_id", step.ID).
			Msg("failed to mark step execution as incident")
	}

	details, _ := json.Marshal(map[string]interface{}{
		"max_retries":       maxRetries,
		"definition_id":     inst.DefinitionID,
		"definition_ver":    inst.DefinitionVer,
		"step_type":         step.Type,
		"final_attempt":     currentExec.Attempt,
		"step_execution_id": currentExec.ID,
	})

	var stepExecID *string
	if currentExec.ID != "" {
		id := currentExec.ID
		stepExecID = &id
	}

	inc := &model.Incident{
		TenantID:     inst.TenantID,
		InstanceID:   inst.ID,
		StepID:       step.ID,
		StepExecID:   stepExecID,
		StepType:     step.Type,
		Status:       model.IncidentStatusOpen,
		ErrorMessage: execErr.Error(),
		Attempt:      currentExec.Attempt,
		Details:      details,
	}

	// Atomic: open the incident AND move the instance to the 'incident' status in
	// one transaction with the instance row locked. The instance is NOT terminal —
	// it is parked, resolvable.
	inst.Status = model.InstanceStatusIncident
	errMsg := fmt.Sprintf("incident on step %s after %d attempts: %s", step.ID, currentExec.Attempt, execErr.Error())
	inst.ErrorMessage = &errMsg
	inst.CurrentStepID = &step.ID
	inst.UpdatedAt = time.Now().UTC()

	if err := s.incidents.RaiseIncidentAtomic(ctx, inst, inc); err != nil {
		return fmt.Errorf("raising incident for step %s: %w", step.ID, err)
	}

	s.logger.Warn().
		Str("instance_id", inst.ID).
		Str("tenant_id", inst.TenantID).
		Str("step_id", step.ID).
		Str("incident_id", inc.ID).
		Int("attempt", currentExec.Attempt).
		Str("error", execErr.Error()).
		Msg("step retries exhausted: incident raised (instance parked, not failed)")

	// Audit: every incident is written into the trail the engine emits.
	s.publishEvent(ctx, "workflow.incident.raised", inst.TenantID, map[string]interface{}{
		"instance_id":  inst.ID,
		"incident_id":  inc.ID,
		"step_id":      step.ID,
		"step_type":    step.Type,
		"attempt":      currentExec.Attempt,
		"error":        execErr.Error(),
		"initiator_id": inst.StartedBy,
	})

	return nil
}

// ListIncidents returns all incidents for an instance (tenant-scoped).
func (s *EngineService) ListIncidents(ctx context.Context, tenantID, instanceID string) ([]*model.Incident, error) {
	if s.incidents == nil {
		return nil, fmt.Errorf("incident store not configured")
	}
	// Verify the instance belongs to the tenant.
	if _, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID); err != nil {
		return nil, fmt.Errorf("loading instance: %w", err)
	}
	return s.incidents.ListByInstance(ctx, tenantID, instanceID)
}

// GetOpenIncident returns the current open incident for an instance.
func (s *EngineService) GetOpenIncident(ctx context.Context, tenantID, instanceID string) (*model.Incident, error) {
	if s.incidents == nil {
		return nil, fmt.Errorf("incident store not configured")
	}
	return s.incidents.GetOpenByInstance(ctx, tenantID, instanceID)
}

// RetryIncident re-runs the failed step of an open incident. A plain retry does
// not mutate committed state, so it is NOT sensitive and does not require a
// maker-checker override. It is serialized per-instance (hot-path entry).
func (s *EngineService) RetryIncident(ctx context.Context, tenantID, instanceID, operatorID string) error {
	if s.incidents == nil {
		return fmt.Errorf("incident store not configured")
	}
	return s.serializeTransition(ctx, instanceID, func(ctx context.Context) error {
		inc, inst, def, step, err := s.loadIncidentContext(ctx, tenantID, instanceID)
		if err != nil {
			return err
		}

		// Put the instance back to running and clear the parked incident pointer,
		// then resolve the incident and re-execute the step.
		if err := s.reactivateInstance(ctx, inst, step.ID); err != nil {
			return err
		}
		if err := s.incidents.ResolveIncident(ctx, inc.ID, operatorID, model.IncidentResolutionRetry); err != nil {
			return fmt.Errorf("resolving incident on retry: %w", err)
		}

		s.auditIncidentResolution(ctx, inst, inc, operatorID, model.IncidentResolutionRetry, nil)

		s.logger.Info().
			Str("instance_id", inst.ID).
			Str("incident_id", inc.ID).
			Str("step_id", step.ID).
			Str("operator_id", operatorID).
			Msg("operator retrying incident step")

		// Re-execute the failed step (already inside the critical section).
		return s.executeStepLocked(ctx, inst, def, step.ID)
	})
}

// SkipIncidentStep marks the failed step as skipped and advances past it. This is
// a SENSITIVE action (it alters the committed path), so it REQUIRES an APPROVED
// maker-checker override whose id is passed in overrideID. Fail-closed: without a
// valid approved override for this incident, it is rejected.
func (s *EngineService) SkipIncidentStep(ctx context.Context, tenantID, instanceID, operatorID, overrideID string) error {
	if s.incidents == nil {
		return fmt.Errorf("incident store not configured")
	}
	return s.serializeTransition(ctx, instanceID, func(ctx context.Context) error {
		inc, inst, _, step, err := s.loadIncidentContext(ctx, tenantID, instanceID)
		if err != nil {
			return err
		}

		ov, err := s.requireApprovedOverride(ctx, tenantID, inc, overrideID, model.IncidentResolutionSkip)
		if err != nil {
			return err
		}

		// Mark the parked step-execution as skipped so history reflects the skip.
		s.markIncidentStepSkipped(ctx, inst.ID, step.ID)

		if err := s.reactivateInstance(ctx, inst, step.ID); err != nil {
			return err
		}
		if err := s.incidents.ResolveIncident(ctx, inc.ID, operatorID, model.IncidentResolutionSkip); err != nil {
			return fmt.Errorf("resolving incident on skip: %w", err)
		}

		s.auditIncidentResolution(ctx, inst, inc, operatorID, model.IncidentResolutionSkip, ov)

		s.logger.Info().
			Str("instance_id", inst.ID).
			Str("incident_id", inc.ID).
			Str("step_id", step.ID).
			Str("operator_id", operatorID).
			Str("override_id", overrideID).
			Str("approved_by", derefStr(ov.ApprovedBy)).
			Msg("operator skipping incident step (maker-checker approved)")

		// Advance PAST the skipped step (already inside the critical section).
		return s.advanceLocked(ctx, inst.ID, step.ID)
	})
}

// ModifyVariablesAndRetryIncident mutates the instance variables (the change is
// carried on the approved override as old/new for audit) and then re-runs the
// failed step. SENSITIVE → requires an APPROVED maker-checker override.
func (s *EngineService) ModifyVariablesAndRetryIncident(ctx context.Context, tenantID, instanceID, operatorID, overrideID string) error {
	if s.incidents == nil {
		return fmt.Errorf("incident store not configured")
	}
	return s.serializeTransition(ctx, instanceID, func(ctx context.Context) error {
		inc, inst, def, step, err := s.loadIncidentContext(ctx, tenantID, instanceID)
		if err != nil {
			return err
		}

		ov, err := s.requireApprovedOverride(ctx, tenantID, inc, overrideID, model.IncidentResolutionModifyRetry)
		if err != nil {
			return err
		}

		// Apply the approved variable change to the instance.
		if len(ov.NewVariables) > 0 {
			var newVars map[string]interface{}
			if uerr := json.Unmarshal(ov.NewVariables, &newVars); uerr != nil {
				return fmt.Errorf("decoding override new_variables: %w", uerr)
			}
			if inst.Variables == nil {
				inst.Variables = make(map[string]interface{})
			}
			for k, v := range newVars {
				inst.Variables[k] = v
			}
		}

		if err := s.reactivateInstance(ctx, inst, step.ID); err != nil {
			return err
		}
		if err := s.incidents.ResolveIncident(ctx, inc.ID, operatorID, model.IncidentResolutionModifyRetry); err != nil {
			return fmt.Errorf("resolving incident on modify-retry: %w", err)
		}

		s.auditIncidentResolution(ctx, inst, inc, operatorID, model.IncidentResolutionModifyRetry, ov)

		s.logger.Info().
			Str("instance_id", inst.ID).
			Str("incident_id", inc.ID).
			Str("step_id", step.ID).
			Str("operator_id", operatorID).
			Str("override_id", overrideID).
			Msg("operator modifying variables then retrying incident step (maker-checker approved)")

		return s.executeStepLocked(ctx, inst, def, step.ID)
	})
}

// AbandonIncident dead-letters an open incident: it captures the full instance
// context (definition pin + snapshot) into the dead-letter table, marks the
// incident dead_lettered, and fails the instance. Enough context is retained to
// diagnose and replay.
func (s *EngineService) AbandonIncident(ctx context.Context, tenantID, instanceID, operatorID, reason string) error {
	if s.incidents == nil {
		return fmt.Errorf("incident store not configured")
	}
	return s.serializeTransition(ctx, instanceID, func(ctx context.Context) error {
		inc, inst, _, step, err := s.loadIncidentContext(ctx, tenantID, instanceID)
		if err != nil {
			return err
		}

		if derr := s.deadLetter(ctx, inst, inc, step.ID, step.Type, model.DeadLetterReasonAbandoned, inc.ErrorMessage, &operatorID); derr != nil {
			return derr
		}
		if err := s.incidents.MarkIncidentDeadLettered(ctx, inc.ID, operatorID); err != nil {
			return fmt.Errorf("marking incident dead-lettered: %w", err)
		}

		// Fail the instance now that the incident is abandoned.
		failMsg := fmt.Sprintf("incident on step %s abandoned by operator: %s", step.ID, reason)
		if err := s.failInstanceFromIncident(ctx, inst, failMsg); err != nil {
			return err
		}

		s.auditIncidentResolution(ctx, inst, inc, operatorID, model.IncidentResolutionDeadLetter, nil)
		s.publishEvent(ctx, "workflow.incident.dead_lettered", inst.TenantID, map[string]interface{}{
			"instance_id": inst.ID,
			"incident_id": inc.ID,
			"step_id":     step.ID,
			"operator_id": operatorID,
			"reason":      reason,
		})

		s.logger.Warn().
			Str("instance_id", inst.ID).
			Str("incident_id", inc.ID).
			Str("operator_id", operatorID).
			Msg("operator abandoned incident: dead-lettered and instance failed")
		return nil
	})
}

// ---------------------------------------------------------------------------
// Maker-checker overrides
// ---------------------------------------------------------------------------

// RequestOverride records a maker-checker (four-eyes) override request for a
// SENSITIVE incident action (skip / modify_variables_retry). The requester is the
// MAKER; a DISTINCT checker must approve before the engine applies it. For a
// modify-variables request, newVars carries the proposed variable change (the
// current values are captured as old for audit).
func (s *EngineService) RequestOverride(ctx context.Context, tenantID, instanceID, requesterID, kind, reason string, newVars map[string]interface{}) (*model.IncidentOverride, error) {
	if s.incidents == nil {
		return nil, fmt.Errorf("incident store not configured")
	}
	if !model.RequiresMakerChecker(kind) {
		return nil, fmt.Errorf("override kind %q does not require maker-checker", kind)
	}

	inc, err := s.incidents.GetOpenByInstance(ctx, tenantID, instanceID)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return nil, model.ErrNoOpenIncident
		}
		return nil, fmt.Errorf("loading open incident: %w", err)
	}

	ov := &model.IncidentOverride{
		TenantID:    tenantID,
		IncidentID:  inc.ID,
		InstanceID:  instanceID,
		Kind:        kind,
		Status:      model.OverrideStatusPending,
		RequestedBy: requesterID,
		Reason:      reason,
	}

	if kind == model.IncidentResolutionModifyRetry {
		inst, ierr := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
		if ierr != nil {
			return nil, fmt.Errorf("loading instance for override: %w", ierr)
		}
		oldJSON, _ := json.Marshal(inst.Variables)
		newJSON, _ := json.Marshal(newVars)
		ov.OldVariables = oldJSON
		ov.NewVariables = newJSON
	}

	if err := s.incidents.CreateOverride(ctx, ov); err != nil {
		return nil, fmt.Errorf("creating override request: %w", err)
	}

	s.publishEvent(ctx, "workflow.incident.override_requested", tenantID, map[string]interface{}{
		"instance_id":  instanceID,
		"incident_id":  inc.ID,
		"override_id":  ov.ID,
		"kind":         kind,
		"requested_by": requesterID,
		"reason":       reason,
	})

	s.logger.Info().
		Str("instance_id", instanceID).
		Str("incident_id", inc.ID).
		Str("override_id", ov.ID).
		Str("kind", kind).
		Str("requested_by", requesterID).
		Msg("maker-checker override requested for incident")

	return ov, nil
}

// ApproveOverride approves a pending override as a DISTINCT checker. Separation of
// duties is enforced fail-closed: the approver may NOT be the requester. The
// check reuses the approval-chain distinct-actor primitive
// (executor.DistinctApproverConflict) so the same SoD logic gates both approval
// chains and incident overrides; the repository ApproveOverride additionally
// guards requested_by <> approver in SQL (belt and suspenders).
func (s *EngineService) ApproveOverride(ctx context.Context, tenantID, overrideID, approverID string) (*model.IncidentOverride, error) {
	if s.incidents == nil {
		return nil, fmt.Errorf("incident store not configured")
	}
	ov, err := s.incidents.GetOverride(ctx, tenantID, overrideID)
	if err != nil {
		return nil, fmt.Errorf("loading override: %w", err)
	}
	if ov.Status != model.OverrideStatusPending {
		return nil, model.ErrOverrideNotPending
	}

	// Reuse the distinct-approver SoD primitive: model the two actors (maker then
	// checker) as decisions on the same chain and require them to be distinct.
	distinctCfg := executor.ApprovalConfig{RequireDistinctApprovers: true}
	decisions := []executor.ApproverDecision{
		{Decision: executor.DecisionApprove, DecidedBy: ov.RequestedBy},
		{Decision: executor.DecisionApprove, DecidedBy: approverID},
	}
	if actor, conflict := executor.DistinctApproverConflict(distinctCfg, decisions); conflict {
		s.logger.Warn().
			Str("override_id", overrideID).
			Str("conflicting_actor", actor).
			Msg("override approval rejected fail-closed: maker == checker (separation-of-duties)")
		s.publishEvent(ctx, "workflow.incident.override_sod_violation", tenantID, map[string]interface{}{
			"override_id":  overrideID,
			"incident_id":  ov.IncidentID,
			"instance_id":  ov.InstanceID,
			"requested_by": ov.RequestedBy,
			"attempted_by": approverID,
		})
		return nil, model.ErrSameActorOverride
	}

	if err := s.incidents.ApproveOverride(ctx, overrideID, approverID); err != nil {
		return nil, err
	}
	// Reflect the approval in the returned struct.
	now := time.Now().UTC()
	ov.Status = model.OverrideStatusApproved
	ov.ApprovedBy = &approverID
	ov.ApprovedAt = &now

	s.publishEvent(ctx, "workflow.incident.override_approved", tenantID, map[string]interface{}{
		"instance_id":  ov.InstanceID,
		"incident_id":  ov.IncidentID,
		"override_id":  ov.ID,
		"kind":         ov.Kind,
		"requested_by": ov.RequestedBy,
		"approved_by":  approverID,
	})

	s.logger.Info().
		Str("override_id", ov.ID).
		Str("incident_id", ov.IncidentID).
		Str("requested_by", ov.RequestedBy).
		Str("approved_by", approverID).
		Msg("maker-checker override approved by distinct checker")

	return ov, nil
}

// RejectOverride rejects a pending override.
func (s *EngineService) RejectOverride(ctx context.Context, tenantID, overrideID, rejecterID, reason string) error {
	if s.incidents == nil {
		return fmt.Errorf("incident store not configured")
	}
	ov, err := s.incidents.GetOverride(ctx, tenantID, overrideID)
	if err != nil {
		return fmt.Errorf("loading override: %w", err)
	}
	if ov.Status != model.OverrideStatusPending {
		return model.ErrOverrideNotPending
	}
	if err := s.incidents.RejectOverride(ctx, overrideID, rejecterID, reason); err != nil {
		return err
	}
	s.publishEvent(ctx, "workflow.incident.override_rejected", tenantID, map[string]interface{}{
		"instance_id": ov.InstanceID,
		"incident_id": ov.IncidentID,
		"override_id": ov.ID,
		"rejected_by": rejecterID,
		"reason":      reason,
	})
	return nil
}

// ListDeadLetters returns the tenant's dead-letter rows.
func (s *EngineService) ListDeadLetters(ctx context.Context, tenantID string, limit int) ([]*model.DeadLetter, error) {
	if s.incidents == nil {
		return nil, fmt.Errorf("incident store not configured")
	}
	return s.incidents.ListDeadLetter(ctx, tenantID, limit)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// loadIncidentContext loads the open incident + instance + definition + failed
// step for an operator action, validating that an open incident exists. It does
// NOT acquire the critical section (the caller already holds it).
func (s *EngineService) loadIncidentContext(ctx context.Context, tenantID, instanceID string) (*model.Incident, *model.WorkflowInstance, *model.WorkflowDefinition, *model.StepDefinition, error) {
	inc, err := s.incidents.GetOpenByInstance(ctx, tenantID, instanceID)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return nil, nil, nil, nil, model.ErrNoOpenIncident
		}
		return nil, nil, nil, nil, fmt.Errorf("loading open incident: %w", err)
	}

	inst, err := s.instanceRepo.GetByID(ctx, tenantID, instanceID)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("loading instance for incident action: %w", err)
	}
	if !inst.HasOpenIncident() {
		return nil, nil, nil, nil, model.ErrNoOpenIncident
	}

	def, err := s.defRepo.GetByID(ctx, inst.TenantID, inst.DefinitionID)
	if err != nil {
		return nil, nil, nil, nil, fmt.Errorf("loading definition for incident action: %w", err)
	}
	step := findStep(def.Steps, inc.StepID)
	if step == nil {
		return nil, nil, nil, nil, fmt.Errorf("incident step %s not found in definition %s", inc.StepID, def.ID)
	}
	return inc, inst, def, step, nil
}

// requireApprovedOverride loads and validates that overrideID is an APPROVED
// override for this incident and the expected kind. Fail-closed on any mismatch.
func (s *EngineService) requireApprovedOverride(ctx context.Context, tenantID string, inc *model.Incident, overrideID, kind string) (*model.IncidentOverride, error) {
	if overrideID == "" {
		return nil, model.ErrOverrideRequired
	}
	ov, err := s.incidents.GetOverride(ctx, tenantID, overrideID)
	if err != nil {
		return nil, fmt.Errorf("loading override for %s: %w", kind, err)
	}
	if ov.IncidentID != inc.ID || ov.Kind != kind || ov.Status != model.OverrideStatusApproved {
		return nil, model.ErrOverrideRequired
	}
	return ov, nil
}

// reactivateInstance puts a parked incident instance back to running at the given
// step and persists it under the optimistic lock.
func (s *EngineService) reactivateInstance(ctx context.Context, inst *model.WorkflowInstance, stepID string) error {
	inst.Status = model.InstanceStatusRunning
	inst.ErrorMessage = nil
	inst.CurrentStepID = &stepID
	inst.UpdatedAt = time.Now().UTC()
	if err := s.instanceRepo.UpdateWithLock(ctx, inst); err != nil {
		return fmt.Errorf("reactivating instance from incident: %w", err)
	}
	return nil
}

// markIncidentStepSkipped flips the parked incident step-execution to skipped.
func (s *EngineService) markIncidentStepSkipped(ctx context.Context, instanceID, stepID string) {
	execs, err := s.instanceRepo.GetStepExecutions(ctx, instanceID)
	if err != nil {
		return
	}
	for _, e := range execs {
		if e.StepID == stepID && e.Status == model.StepStatusIncident {
			completedAt := time.Now().UTC()
			e.Status = model.StepStatusSkipped
			e.CompletedAt = &completedAt
			_ = s.instanceRepo.UpdateStepExecution(ctx, e)
			return
		}
	}
}

// deadLetter writes a dead-letter row capturing full replay context.
func (s *EngineService) deadLetter(ctx context.Context, inst *model.WorkflowInstance, inc *model.Incident, stepID, stepType, reason, errMsg string, abandonedBy *string) error {
	snapshot, _ := json.Marshal(map[string]interface{}{
		"variables":       inst.Variables,
		"step_outputs":    inst.StepOutputs,
		"current_step_id": inst.CurrentStepID,
		"lock_version":    inst.LockVersion,
	})
	var incID *string
	if inc != nil {
		id := inc.ID
		incID = &id
	}
	dl := &model.DeadLetter{
		TenantID:      inst.TenantID,
		InstanceID:    inst.ID,
		IncidentID:    incID,
		StepID:        stepID,
		StepType:      stepType,
		Reason:        reason,
		ErrorMessage:  errMsg,
		DefinitionID:  inst.DefinitionID,
		DefinitionVer: inst.DefinitionVer,
		Snapshot:      snapshot,
		AbandonedBy:   abandonedBy,
	}
	if err := s.incidents.CreateDeadLetter(ctx, dl); err != nil {
		return fmt.Errorf("creating dead-letter row: %w", err)
	}
	return nil
}

// failInstanceFromIncident transitions a parked incident instance to failed (used
// when the incident is abandoned/dead-lettered). It mirrors failInstance but is
// tolerant of the current 'incident' status.
func (s *EngineService) failInstanceFromIncident(ctx context.Context, inst *model.WorkflowInstance, errMsg string) error {
	now := time.Now().UTC()
	inst.Status = model.InstanceStatusFailed
	inst.ErrorMessage = &errMsg
	inst.CompletedAt = &now
	inst.UpdatedAt = now
	if err := s.instanceRepo.UpdateWithLock(ctx, inst); err != nil {
		return fmt.Errorf("failing instance from incident: %w", err)
	}
	s.publishEvent(ctx, "workflow.instance.failed", inst.TenantID, map[string]interface{}{
		"instance_id":  inst.ID,
		"error":        errMsg,
		"initiator_id": inst.StartedBy,
	})
	// COMPOSITION: a child abandoned via a dead-lettered incident is terminal-
	// failed; propagate to its parent call_activity / multi_instance step.
	if inst.HasParent() {
		s.onChildInstanceTerminal(ctx, inst, model.InstanceStatusFailed, errMsg)
	}
	return nil
}

// auditIncidentResolution writes an incident resolution (who / what / old / new)
// into the audit trail the engine emits.
func (s *EngineService) auditIncidentResolution(ctx context.Context, inst *model.WorkflowInstance, inc *model.Incident, operatorID, kind string, ov *model.IncidentOverride) {
	payload := map[string]interface{}{
		"instance_id": inst.ID,
		"incident_id": inc.ID,
		"step_id":     inc.StepID,
		"resolution":  kind,
		"operator_id": operatorID,
	}
	if ov != nil {
		payload["override_id"] = ov.ID
		payload["requested_by"] = ov.RequestedBy
		if ov.ApprovedBy != nil {
			payload["approved_by"] = *ov.ApprovedBy
		}
		if len(ov.OldVariables) > 0 {
			payload["old_variables"] = json.RawMessage(ov.OldVariables)
		}
		if len(ov.NewVariables) > 0 {
			payload["new_variables"] = json.RawMessage(ov.NewVariables)
		}
	}
	s.publishEvent(ctx, "workflow.incident.resolved", inst.TenantID, payload)
}

func derefStr(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
