package executor

import (
	"context"
	"sync"

	"github.com/clario360/platform/internal/workflow/model"
)

// definitionLister enumerates the active workflow definitions whose steps the
// parallel gateway may need to resolve. *repository.DefinitionRepository
// satisfies it via ListActive.
type definitionLister interface {
	ListActive(ctx context.Context) ([]*model.WorkflowDefinition, error)
}

// RepositoryStepLookup builds a StepLookup backed by the workflow definition
// repository. The parallel gateway resolves the branch sub-step IDs declared in
// a definition's parallel_gateway config; those steps always live in the same
// (active) definition the executing instance belongs to, so resolving against
// the set of active definitions yields the correct step.
//
// The lookup maintains a lazily-built, thread-safe index of step ID -> step
// definition. On a miss it rebuilds the index once (a freshly published
// definition's steps may not yet be cached) and retries before reporting the
// step as unknown, so newly activated workflows resolve without a restart. The
// StepLookup signature carries no context, so the rebuild runs against the
// supplied background context.
//
// A step ID that appears in more than one active definition resolves to the
// last one indexed; gateway branch IDs are author-controlled within a single
// definition, so cross-definition collisions do not arise in practice. Callers
// that need strict per-definition isolation can construct a StepLookup over a
// single definition's steps directly (as the executor's own tests do).
func RepositoryStepLookup(ctx context.Context, defs definitionLister) StepLookup {
	l := &repoStepLookup{ctx: ctx, defs: defs}
	return l.lookup
}

type repoStepLookup struct {
	ctx  context.Context
	defs definitionLister

	mu     sync.RWMutex
	index  map[string]*model.StepDefinition
	loaded bool
}

func (l *repoStepLookup) lookup(stepID string) (*model.StepDefinition, bool) {
	if step, ok := l.get(stepID); ok {
		return step, true
	}
	// Miss: rebuild once in case a definition was activated after the last
	// load, then retry.
	l.refresh()
	return l.get(stepID)
}

func (l *repoStepLookup) get(stepID string) (*model.StepDefinition, bool) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if !l.loaded {
		return nil, false
	}
	step, ok := l.index[stepID]
	return step, ok
}

func (l *repoStepLookup) refresh() {
	defsList, err := l.defs.ListActive(l.ctx)
	if err != nil {
		// Keep any previously built index; a transient list error must not
		// erase already-resolvable steps.
		l.mu.Lock()
		l.loaded = true
		l.mu.Unlock()
		return
	}

	index := make(map[string]*model.StepDefinition)
	for _, def := range defsList {
		for i := range def.Steps {
			step := def.Steps[i]
			index[step.ID] = &step
		}
	}

	l.mu.Lock()
	l.index = index
	l.loaded = true
	l.mu.Unlock()
}
