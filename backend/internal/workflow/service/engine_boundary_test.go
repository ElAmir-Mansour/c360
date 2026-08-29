package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// This file proves INTERRUPTING BOUNDARY EVENTS + the EVENT-BASED GATEWAY on the
// existing durable park/resume engine:
//
//   * a timer boundary interrupts a PARKED human_task and routes to the handler
//     (and does NOT fire when the step completes first);
//   * an error boundary routes on step failure;
//   * an event-based gateway routes to the first-firing arm and cancels the rest;
//   * interruption is SERIALIZED — a boundary fire racing a normal completion
//     resolves to exactly one outcome (no double-advance).
//
// It drives the REAL EngineService with the real boundary-fire path
// (FireBoundaryEvent / the error-boundary hook), a controllable in-memory
// BoundaryRegistrar (so the test decides WHEN an armed timer/message fires), and
// the multi-instance-capable instance/definition doubles from
// engine_composition_test.go.

const bndTenant = "tenant-boundary"
const bndUser = "user-boundary"

// ---------------------------------------------------------------------------
// controllable boundary registrar
// ---------------------------------------------------------------------------

// armedTimer / armedWait record a single armed boundary/gateway arm so a test can
// fire or assert cancellation on it.
type armedTimer struct {
	instanceID, stepID, armID string
	fireAt                    time.Time
	cancelled                 bool
}

type armedWait struct {
	instanceID, stepID, armID, topic, corr string
	cancelled                              bool
}

// fakeBoundaryRegistrar implements executor.BoundaryRegistrar + the engine's
// boundaryRegistrar seam. It records every arm so the test can fire it (by calling
// the engine's FireBoundaryEvent directly) and assert siblings were cancelled.
type fakeBoundaryRegistrar struct {
	mu     sync.Mutex
	timers []*armedTimer
	waits  []*armedWait
	// removedTimers / removedEventWaits record UNMARKED (ordinary step) durable
	// removals, so a test can assert an interrupted timer/wait step's OWN pending
	// work was torn down (must-fix 2), keyed by "instanceID:stepID".
	removedTimers     map[string]bool
	removedEventWaits map[string]bool
}

func newFakeBoundaryRegistrar() *fakeBoundaryRegistrar {
	return &fakeBoundaryRegistrar{
		removedTimers:     map[string]bool{},
		removedEventWaits: map[string]bool{},
	}
}

func (f *fakeBoundaryRegistrar) RegisterBoundaryTimer(_ context.Context, instanceID, stepID, armID string, fireAt time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.timers = append(f.timers, &armedTimer{instanceID: instanceID, stepID: stepID, armID: armID, fireAt: fireAt})
	return nil
}

func (f *fakeBoundaryRegistrar) RegisterBoundaryMessageWait(_ context.Context, instanceID, stepID, armID, topic, correlationValue string, _ time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.waits = append(f.waits, &armedWait{instanceID: instanceID, stepID: stepID, armID: armID, topic: topic, corr: correlationValue})
	return nil
}

func (f *fakeBoundaryRegistrar) CancelBoundaryTimer(_ context.Context, instanceID, stepID, armID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.timers {
		if t.instanceID == instanceID && t.stepID == stepID && t.armID == armID {
			t.cancelled = true
		}
	}
	return nil
}

func (f *fakeBoundaryRegistrar) CancelBoundaryMessageWait(_ context.Context, instanceID, stepID, armID, _, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, w := range f.waits {
		if w.instanceID == instanceID && w.stepID == stepID && w.armID == armID {
			w.cancelled = true
		}
	}
	return nil
}

func (f *fakeBoundaryRegistrar) RemoveTimer(_ context.Context, instanceID, stepID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removedTimers[instanceID+":"+stepID] = true
	return nil
}

func (f *fakeBoundaryRegistrar) RemoveEventWait(_ context.Context, _, _, instanceID, stepID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removedEventWaits[instanceID+":"+stepID] = true
	return nil
}

func (f *fakeBoundaryRegistrar) timerRemoved(instanceID, stepID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.removedTimers[instanceID+":"+stepID]
}

func (f *fakeBoundaryRegistrar) eventWaitRemoved(instanceID, stepID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.removedEventWaits[instanceID+":"+stepID]
}

func (f *fakeBoundaryRegistrar) timerFor(stepID, armID string) *armedTimer {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, t := range f.timers {
		if t.stepID == stepID && t.armID == armID {
			return t
		}
	}
	return nil
}

func (f *fakeBoundaryRegistrar) waitFor(stepID, armID string) *armedWait {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, w := range f.waits {
		if w.stepID == stepID && w.armID == armID {
			return w
		}
	}
	return nil
}

var _ executor.BoundaryRegistrar = (*fakeBoundaryRegistrar)(nil)
var _ boundaryRegistrar = (*fakeBoundaryRegistrar)(nil)

// bndExecutor is a leaf executor for boundary tests: it parks human_task steps
// (so they stay running and interruptible), dispatches event_based_gateway to the
// real EventGatewayExecutor, optionally fails a named service_task, and echoes a
// trivial output for everything else.
type bndExecutor struct {
	gateway  *executor.EventGatewayExecutor
	failStep string
}

func (e *bndExecutor) Execute(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*executor.ExecutionResult, error) {
	switch step.Type {
	case model.StepTypeEventGateway:
		return e.gateway.Execute(ctx, inst, step, exec)
	case model.StepTypeHumanTask:
		return nil, executor.ErrParked
	case model.StepTypeTimer:
		// A timer step parks; in production it also registers an UNMARKED
		// "instanceID:stepID" timer member. This leaf only parks — the must-fix-2
		// test asserts the engine tears that member down (via RemoveTimer) on
		// interruption, which the engine does regardless of who registered it.
		return nil, executor.ErrParked
	case model.StepTypeEventTask:
		// An event_task WAIT step parks; interruption must remove its unmarked
		// event-wait key (via RemoveEventWait).
		return nil, executor.ErrParked
	case model.StepTypeServiceTask:
		if e.failStep != "" && step.ID == e.failStep {
			return nil, errors.New("simulated service failure")
		}
		return &executor.ExecutionResult{Output: map[string]interface{}{"ok": true}}, nil
	default:
		return &executor.ExecutionResult{Output: map[string]interface{}{"ok": true}}, nil
	}
}

var _ executorRegistry = (*bndExecutor)(nil)

// buildBoundaryEngine wires a real EngineService with the controllable registrar
// and the real event-gateway executor pointing at that registrar. maxRetries=0 on
// a failing step means it fails on the first attempt (exercising the error
// boundary immediately).
func buildBoundaryEngine(t *testing.T, defRepo *compDefRepo) (*EngineService, *multiInstanceRepo, *fakeBoundaryRegistrar, *bndExecutor) {
	t.Helper()
	instRepo := newMultiInstanceRepo()
	reg := newFakeBoundaryRegistrar()
	leaf := &bndExecutor{}
	eng := NewEngineService(instRepo, defRepo, newRecordingTaskRepo(), leaf, nil, zerolog.Nop())
	eng.SetBoundaryRegistrar(reg)
	leaf.gateway = executor.NewEventGatewayExecutor(reg, nil, zerolog.Nop())
	return eng, instRepo, reg, leaf
}

// ---------------------------------------------------------------------------
// (1a) timer boundary interrupts a parked human_task and routes to the handler
// ---------------------------------------------------------------------------

func humanTaskWithTimerBoundary() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID: "def-bnd-timer", TenantID: bndTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "review",
				Type: model.StepTypeHumanTask,
				Name: "Review",
				Config: map[string]interface{}{
					"form_fields": []interface{}{},
					"assignee":    "u1",
				},
				BoundaryEvents: []model.BoundaryEvent{
					{ID: "b-timer", Type: model.BoundaryEventTypeTimer, HandlerStepID: "escalate",
						Config: map[string]interface{}{"duration": "PT30M"}},
				},
				Transitions: []model.Transition{{Target: "approved"}},
			},
			{ID: "approved", Type: model.StepTypeServiceTask, Name: "Approved", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "escalate", Type: model.StepTypeServiceTask, Name: "Escalate", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func TestTimerBoundaryInterruptsParkedHumanTaskAndRoutesToHandler(t *testing.T) {
	defRepo := newCompDefRepo()
	def := humanTaskWithTimerBoundary()
	defRepo.add(def)
	eng, instRepo, reg, _ := buildBoundaryEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}
	// Parked on the human task, running, with the timer boundary armed.
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusRunning {
		t.Fatalf("status after start = %q, want running (parked on review)", got)
	}
	armed := reg.timerFor("review", "b-timer")
	if armed == nil {
		t.Fatal("timer boundary was not armed on the parked human task")
	}
	if armed.instanceID != inst.ID {
		t.Fatalf("armed timer instance = %q, want %q", armed.instanceID, inst.ID)
	}

	// Fire the boundary timer (as the scheduler would).
	if err := eng.FireBoundaryEvent(context.Background(), inst.ID, "review", "b-timer"); err != nil {
		t.Fatalf("FireBoundaryEvent error = %v", err)
	}

	// The flow must have routed to the escalate handler -> end -> completed.
	final := instRepo.get(inst.ID)
	if final.Status != model.InstanceStatusCompleted {
		t.Fatalf("status after boundary fire = %q, want completed via escalate handler", final.Status)
	}
	// The escalate step must have run; the approved (normal) path must NOT.
	if !stepRan(instRepo, inst.ID, "escalate") {
		t.Fatal("escalate handler step did not run after timer boundary fired")
	}
	if stepRan(instRepo, inst.ID, "approved") {
		t.Fatal("approved (normal) path ran, but the boundary should have interrupted it")
	}
	// The interrupted human_task's running step-execution must be cancelled.
	if !stepStatusIs(instRepo, inst.ID, "review", model.StepStatusCancelled) {
		t.Fatal("interrupted review step-execution was not cancelled")
	}
}

// ---------------------------------------------------------------------------
// (1b) the timer boundary does NOT fire if the step completes first
// ---------------------------------------------------------------------------

func TestTimerBoundaryDoesNotFireIfStepCompletesFirst(t *testing.T) {
	defRepo := newCompDefRepo()
	def := humanTaskWithTimerBoundary()
	defRepo.add(def)
	eng, instRepo, reg, _ := buildBoundaryEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}

	// Complete the human task NORMALLY first (routes review -> approved -> end).
	reviewExecID := runningStepExecIDFor(instRepo, inst.ID, "review")
	task := &model.HumanTask{
		ID: "t1", TenantID: bndTenant, InstanceID: inst.ID, StepID: "review",
		StepExecID: reviewExecID, Status: model.TaskStatusCompleted, FormData: map[string]interface{}{"ok": true},
	}
	if err := eng.ResumeFromTask(context.Background(), task); err != nil {
		t.Fatalf("ResumeFromTask error = %v", err)
	}
	final := instRepo.get(inst.ID)
	if final.Status != model.InstanceStatusCompleted {
		t.Fatalf("status after normal completion = %q, want completed", final.Status)
	}
	if !stepRan(instRepo, inst.ID, "approved") {
		t.Fatal("approved path did not run on normal completion")
	}
	// The armed timer must have been CANCELLED by the normal completion.
	if armed := reg.timerFor("review", "b-timer"); armed == nil || !armed.cancelled {
		t.Fatalf("timer boundary was not cancelled on normal completion: %+v", armed)
	}

	// Now a LATE boundary fire (the timer poller races after completion) must
	// no-op: the step is no longer running, so it loses the single-winner race.
	if err := eng.FireBoundaryEvent(context.Background(), inst.ID, "review", "b-timer"); err != nil {
		t.Fatalf("late FireBoundaryEvent error = %v", err)
	}
	if stepRan(instRepo, inst.ID, "escalate") {
		t.Fatal("escalate handler ran on a LATE boundary fire, but completion had already won")
	}
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusCompleted {
		t.Fatalf("status after late fire = %q, want still completed (no double-advance)", got)
	}
}

// ---------------------------------------------------------------------------
// (2) error boundary routes on step failure
// ---------------------------------------------------------------------------

func TestErrorBoundaryRoutesOnStepFailure(t *testing.T) {
	defRepo := newCompDefRepo()
	def := &model.WorkflowDefinition{
		ID: "def-bnd-error", TenantID: bndTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:     "call-out",
				Type:   model.StepTypeServiceTask,
				Name:   "Call Out",
				Config: map[string]interface{}{
					// max_retries omitted (0) => fail on first attempt.
				},
				BoundaryEvents: []model.BoundaryEvent{
					{ID: "b-err", Type: model.BoundaryEventTypeError, HandlerStepID: "fallback"},
				},
				Transitions: []model.Transition{{Target: "happy-end"}},
			},
			{ID: "fallback", Type: model.StepTypeServiceTask, Name: "Fallback", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "happy-end", Type: model.StepTypeServiceTask, Name: "Happy", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(def)
	eng, instRepo, _, leaf := buildBoundaryEngine(t, defRepo)
	leaf.failStep = "call-out" // the guarded call fails

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}

	final := instRepo.get(inst.ID)
	// The error boundary must have caught the failure and routed to fallback -> end.
	if final.Status != model.InstanceStatusCompleted {
		t.Fatalf("status = %q, want completed via error boundary fallback (not failed)", final.Status)
	}
	if !stepRan(instRepo, inst.ID, "fallback") {
		t.Fatal("error boundary handler (fallback) did not run")
	}
	if stepRan(instRepo, inst.ID, "happy-end") {
		t.Fatal("happy path ran, but the failure should have routed to the error boundary")
	}
}

// TestErrorBoundaryNotFiredWhenNoneDeclared proves the failure path is UNCHANGED
// for a failing step that declares no error boundary (no incident store => the
// instance fails, exactly as before).
func TestErrorBoundaryNotFiredWhenNoneDeclared(t *testing.T) {
	defRepo := newCompDefRepo()
	def := &model.WorkflowDefinition{
		ID: "def-no-bnd", TenantID: bndTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{ID: "work", Type: model.StepTypeServiceTask, Name: "Work", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(def)
	eng, instRepo, _, leaf := buildBoundaryEngine(t, defRepo)
	leaf.failStep = "work"

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusFailed {
		t.Fatalf("status = %q, want failed (no boundary, no incident store => legacy fail)", got)
	}
}

// ---------------------------------------------------------------------------
// (3) event-based gateway routes to the first-firing event and cancels the rest
// ---------------------------------------------------------------------------

func eventGatewayDef() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID: "def-event-gw", TenantID: bndTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "wait-for-first",
				Type: model.StepTypeEventGateway,
				Name: "Wait For First Event",
				Config: map[string]interface{}{
					"events": []interface{}{
						map[string]interface{}{"id": "on-approval", "type": "message", "target": "approved-path",
							"topic": "approvals", "correlation_value": "case-1"},
						map[string]interface{}{"id": "on-timeout", "type": "timer", "target": "timeout-path",
							"duration": "PT1H"},
					},
				},
				// A gateway parks; it has no normal transition until an arm fires.
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "approved-path", Type: model.StepTypeServiceTask, Name: "Approved", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "timeout-path", Type: model.StepTypeServiceTask, Name: "Timeout", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func TestEventGatewayRoutesToFirstFiringArmAndCancelsRest(t *testing.T) {
	defRepo := newCompDefRepo()
	def := eventGatewayDef()
	defRepo.add(def)
	eng, instRepo, reg, _ := buildBoundaryEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}
	// Parked on the gateway with BOTH arms armed.
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusRunning {
		t.Fatalf("status after start = %q, want running (parked on gateway)", got)
	}
	if reg.waitFor("wait-for-first", "on-approval") == nil {
		t.Fatal("message arm 'on-approval' was not armed")
	}
	if reg.timerFor("wait-for-first", "on-timeout") == nil {
		t.Fatal("timer arm 'on-timeout' was not armed")
	}

	// The MESSAGE arm fires first (as the event-wait consumer would route it).
	if err := eng.FireBoundaryEvent(context.Background(), inst.ID, "wait-for-first", "on-approval"); err != nil {
		t.Fatalf("FireBoundaryEvent(message arm) error = %v", err)
	}

	final := instRepo.get(inst.ID)
	if final.Status != model.InstanceStatusCompleted {
		t.Fatalf("status = %q, want completed via approved-path", final.Status)
	}
	if !stepRan(instRepo, inst.ID, "approved-path") {
		t.Fatal("winning arm target (approved-path) did not run")
	}
	if stepRan(instRepo, inst.ID, "timeout-path") {
		t.Fatal("losing arm target (timeout-path) ran, but its arm should have been cancelled")
	}
	// The losing timer arm must have been cancelled.
	if lost := reg.timerFor("wait-for-first", "on-timeout"); lost == nil || !lost.cancelled {
		t.Fatalf("losing timer arm not cancelled: %+v", lost)
	}

	// A LATE fire of the losing arm must no-op (single winner).
	if err := eng.FireBoundaryEvent(context.Background(), inst.ID, "wait-for-first", "on-timeout"); err != nil {
		t.Fatalf("late FireBoundaryEvent(timer arm) error = %v", err)
	}
	if stepRan(instRepo, inst.ID, "timeout-path") {
		t.Fatal("late losing arm fire ran timeout-path (double-advance)")
	}
}

// ---------------------------------------------------------------------------
// (4) interruption is serialized: boundary-fire vs completion race => ONE outcome
// ---------------------------------------------------------------------------

// TestBoundaryVsCompletionRaceResolvesToExactlyOneOutcome runs a boundary timer
// fire and a normal task completion CONCURRENTLY many times and asserts that each
// run resolves to exactly one terminal path (escalate XOR approved) with no
// double-advance. The per-instance critical section + the running-step-exec
// single-winner guard must serialize them.
func TestBoundaryVsCompletionRaceResolvesToExactlyOneOutcome(t *testing.T) {
	for iter := 0; iter < 40; iter++ {
		defRepo := newCompDefRepo()
		def := humanTaskWithTimerBoundary()
		defRepo.add(def)
		eng, instRepo, _, _ := buildBoundaryEngine(t, defRepo)

		inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
		if err != nil {
			t.Fatalf("iter %d: StartInstance error = %v", iter, err)
		}
		reviewExecID := runningStepExecIDFor(instRepo, inst.ID, "review")

		var wg sync.WaitGroup
		wg.Add(2)
		// Racer A: normal task completion (review -> approved).
		go func() {
			defer wg.Done()
			task := &model.HumanTask{
				ID: "t", TenantID: bndTenant, InstanceID: inst.ID, StepID: "review",
				StepExecID: reviewExecID, Status: model.TaskStatusCompleted, FormData: map[string]interface{}{"ok": true},
			}
			_ = eng.ResumeFromTask(context.Background(), task)
		}()
		// Racer B: boundary timer fire (review -> escalate).
		go func() {
			defer wg.Done()
			_ = eng.FireBoundaryEvent(context.Background(), inst.ID, "review", "b-timer")
		}()
		wg.Wait()

		final := instRepo.get(inst.ID)
		if final.Status != model.InstanceStatusCompleted {
			t.Fatalf("iter %d: final status = %q, want completed", iter, final.Status)
		}
		ranApproved := stepRan(instRepo, inst.ID, "approved")
		ranEscalate := stepRan(instRepo, inst.ID, "escalate")
		if ranApproved == ranEscalate {
			t.Fatalf("iter %d: exactly one path must run, got approved=%v escalate=%v (double-advance or no-advance)",
				iter, ranApproved, ranEscalate)
		}
	}
}

// ---------------------------------------------------------------------------
// (5) must-fix 2: interrupting a timer/wait step tears down the step's OWN
//     underlying durable work (not just human tasks + sibling arms).
// ---------------------------------------------------------------------------

// timerStepWithMessageBoundary is a TIMER step (its own pending work is an
// unmarked "instanceID:stepID" timer member) carrying a MESSAGE boundary. When the
// boundary fires, the interrupted timer step's own timer must be removed.
func timerStepWithMessageBoundary() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID: "def-bnd-timerstep", TenantID: bndTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "sleep",
				Type: model.StepTypeTimer,
				Name: "Sleep",
				Config: map[string]interface{}{
					"duration": "PT1H",
				},
				BoundaryEvents: []model.BoundaryEvent{
					{ID: "b-msg", Type: model.BoundaryEventTypeMessage, HandlerStepID: "cancelled",
						Config: map[string]interface{}{"topic": "cancel", "correlation_value": "c-1"}},
				},
				Transitions: []model.Transition{{Target: "woke"}},
			},
			{ID: "woke", Type: model.StepTypeServiceTask, Name: "Woke", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "cancelled", Type: model.StepTypeServiceTask, Name: "Cancelled", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func TestBoundaryInterruptingTimerStepRemovesItsOwnTimer(t *testing.T) {
	defRepo := newCompDefRepo()
	def := timerStepWithMessageBoundary()
	defRepo.add(def)
	eng, instRepo, reg, _ := buildBoundaryEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}
	// Parked on the timer step; the message boundary is armed.
	if reg.waitFor("sleep", "b-msg") == nil {
		t.Fatal("message boundary was not armed on the parked timer step")
	}

	// Fire the message boundary (as the event-wait consumer would).
	if err := eng.FireBoundaryEvent(context.Background(), inst.ID, "sleep", "b-msg"); err != nil {
		t.Fatalf("FireBoundaryEvent error = %v", err)
	}

	final := instRepo.get(inst.ID)
	if final.Status != model.InstanceStatusCompleted {
		t.Fatalf("status = %q, want completed via cancelled handler", final.Status)
	}
	if !stepRan(instRepo, inst.ID, "cancelled") {
		t.Fatal("boundary handler (cancelled) did not run")
	}
	if stepRan(instRepo, inst.ID, "woke") {
		t.Fatal("normal timer path (woke) ran, but the boundary should have interrupted it")
	}
	// CORE of must-fix 2: the interrupted timer step's OWN unmarked timer must have
	// been removed so it cannot later fire a spurious AdvanceWorkflow.
	if !reg.timerRemoved(inst.ID, "sleep") {
		t.Fatal("interrupted timer step's own durable timer was NOT removed (would leak and fire spuriously)")
	}
}

// eventWaitStepWithTimerBoundary is an event_task WAIT step (its own pending work
// is an unmarked event-wait key) carrying a TIMER boundary. When the timer fires,
// the interrupted wait step's own event-wait key must be removed.
func eventWaitStepWithTimerBoundary() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID: "def-bnd-waitstep", TenantID: bndTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "await-signal",
				Type: model.StepTypeEventTask,
				Name: "Await Signal",
				Config: map[string]interface{}{
					"mode":              "WAIT",
					"topic":             "signals",
					"correlation_value": "sig-1",
				},
				BoundaryEvents: []model.BoundaryEvent{
					{ID: "b-timeout", Type: model.BoundaryEventTypeTimer, HandlerStepID: "timed-out",
						Config: map[string]interface{}{"duration": "PT15M"}},
				},
				Transitions: []model.Transition{{Target: "signalled"}},
			},
			{ID: "signalled", Type: model.StepTypeServiceTask, Name: "Signalled", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "timed-out", Type: model.StepTypeServiceTask, Name: "Timed Out", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func TestBoundaryInterruptingEventWaitStepRemovesItsOwnWait(t *testing.T) {
	defRepo := newCompDefRepo()
	def := eventWaitStepWithTimerBoundary()
	defRepo.add(def)
	eng, instRepo, reg, _ := buildBoundaryEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}
	if reg.timerFor("await-signal", "b-timeout") == nil {
		t.Fatal("timer boundary was not armed on the parked event_task WAIT step")
	}

	if err := eng.FireBoundaryEvent(context.Background(), inst.ID, "await-signal", "b-timeout"); err != nil {
		t.Fatalf("FireBoundaryEvent error = %v", err)
	}

	final := instRepo.get(inst.ID)
	if final.Status != model.InstanceStatusCompleted {
		t.Fatalf("status = %q, want completed via timed-out handler", final.Status)
	}
	if !stepRan(instRepo, inst.ID, "timed-out") {
		t.Fatal("boundary handler (timed-out) did not run")
	}
	// CORE of must-fix 2: the interrupted WAIT step's own unmarked event-wait key
	// must have been removed so a late correlated event cannot resume it.
	if !reg.eventWaitRemoved(inst.ID, "await-signal") {
		t.Fatal("interrupted event_task WAIT step's own event-wait was NOT removed (would resume spuriously)")
	}
}

// ---------------------------------------------------------------------------
// (6) must-fix 1: a completion arriving AFTER a boundary won must no-op (it lost
//     the single-winner race) instead of double-advancing from the original step.
// ---------------------------------------------------------------------------

// completionAfterBoundaryDef routes the boundary handler to a step that PARKS (a
// human_task) so the instance stays RUNNABLE after the boundary wins. This
// isolates the single-winner completion guard (must-fix 1) from the not-runnable
// pre-check: the late completion must no-op via the cancellation guard, not via
// the instance already being terminal.
func completionAfterBoundaryDef() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID: "def-bnd-late-completion", TenantID: bndTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "review",
				Type: model.StepTypeHumanTask,
				Name: "Review",
				Config: map[string]interface{}{
					"form_fields": []interface{}{},
					"assignee":    "u1",
				},
				BoundaryEvents: []model.BoundaryEvent{
					{ID: "b-timer", Type: model.BoundaryEventTypeTimer, HandlerStepID: "escalate",
						Config: map[string]interface{}{"duration": "PT30M"}},
				},
				Transitions: []model.Transition{{Target: "approved"}},
			},
			{ID: "approved", Type: model.StepTypeServiceTask, Name: "Approved", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			// escalate PARKS (human_task) so the instance is still running when the late
			// completion arrives.
			{ID: "escalate", Type: model.StepTypeHumanTask, Name: "Escalate",
				Config: map[string]interface{}{"form_fields": []interface{}{}, "assignee": "boss"}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func TestCompletionAfterBoundaryWonNoOps(t *testing.T) {
	defRepo := newCompDefRepo()
	def := completionAfterBoundaryDef()
	defRepo.add(def)
	eng, instRepo, _, _ := buildBoundaryEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), bndTenant, bndUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}
	reviewExecID := runningStepExecIDFor(instRepo, inst.ID, "review")

	// The BOUNDARY wins first (timer fired while the reviewer was mid-approve):
	// review -> escalate (parks; instance stays running).
	if err := eng.FireBoundaryEvent(context.Background(), inst.ID, "review", "b-timer"); err != nil {
		t.Fatalf("FireBoundaryEvent error = %v", err)
	}
	if !stepRan(instRepo, inst.ID, "escalate") {
		t.Fatal("escalate handler did not run after boundary won")
	}
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusRunning {
		t.Fatalf("status after boundary win = %q, want running (parked on escalate)", got)
	}

	// Now the human task completion arrives LATE. Its review step-exec is already
	// CANCELLED by the boundary, so the completion MUST no-op (not advance
	// review -> approved).
	task := &model.HumanTask{
		ID: "t-late", TenantID: bndTenant, InstanceID: inst.ID, StepID: "review",
		StepExecID: reviewExecID, Status: model.TaskStatusCompleted, FormData: map[string]interface{}{"ok": true},
	}
	if err := eng.ResumeFromTask(context.Background(), task); err != nil {
		t.Fatalf("late ResumeFromTask error = %v", err)
	}
	if stepRan(instRepo, inst.ID, "approved") {
		t.Fatal("approved (normal) path ran on a LATE completion, but the boundary had already won (double-advance)")
	}
	// Still parked on escalate; the boundary handler owns the flow.
	cur := instRepo.get(inst.ID).CurrentStepID
	if cur == nil || *cur != "escalate" {
		t.Fatalf("current step after late completion = %v, want still 'escalate' (no double-advance)", cur)
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// stepRan reports whether any step-execution exists for (instanceID, stepID) —
// i.e. the step was entered by the engine.
func stepRan(repo *multiInstanceRepo, instanceID, stepID string) bool {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for _, e := range repo.executions {
		if e.InstanceID == instanceID && e.StepID == stepID {
			return true
		}
	}
	return false
}

// stepStatusIs reports whether any step-execution for (instanceID, stepID) has the
// given status.
func stepStatusIs(repo *multiInstanceRepo, instanceID, stepID, status string) bool {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for _, e := range repo.executions {
		if e.InstanceID == instanceID && e.StepID == stepID && e.Status == status {
			return true
		}
	}
	return false
}
