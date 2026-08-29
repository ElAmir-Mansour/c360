package attestledger

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// fakeAnchorer records AnchorAll calls and returns scripted counts.
type fakeAnchorer struct {
	mu      sync.Mutex
	calls   int
	results []int // per-call anchored count; last value repeats
	err     error
}

func (f *fakeAnchorer) AnchorAll(_ context.Context, _ int) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if f.err != nil {
		return 0, f.err
	}
	if len(f.results) == 0 {
		return 0, nil
	}
	idx := f.calls - 1
	if idx >= len(f.results) {
		idx = len(f.results) - 1
	}
	return f.results[idx], nil
}

func (f *fakeAnchorer) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func TestNewLoop_Validation(t *testing.T) {
	t.Parallel()
	if _, err := NewLoop(LoopConfig{}); err == nil {
		t.Fatal("expected error for nil service")
	}
	l, err := NewLoop(LoopConfig{Service: &fakeAnchorer{}})
	if err != nil {
		t.Fatal(err)
	}
	if l.interval != 5*time.Minute || l.batch != 16 {
		t.Fatalf("defaults wrong: interval=%v batch=%d", l.interval, l.batch)
	}
}

func TestLoop_RunsTicksUntilCancelled(t *testing.T) {
	t.Parallel()
	// Batch=2; the loop drains immediately when a tick anchors a full batch, so
	// returning 2 then 0 yields a fast retry followed by an idle-poll.
	anchorer := &fakeAnchorer{results: []int{2, 0}}
	loop, err := NewLoop(LoopConfig{
		Service:  anchorer,
		Logger:   zerolog.Nop(),
		Interval: 20 * time.Millisecond,
		Batch:    2,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { loop.Run(ctx); close(done) }()

	// Wait until at least two ticks have run, then cancel.
	deadline := time.After(2 * time.Second)
	for anchorer.callCount() < 2 {
		select {
		case <-deadline:
			cancel()
			t.Fatalf("loop did not tick twice; calls=%d", anchorer.callCount())
		case <-time.After(2 * time.Millisecond):
		}
	}
	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("loop did not stop after cancel")
	}
}

func TestLoop_ContinuesOnError(t *testing.T) {
	t.Parallel()
	anchorer := &fakeAnchorer{err: errors.New("boom")}
	loop, err := NewLoop(LoopConfig{
		Service:  anchorer,
		Logger:   zerolog.Nop(),
		Interval: 5 * time.Millisecond,
		Batch:    4,
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { loop.Run(ctx); close(done) }()

	deadline := time.After(2 * time.Second)
	for anchorer.callCount() < 2 {
		select {
		case <-deadline:
			cancel()
			t.Fatalf("loop did not retry after error; calls=%d", anchorer.callCount())
		case <-time.After(2 * time.Millisecond):
		}
	}
	cancel()
	<-done
}
