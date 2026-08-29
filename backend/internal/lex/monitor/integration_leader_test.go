package monitor

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/leadership"
)

// fakeElector is a controllable leadership.Elector for testing runLeaderGated
// without Redis. It fires OnAcquire/OnLose on command and blocks Run until ctx is
// cancelled (mirroring a real elector's lifecycle).
type fakeElector struct {
	acquire chan struct{}
	lose    chan struct{}
	leader  atomic.Bool
}

func newFakeElector() *fakeElector {
	return &fakeElector{acquire: make(chan struct{}, 4), lose: make(chan struct{}, 4)}
}

func (f *fakeElector) Run(ctx context.Context, opts leadership.RunOpts) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-f.acquire:
			f.leader.Store(true)
			if opts.OnAcquire != nil {
				opts.OnAcquire(ctx)
			}
		case <-f.lose:
			f.leader.Store(false)
			if opts.OnLose != nil {
				opts.OnLose()
			}
		}
	}
}

func (f *fakeElector) IsLeader() bool              { return f.leader.Load() }
func (f *fakeElector) Close(context.Context) error { return nil }

// TestRunLeaderGatedNilElectorRunsDirectly: with no elector wired, the loop runs
// un-gated (single-replica / dev fallback) so existing wiring is unaffected.
func TestRunLeaderGatedNilElectorRunsDirectly(t *testing.T) {
	var ran atomic.Bool
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		done <- runLeaderGated(ctx, nil, "role", "inst", zerolog.Nop(), func(ctx context.Context) error {
			ran.Store(true)
			<-ctx.Done()
			return ctx.Err()
		})
	}()
	waitFor(t, ran.Load, "loop should run directly with nil elector")
	cancel()
	if err := <-done; err != nil {
		t.Fatalf("nil-elector runLeaderGated returned %v, want nil", err)
	}
}

// TestRunLeaderGatedStartsOnAcquireStopsOnLose: the loop starts ONLY after
// leadership is acquired and its context is cancelled when leadership is lost, so
// at most one replica's ticker is live.
func TestRunLeaderGatedStartsOnAcquireStopsOnLose(t *testing.T) {
	fe := newFakeElector()
	var (
		mu      sync.Mutex
		starts  int
		stopped bool
	)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = runLeaderGated(ctx, fe, "role", "inst", zerolog.Nop(), func(loopCtx context.Context) error {
			mu.Lock()
			starts++
			mu.Unlock()
			<-loopCtx.Done()
			mu.Lock()
			stopped = true
			mu.Unlock()
			return loopCtx.Err()
		})
	}()

	// Not a leader yet ⇒ loop never started.
	time.Sleep(20 * time.Millisecond)
	mu.Lock()
	if starts != 0 {
		mu.Unlock()
		t.Fatal("loop must NOT run before leadership is acquired")
	}
	mu.Unlock()

	// Acquire ⇒ loop starts.
	fe.acquire <- struct{}{}
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return starts == 1 }, "loop should start on acquire")

	// Lose ⇒ loop's context cancelled, loop stops.
	fe.lose <- struct{}{}
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return stopped }, "loop should stop on leadership loss")
}

// TestRunLeaderGatedReacquireRestarts: losing then re-acquiring leadership starts a
// FRESH loop invocation (the integration tickers are stateless pollers safe to
// restart).
func TestRunLeaderGatedReacquireRestarts(t *testing.T) {
	fe := newFakeElector()
	var starts atomic.Int32
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() {
		_ = runLeaderGated(ctx, fe, "role", "inst", zerolog.Nop(), func(loopCtx context.Context) error {
			starts.Add(1)
			<-loopCtx.Done()
			return loopCtx.Err()
		})
	}()

	fe.acquire <- struct{}{}
	waitFor(t, func() bool { return starts.Load() == 1 }, "first acquire starts loop")
	fe.lose <- struct{}{}
	time.Sleep(20 * time.Millisecond)
	fe.acquire <- struct{}{}
	waitFor(t, func() bool { return starts.Load() == 2 }, "re-acquire restarts loop")
}

// waitFor polls cond up to ~2s, failing the test if it never becomes true.
func waitFor(t *testing.T, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal(msg)
}
