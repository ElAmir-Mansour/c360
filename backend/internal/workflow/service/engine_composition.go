package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// ---------------------------------------------------------------------------
// Re-entrancy substrate for synchronous child completion.
//
// A call_activity / multi_instance child can complete SYNCHRONOUSLY while its
// parent's per-instance critical section is still held higher up the SAME call
// stack (parent StartInstance -> child start -> child completes inline). Because
// the per-instance mutex is not reentrant, resuming the parent inline would
// re-acquire the held parent lock and deadlock. The compContext threads through
// ctx the set of instance ids currently held by this stack plus a queue of
// deferred parent-resume closures; the outermost serializeTransition drains the
// queue AFTER all its locks release, so each resume acquires the parent lock
// cleanly. When a parent is NOT currently held (an async resume driven by a
// timer/event/child-in-another-goroutine), the resume runs inline immediately.
// ---------------------------------------------------------------------------

type compContextKey struct{}

type compContext struct {
	mu       sync.Mutex
	held     map[string]int
	deferred []func()
}

func newCompContext() *compContext {
	return &compContext{held: map[string]int{}}
}

func (c *compContext) hold(id string) {
	c.mu.Lock()
	c.held[id]++
	c.mu.Unlock()
}

func (c *compContext) release(id string) {
	c.mu.Lock()
	if c.held[id] > 0 {
		c.held[id]--
		if c.held[id] == 0 {
			delete(c.held, id)
		}
	}
	c.mu.Unlock()
}

func (c *compContext) isHeld(id string) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.held[id] > 0
}

func (c *compContext) enqueue(fn func()) {
	c.mu.Lock()
	c.deferred = append(c.deferred, fn)
	c.mu.Unlock()
}

func (c *compContext) drain() []func() {
	c.mu.Lock()
	out := c.deferred
	c.deferred = nil
	c.mu.Unlock()
	return out
}

// compContextFrom returns the compContext on ctx, or a fresh one plus outermost=
// true when none is present (the caller is the top of the stack and owns draining).
func compContextFrom(ctx context.Context) (*compContext, bool) {
	if cc, ok := ctx.Value(compContextKey{}).(*compContext); ok && cc != nil {
		return cc, false
	}
	return newCompContext(), true
}

func withCompContext(ctx context.Context, cc *compContext) context.Context {
	return context.WithValue(ctx, compContextKey{}, cc)
}

// drainDeferred runs any deferred parent-resume closures collected during this
// stack, looping until the queue is empty (a drained resume may itself defer a
// grandparent resume). A bounded guard prevents an unexpected cycle from looping
// forever.
func (s *EngineService) drainDeferred(_ context.Context, cc *compContext) {
	for i := 0; i < 10000; i++ {
		batch := cc.drain()
		if len(batch) == 0 {
			return
		}
		for _, fn := range batch {
			fn()
		}
	}
	s.logger.Error().Msg("composition: deferred parent-resume drain exceeded bound (possible cycle)")
}

// This file implements the ENGINE side of the two BPMN composition step types:
//
//	call_activity  — a parent step starts a CHILD instance from another definition
//	                 (mapping inputs in), records a parent->child link, and PARKS;
//	                 the child completing maps its outputs back and resumes the
//	                 parent; a child failing propagates to the parent step.
//	multi_instance — a parent step fans out N children (async) over a collection;
//	                 each child completion decrements a fan-in counter and, when the
//	                 completion policy (all / any / n_of_m) is met, resumes the
//	                 parent once (early-cancelling the rest for any / n_of_m).
//
// It reuses the EXISTING durable park/resume seams: StartInstance for the child,
// AdvanceWorkflow to resume a parent, completeInstance/failInstance/raiseIncident
// as the child terminal points that fire the parent hook. Everything mutating
// state goes through the same transactional CommitStepTransition path the leaf
// steps use (via advanceLocked / completeRunningStepExecution).

// WithCompositionStores wires the OPTIONAL multi_instance fan-in ledger (and,
// for symmetry, re-confirms the self-canceler). It returns the receiver for
// chaining and is a no-op passthrough when ledger is nil. Separate from
// NewEngineService so every existing caller/test compiles unchanged; a wiring
// that never uses multi_instance never calls it.
func (s *EngineService) WithCompositionStores(ledger miChildLedger) *EngineService {
	s.miLedger = ledger
	if s.canceler == nil {
		s.canceler = s
	}
	return s
}

// StartChildInstance implements executor.ChildStarter. It resolves the ACTIVE
// child definition for definitionKey in the parent's tenant, seeds it with
// inputVars, records the parent link (so the child's terminal transition finds
// its parent), and starts it — returning the new child instance id. The child is
// started under its OWN per-instance critical section (StartInstance serializes
// internally); the PARENT is already parked by the calling executor.
//
// Guarded so a nil resolver (test double / unwired) is a clear error rather than
// a silent no-op.
var _ executor.ChildStarter = (*EngineService)(nil)

func (s *EngineService) StartChildInstance(ctx context.Context, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey string, inputVars map[string]interface{}) (string, error) {
	child, childDef, firstStepID, err := s.createChildInstance(ctx, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey, inputVars)
	if err != nil {
		return "", err
	}
	s.advanceChildFirstStep(ctx, child, childDef, firstStepID)
	return child.ID, nil
}

// createChildInstance resolves + persists a child instance (with the parent link
// recorded atomically at creation) WITHOUT advancing it. Split from
// StartChildInstance so the sequential multi_instance path can attach the child
// id to its fan-in slot BEFORE the child can advance/complete (closing a race
// where a fast child completes before its slot knows its instance id).
func (s *EngineService) createChildInstance(ctx context.Context, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey string, inputVars map[string]interface{}) (*model.WorkflowInstance, *model.WorkflowDefinition, string, error) {
	if s.childDefResolver == nil {
		return nil, nil, "", fmt.Errorf("composition: no child-definition resolver wired (call_activity/multi_instance require repository.DefinitionRepository)")
	}
	if definitionKey == "" {
		return nil, nil, "", fmt.Errorf("composition: empty child definition_key")
	}

	// CYCLE / RUNAWAY-NESTING GUARD (fail closed BEFORE persisting the child).
	// Walk parent_instance_id up from the parent that is spawning this child to
	// compute the child's would-be depth. A top-level instance is depth 0; the
	// child about to be created is (parentDepth + 1). If that exceeds maxCallDepth
	// reject — so a call_activity/multi_instance definition_key that resolves back
	// to its own lineage (self-recursion), or a mutually-recursive pair, raises an
	// incident on the parent step instead of spawning an unbounded async
	// child->grandchild->... chain (each a real workflow_instances row + park).
	// This complements drainDeferred, which only bounds SYNCHRONOUS same-stack
	// resumes, not the async spawn chain.
	childDepth, derr := s.compositionDepth(ctx, parentInstanceID)
	if derr != nil {
		return nil, nil, "", fmt.Errorf("composition: computing call depth for parent %q: %w", parentInstanceID, derr)
	}
	if childDepth > s.maxCallDepth {
		s.logger.Error().
			Str("parent_instance_id", parentInstanceID).
			Str("parent_step_id", parentStepID).
			Str("child_definition_key", definitionKey).
			Int("child_depth", childDepth).
			Int("max_call_depth", s.maxCallDepth).
			Msg("composition: max call depth exceeded — rejecting child spawn (possible recursive/cyclic definition)")
		return nil, nil, "", fmt.Errorf("composition: max call depth %d exceeded (child would be depth %d) starting %q from parent %q: possible recursive/cyclic composition",
			s.maxCallDepth, childDepth, definitionKey, parentInstanceID)
	}

	childDef, err := s.childDefResolver.GetActiveByDefinitionKey(ctx, tenantID, definitionKey)
	if err != nil {
		return nil, nil, "", fmt.Errorf("resolving child definition %q: %w", definitionKey, err)
	}

	now := time.Now().UTC()
	firstStepID := ""
	if len(childDef.Steps) > 0 {
		firstStepID = childDef.Steps[0].ID
	}

	parentInst := parentInstanceID
	parentStep := parentStepID
	var startedByPtr *string
	if startedBy != "" {
		sb := startedBy
		startedByPtr = &sb
	}

	child := &model.WorkflowInstance{
		ID:               generateUUID(),
		TenantID:         tenantID,
		DefinitionID:     childDef.ID,
		DefinitionVer:    childDef.Version,
		Status:           model.InstanceStatusRunning,
		CurrentStepID:    &firstStepID,
		Variables:        make(map[string]interface{}),
		StepOutputs:      make(map[string]interface{}),
		StartedBy:        startedByPtr,
		StartedAt:        now,
		UpdatedAt:        now,
		LockVersion:      0,
		ParentInstanceID: &parentInst,
		ParentStepID:     &parentStep,
	}
	// Seed the child variables from its own defaults, then overlay the mapped
	// inputs so the caller's input_mapping wins over defaults.
	child.Variables = s.resolveInitialVariables(childDef.Variables, inputVars, nil)

	if err := s.instanceRepo.Create(ctx, child); err != nil {
		return nil, nil, "", fmt.Errorf("creating child instance: %w", err)
	}

	s.logger.Info().
		Str("child_instance_id", child.ID).
		Str("child_definition_id", childDef.ID).
		Str("parent_instance_id", parentInstanceID).
		Str("parent_step_id", parentStepID).
		Str("tenant_id", tenantID).
		Msg("child workflow instance created (composition)")

	s.publishEvent(ctx, "workflow.instance.started", tenantID, map[string]interface{}{
		"instance_id":        child.ID,
		"definition_id":      childDef.ID,
		"started_by":         startedBy,
		"parent_instance_id": parentInstanceID,
		"parent_step_id":     parentStepID,
	})

	return child, childDef, firstStepID, nil
}

// compositionDepth returns the depth the CHILD about to be spawned by
// parentInstanceID would occupy in the composition (call_activity / multi_instance)
// spawn tree: a top-level (no-parent) instance is depth 0 and each nested child
// adds 1, so the returned value is (parent's depth + 1). parentInstanceID == ""
// means the caller is not spawning from an instance (defensive) and yields depth
// 1. The walk follows parent_instance_id up the chain and is itself hard-bounded
// to maxCallDepth+2 iterations so a corrupt parent cycle in existing data cannot
// make the walk itself loop forever — it returns a depth past the bound, which
// the caller then rejects. Lookups use the empty tenant id (GetByID already
// resolves cross-tenant by id, matching resumeCallActivityParent's parent load).
func (s *EngineService) compositionDepth(ctx context.Context, parentInstanceID string) (int, error) {
	if parentInstanceID == "" {
		return 1, nil
	}
	// Hard iteration cap: at most maxCallDepth+2 hops. Once we exceed the bound the
	// exact depth no longer matters (the caller rejects), and this stops a cyclic
	// parent chain from spinning forever.
	maxHops := s.maxCallDepth + 2
	depth := 1 // the child about to be created sits one below its immediate parent
	cur := parentInstanceID
	for hop := 0; hop < maxHops; hop++ {
		inst, err := s.instanceRepo.GetByID(ctx, "", cur)
		if err != nil {
			return 0, fmt.Errorf("walking parent chain at %q: %w", cur, err)
		}
		if !inst.HasParent() {
			return depth, nil
		}
		depth++
		cur = *inst.ParentInstanceID
	}
	// Bound exceeded without reaching a root: report a depth strictly past the
	// limit so the caller fails closed (covers both deep nesting and a corrupt
	// parent cycle).
	s.logger.Error().
		Str("parent_instance_id", parentInstanceID).
		Int("max_hops", maxHops).
		Msg("composition: parent-chain walk exceeded hop bound (deep nesting or corrupt parent cycle)")
	return s.maxCallDepth + 1, nil
}

// StartMultiInstanceChild implements executor.ChildStarter for the multi_instance
// fan-out. It performs create -> SEED THE FAN-IN LEDGER SLOT (with the child id)
// -> advance IN THAT ORDER, so a fast child that completes synchronously during
// advance finds its ledger slot already present (the completion hook resolves the
// slot by child_instance_id). childIndex is the child's position in the
// collection. Requires a wired fan-in ledger.
func (s *EngineService) StartMultiInstanceChild(ctx context.Context, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey string, childIndex int, inputVars map[string]interface{}) (string, error) {
	if s.miLedger == nil {
		return "", fmt.Errorf("composition: no multi_instance fan-in ledger wired")
	}
	child, childDef, firstStepID, err := s.createChildInstance(ctx, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey, inputVars)
	if err != nil {
		return "", err
	}
	// Seed the slot WITH the child id BEFORE advancing so the completion hook can
	// find it. Idempotent on (parent, step, index).
	childID := child.ID
	slot := &model.MIChild{
		TenantID:         tenantID,
		ParentInstanceID: parentInstanceID,
		ParentStepID:     parentStepID,
		ChildIndex:       childIndex,
		ChildInstanceID:  &childID,
		Status:           model.MIChildStatusRunning,
	}
	if lerr := s.miLedger.CreateChild(ctx, slot); lerr != nil {
		return "", fmt.Errorf("seeding multi_instance fan-in slot %d: %w", childIndex, lerr)
	}
	s.advanceChildFirstStep(ctx, child, childDef, firstStepID)
	return child.ID, nil
}

// SeedMultiInstanceSlot implements executor.ChildStarter: it records a NOT-YET-
// STARTED fan-in slot (child instance id nil) for the sequential path so the
// engine knows the full cardinality up-front and can start the next slot as prior
// children complete. Idempotent on (parent, step, index).
func (s *EngineService) SeedMultiInstanceSlot(ctx context.Context, tenantID, parentInstanceID, parentStepID string, childIndex int) error {
	if s.miLedger == nil {
		return fmt.Errorf("composition: no multi_instance fan-in ledger wired")
	}
	slot := &model.MIChild{
		TenantID:         tenantID,
		ParentInstanceID: parentInstanceID,
		ParentStepID:     parentStepID,
		ChildIndex:       childIndex,
		Status:           model.MIChildStatusRunning,
	}
	if err := s.miLedger.CreateChild(ctx, slot); err != nil {
		return fmt.Errorf("seeding sequential multi_instance slot %d: %w", childIndex, err)
	}
	return nil
}

// advanceChildFirstStep advances a freshly-created child from its first step
// under ITS OWN critical section. A failure here does not tear down the parent
// link — the child is created and recoverable, exactly like a top-level
// StartInstance.
func (s *EngineService) advanceChildFirstStep(ctx context.Context, child *model.WorkflowInstance, childDef *model.WorkflowDefinition, firstStepID string) {
	if firstStepID == "" {
		return
	}
	if aerr := s.serializeTransition(ctx, child.ID, func(ctx context.Context) error {
		return s.executeStepLocked(ctx, child, childDef, firstStepID)
	}); aerr != nil {
		s.logger.Error().Err(aerr).
			Str("child_instance_id", child.ID).
			Str("step_id", firstStepID).
			Msg("failed to execute child first step")
	}
}

// onChildInstanceTerminal is the parent-resume hook fired when an instance that
// HAS A PARENT reaches a terminal state (completed / failed / incident-final).
// It dispatches to the multi_instance fan-in (when the child is a fan-out slot)
// or the single call_activity resume/propagation path.
//
// It runs UNDER THE PARENT's critical section (acquired here) so a burst of
// sibling children completing concurrently cannot double-advance the parent. The
// child's own critical section has already been released by the caller (the
// child terminal transition committed before this hook fires).
func (s *EngineService) onChildInstanceTerminal(ctx context.Context, child *model.WorkflowInstance, childStatus string, childErr string) {
	if !child.HasParent() {
		return
	}
	parentInstanceID := *child.ParentInstanceID
	parentStepID := *child.ParentStepID

	// Multi_instance fan-out child? The ledger has a slot keyed on this child
	// instance id. If so, drive the counter fan-in; otherwise treat it as a single
	// call_activity child.
	if s.miLedger != nil {
		if slot, err := s.miLedger.GetChildByInstance(ctx, child.ID); err == nil && slot != nil {
			s.handleMultiInstanceChildTerminal(ctx, child, slot, childStatus, childErr)
			return
		}
	}

	// Single call_activity child: resume (or propagate to) the parent step under
	// the parent's critical section — deferred to the outermost unwind when the
	// parent lock is currently held by this stack (synchronous child completion).
	childCopy := *child
	s.runParentResume(ctx, parentInstanceID, func(runCtx context.Context) {
		_ = s.serializeTransition(runCtx, parentInstanceID, func(txCtx context.Context) error {
			return s.resumeCallActivityParent(txCtx, parentInstanceID, parentStepID, &childCopy, childStatus, childErr)
		})
	})
}

// runParentResume runs a parent-resume closure either inline (when the parent's
// critical section is NOT held by this stack — an async resume) or deferred to
// the outermost serializeTransition (when it IS held — a synchronous child
// completion within the parent's own transition). The deferred closure runs with
// a ctx that carries a FRESH compContext so it can freshly acquire the parent
// lock without the stale held-set marking it as still held.
func (s *EngineService) runParentResume(ctx context.Context, parentInstanceID string, resume func(context.Context)) {
	cc, _ := compContextFrom(ctx)
	if cc.isHeld(parentInstanceID) {
		cc.enqueue(func() {
			resume(context.Background())
		})
		return
	}
	resume(ctx)
}

// resumeCallActivityParent maps a completed child's outputs back onto the parent
// call_activity step and advances the parent; on a failed child it propagates the
// failure to the parent step (default policy: fail the parent step, which enters
// the parent's own retry/incident path). The caller holds the parent's critical
// section.
func (s *EngineService) resumeCallActivityParent(ctx context.Context, parentInstanceID, parentStepID string, child *model.WorkflowInstance, childStatus, childErr string) error {
	parent, err := s.instanceRepo.GetByID(ctx, "", parentInstanceID)
	if err != nil {
		return fmt.Errorf("loading parent instance for call-activity resume: %w", err)
	}
	if !parent.IsRunnable() {
		s.logger.Debug().
			Str("parent_instance_id", parentInstanceID).
			Str("status", parent.Status).
			Msg("parent not runnable, skipping call-activity resume")
		return nil
	}

	def, err := s.defRepo.GetByID(ctx, parent.TenantID, parent.DefinitionID)
	if err != nil {
		return fmt.Errorf("loading parent definition for call-activity resume: %w", err)
	}
	step := findStep(def.Steps, parentStepID)
	if step == nil {
		return fmt.Errorf("parent call-activity step %s not found in definition %s", parentStepID, def.ID)
	}

	if childStatus != model.InstanceStatusCompleted {
		// Child failed: propagate to the parent step. The default (and only) policy
		// fails the parent step, so the parent's configured retry/incident handling
		// governs what happens next — the child's error is surfaced verbatim.
		return s.propagateChildFailureToParentStep(ctx, parent, def, step, child, childErr)
	}

	// Child completed: project its outputs back. The child's variables + its
	// step_outputs are exposed under a "child" root so an output_mapping can pull
	// specific values; the whole child output is also stored as the parent step's
	// output for observability.
	childData := childProjection(child)
	stepOutput := map[string]interface{}{
		"child_instance_id": child.ID,
		"child_status":      childStatus,
		"child":             childData,
	}
	if mapping := executor.CallActivityOutputMapping(step.Config); mapping != nil {
		mapped, merr := s.resolveChildOutputMapping(mapping, childData)
		if merr != nil {
			return fmt.Errorf("resolving call-activity output_mapping: %w", merr)
		}
		// Merge mapped values into the parent instance variables (so downstream
		// steps/conditions see them) and echo them on the step output.
		if parent.Variables == nil {
			parent.Variables = make(map[string]interface{})
		}
		for k, v := range mapped {
			parent.Variables[k] = v
			stepOutput[k] = v
		}
	}

	s.storeStepOutput(ctx, parent, parentStepID, stepOutput)
	// SINGLE-WINNER GUARD (call-activity completion side): only advance the parent
	// if we actually claimed the RUNNING parent step-exec. found=false means the
	// parent call-activity step was already resolved — either an interrupting
	// boundary cancelled it (this child completion lost the race and MUST NOT
	// double-advance past the boundary handler) or a benign replay of an
	// already-completed step (the parent already advanced). Both cases correctly
	// no-op here.
	found, err := s.completeRunningStepExecutionFound(ctx, parent.ID, parentStepID, stepOutput)
	if err != nil {
		return err
	}
	if !found {
		s.logger.Info().
			Str("parent_instance_id", parent.ID).
			Str("step_id", parentStepID).
			Str("child_instance_id", child.ID).
			Msg("call-activity child completed but parent step no longer running (boundary/sibling won or benign replay), ignoring")
		return nil
	}

	s.logger.Info().
		Str("parent_instance_id", parent.ID).
		Str("parent_step_id", parentStepID).
		Str("child_instance_id", child.ID).
		Msg("call-activity child completed, resuming parent")

	return s.advanceLocked(ctx, parent.ID, parentStepID)
}

// propagateChildFailureToParentStep raises the child's failure onto the parent
// step. It routes through handleStepFailure so the parent step honours its own
// max_retries and (when an incident store is wired) the incident/park path —
// exactly as if the parent step itself had failed.
func (s *EngineService) propagateChildFailureToParentStep(ctx context.Context, parent *model.WorkflowInstance, def *model.WorkflowDefinition, step *model.StepDefinition, child *model.WorkflowInstance, childErr string) error {
	// Find the parent's RUNNING step execution for this call-activity step so the
	// failure is recorded against it (falling back to a synthetic exec record when
	// none is found, which keeps handleStepFailure well-formed).
	stepExec := s.runningStepExecution(ctx, parent.ID, step.ID)
	if stepExec == nil {
		now := time.Now().UTC()
		stepExec = &model.StepExecution{
			ID:         generateUUID(),
			InstanceID: parent.ID,
			StepID:     step.ID,
			StepType:   step.Type,
			Status:     model.StepStatusRunning,
			Attempt:    1,
			StartedAt:  &now,
			CreatedAt:  now,
		}
		if err := s.instanceRepo.CreateStepExecution(ctx, stepExec); err != nil {
			return fmt.Errorf("creating parent step execution for child-failure propagation: %w", err)
		}
	}

	msg := childErr
	if msg == "" {
		msg = "child instance failed"
	}
	execErr := fmt.Errorf("call_activity child %s failed: %s", child.ID, msg)

	s.logger.Warn().
		Str("parent_instance_id", parent.ID).
		Str("parent_step_id", step.ID).
		Str("child_instance_id", child.ID).
		Msg("call-activity child failed, propagating to parent step")

	return s.handleStepFailure(ctx, parent, def, step, stepExec, execErr)
}

// handleMultiInstanceChildTerminal drives the multi_instance completion-counter
// fan-in. It marks the child's ledger slot terminal (guarded so a duplicate
// terminal is a no-op), then — under the PARENT's critical section — re-reads the
// ledger, evaluates the completion policy, and either resumes the parent step
// (aggregating outputs, early-cancelling the rest) or, when the policy can no
// longer be met, fails the parent step.
func (s *EngineService) handleMultiInstanceChildTerminal(ctx context.Context, child *model.WorkflowInstance, slot *model.MIChild, childStatus, childErr string) {
	parentInstanceID := slot.ParentInstanceID
	parentStepID := slot.ParentStepID

	ledgerStatus := model.MIChildStatusCompleted
	var errPtr *string
	var childOut map[string]interface{}
	if childStatus == model.InstanceStatusCompleted {
		childOut = childProjection(child)
	} else {
		ledgerStatus = model.MIChildStatusFailed
		if childErr != "" {
			e := childErr
			errPtr = &e
		}
	}

	// Mark the slot terminal. If it was already terminal (a duplicate completion
	// signal), this call reports false and we stop — the parent was, or will be,
	// resumed by the call that actually flipped the slot.
	flipped, err := s.miLedger.MarkChildTerminalByInstance(ctx, child.ID, ledgerStatus, childOut, errPtr)
	if err != nil {
		s.logger.Error().Err(err).
			Str("child_instance_id", child.ID).
			Msg("multi_instance: marking child slot terminal")
		return
	}
	if !flipped {
		return
	}

	// Resume the parent fan-in under its critical section, deferred to the
	// outermost unwind when the parent lock is currently held by this stack (a
	// synchronous child completion during the fan-out).
	s.runParentResume(ctx, parentInstanceID, func(runCtx context.Context) {
		_ = s.serializeTransition(runCtx, parentInstanceID, func(txCtx context.Context) error {
			return s.evaluateMultiInstanceFanIn(txCtx, parentInstanceID, parentStepID)
		})
	})
}

// evaluateMultiInstanceFanIn re-reads the fan-in ledger, evaluates the parent
// step's completion policy, and resumes / fails / starts-next as appropriate.
// The caller holds the parent's critical section.
func (s *EngineService) evaluateMultiInstanceFanIn(ctx context.Context, parentInstanceID, parentStepID string) error {
	parent, err := s.instanceRepo.GetByID(ctx, "", parentInstanceID)
	if err != nil {
		return fmt.Errorf("loading parent for multi_instance fan-in: %w", err)
	}
	if !parent.IsRunnable() {
		return nil // already resolved / not runnable
	}

	def, err := s.defRepo.GetByID(ctx, parent.TenantID, parent.DefinitionID)
	if err != nil {
		return fmt.Errorf("loading parent definition for multi_instance fan-in: %w", err)
	}
	step := findStep(def.Steps, parentStepID)
	if step == nil {
		return fmt.Errorf("multi_instance step %s not found in definition %s", parentStepID, def.ID)
	}

	children, err := s.miLedger.ListChildren(ctx, parentInstanceID, parentStepID)
	if err != nil {
		return fmt.Errorf("listing multi_instance fan-in slots: %w", err)
	}

	total := len(children)
	completed, failed := 0, 0
	for _, c := range children {
		switch c.Status {
		case model.MIChildStatusCompleted:
			completed++
		case model.MIChildStatusFailed:
			failed++
		}
	}

	satisfied, failedPolicy := executor.MICompletionSatisfied(step.Config, total, completed, failed)

	// SEQUENTIAL mode: if the policy is not yet decided and there is an un-started
	// slot (child_instance_id nil), start the next one and keep parking.
	if !satisfied && !failedPolicy && configBoolAny(step.Config, "sequential") {
		if started := s.startNextSequentialChild(ctx, parent, step, children); started {
			return nil
		}
	}

	if !satisfied && !failedPolicy {
		return nil // keep parking; more children outstanding
	}

	if failedPolicy {
		// The policy can no longer be met (e.g. a failure under "all"). Fail the
		// parent step so its own retry/incident handling governs. Cancel any still-
		// running children first so they do not linger.
		s.cancelRemainingChildren(ctx, parent.TenantID, children)
		stepExec := s.runningStepExecution(ctx, parent.ID, parentStepID)
		if stepExec == nil {
			now := time.Now().UTC()
			stepExec = &model.StepExecution{
				ID: generateUUID(), InstanceID: parent.ID, StepID: parentStepID,
				StepType: step.Type, Status: model.StepStatusRunning, Attempt: 1,
				StartedAt: &now, CreatedAt: now,
			}
			_ = s.instanceRepo.CreateStepExecution(ctx, stepExec)
		}
		return s.handleStepFailure(ctx, parent, def, step, stepExec,
			fmt.Errorf("multi_instance %s: completion policy failed (%d/%d completed, %d failed)", parentStepID, completed, total, failed))
	}

	// Policy satisfied: aggregate outputs (in child_index order), early-cancel any
	// still-running children (any / n_of_m), complete the step, and advance.
	s.cancelRemainingChildren(ctx, parent.TenantID, children)

	results := make([]interface{}, 0, total)
	for _, c := range children {
		if c.Status == model.MIChildStatusCompleted && c.Output != nil {
			results = append(results, c.Output)
		}
	}
	stepOutput := map[string]interface{}{
		"multi_instance":     true,
		"collection_size":    total,
		"completed_children": completed,
		"failed_children":    failed,
		"results":            results,
	}

	s.storeStepOutput(ctx, parent, parentStepID, stepOutput)
	// SINGLE-WINNER GUARD (multi_instance fan-in side): only advance if we claimed
	// the RUNNING parent step-exec. found=false means the parent multi_instance
	// step was already resolved (an interrupting boundary cancelled it, or a benign
	// replay), so this fan-in lost the race and MUST NOT double-advance.
	found, err := s.completeRunningStepExecutionFound(ctx, parent.ID, parentStepID, stepOutput)
	if err != nil {
		return err
	}
	if !found {
		s.logger.Info().
			Str("parent_instance_id", parent.ID).
			Str("step_id", parentStepID).
			Msg("multi_instance fan-in but parent step no longer running (boundary/sibling won or benign replay), ignoring")
		return nil
	}

	s.logger.Info().
		Str("parent_instance_id", parent.ID).
		Str("parent_step_id", parentStepID).
		Int("completed", completed).
		Int("total", total).
		Msg("multi_instance completion policy satisfied, resuming parent")

	return s.advanceLocked(ctx, parent.ID, parentStepID)
}

// startNextSequentialChild starts the first un-started (child_instance_id nil)
// slot for a sequential multi_instance, using the slot's element already implied
// by its index. Because sequential fan-out is a convenience, the per-element
// inputs are re-derived from the parent variables collection at start time.
// Returns true when a child was started.
func (s *EngineService) startNextSequentialChild(ctx context.Context, parent *model.WorkflowInstance, step *model.StepDefinition, children []*model.MIChild) bool {
	// Resolve the collection + element var from the step config so the next slot's
	// element can be passed as the child input.
	dataCtx := s.buildExpressionContext(parent)
	raw, ok := step.Config["collection"]
	if !ok {
		return false
	}
	resolved, err := s.resolver.Resolve(raw, dataCtx)
	if err != nil {
		return false
	}
	coll, ok := resolved.([]interface{})
	if !ok {
		return false
	}
	elementVar, _ := step.Config["element_var"].(string)
	if elementVar == "" {
		elementVar = "item"
	}
	childDefKey, _ := step.Config["child_definition_key"].(string)
	startedBy := ""
	if parent.StartedBy != nil {
		startedBy = *parent.StartedBy
	}

	for _, slot := range children {
		if slot.ChildInstanceID != nil {
			continue
		}
		if slot.ChildIndex < 0 || slot.ChildIndex >= len(coll) {
			continue
		}
		inputs := map[string]interface{}{
			elementVar:   coll[slot.ChildIndex],
			"loop_index": slot.ChildIndex,
			"loop_total": len(coll),
		}
		// Create -> ATTACH the id to the slot -> advance. Attaching before advancing
		// closes the race where a fast child completes before its slot knows its
		// instance id (the terminal hook finds the slot by child_instance_id).
		child, childDef, firstStepID, cerr := s.createChildInstance(ctx, parent.TenantID, startedBy, parent.ID, step.ID, childDefKey, inputs)
		if cerr != nil {
			s.logger.Error().Err(cerr).
				Str("parent_instance_id", parent.ID).
				Int("child_index", slot.ChildIndex).
				Msg("multi_instance: creating next sequential child")
			return false
		}
		if aerr := s.miLedger.AttachChildInstance(ctx, parent.ID, step.ID, slot.ChildIndex, child.ID); aerr != nil {
			s.logger.Error().Err(aerr).
				Str("parent_instance_id", parent.ID).
				Int("child_index", slot.ChildIndex).
				Msg("multi_instance: attaching next sequential child to slot")
			return false
		}
		s.advanceChildFirstStep(ctx, child, childDef, firstStepID)
		return true
	}
	return false
}

// cancelRemainingChildren cancels any still-running fan-out children (early-
// cancel for any / n_of_m, or cleanup on a failed policy). Best-effort.
func (s *EngineService) cancelRemainingChildren(ctx context.Context, tenantID string, children []*model.MIChild) {
	if s.canceler == nil {
		return
	}
	for _, c := range children {
		if c.Status == model.MIChildStatusRunning && c.ChildInstanceID != nil && *c.ChildInstanceID != "" {
			if err := s.canceler.CancelInstance(ctx, tenantID, *c.ChildInstanceID); err != nil {
				s.logger.Debug().Err(err).
					Str("child_instance_id", *c.ChildInstanceID).
					Msg("multi_instance: cancelling remaining child (best-effort)")
			}
		}
	}
}

// runningStepExecution returns the RUNNING step execution for (instance, step),
// or nil if none is found.
func (s *EngineService) runningStepExecution(ctx context.Context, instanceID, stepID string) *model.StepExecution {
	execs, err := s.instanceRepo.GetStepExecutions(ctx, instanceID)
	if err != nil {
		return nil
	}
	for _, ex := range execs {
		if ex.StepID == stepID && ex.Status == model.StepStatusRunning {
			return ex
		}
	}
	return nil
}

// resolveChildOutputMapping resolves each output_mapping value against the
// child's projected data (exposed under a "child" root).
func (s *EngineService) resolveChildOutputMapping(mapping map[string]interface{}, childData map[string]interface{}) (map[string]interface{}, error) {
	dataCtx := map[string]interface{}{"child": childData}
	out := make(map[string]interface{}, len(mapping))
	for parentVar, spec := range mapping {
		val, err := s.resolver.Resolve(spec, dataCtx)
		if err != nil {
			return nil, fmt.Errorf("output_mapping[%q]: %w", parentVar, err)
		}
		out[parentVar] = val
	}
	return out, nil
}

// childProjection exposes a completed child's variables + step outputs as a data
// map an output_mapping can reference (child.variables.x / child.steps.y.output).
func childProjection(child *model.WorkflowInstance) map[string]interface{} {
	return map[string]interface{}{
		"variables": child.Variables,
		"steps":     child.StepOutputs,
	}
}

// configBoolAny reads a boolean-ish config value (bool or "true"/1) for the given
// key. A thin wrapper so this file need not import the executor's helper.
func configBoolAny(config map[string]interface{}, key string) bool {
	switch v := config[key].(type) {
	case bool:
		return v
	case string:
		return v == "true" || v == "1" || v == "yes" || v == "on"
	case float64:
		return v != 0
	case int:
		return v != 0
	default:
		return false
	}
}
