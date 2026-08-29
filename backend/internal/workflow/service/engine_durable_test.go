package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// This file pins the durable-execution CORRECTNESS substrate (gaps 1-3):
//   1. transactional step commit — a mid-advance failure leaves consistent state,
//   2. per-instance serialization — concurrent re-entries do not double-advance,
//   3. bounded (non-recursive) retry — a large max_retries does not blow the stack.
//
// It uses a durableInstanceRepo double that implements the OPTIONAL stepCommitter
// and instanceSerializer capabilities the production repository provides, so the
// engine takes exactly the transactional path it takes in production.

// durableInstanceRepo is a stateful in-memory instance repo that faithfully models
// the atomicity and optimistic-lock semantics of the real repository, plus a
// controllable failure injection point for the transactional commit.
type durableInstanceRepo struct {
	mu         sync.Mutex
	inst       *model.WorkflowInstance
	executions []*model.StepExecution

	// failCommitOnStep, when set, makes CommitStepTransition fail (rolling back —
	// i.e. applying NEITHER the step-exec insert NOR the instance update) the FIRST
	// time it is asked to transition INTO that step. Simulates a crash mid-advance.
	failCommitOnStep string
	commitCalls      int

	// commitStarted/releaseCommit let a test hold a commit mid-flight to force a
	// concurrent re-entry to race the very same transition.
	commitStarted chan struct{}
	releaseCommit chan struct{}
}

func newDurableInstanceRepo(inst *model.WorkflowInstance) *durableInstanceRepo {
	cp := *inst
	return &durableInstanceRepo{inst: &cp}
}

func (r *durableInstanceRepo) Create(_ context.Context, inst *model.WorkflowInstance) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *inst
	r.inst = &cp
	return nil
}

func (r *durableInstanceRepo) GetByID(_ context.Context, _, _ string) (*model.WorkflowInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inst == nil {
		return nil, model.ErrNotFound
	}
	cp := *r.inst
	return &cp, nil
}

// UpdateWithLock models the optimistic lock: the write only lands when the
// caller's lock_version matches the stored one, then the stored version bumps.
func (r *durableInstanceRepo) UpdateWithLock(_ context.Context, inst *model.WorkflowInstance) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.inst == nil {
		return model.ErrNotFound
	}
	if inst.LockVersion != r.inst.LockVersion {
		return model.ErrConcurrencyConfl
	}
	cp := *inst
	cp.LockVersion = r.inst.LockVersion + 1
	r.inst = &cp
	inst.LockVersion = cp.LockVersion
	return nil
}

// CommitStepTransition models the production atomic commit: it either applies BOTH
// the step-execution insert AND the instance update, or (on injected failure or a
// lock conflict) applies NEITHER.
func (r *durableInstanceRepo) CommitStepTransition(_ context.Context, inst *model.WorkflowInstance, stepExec *model.StepExecution) error {
	// Coordinate an intentional mid-flight pause BEFORE taking the lock so a second
	// goroutine can attempt to race this exact transition.
	if r.commitStarted != nil {
		r.commitStarted <- struct{}{}
		<-r.releaseCommit
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	r.commitCalls++

	// Optimistic lock check first (nothing is written on conflict).
	if inst.LockVersion != r.inst.LockVersion {
		return model.ErrConcurrencyConfl
	}

	// Injected mid-advance failure: write NOTHING and report the crash.
	if r.failCommitOnStep != "" && inst.CurrentStepID != nil && *inst.CurrentStepID == r.failCommitOnStep {
		r.failCommitOnStep = "" // fail once
		return errors.New("simulated crash mid-advance: transaction rolled back")
	}

	// Atomic apply: step-exec insert + instance update together.
	if stepExec != nil {
		stepExec.ID = generateUUID()
		stepExec.CreatedAt = time.Now().UTC()
		cp := *stepExec
		r.executions = append(r.executions, &cp)
	}
	cp := *inst
	cp.LockVersion = r.inst.LockVersion + 1
	r.inst = &cp
	inst.LockVersion = cp.LockVersion
	return nil
}

// SerializeInstance models the cross-process advisory-lock critical section with a
// plain mutex — enough to exercise the engine's serialized-entry code path.
var serializeMu sync.Mutex

func (r *durableInstanceRepo) SerializeInstance(_ context.Context, _ string, fn func() error) error {
	serializeMu.Lock()
	defer serializeMu.Unlock()
	return fn()
}

func (r *durableInstanceRepo) List(context.Context, string, string, string, string, *time.Time, *time.Time, string, string, int, int) ([]*model.WorkflowInstance, int, error) {
	return nil, 0, nil
}
func (r *durableInstanceRepo) ListRunning(context.Context, int, int) ([]*model.WorkflowInstance, error) {
	return nil, nil
}
func (r *durableInstanceRepo) CreateStepExecution(_ context.Context, exec *model.StepExecution) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	exec.ID = generateUUID()
	exec.CreatedAt = time.Now().UTC()
	cp := *exec
	r.executions = append(r.executions, &cp)
	return nil
}
func (r *durableInstanceRepo) UpdateStepExecution(_ context.Context, exec *model.StepExecution) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, e := range r.executions {
		if e.ID == exec.ID {
			cp := *exec
			r.executions[i] = &cp
			return nil
		}
	}
	return nil
}
func (r *durableInstanceRepo) GetStepExecutions(context.Context, string) ([]*model.StepExecution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]*model.StepExecution, len(r.executions))
	copy(out, r.executions)
	return out, nil
}
func (r *durableInstanceRepo) GetLastFailedStep(context.Context, string) (*model.StepExecution, error) {
	return nil, nil
}

func (r *durableInstanceRepo) snapshot() (*model.WorkflowInstance, []*model.StepExecution) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *r.inst
	execs := make([]*model.StepExecution, len(r.executions))
	copy(execs, r.executions)
	return &cp, execs
}

func (r *durableInstanceRepo) execCountForStep(stepID string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, e := range r.executions {
		if e.StepID == stepID {
			n++
		}
	}
	return n
}

var _ instanceRepo = (*durableInstanceRepo)(nil)
var _ stepCommitter = (*durableInstanceRepo)(nil)
var _ instanceSerializer = (*durableInstanceRepo)(nil)

// countingExecutor completes every step and records how many times each step was
// dispatched to the executor (i.e. how many times the engine actually advanced).
type countingExecutor struct {
	mu    sync.Mutex
	calls map[string]int
}

func newCountingExecutor() *countingExecutor { return &countingExecutor{calls: map[string]int{}} }

func (e *countingExecutor) Execute(_ context.Context, _ *model.WorkflowInstance, step *model.StepDefinition, _ *model.StepExecution) (*executor.ExecutionResult, error) {
	e.mu.Lock()
	e.calls[step.ID]++
	e.mu.Unlock()
	return &executor.ExecutionResult{Output: map[string]interface{}{"ok": true}}, nil
}

func (e *countingExecutor) callsFor(stepID string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls[stepID]
}

// twoStepThenEnd builds s1 -> s2 -> end (condition steps so the counting executor
// drives them synchronously).
func twoStepThenEnd() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:       "def-durable",
		TenantID: "tenant-durable",
		Status:   model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{ID: "s1", Type: model.StepTypeCondition, Name: "S1", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "s2"}}},
			{ID: "s2", Type: model.StepTypeCondition, Name: "S2", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func durableInstance() *model.WorkflowInstance {
	first := "s1"
	return &model.WorkflowInstance{
		ID:            "inst-durable",
		TenantID:      "tenant-durable",
		DefinitionID:  "def-durable",
		DefinitionVer: 1,
		Status:        model.InstanceStatusRunning,
		CurrentStepID: &first,
		Variables:     map[string]interface{}{},
		StepOutputs:   map[string]interface{}{},
		StartedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
		LockVersion:   0,
	}
}

// TestCommitStepTransition_AtomicRollbackLeavesConsistentState proves gap 1: when
// the atomic commit for a step fails mid-advance, NEITHER the step-execution row
// NOR the instance pointer is written — no torn state.
func TestCommitStepTransition_AtomicRollbackLeavesConsistentState(t *testing.T) {
	def := twoStepThenEnd()
	repo := newDurableInstanceRepo(durableInstance())
	repo.failCommitOnStep = "s2" // crash when advancing INTO s2

	engine := NewEngineService(repo, &durableDefRepo{def: def}, newRecordingTaskRepo(), newCountingExecutor(), nil, zerolog.Nop())

	// Advance from s1: engine evaluates s1->s2 and tries to commit the transition
	// into s2, which we make fail.
	err := engine.AdvanceWorkflow(context.Background(), "inst-durable", "s1")
	if err == nil {
		t.Fatal("expected AdvanceWorkflow to surface the simulated commit failure")
	}

	inst, execs := repo.snapshot()

	// The instance must NOT have moved to s2 (torn-state guard).
	if inst.CurrentStepID == nil || *inst.CurrentStepID != "s1" {
		t.Fatalf("current step after failed commit = %v, want s1 (no partial advance)", inst.CurrentStepID)
	}
	// No s2 step-execution row may exist (the insert rolled back with the update).
	for _, e := range execs {
		if e.StepID == "s2" {
			t.Fatalf("a step-execution row for s2 was persisted despite the rolled-back transition: %+v", e)
		}
	}
	if repo.commitCalls == 0 {
		t.Fatal("expected CommitStepTransition to have been exercised")
	}
}

// TestExecuteStep_UsesAtomicCommitAndAdvances is the happy path through the
// transactional committer: the instance walks s1 -> s2 -> end and each step is
// executed exactly once.
func TestExecuteStep_UsesAtomicCommitAndAdvances(t *testing.T) {
	def := twoStepThenEnd()
	repo := newDurableInstanceRepo(durableInstance())
	exe := newCountingExecutor()
	engine := NewEngineService(repo, &durableDefRepo{def: def}, newRecordingTaskRepo(), exe, nil, zerolog.Nop())

	if err := engine.executeStep(context.Background(), mustInst(repo), def, "s1"); err != nil {
		t.Fatalf("executeStep error = %v", err)
	}

	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusCompleted {
		t.Fatalf("instance status = %s, want completed", inst.Status)
	}
	if exe.callsFor("s1") != 1 || exe.callsFor("s2") != 1 {
		t.Fatalf("each step must execute once: s1=%d s2=%d", exe.callsFor("s1"), exe.callsFor("s2"))
	}
}

// TestConcurrentReentry_DoesNotDoubleAdvance proves gap 3: two goroutines racing to
// advance the SAME instance from the SAME step result in exactly ONE committed
// advance — the losing re-entry is serialized and rejected (or no-ops) rather than
// double-advancing.
func TestConcurrentReentry_DoesNotDoubleAdvance(t *testing.T) {
	def := twoStepThenEnd()
	// Single-step workflow variant so both racers target the same s1->s2 edge and
	// we can count how many s2 executions/rows result.
	repo := newDurableInstanceRepo(durableInstance())
	exe := newCountingExecutor()
	engine := NewEngineService(repo, &durableDefRepo{def: def}, newRecordingTaskRepo(), exe, nil, zerolog.Nop())

	const racers = 8
	var wg sync.WaitGroup
	wg.Add(racers)
	errs := make([]error, racers)
	for i := 0; i < racers; i++ {
		go func(idx int) {
			defer wg.Done()
			// All racers advance from s1 concurrently.
			errs[idx] = engine.AdvanceWorkflow(context.Background(), "inst-durable", "s1")
		}(i)
	}
	wg.Wait()

	// The workflow must have advanced from s1 exactly once: s2 executed once and
	// the instance ended completed. Concurrent re-entries must not have produced
	// multiple s2 executions or step-exec rows.
	if got := exe.callsFor("s2"); got != 1 {
		t.Fatalf("s2 executed %d times, want exactly 1 (no double-advance)", got)
	}
	if got := repo.execCountForStep("s2"); got != 1 {
		t.Fatalf("s2 has %d step-execution rows, want exactly 1", got)
	}
	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusCompleted {
		t.Fatalf("final status = %s, want completed", inst.Status)
	}
}

// TestHandleStepFailure_BoundedRetryNoStackBlowup proves the retry path is bounded
// iteration, not per-attempt recursion: a large max_retries with an always-failing
// step fails the instance without exhausting the stack.
func TestHandleStepFailure_BoundedRetryNoStackBlowup(t *testing.T) {
	def := &model.WorkflowDefinition{
		ID:       "def-retry",
		TenantID: "tenant-retry",
		Status:   model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{ID: "flaky", Type: model.StepTypeServiceTask, Name: "Flaky", Config: map[string]interface{}{"max_retries": 5000}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End"},
		},
	}
	first := "flaky"
	inst := &model.WorkflowInstance{
		ID: "inst-retry", TenantID: "tenant-retry", DefinitionID: "def-retry", DefinitionVer: 1,
		Status: model.InstanceStatusRunning, CurrentStepID: &first,
		Variables: map[string]interface{}{}, StepOutputs: map[string]interface{}{},
		StartedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC(),
	}
	repo := newDurableInstanceRepo(inst)
	engine := NewEngineService(repo, &durableDefRepo{def: def}, newRecordingTaskRepo(), &alwaysFailExecutor{}, nil, zerolog.Nop())

	if err := engine.executeStep(context.Background(), mustInst(repo), def, "flaky"); err != nil {
		t.Fatalf("executeStep returned error (should fail the instance, not error out): %v", err)
	}
	got, _ := repo.snapshot()
	if got.Status != model.InstanceStatusFailed {
		t.Fatalf("instance status = %s, want failed after retries exhausted", got.Status)
	}
}

func mustInst(r *durableInstanceRepo) *model.WorkflowInstance {
	inst, _ := r.snapshot()
	return inst
}

// alwaysFailExecutor always returns a non-parked error to drive the retry loop.
type alwaysFailExecutor struct{}

func (alwaysFailExecutor) Execute(context.Context, *model.WorkflowInstance, *model.StepDefinition, *model.StepExecution) (*executor.ExecutionResult, error) {
	return nil, errors.New("boom")
}

// durableDefRepo is a fixed-definition def repo for the durable-execution tests.
type durableDefRepo struct {
	def *model.WorkflowDefinition
}

func (r *durableDefRepo) Create(context.Context, *model.WorkflowDefinition) error { return nil }
func (r *durableDefRepo) GetByID(context.Context, string, string) (*model.WorkflowDefinition, error) {
	return r.def, nil
}
func (r *durableDefRepo) GetActiveByID(context.Context, string, string) (*model.WorkflowDefinition, error) {
	return r.def, nil
}
func (r *durableDefRepo) List(context.Context, string, string, string, string, string, string, int, int) ([]*model.WorkflowDefinition, int, error) {
	return nil, 0, nil
}
func (r *durableDefRepo) ListVersions(context.Context, string, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}
func (r *durableDefRepo) Update(context.Context, *model.WorkflowDefinition) error    { return nil }
func (r *durableDefRepo) SoftDelete(context.Context, string, string) error           { return nil }
func (r *durableDefRepo) GetMaxVersion(context.Context, string, string) (int, error) { return 0, nil }
func (r *durableDefRepo) GetActiveByTriggerTopic(context.Context, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

var _ definitionRepo = (*durableDefRepo)(nil)
