package service

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/leadership"
)

// fakeElector is a controllable Elector for testing RunLeaderSingleton without
// Redis. Tests drive leadership transitions via Acquire()/Lose() and end the
// session via Stop() (or by cancelling the ctx passed to Run).
type fakeElector struct {
	mu       sync.Mutex
	opts     leadership.RunOpts
	ready    chan struct{} // closed once Run has captured opts
	stopCh   chan struct{}
	leader   atomic.Bool
	runErr   error
	parent   context.Context
	closedRd bool
}

func newFakeElector() *fakeElector {
	return &fakeElector{
		ready:  make(chan struct{}),
		stopCh: make(chan struct{}),
	}
}

func (f *fakeElector) Run(ctx context.Context, opts leadership.RunOpts) error {
	f.mu.Lock()
	f.opts = opts
	f.parent = ctx
	if !f.closedRd {
		f.closedRd = true
		close(f.ready)
	}
	f.mu.Unlock()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-f.stopCh:
		return f.runErr
	}
}

func (f *fakeElector) IsLeader() bool { return f.leader.Load() }

func (f *fakeElector) Close(context.Context) error { return nil }

// Acquire simulates winning leadership: fires OnAcquire with the parent ctx.
func (f *fakeElector) Acquire() {
	<-f.ready
	f.mu.Lock()
	onAcquire := f.opts.OnAcquire
	parent := f.parent
	f.mu.Unlock()
	f.leader.Store(true)
	if onAcquire != nil {
		onAcquire(parent)
	}
}

// Lose simulates losing leadership: fires OnLose.
func (f *fakeElector) Lose() {
	<-f.ready
	f.mu.Lock()
	onLose := f.opts.OnLose
	f.mu.Unlock()
	f.leader.Store(false)
	if onLose != nil {
		onLose()
	}
}

// Stop ends Run with the given error.
func (f *fakeElector) Stop(err error) {
	f.mu.Lock()
	f.runErr = err
	f.mu.Unlock()
	close(f.stopCh)
}

func TestRunLeaderSingleton_StartsOnAcquire(t *testing.T) {
	t.Parallel()

	fe := newFakeElector()
	started := make(chan struct{}, 1)
	var running atomic.Bool

	go func() {
		_ = RunLeaderSingleton(context.Background(), fe, "role-x", "inst-1", zerolog.Nop(), func(ctx context.Context) {
			running.Store(true)
			started <- struct{}{}
			<-ctx.Done() // block until cancelled
			running.Store(false)
		})
	}()

	fe.Acquire()

	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("fn never started after OnAcquire")
	}
	if !running.Load() {
		t.Fatal("fn not running after acquire")
	}

	fe.Stop(nil)
}

func TestRunLeaderSingleton_CancelsOnLose(t *testing.T) {
	t.Parallel()

	fe := newFakeElector()
	started := make(chan struct{}, 1)
	cancelled := make(chan struct{}, 1)

	go func() {
		_ = RunLeaderSingleton(context.Background(), fe, "role-y", "inst-2", zerolog.Nop(), func(ctx context.Context) {
			started <- struct{}{}
			<-ctx.Done()
			cancelled <- struct{}{}
		})
	}()

	fe.Acquire()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("fn never started")
	}

	// Losing leadership must cancel the fn's context.
	fe.Lose()
	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("fn context not cancelled after OnLose")
	}

	fe.Stop(nil)
}

func TestRunLeaderSingleton_ReacquireRestartsFn(t *testing.T) {
	t.Parallel()

	fe := newFakeElector()
	var starts atomic.Int32
	started := make(chan struct{}, 4)
	cancelled := make(chan struct{}, 4)

	go func() {
		_ = RunLeaderSingleton(context.Background(), fe, "role-z", "inst-3", zerolog.Nop(), func(ctx context.Context) {
			starts.Add(1)
			started <- struct{}{}
			<-ctx.Done()
			cancelled <- struct{}{}
		})
	}()

	// First leadership term.
	fe.Acquire()
	<-started
	fe.Lose()
	<-cancelled

	// Second leadership term must start a fresh fn invocation.
	fe.Acquire()
	select {
	case <-started:
	case <-time.After(2 * time.Second):
		t.Fatal("fn did not restart on re-acquire")
	}
	if got := starts.Load(); got != 2 {
		t.Fatalf("fn started %d times, want 2", got)
	}

	fe.Stop(nil)
	<-cancelled // teardown cancels the active fn
}

func TestRunLeaderSingleton_StopCancelsActiveFnAndReturnsNil(t *testing.T) {
	t.Parallel()

	fe := newFakeElector()
	cancelled := make(chan struct{}, 1)
	retErr := make(chan error, 1)

	go func() {
		retErr <- RunLeaderSingleton(context.Background(), fe, "role-s", "inst-4", zerolog.Nop(), func(ctx context.Context) {
			<-ctx.Done()
			cancelled <- struct{}{}
		})
	}()

	fe.Acquire()

	// Elector ends cleanly (ctx-cancel semantics): helper must cancel fn and
	// return nil (context.Canceled is treated as clean shutdown).
	fe.Stop(context.Canceled)

	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("active fn not cancelled on shutdown")
	}
	select {
	case err := <-retErr:
		if err != nil {
			t.Fatalf("RunLeaderSingleton returned %v, want nil for context.Canceled", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RunLeaderSingleton did not return")
	}
}

func TestRunLeaderSingleton_PropagatesElectorError(t *testing.T) {
	t.Parallel()

	fe := newFakeElector()
	retErr := make(chan error, 1)
	wantErr := errors.New("elector exploded")

	go func() {
		retErr <- RunLeaderSingleton(context.Background(), fe, "role-e", "inst-5", zerolog.Nop(), func(ctx context.Context) {
			<-ctx.Done()
		})
	}()

	fe.Stop(wantErr) // never acquired; elector returns a hard error

	select {
	case err := <-retErr:
		if !errors.Is(err, wantErr) {
			t.Fatalf("RunLeaderSingleton returned %v, want %v", err, wantErr)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RunLeaderSingleton did not return")
	}
}

func TestRunLeaderSingleton_ParentContextCancelStops(t *testing.T) {
	t.Parallel()

	fe := newFakeElector()
	cancelled := make(chan struct{}, 1)
	retErr := make(chan error, 1)

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		retErr <- RunLeaderSingleton(ctx, fe, "role-p", "inst-6", zerolog.Nop(), func(c context.Context) {
			<-c.Done()
			cancelled <- struct{}{}
		})
	}()

	fe.Acquire()
	cancel() // parent cancellation propagates through the real elector's Run

	select {
	case <-cancelled:
	case <-time.After(2 * time.Second):
		t.Fatal("fn not cancelled when parent ctx cancelled")
	}
	select {
	case err := <-retErr:
		if err != nil {
			t.Fatalf("returned %v, want nil on parent cancel", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("RunLeaderSingleton did not return on parent cancel")
	}
}

func TestRunLeaderSingleton_NilElector(t *testing.T) {
	t.Parallel()
	err := RunLeaderSingleton(context.Background(), nil, "r", "i", zerolog.Nop(), func(context.Context) {})
	if !errors.Is(err, leadership.ErrInvalidConfig) {
		t.Fatalf("nil elector returned %v, want ErrInvalidConfig", err)
	}
}

func TestRunLeaderSingleton_NilFn(t *testing.T) {
	t.Parallel()
	fe := newFakeElector()
	err := RunLeaderSingleton(context.Background(), fe, "r", "i", zerolog.Nop(), nil)
	if err == nil {
		t.Fatal("nil fn should return an error")
	}
}
