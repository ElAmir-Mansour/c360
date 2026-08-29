package drift

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

type fakeDriftRunner struct {
	calls int
	err   error
}

func (r *fakeDriftRunner) RunAllProductionModels(context.Context) error {
	r.calls++
	return r.err
}

func TestSchedulerReturnsCanceledWithoutRunningWhenContextAlreadyCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	runner := &fakeDriftRunner{}

	err := NewScheduler(runner, time.Hour, zerolog.Nop()).Run(ctx)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want context.Canceled", err)
	}
	if runner.calls != 0 {
		t.Fatalf("runner calls = %d, want 0", runner.calls)
	}
}

func TestSchedulerReturnsCanceledWithoutRetryingCanceledRun(t *testing.T) {
	runner := &fakeDriftRunner{err: fmt.Errorf("begin read-only transaction: %w", context.Canceled)}

	err := NewScheduler(runner, time.Hour, zerolog.Nop()).Run(context.Background())

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want context.Canceled", err)
	}
	if runner.calls != 1 {
		t.Fatalf("runner calls = %d, want 1", runner.calls)
	}
}

func TestSchedulerTreatsClosedPoolAsCanceled(t *testing.T) {
	runner := &fakeDriftRunner{err: errors.New("begin read-only transaction: closed pool")}

	err := NewScheduler(runner, time.Hour, zerolog.Nop()).Run(context.Background())

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Run() error = %v, want context.Canceled", err)
	}
	if runner.calls != 1 {
		t.Fatalf("runner calls = %d, want 1", runner.calls)
	}
}
