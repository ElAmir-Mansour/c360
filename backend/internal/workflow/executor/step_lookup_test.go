package executor

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// fakeDefinitionLister is a real (in-memory) definitionLister used to drive the
// repository-backed StepLookup without a database. It counts ListActive calls so
// tests can assert the lazy-load / refresh-on-miss behavior.
type fakeDefinitionLister struct {
	mu    sync.Mutex
	defs  []*model.WorkflowDefinition
	calls int
	err   error
}

func (f *fakeDefinitionLister) ListActive(_ context.Context) ([]*model.WorkflowDefinition, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return nil, f.err
	}
	return f.defs, nil
}

func (f *fakeDefinitionLister) set(defs []*model.WorkflowDefinition) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.defs = defs
}

func (f *fakeDefinitionLister) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func defWithSteps(id string, steps ...model.StepDefinition) *model.WorkflowDefinition {
	return &model.WorkflowDefinition{ID: id, Steps: steps}
}

// TestRepositoryStepLookup_ResolvesSteps proves the lookup indexes steps across
// active definitions and returns the right definition for a known ID.
func TestRepositoryStepLookup_ResolvesSteps(t *testing.T) {
	lister := &fakeDefinitionLister{}
	lister.set([]*model.WorkflowDefinition{
		defWithSteps("d1",
			model.StepDefinition{ID: "a1", Type: model.StepTypeServiceTask},
			model.StepDefinition{ID: "a2", Type: model.StepTypeHumanTask},
		),
		defWithSteps("d2",
			model.StepDefinition{ID: "b1", Type: model.StepTypeCondition},
		),
	})

	lookup := RepositoryStepLookup(context.Background(), lister)

	for _, id := range []string{"a1", "a2", "b1"} {
		step, ok := lookup(id)
		if !ok {
			t.Fatalf("lookup(%q) miss, want hit", id)
		}
		if step.ID != id {
			t.Errorf("lookup(%q).ID = %q", id, step.ID)
		}
	}

	if _, ok := lookup("a1"); !ok {
		t.Fatal("repeat hit should not require a reload")
	}
}

// TestRepositoryStepLookup_RefreshesOnMiss proves a step published after the
// first load resolves on a later call (refresh-on-miss), and that a persistent
// miss reports not-found without thrashing the lister on every cached hit.
func TestRepositoryStepLookup_RefreshesOnMiss(t *testing.T) {
	lister := &fakeDefinitionLister{}
	lister.set([]*model.WorkflowDefinition{
		defWithSteps("d1", model.StepDefinition{ID: "a1", Type: model.StepTypeServiceTask}),
	})

	lookup := RepositoryStepLookup(context.Background(), lister)

	if _, ok := lookup("a1"); !ok {
		t.Fatal("a1 should resolve after initial load")
	}

	// A genuinely unknown step triggers exactly one refresh attempt, then misses.
	if _, ok := lookup("ghost"); ok {
		t.Fatal("unknown step must miss")
	}

	// Newly activated definition becomes resolvable on the next miss-driven refresh.
	lister.set([]*model.WorkflowDefinition{
		defWithSteps("d1", model.StepDefinition{ID: "a1", Type: model.StepTypeServiceTask}),
		defWithSteps("d2", model.StepDefinition{ID: "z9", Type: model.StepTypeTimer}),
	})
	step, ok := lookup("z9")
	if !ok {
		t.Fatal("z9 should resolve after refresh-on-miss")
	}
	if step.ID != "z9" {
		t.Errorf("resolved step ID = %q, want z9", step.ID)
	}
}

// TestRepositoryStepLookup_ListErrorDoesNotPanic proves a list error is tolerated:
// the lookup reports a miss rather than panicking, and keeps any prior index.
func TestRepositoryStepLookup_ListErrorDoesNotPanic(t *testing.T) {
	lister := &fakeDefinitionLister{}
	lister.set([]*model.WorkflowDefinition{
		defWithSteps("d1", model.StepDefinition{ID: "a1", Type: model.StepTypeServiceTask}),
	})
	lookup := RepositoryStepLookup(context.Background(), lister)

	if _, ok := lookup("a1"); !ok {
		t.Fatal("a1 should resolve before the error")
	}

	lister.mu.Lock()
	lister.err = errors.New("db down")
	lister.mu.Unlock()

	// Previously indexed step still resolves from cache despite the list error.
	if _, ok := lookup("a1"); !ok {
		t.Error("cached step should survive a transient list error")
	}
	// Unknown step misses cleanly.
	if _, ok := lookup("ghost"); ok {
		t.Error("unknown step must miss even when list errors")
	}
	if lister.callCount() == 0 {
		t.Error("expected at least one ListActive call")
	}
}

// TestRepositoryStepLookup_IntegratesWithParallelGateway wires the
// repository-backed lookup into a real ExecutorRegistry + ParallelGatewayExecutor
// and proves the gateway resolves its branch sub-steps through it.
func TestRepositoryStepLookup_IntegratesWithParallelGateway(t *testing.T) {
	rec := &recordingExecutor{}
	registry := NewExecutorRegistry()
	registry.Register("worker", rec)

	lister := &fakeDefinitionLister{}
	lister.set([]*model.WorkflowDefinition{
		defWithSteps("d1",
			model.StepDefinition{ID: "a1", Type: "worker"},
			model.StepDefinition{ID: "b1", Type: "worker"},
		),
	})

	gw := NewParallelGatewayExecutor(registry, RepositoryStepLookup(context.Background(), lister), zerolog.Nop())
	step := pgStep([][]string{{"a1"}, {"b1"}}, "all")

	result, err := gw.Execute(context.Background(), pgTestInstance(), step, &model.StepExecution{ID: "e1"})
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if got := result.Output["branches_completed"]; got != 2 {
		t.Errorf("branches_completed = %v, want 2", got)
	}
}
