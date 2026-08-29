package predict

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// countingScanner records how many times RunOnce was called.
type countingScanner struct {
	mu    sync.Mutex
	calls int
	err   error
	res   *Result
}

func (c *countingScanner) RunOnce(_ context.Context) (*Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls++
	return c.res, c.err
}

func (c *countingScanner) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.calls
}

func TestLoop_RunsImmediatelyAndOnTick(t *testing.T) {
	t.Parallel()
	scanner := &countingScanner{res: &Result{}}
	loop := NewLoop(scanner, LoopConfig{Interval: 20 * time.Millisecond, Logger: zerolog.Nop()})

	loop.Start(context.Background())
	defer loop.Stop()

	// Wait until at least a couple of scans have happened (immediate + a tick).
	deadline := time.Now().Add(2 * time.Second)
	for scanner.count() < 3 {
		if time.Now().After(deadline) {
			t.Fatalf("loop did not tick enough: got %d scans", scanner.count())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestLoop_StopHaltsScanning(t *testing.T) {
	t.Parallel()
	scanner := &countingScanner{res: &Result{}}
	loop := NewLoop(scanner, LoopConfig{Interval: 10 * time.Millisecond, Logger: zerolog.Nop()})
	loop.Start(context.Background())

	// Let it run a few times.
	deadline := time.Now().Add(2 * time.Second)
	for scanner.count() < 2 {
		if time.Now().After(deadline) {
			t.Fatal("loop never scanned")
		}
		time.Sleep(2 * time.Millisecond)
	}

	loop.Stop()
	after := scanner.count()
	// No new scans should occur after Stop returns.
	time.Sleep(50 * time.Millisecond)
	if scanner.count() != after {
		t.Fatalf("loop kept scanning after Stop: %d -> %d", after, scanner.count())
	}
}

func TestLoop_StopBeforeStartIsSafe(t *testing.T) {
	t.Parallel()
	loop := NewLoop(&countingScanner{}, LoopConfig{})
	loop.Stop() // must not panic
}

func TestLoop_DoubleStartIsNoOp(t *testing.T) {
	t.Parallel()
	scanner := &countingScanner{res: &Result{}}
	loop := NewLoop(scanner, LoopConfig{Interval: time.Hour, Logger: zerolog.Nop()})
	loop.Start(context.Background())
	loop.Start(context.Background()) // ignored — no second goroutine
	defer loop.Stop()

	// Only the immediate scan from the first Start should have run.
	time.Sleep(30 * time.Millisecond)
	if c := scanner.count(); c != 1 {
		t.Fatalf("expected exactly one immediate scan, got %d", c)
	}
}

func TestLoop_ContinuesAfterScanError(t *testing.T) {
	t.Parallel()
	scanner := &countingScanner{err: errors.New("transient db error")}
	loop := NewLoop(scanner, LoopConfig{Interval: 10 * time.Millisecond, Logger: zerolog.Nop()})
	loop.Start(context.Background())
	defer loop.Stop()

	// Despite each scan erroring, the loop must keep ticking.
	deadline := time.Now().Add(2 * time.Second)
	for scanner.count() < 3 {
		if time.Now().After(deadline) {
			t.Fatalf("loop stopped after an error: got %d scans", scanner.count())
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestLoop_CancelledContextStops(t *testing.T) {
	t.Parallel()
	scanner := &countingScanner{res: &Result{}}
	loop := NewLoop(scanner, LoopConfig{Interval: 10 * time.Millisecond, Logger: zerolog.Nop()})
	ctx, cancel := context.WithCancel(context.Background())
	loop.Start(ctx)

	deadline := time.Now().Add(2 * time.Second)
	for scanner.count() < 2 {
		if time.Now().After(deadline) {
			t.Fatal("loop never scanned")
		}
		time.Sleep(2 * time.Millisecond)
	}
	cancel()
	loop.Stop()
}
