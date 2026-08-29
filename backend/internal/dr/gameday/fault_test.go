package gameday

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// fakeStreamController records pause/resume calls so a test can assert a stream
// was paused and that the revert resumed exactly that stream.
type fakeStreamController struct {
	mu        sync.Mutex
	paused    map[string]int
	resumed   map[string]int
	pauseErr  error
	resumeErr error
}

func newFakeStreamController() *fakeStreamController {
	return &fakeStreamController{paused: map[string]int{}, resumed: map[string]int{}}
}

func (f *fakeStreamController) PauseStream(_ context.Context, streamID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.pauseErr != nil {
		return f.pauseErr
	}
	f.paused[streamID]++
	return nil
}

func (f *fakeStreamController) ResumeStream(_ context.Context, streamID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.resumeErr != nil {
		return f.resumeErr
	}
	f.resumed[streamID]++
	return nil
}

func (f *fakeStreamController) pausedCount(id string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.paused[id]
}

func (f *fakeStreamController) resumedCount(id string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.resumed[id]
}

func TestPauseStreamFault_InjectAndRevert(t *testing.T) {
	ctrl := newFakeStreamController()
	f := NewPauseStreamFault(ctrl)
	if f.Action() != ActionPauseStream {
		t.Fatalf("Action() = %q, want %q", f.Action(), ActionPauseStream)
	}

	revert, err := f.Inject(context.Background(), Step{Action: ActionPauseStream, Target: "stream-1"})
	if err != nil {
		t.Fatalf("Inject() error = %v", err)
	}
	if got := ctrl.pausedCount("stream-1"); got != 1 {
		t.Fatalf("paused count = %d, want 1", got)
	}
	if got := ctrl.resumedCount("stream-1"); got != 0 {
		t.Fatalf("resumed count before revert = %d, want 0", got)
	}

	if err := revert(context.Background()); err != nil {
		t.Fatalf("revert() error = %v", err)
	}
	if got := ctrl.resumedCount("stream-1"); got != 1 {
		t.Fatalf("resumed count after revert = %d, want 1", got)
	}
}

func TestPauseStreamFault_InjectErrorLeavesNothingToRevert(t *testing.T) {
	ctrl := newFakeStreamController()
	ctrl.pauseErr = errors.New("boom")
	f := NewPauseStreamFault(ctrl)

	revert, err := f.Inject(context.Background(), Step{Action: ActionPauseStream, Target: "stream-1"})
	if err == nil {
		t.Fatal("Inject() expected error, got nil")
	}
	// A failed inject must return a usable no-op revert (never nil) so the caller's
	// defer is always safe.
	if revert == nil {
		t.Fatal("Inject() returned nil revert on error")
	}
	if err := revert(context.Background()); err != nil {
		t.Fatalf("no-op revert error = %v", err)
	}
	if got := ctrl.resumedCount("stream-1"); got != 0 {
		t.Fatalf("resume must not be called when pause failed, got %d", got)
	}
}

func TestPauseStreamFault_MissingTarget(t *testing.T) {
	f := NewPauseStreamFault(newFakeStreamController())
	if _, err := f.Inject(context.Background(), Step{Action: ActionPauseStream}); err == nil {
		t.Fatal("expected error for missing target")
	}
}

// fakeLagController records induced/cleared lag.
type fakeLagController struct {
	mu      sync.Mutex
	induced map[string]time.Duration
	cleared map[string]int
}

func newFakeLagController() *fakeLagController {
	return &fakeLagController{induced: map[string]time.Duration{}, cleared: map[string]int{}}
}

func (f *fakeLagController) InduceLag(_ context.Context, streamID string, d time.Duration) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.induced[streamID] = d
	return nil
}

func (f *fakeLagController) ClearLag(_ context.Context, streamID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.cleared[streamID]++
	return nil
}

func TestInduceLagFault_UsesParamLagThenDefault(t *testing.T) {
	ctrl := newFakeLagController()
	f := NewInduceLagFault(ctrl, 10*time.Minute)

	// Explicit duration string param.
	if _, err := f.Inject(context.Background(), Step{
		Action: ActionInduceLag, Target: "s1", Params: map[string]any{"lag": "90s"},
	}); err != nil {
		t.Fatalf("Inject error = %v", err)
	}
	if ctrl.induced["s1"] != 90*time.Second {
		t.Fatalf("induced[s1] = %v, want 90s", ctrl.induced["s1"])
	}

	// No param -> default.
	if _, err := f.Inject(context.Background(), Step{Action: ActionInduceLag, Target: "s2"}); err != nil {
		t.Fatalf("Inject error = %v", err)
	}
	if ctrl.induced["s2"] != 10*time.Minute {
		t.Fatalf("induced[s2] = %v, want default 10m", ctrl.induced["s2"])
	}

	// Numeric seconds param.
	if _, err := f.Inject(context.Background(), Step{
		Action: ActionInduceLag, Target: "s3", Params: map[string]any{"lag": float64(45)},
	}); err != nil {
		t.Fatalf("Inject error = %v", err)
	}
	if ctrl.induced["s3"] != 45*time.Second {
		t.Fatalf("induced[s3] = %v, want 45s", ctrl.induced["s3"])
	}
}

func TestInduceLagFault_RevertClears(t *testing.T) {
	ctrl := newFakeLagController()
	f := NewInduceLagFault(ctrl, time.Minute)
	revert, err := f.Inject(context.Background(), Step{Action: ActionInduceLag, Target: "s1"})
	if err != nil {
		t.Fatalf("Inject error = %v", err)
	}
	if err := revert(context.Background()); err != nil {
		t.Fatalf("revert error = %v", err)
	}
	if ctrl.cleared["s1"] != 1 {
		t.Fatalf("cleared[s1] = %d, want 1", ctrl.cleared["s1"])
	}
}

// fakeSiteBlocker records block/unblock.
type fakeSiteBlocker struct {
	mu        sync.Mutex
	blocked   map[string]int
	unblocked map[string]int
}

func newFakeSiteBlocker() *fakeSiteBlocker {
	return &fakeSiteBlocker{blocked: map[string]int{}, unblocked: map[string]int{}}
}

func (f *fakeSiteBlocker) BlockSite(_ context.Context, siteID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.blocked[siteID]++
	return nil
}

func (f *fakeSiteBlocker) UnblockSite(_ context.Context, siteID string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.unblocked[siteID]++
	return nil
}

func TestBlockSiteFault_InjectAndRevert(t *testing.T) {
	blocker := newFakeSiteBlocker()
	f := NewBlockSiteFault(blocker)
	revert, err := f.Inject(context.Background(), Step{Action: ActionBlockSite, Target: "site-1"})
	if err != nil {
		t.Fatalf("Inject error = %v", err)
	}
	if blocker.blocked["site-1"] != 1 {
		t.Fatalf("blocked[site-1] = %d, want 1", blocker.blocked["site-1"])
	}
	if err := revert(context.Background()); err != nil {
		t.Fatalf("revert error = %v", err)
	}
	if blocker.unblocked["site-1"] != 1 {
		t.Fatalf("unblocked[site-1] = %d, want 1", blocker.unblocked["site-1"])
	}
}

func TestOnceRevert_RunsExactlyOnce(t *testing.T) {
	var calls int
	once := newOnceRevert(func(context.Context) error {
		calls++
		return nil
	})

	ran1, err1 := once.run(context.Background())
	ran2, err2 := once.run(context.Background())
	ran3, err3 := once.run(context.Background())

	if !ran1 {
		t.Fatal("first run should report ran=true")
	}
	if ran2 || ran3 {
		t.Fatal("subsequent runs should report ran=false")
	}
	if err1 != nil || err2 != nil || err3 != nil {
		t.Fatalf("unexpected errors: %v %v %v", err1, err2, err3)
	}
	if calls != 1 {
		t.Fatalf("underlying teardown called %d times, want exactly 1", calls)
	}
	if !once.reverted() {
		t.Fatal("reverted() should be true after running")
	}
}

func TestRegistry_Lookup(t *testing.T) {
	pause := NewPauseStreamFault(newFakeStreamController())
	reg := NewRegistry(pause, nil)
	if got, ok := reg.Injector(ActionPauseStream); !ok || got != pause {
		t.Fatalf("Injector(pause) = %v,%v want %v,true", got, ok, pause)
	}
	if _, ok := reg.Injector(ActionBlockSite); ok {
		t.Fatal("Injector(block_site) should be absent")
	}
}
