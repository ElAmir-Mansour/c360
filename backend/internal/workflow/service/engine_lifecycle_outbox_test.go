package service

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// OUTBOX-ATOMICITY POLISH — service-level proof of the routing + no-double-emit.
//
// When the wired instance repo implements the OPTIONAL lifecycleCommitter, the six
// lifecycle emits (completed/failed/cancelled/suspended/resumed/retried) must be
// staged in the SAME transaction as the state change (via CommitInstanceStateWithEvent)
// and MUST NOT also be direct-published (no double-emit). When the repo does NOT
// implement it, the engine falls back to UpdateWithLock + best-effort publishEvent
// (unchanged legacy behaviour), which these tests also pin.

// atomicLifecycleRepo is an in-memory instance repo that implements the atomic
// lifecycleCommitter: CommitInstanceStateWithEvent records the staged event and
// applies the state change together (modelling the one-tx commit).
type atomicLifecycleRepo struct {
	mu     sync.Mutex
	inst   *model.WorkflowInstance
	staged []*events.Event // events staged "in-tx" via the atomic committer
	failTx bool            // when true, the atomic commit fails → nothing staged
}

func newAtomicLifecycleRepo(inst *model.WorkflowInstance) *atomicLifecycleRepo {
	cp := *inst
	return &atomicLifecycleRepo{inst: &cp}
}

func (r *atomicLifecycleRepo) CommitInstanceStateWithEvent(_ context.Context, inst *model.WorkflowInstance, _ *model.StepExecution, _ string, evt *events.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failTx {
		// Simulate a rolled-back tx: NEITHER the state change NOR the event lands.
		return model.ErrConcurrencyConfl
	}
	cp := *inst
	cp.LockVersion = r.inst.LockVersion + 1
	r.inst = &cp
	inst.LockVersion = cp.LockVersion
	r.staged = append(r.staged, evt)
	return nil
}

func (r *atomicLifecycleRepo) stagedCount() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.staged)
}

func (r *atomicLifecycleRepo) GetByID(_ context.Context, _, _ string) (*model.WorkflowInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *r.inst
	return &cp, nil
}

func (r *atomicLifecycleRepo) UpdateWithLock(_ context.Context, inst *model.WorkflowInstance) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *inst
	cp.LockVersion = r.inst.LockVersion + 1
	r.inst = &cp
	inst.LockVersion = cp.LockVersion
	return nil
}

// The remaining instanceRepo surface is inert for the lifecycle tests.
func (r *atomicLifecycleRepo) Create(context.Context, *model.WorkflowInstance) error { return nil }
func (r *atomicLifecycleRepo) List(context.Context, string, string, string, string, *time.Time, *time.Time, string, string, int, int) ([]*model.WorkflowInstance, int, error) {
	return nil, 0, nil
}
func (r *atomicLifecycleRepo) ListRunning(context.Context, int, int) ([]*model.WorkflowInstance, error) {
	return nil, nil
}
func (r *atomicLifecycleRepo) CreateStepExecution(context.Context, *model.StepExecution) error {
	return nil
}
func (r *atomicLifecycleRepo) UpdateStepExecution(context.Context, *model.StepExecution) error {
	return nil
}
func (r *atomicLifecycleRepo) GetStepExecutions(context.Context, string) ([]*model.StepExecution, error) {
	return nil, nil
}
func (r *atomicLifecycleRepo) GetLastFailedStep(context.Context, string) (*model.StepExecution, error) {
	return nil, nil
}

var _ instanceRepo = (*atomicLifecycleRepo)(nil)
var _ lifecycleCommitter = (*atomicLifecycleRepo)(nil)

// legacyLifecycleRepo is the SAME in-memory repo WITHOUT the lifecycleCommitter
// method — so the engine's type assertion fails and it falls back to
// UpdateWithLock + publishEvent. Embedding-by-copy would drag the method in, so
// this is a distinct type that intentionally omits CommitInstanceStateWithEvent.
type legacyLifecycleRepo struct {
	mu   sync.Mutex
	inst *model.WorkflowInstance
}

func newLegacyLifecycleRepo(inst *model.WorkflowInstance) *legacyLifecycleRepo {
	cp := *inst
	return &legacyLifecycleRepo{inst: &cp}
}

func (r *legacyLifecycleRepo) GetByID(_ context.Context, _, _ string) (*model.WorkflowInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *r.inst
	return &cp, nil
}
func (r *legacyLifecycleRepo) UpdateWithLock(_ context.Context, inst *model.WorkflowInstance) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *inst
	cp.LockVersion = r.inst.LockVersion + 1
	r.inst = &cp
	inst.LockVersion = cp.LockVersion
	return nil
}
func (r *legacyLifecycleRepo) Create(context.Context, *model.WorkflowInstance) error { return nil }
func (r *legacyLifecycleRepo) List(context.Context, string, string, string, string, *time.Time, *time.Time, string, string, int, int) ([]*model.WorkflowInstance, int, error) {
	return nil, 0, nil
}
func (r *legacyLifecycleRepo) ListRunning(context.Context, int, int) ([]*model.WorkflowInstance, error) {
	return nil, nil
}
func (r *legacyLifecycleRepo) CreateStepExecution(context.Context, *model.StepExecution) error {
	return nil
}
func (r *legacyLifecycleRepo) UpdateStepExecution(context.Context, *model.StepExecution) error {
	return nil
}
func (r *legacyLifecycleRepo) GetStepExecutions(context.Context, string) ([]*model.StepExecution, error) {
	return nil, nil
}
func (r *legacyLifecycleRepo) GetLastFailedStep(context.Context, string) (*model.StepExecution, error) {
	return nil, nil
}

var _ instanceRepo = (*legacyLifecycleRepo)(nil)

func runnableInstance() *model.WorkflowInstance {
	step := "s1"
	return &model.WorkflowInstance{
		ID:            "inst-lc",
		TenantID:      "tenant-lc",
		DefinitionID:  "def-lc",
		DefinitionVer: 1,
		Status:        model.InstanceStatusRunning,
		CurrentStepID: &step,
		Variables:     map[string]interface{}{},
		StepOutputs:   map[string]interface{}{},
		StartedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
	}
}

// TestCancelInstance_AtomicStagesEventNoDoublePublish proves that with the atomic
// lifecycleCommitter wired, CancelInstance stages the cancelled event in-tx AND
// does NOT also direct-publish it (no double-emit).
func TestCancelInstance_AtomicStagesEventNoDoublePublish(t *testing.T) {
	repo := newAtomicLifecycleRepo(runnableInstance())
	prod := newDispatchProducer()
	engine := NewEngineService(repo, &durableDefRepo{def: twoStepThenEnd()}, newRecordingTaskRepo(), newCountingExecutor(), prod, zerolog.Nop())

	if engine.lifecycleTx == nil {
		t.Fatal("engine did not discover the lifecycleCommitter capability on the repo")
	}

	if err := engine.CancelInstance(context.Background(), "tenant-lc", "inst-lc"); err != nil {
		t.Fatalf("CancelInstance error = %v", err)
	}

	// Exactly one audit event was staged atomically.
	if got := repo.stagedCount(); got != 1 {
		t.Fatalf("staged events = %d, want 1 (atomic in-tx staging)", got)
	}
	// And it was NOT also direct-published (no double-emit) — the producer must not
	// have seen the cancelled event.
	if got := prod.count("com.clario360.workflow.instance.cancelled"); got != 0 {
		t.Fatalf("cancelled event direct-published %d times, want 0 (no double-emit; it is staged)", got)
	}
}

// TestCancelInstance_LegacyFallbackDirectPublishes proves the backward-compatible
// path: a repo WITHOUT the atomic capability makes CancelInstance direct-publish
// the event exactly as before (a test double / un-migrated deployment).
func TestCancelInstance_LegacyFallbackDirectPublishes(t *testing.T) {
	repo := newLegacyLifecycleRepo(runnableInstance())
	prod := newDispatchProducer()
	engine := NewEngineService(repo, &durableDefRepo{def: twoStepThenEnd()}, newRecordingTaskRepo(), newCountingExecutor(), prod, zerolog.Nop())

	if engine.lifecycleTx != nil {
		t.Fatal("legacy repo must NOT be discovered as a lifecycleCommitter")
	}

	if err := engine.CancelInstance(context.Background(), "tenant-lc", "inst-lc"); err != nil {
		t.Fatalf("CancelInstance error = %v", err)
	}

	// Legacy path direct-publishes exactly once.
	if got := prod.count("com.clario360.workflow.instance.cancelled"); got != 1 {
		t.Fatalf("legacy cancelled direct-publishes = %d, want 1", got)
	}
}

// TestCancelInstance_AtomicRollbackStagesNothing proves that when the atomic commit
// rolls back (state NOT changed), the audit event is NOT staged — no dangling
// event — and the error surfaces to the caller.
func TestCancelInstance_AtomicRollbackStagesNothing(t *testing.T) {
	repo := newAtomicLifecycleRepo(runnableInstance())
	repo.failTx = true
	prod := newDispatchProducer()
	engine := NewEngineService(repo, &durableDefRepo{def: twoStepThenEnd()}, newRecordingTaskRepo(), newCountingExecutor(), prod, zerolog.Nop())

	err := engine.CancelInstance(context.Background(), "tenant-lc", "inst-lc")
	if err == nil {
		t.Fatal("expected CancelInstance to surface the rolled-back commit error")
	}
	if got := repo.stagedCount(); got != 0 {
		t.Fatalf("staged events after rollback = %d, want 0", got)
	}
	if got := prod.count("com.clario360.workflow.instance.cancelled"); got != 0 {
		t.Fatalf("no event may be published when the transition rolled back, got %d", got)
	}
}
