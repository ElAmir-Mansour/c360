package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// ---------------------------------------------------------------------------
// INTERRUPTING BOUNDARY EVENTS + EVENT-BASED GATEWAY (Phase 5 control-flow).
//
// This file implements the ENGINE side of two BPMN control-flow constructs on
// the existing durable park/resume engine:
//
//   * Interrupting boundary events attached to a step (model.BoundaryEvent):
//     while the attached step is PARKED/active, a timer expiring, the step
//     failing (error boundary), or a correlated inbound message INTERRUPTS the
//     step — cancels its pending task/wait/timer — and routes to the boundary's
//     handler step.
//
//   * The event-based gateway (StepTypeEventGateway): a step that parks waiting
//     for one of N events (timer/message) and routes to whichever fires FIRST,
//     cancelling the others.
//
// Both reuse the SAME durable seams the timer step + event_task WAIT use: the
// Redis-sorted-set timer subsystem (via the SchedulerService BoundaryRegistrar)
// and the event-wait correlation subsystem (Redis key + the event-wait consumer).
//
// SINGLE-WINNER SERIALIZATION. A boundary fire racing a normal completion (or two
// gateway arms racing) MUST resolve to EXACTLY ONE outcome. Both the boundary
// fire and the normal advance run under the per-instance critical section
// (serializeTransition → SerializeInstance + lock_version + local mutex). The
// arbiter is the RUNNING step-execution row for the attached/gateway step: the
// first path to flip it to a terminal-for-this-purpose status wins; the loser
// finds it no longer running and no-ops. This is the same "flip-once" pattern the
// multi_instance fan-in and approval-chain resolution use.
//
// Additive + reversible: no existing definition carries boundary_events or uses
// event_based_gateway, so every existing definition/instance is byte-for-byte
// unchanged. The registrar/firer wiring is optional; absent it, a boundary is
// simply never armed and the step behaves exactly as before.
// ---------------------------------------------------------------------------

// boundaryTimerMarker separates a boundary/gateway timer's attached step id from
// its arm id inside a Redis timer member. It is chosen to never collide with a
// real step id (step ids are author-controlled identifiers; this byte sequence is
// not a valid identifier). Member shape: "instanceID:stepID<marker>armID".
const boundaryTimerMarker = "#@bnd@#"

// boundaryWaitMarker separates an event-wait value's "instanceID:stepID" from the
// boundary arm id. Value shape (boundary): "instanceID:stepID#@bwait@#armID".
const boundaryWaitMarker = "#@bwait@#"

// encodeBoundaryTimerMember builds the Redis timer member for a boundary/gateway
// timer arm. pollTimers splits on the FIRST ":" into (instanceID, rest); the rest
// carries "stepID<marker>armID", decoded by decodeBoundaryTimerStep.
func encodeBoundaryTimerMember(instanceID, stepID, armID string) string {
	return instanceID + ":" + stepID + boundaryTimerMarker + armID
}

// decodeBoundaryTimerStep splits the "rest" portion (everything after the first
// ":" of a timer member) into (attachedStepID, armID) when it carries the
// boundary marker, or ok=false for an ordinary timer step.
func decodeBoundaryTimerStep(rest string) (attachedStepID, armID string, ok bool) {
	idx := strings.Index(rest, boundaryTimerMarker)
	if idx < 0 {
		return "", "", false
	}
	return rest[:idx], rest[idx+len(boundaryTimerMarker):], true
}

// eventWaitKey builds the event-wait Redis key, matching the shape the event_task
// WAIT executor and the event-wait consumer use ("workflow:eventwait:{topic}:{corr}").
func eventWaitKey(topic, correlationValue string) string {
	return fmt.Sprintf("workflow:eventwait:%s:%s", topic, correlationValue)
}

// encodeBoundaryWaitValue builds the stored event-wait value for a boundary/gateway
// message arm: "instanceID:stepID#@bwait@#armID". The event-wait consumer detects
// the marker and routes to FireBoundaryEvent instead of AdvanceWorkflow.
func encodeBoundaryWaitValue(instanceID, stepID, armID string) string {
	return instanceID + ":" + stepID + boundaryWaitMarker + armID
}

// DecodeBoundaryWaitValue parses a stored event-wait value that carries the
// boundary marker into (instanceID, attachedStepID, armID). ok=false for an
// ordinary event_task WAIT value ("instanceID:stepID"). Exported so the event-wait
// consumer (same package would not need it, but the consumer lives in a sibling
// package) can route boundary messages.
func DecodeBoundaryWaitValue(val string) (instanceID, attachedStepID, armID string, ok bool) {
	mIdx := strings.Index(val, boundaryWaitMarker)
	if mIdx < 0 {
		return "", "", "", false
	}
	head := val[:mIdx]
	armID = val[mIdx+len(boundaryWaitMarker):]
	// head is "instanceID:stepID" — split on the LAST ":" (uuids have no colon).
	cIdx := strings.LastIndex(head, ":")
	if cIdx <= 0 || cIdx == len(head)-1 {
		return "", "", "", false
	}
	return head[:cIdx], head[cIdx+1:], armID, true
}

// boundaryRegistrar is the OPTIONAL durable-scheduling capability the engine uses
// to arm/cancel a step's boundary timers and message waits (and an event-based
// gateway's arms). It is satisfied by *service.SchedulerService. Wired via
// SetBoundaryRegistrar; absent it, boundaries are never armed (a step behaves
// exactly as before) — so the whole feature is reversible/additive.
type boundaryRegistrar interface {
	RegisterBoundaryTimer(ctx context.Context, instanceID, stepID, armID string, fireAt time.Time) error
	RegisterBoundaryMessageWait(ctx context.Context, instanceID, stepID, armID, topic, correlationValue string, ttl time.Duration) error
	CancelBoundaryTimer(ctx context.Context, instanceID, stepID, armID string) error
	CancelBoundaryMessageWait(ctx context.Context, instanceID, stepID, armID, topic, correlationValue string) error
	// The UNMARKED (ordinary step) durable registrations. When an interrupting
	// boundary fires on a step that is ITSELF a timer/wait step, the step's own
	// pending durable work (the ordinary "instanceID:stepID" timer member, or the
	// ordinary "instanceID:stepID" event-wait key) must be torn down too, or it
	// would leak and later fire a spurious AdvanceWorkflow on the interrupted step.
	RemoveTimer(ctx context.Context, instanceID, stepID string) error
	RemoveEventWait(ctx context.Context, topic, correlationValue, instanceID, stepID string) error
}

// SetBoundaryRegistrar installs the OPTIONAL durable registrar (the scheduler) so
// the engine can ARM a step's timer/message boundary events when the step parks
// and CANCEL them when the step resolves. Returns the receiver for chaining and
// is a no-op when reg is nil (boundaries are then never armed — legacy behaviour).
func (s *EngineService) SetBoundaryRegistrar(reg boundaryRegistrar) *EngineService {
	s.boundaryReg = reg
	return s
}

// armBoundaryEvents registers the durable timer / message-wait boundary events
// attached to a step that has just PARKED. Error boundaries need no durable
// registration (they are evaluated inline in the step-failure path). The caller
// holds the per-instance critical section. Best-effort per boundary: a failure to
// arm one boundary logs and continues (the step is already parked and correct;
// the boundary simply will not fire).
//
// stepExec is the step's just-persisted execution row. For a step that can be
// INTERRUPTED (it declares boundary events) or an event-based gateway, the row is
// (re-)asserted to RUNNING here so the single-winner guard in FireBoundaryEvent
// has a running exec to claim: the success-park path (Parked flag) marks the row
// 'completed' by default, which is correct for a plain parked leaf but would make
// a boundary fire immediately lose the race. This re-mark is scoped to
// boundary/gateway steps ONLY, so every existing parked step is byte-for-byte
// unchanged. It is a no-op on the ErrParked path (the row is already running).
func (s *EngineService) armBoundaryEvents(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition, stepExec *model.StepExecution) {
	// Keep the parked step's exec RUNNING so it can be interrupted (single-winner
	// arbiter). Scoped to interruptible steps: those with boundary events, or an
	// event-based gateway (whose arms live in config, not BoundaryEvents).
	if stepExec != nil && stepExec.Status != model.StepStatusRunning &&
		(len(step.BoundaryEvents) > 0 || step.Type == model.StepTypeEventGateway) {
		completedAtNil := stepExec.CompletedAt
		stepExec.Status = model.StepStatusRunning
		stepExec.CompletedAt = nil
		if err := s.instanceRepo.UpdateStepExecution(ctx, stepExec); err != nil {
			// Restore the field we touched and log; the step is still correctly parked.
			stepExec.CompletedAt = completedAtNil
			s.logger.Error().Err(err).
				Str("instance_id", inst.ID).Str("step_id", step.ID).
				Msg("boundary: re-asserting parked step exec to running (not armed as interruptible)")
			return
		}
	}

	if s.boundaryReg == nil || len(step.BoundaryEvents) == 0 {
		return
	}
	dataCtx := s.buildExpressionContext(inst)
	for _, b := range step.BoundaryEvents {
		switch b.Type {
		case model.BoundaryEventTypeTimer:
			fireAt, err := executor.ResolveBoundaryTimerFireAt(s.resolver,
				strBoundaryCfg(b.Config, "duration"), strBoundaryCfg(b.Config, "fire_at"), dataCtx)
			if err != nil {
				s.logger.Error().Err(err).
					Str("instance_id", inst.ID).Str("step_id", step.ID).Str("boundary_id", b.ID).
					Msg("boundary: resolving timer fire_at (not armed)")
				continue
			}
			if err := s.boundaryReg.RegisterBoundaryTimer(ctx, inst.ID, step.ID, b.ID, fireAt); err != nil {
				s.logger.Error().Err(err).
					Str("instance_id", inst.ID).Str("step_id", step.ID).Str("boundary_id", b.ID).
					Msg("boundary: arming timer (not armed)")
			}
		case model.BoundaryEventTypeMessage:
			topic := strBoundaryCfg(b.Config, "topic")
			corrRaw := strBoundaryCfg(b.Config, "correlation_value")
			resolved, err := s.resolver.Resolve(corrRaw, dataCtx)
			if err != nil {
				s.logger.Error().Err(err).
					Str("instance_id", inst.ID).Str("step_id", step.ID).Str("boundary_id", b.ID).
					Msg("boundary: resolving message correlation (not armed)")
				continue
			}
			corr := fmt.Sprintf("%v", resolved)
			ttl := time.Duration(0)
			if secs := floatBoundaryCfg(b.Config, "timeout_seconds"); secs > 0 {
				ttl = time.Duration(secs * float64(time.Second))
			}
			if err := s.boundaryReg.RegisterBoundaryMessageWait(ctx, inst.ID, step.ID, b.ID, topic, corr, ttl); err != nil {
				s.logger.Error().Err(err).
					Str("instance_id", inst.ID).Str("step_id", step.ID).Str("boundary_id", b.ID).
					Msg("boundary: arming message wait (not armed)")
			}
		default:
			// error boundaries are handled inline in handleStepFailure; nothing to arm.
		}
	}
}

// cancelBoundaryEvents removes any durable timer / message-wait registrations for
// a step's boundary events (and an event-based gateway's arms). Called when the
// step resolves — either by normal completion, by a boundary firing (the winning
// boundary cancels its siblings), or when the instance is cancelled. Best-effort.
func (s *EngineService) cancelBoundaryEvents(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition) {
	if s.boundaryReg == nil {
		return
	}
	dataCtx := s.buildExpressionContext(inst)
	// Attached boundary events.
	for _, b := range step.BoundaryEvents {
		s.cancelOneBoundary(ctx, inst, step.ID, b.ID, b.Type, b.Config, dataCtx)
	}
	// Event-based gateway arms (the arms live in the step config, not as boundary
	// events). Cancel every arm so the loser arms are torn down when one wins.
	if step.Type == model.StepTypeEventGateway {
		arms, err := executor.ParseEventGatewayArms(step.Config)
		if err != nil {
			return
		}
		for _, arm := range arms {
			switch arm.Kind {
			case "timer":
				_ = s.boundaryReg.CancelBoundaryTimer(ctx, inst.ID, step.ID, arm.ID)
			case "message":
				resolved, rerr := s.resolver.Resolve(arm.CorrelationValue, dataCtx)
				if rerr != nil {
					continue
				}
				_ = s.boundaryReg.CancelBoundaryMessageWait(ctx, inst.ID, step.ID, arm.ID, arm.Topic, fmt.Sprintf("%v", resolved))
			}
		}
	}
}

// interruptStepOwnWork tears down the UNMARKED durable registration a step made
// for its OWN pending work when that step is interrupted by a boundary event. Only
// timer steps and event_task WAIT steps register such unmarked durable work; every
// other interruptible step's pending work is a human task (cancelled by the caller)
// or child instances (cancelled elsewhere) or the marked boundary/gateway arms
// (cancelled by cancelBoundaryEvents). No-op when no registrar is wired.
func (s *EngineService) interruptStepOwnWork(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition) {
	if s.boundaryReg == nil {
		return
	}
	switch step.Type {
	case model.StepTypeTimer:
		// The timer step registered an unmarked "instanceID:stepID" sorted-set member.
		if err := s.boundaryReg.RemoveTimer(ctx, inst.ID, step.ID); err != nil {
			s.logger.Debug().Err(err).
				Str("instance_id", inst.ID).Str("step_id", step.ID).
				Msg("boundary: removing interrupted timer step's own timer (best-effort)")
		}
	case model.StepTypeEventTask:
		// Only WAIT-mode event_task steps park (and register an unmarked event-wait
		// key). PUBLISH mode completes synchronously and never parks, so it is never
		// the interrupted step. The wait key is keyed by topic + resolved
		// correlation_value, matching what the event_task WAIT executor stored.
		if strings.EqualFold(strBoundaryCfg(step.Config, "mode"), "WAIT") {
			topic := strBoundaryCfg(step.Config, "topic")
			corrRaw := strBoundaryCfg(step.Config, "correlation_value")
			resolved, err := s.resolver.Resolve(corrRaw, s.buildExpressionContext(inst))
			if err != nil {
				s.logger.Debug().Err(err).
					Str("instance_id", inst.ID).Str("step_id", step.ID).
					Msg("boundary: resolving interrupted event_task correlation for removal (best-effort)")
				return
			}
			corr := fmt.Sprintf("%v", resolved)
			if err := s.boundaryReg.RemoveEventWait(ctx, topic, corr, inst.ID, step.ID); err != nil {
				s.logger.Debug().Err(err).
					Str("instance_id", inst.ID).Str("step_id", step.ID).
					Msg("boundary: removing interrupted event_task step's own event-wait (best-effort)")
			}
		}
	}
}

func (s *EngineService) cancelOneBoundary(ctx context.Context, inst *model.WorkflowInstance, stepID, armID, typ string, cfg, dataCtx map[string]interface{}) {
	switch typ {
	case model.BoundaryEventTypeTimer:
		_ = s.boundaryReg.CancelBoundaryTimer(ctx, inst.ID, stepID, armID)
	case model.BoundaryEventTypeMessage:
		topic := strBoundaryCfg(cfg, "topic")
		resolved, err := s.resolver.Resolve(strBoundaryCfg(cfg, "correlation_value"), dataCtx)
		if err != nil {
			return
		}
		_ = s.boundaryReg.CancelBoundaryMessageWait(ctx, inst.ID, stepID, armID, topic, fmt.Sprintf("%v", resolved))
	}
}

// FireBoundaryEvent is the hot-path ENTRY invoked by the scheduler (timer arm) or
// the event-wait consumer (message arm) when a boundary/gateway event fires. It
// is serialized per-instance so a boundary fire racing a normal completion (or a
// sibling arm) resolves to EXACTLY ONE outcome.
//
// attachedStepID is the step the boundary is attached to (or the event-based
// gateway step itself); armID identifies which boundary/arm fired.
func (s *EngineService) FireBoundaryEvent(ctx context.Context, instanceID, attachedStepID, armID string) error {
	return s.serializeTransition(ctx, instanceID, func(ctx context.Context) error {
		return s.fireBoundaryLocked(ctx, instanceID, attachedStepID, armID)
	})
}

// fireBoundaryLocked is the body of FireBoundaryEvent. The caller MUST hold the
// per-instance critical section.
func (s *EngineService) fireBoundaryLocked(ctx context.Context, instanceID, attachedStepID, armID string) error {
	inst, err := s.instanceRepo.GetByID(ctx, "", instanceID)
	if err != nil {
		return fmt.Errorf("loading instance for boundary fire: %w", err)
	}
	if !inst.IsRunnable() {
		s.logger.Debug().
			Str("instance_id", instanceID).Str("status", inst.Status).
			Msg("instance not runnable, ignoring boundary fire")
		return nil
	}

	def, err := s.defRepo.GetByID(ctx, inst.TenantID, inst.DefinitionID)
	if err != nil {
		return fmt.Errorf("loading definition for boundary fire: %w", err)
	}
	step := findStep(def.Steps, attachedStepID)
	if step == nil {
		return fmt.Errorf("boundary attached step %s not found in definition %s", attachedStepID, def.ID)
	}

	// SINGLE-WINNER GUARD. The attached/gateway step must still have a RUNNING
	// step-execution. If normal completion (or a sibling arm) already flipped it,
	// this fire lost the race and no-ops. Flipping the running exec to 'cancelled'
	// here IS the atomic claim of the winner within the critical section.
	runningExec := s.runningStepExecution(ctx, instanceID, attachedStepID)
	if runningExec == nil {
		s.logger.Info().
			Str("instance_id", instanceID).Str("step_id", attachedStepID).Str("arm_id", armID).
			Msg("boundary fired but step no longer running (lost race to completion/sibling), ignoring")
		return nil
	}

	// Resolve the target: an event-based gateway routes to the winning ARM's
	// target; an attached boundary routes to its HANDLER step.
	target, ok := s.boundaryTarget(step, armID)
	if !ok {
		s.logger.Warn().
			Str("instance_id", instanceID).Str("step_id", attachedStepID).Str("arm_id", armID).
			Msg("boundary fired but arm/handler not found in definition, ignoring")
		return nil
	}
	targetStep := findStep(def.Steps, target)
	if targetStep == nil {
		return fmt.Errorf("boundary handler/target step %s not found in definition %s", target, def.ID)
	}

	// Claim the winner: cancel the running step-execution (interrupt the step's
	// pending work) so a later completion/sibling finds no running exec and no-ops.
	completedAt := time.Now().UTC()
	runningExec.Status = model.StepStatusCancelled
	runningExec.CompletedAt = &completedAt
	if err := s.instanceRepo.UpdateStepExecution(ctx, runningExec); err != nil {
		return fmt.Errorf("cancelling interrupted step execution: %w", err)
	}

	// INTERRUPT the step's pending external work:
	//   - cancel any open human task(s) for this step (a parked human_task),
	//   - cancel the sibling boundary/gateway timer + message registrations.
	if err := s.taskRepo.CancelOpenByInstanceStep(ctx, instanceID, attachedStepID); err != nil {
		s.logger.Debug().Err(err).
			Str("instance_id", instanceID).Str("step_id", attachedStepID).
			Msg("boundary: cancelling open tasks for interrupted step (best-effort)")
	}
	// Cancel the sibling boundary/gateway arms (marked registrations).
	s.cancelBoundaryEvents(ctx, inst, step)
	// Cancel the interrupted step's OWN underlying durable work. If the attached
	// step is itself a timer / event_task WAIT step, it registered an UNMARKED
	// "instanceID:stepID" timer member / event-wait key when it parked; that would
	// otherwise leak and later fire a spurious AdvanceWorkflow on the step this
	// boundary just interrupted. (Its human task, if any, is cancelled above.)
	s.interruptStepOwnWork(ctx, inst, step)

	// Audit: every boundary fire is written into the trail the engine emits.
	s.publishEvent(ctx, "workflow.boundary.fired", inst.TenantID, map[string]interface{}{
		"instance_id":  inst.ID,
		"step_id":      attachedStepID,
		"arm_id":       armID,
		"boundary":     s.boundaryKindFor(step, armID),
		"target":       target,
		"initiator_id": inst.StartedBy,
	})

	s.logger.Info().
		Str("instance_id", inst.ID).Str("step_id", attachedStepID).Str("arm_id", armID).
		Str("target", target).Msg("boundary event fired: interrupting step and routing to target")

	// Route the flow to the boundary handler / winning arm target. This mirrors a
	// normal advance to a specific step (already inside the critical section).
	inst.CurrentStepID = &target
	inst.UpdatedAt = time.Now().UTC()
	if err := s.instanceRepo.UpdateWithLock(ctx, inst); err != nil {
		return fmt.Errorf("updating instance current step on boundary fire: %w", err)
	}

	if targetStep.Type == model.StepTypeEnd {
		return s.completeInstance(ctx, inst, target)
	}
	return s.executeStepLocked(ctx, inst, def, target)
}

// boundaryTarget returns the routing target for a fired arm/boundary of a step. An
// event-based gateway looks the arm id up in its config arms (routing to the arm's
// target); any other step looks the arm id up in its attached boundary events
// (routing to the boundary's handler step).
func (s *EngineService) boundaryTarget(step *model.StepDefinition, armID string) (string, bool) {
	if step.Type == model.StepTypeEventGateway {
		arms, err := executor.ParseEventGatewayArms(step.Config)
		if err != nil {
			return "", false
		}
		for _, arm := range arms {
			if arm.ID == armID {
				return arm.Target, true
			}
		}
		return "", false
	}
	for _, b := range step.BoundaryEvents {
		if b.ID == armID {
			return b.HandlerStepID, true
		}
	}
	return "", false
}

// boundaryKindFor returns a human/audit label for the fired arm/boundary type.
func (s *EngineService) boundaryKindFor(step *model.StepDefinition, armID string) string {
	if step.Type == model.StepTypeEventGateway {
		return "event_gateway_arm"
	}
	for _, b := range step.BoundaryEvents {
		if b.ID == armID {
			return b.Type
		}
	}
	return "unknown"
}

// fireErrorBoundary is invoked from the step-failure path: when a step with an
// ERROR boundary fails (retries exhausted), instead of raising an incident /
// failing the instance, the flow routes to the matching error boundary's handler.
// The caller (handleStepFailure) holds the per-instance critical section and has
// already marked the failed attempt. Returns handled=true when an error boundary
// caught the failure (the caller then returns), or false to fall through to the
// legacy incident/fail path.
func (s *EngineService) fireErrorBoundary(ctx context.Context, inst *model.WorkflowInstance, def *model.WorkflowDefinition, step *model.StepDefinition, failMsg string) (bool, error) {
	b, ok := matchErrorBoundary(step, failMsg)
	if !ok {
		return false, nil
	}
	targetStep := findStep(def.Steps, b.HandlerStepID)
	if targetStep == nil {
		return false, fmt.Errorf("error boundary handler step %s not found in definition %s", b.HandlerStepID, def.ID)
	}

	// Cancel any sibling timer/message boundaries armed for this step (the error
	// boundary won).
	s.cancelBoundaryEvents(ctx, inst, step)

	s.publishEvent(ctx, "workflow.boundary.fired", inst.TenantID, map[string]interface{}{
		"instance_id":  inst.ID,
		"step_id":      step.ID,
		"arm_id":       b.ID,
		"boundary":     model.BoundaryEventTypeError,
		"target":       b.HandlerStepID,
		"error":        failMsg,
		"initiator_id": inst.StartedBy,
	})

	s.logger.Info().
		Str("instance_id", inst.ID).Str("step_id", step.ID).Str("boundary_id", b.ID).
		Str("target", b.HandlerStepID).Str("error", failMsg).
		Msg("error boundary caught step failure: routing to handler")

	inst.CurrentStepID = &b.HandlerStepID
	inst.UpdatedAt = time.Now().UTC()
	if err := s.instanceRepo.UpdateWithLock(ctx, inst); err != nil {
		return false, fmt.Errorf("updating instance current step on error boundary: %w", err)
	}

	if targetStep.Type == model.StepTypeEnd {
		return true, s.completeInstance(ctx, inst, b.HandlerStepID)
	}
	return true, s.executeStepLocked(ctx, inst, def, b.HandlerStepID)
}

// matchErrorBoundary returns the first error boundary of step whose error_code
// matches the failure message (a code-less boundary is catch-all).
func matchErrorBoundary(step *model.StepDefinition, failMsg string) (model.BoundaryEvent, bool) {
	for _, b := range step.BoundaryEvents {
		if b.Type == model.BoundaryEventTypeError && executor.BoundaryMatchesError(b, failMsg) {
			return b, true
		}
	}
	return model.BoundaryEvent{}, false
}

// hasErrorBoundary reports whether the step declares any error boundary (used to
// short-circuit the incident/fail decision).
func hasErrorBoundary(step *model.StepDefinition) bool {
	for _, b := range step.BoundaryEvents {
		if b.Type == model.BoundaryEventTypeError {
			return true
		}
	}
	return false
}

// ---- config readers (boundary configs are decoded-JSON maps) ----

func strBoundaryCfg(cfg map[string]interface{}, key string) string {
	if cfg == nil {
		return ""
	}
	if v, ok := cfg[key].(string); ok {
		return v
	}
	return ""
}

func floatBoundaryCfg(cfg map[string]interface{}, key string) float64 {
	if cfg == nil {
		return 0
	}
	switch v := cfg[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	case int64:
		return float64(v)
	default:
		return 0
	}
}
