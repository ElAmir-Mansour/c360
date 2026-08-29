package copilot

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// fakeSystemRunner runs fn with a nil DBTX on the system path.
type fakeSystemRunner struct{ ran int }

func (r *fakeSystemRunner) RunSystemTx(_ context.Context, fn func(repository.DBTX) error) error {
	r.ran++
	return fn(nil)
}

// fakePruneStore records the cutoff it was asked to prune by.
type fakePruneStore struct {
	lastCutoff time.Time
	returnN    int64
	returnErr  error
	calls      int
}

func (s *fakePruneStore) PruneSessionsOlderThan(_ context.Context, _ repository.DBTX, cutoff time.Time) (int64, error) {
	s.calls++
	s.lastCutoff = cutoff
	return s.returnN, s.returnErr
}

func TestPruneLoop_SweepDeletesByRetentionCutoff(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	runner := &fakeSystemRunner{}
	store := &fakePruneStore{returnN: 5}
	loop, err := NewPruneLoop(PruneLoopConfig{
		Runner:    runner,
		Store:     store,
		Logger:    zerolog.Nop(),
		Retention: 30 * 24 * time.Hour,
		Now:       func() time.Time { return now },
	})
	if err != nil {
		t.Fatalf("NewPruneLoop: %v", err)
	}

	pruned, err := loop.Sweep(context.Background())
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if pruned != 5 {
		t.Fatalf("expected 5 pruned, got %d", pruned)
	}
	if runner.ran != 1 || store.calls != 1 {
		t.Fatalf("expected one system tx and one prune call, got tx=%d prune=%d", runner.ran, store.calls)
	}
	wantCutoff := now.Add(-30 * 24 * time.Hour)
	if !store.lastCutoff.Equal(wantCutoff) {
		t.Fatalf("cutoff wrong: got %v want %v", store.lastCutoff, wantCutoff)
	}
}

func TestPruneLoop_SweepPropagatesError(t *testing.T) {
	t.Parallel()
	wantErr := errors.New("db down")
	loop, err := NewPruneLoop(PruneLoopConfig{
		Runner: &fakeSystemRunner{},
		Store:  &fakePruneStore{returnErr: wantErr},
		Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewPruneLoop: %v", err)
	}
	if _, err := loop.Sweep(context.Background()); !errors.Is(err, wantErr) {
		t.Fatalf("expected wrapped db error, got %v", err)
	}
}

func TestNewPruneLoop_RequiresRunnerAndStore(t *testing.T) {
	t.Parallel()
	if _, err := NewPruneLoop(PruneLoopConfig{Store: &fakePruneStore{}}); err == nil {
		t.Fatal("expected error when runner is nil")
	}
	if _, err := NewPruneLoop(PruneLoopConfig{Runner: &fakeSystemRunner{}}); err == nil {
		t.Fatal("expected error when store is nil")
	}
}

func TestPruneLoop_RunStopsOnContextCancel(t *testing.T) {
	t.Parallel()
	runner := &fakeSystemRunner{}
	loop, err := NewPruneLoop(PruneLoopConfig{
		Runner:   runner,
		Store:    &fakePruneStore{},
		Logger:   zerolog.Nop(),
		Interval: time.Hour, // long, so only the immediate first sweep runs
	})
	if err != nil {
		t.Fatalf("NewPruneLoop: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		loop.Run(ctx)
		close(done)
	}()
	// Give the immediate first tick a moment, then cancel.
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after context cancel")
	}
}
