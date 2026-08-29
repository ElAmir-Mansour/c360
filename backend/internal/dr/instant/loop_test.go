package instant

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/repository"
)

// newTestLoop builds a HydrateLoop driving the real service over the in-memory
// store; batch is large so a single Tick advances every active session.
func newTestLoop(t *testing.T, svc *Service, store *memStore) *HydrateLoop {
	t.Helper()
	loop, err := NewHydrateLoop(HydrateLoopConfig{
		Driver: svc,
		Store:  store,
		System: newMemRunner(),
		Batch:  64,
	})
	if err != nil {
		t.Fatalf("NewHydrateLoop: %v", err)
	}
	return loop
}

func TestLoop_AdvancesMultipleSessions(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, newSequentialBase(5, 8), newMemSink("loc"), 0)
	tenantA := uuid.New()
	tenantB := uuid.New()

	sa, err := svc.StartSession(ctx, tenantA, uuid.New(), nil)
	if err != nil {
		t.Fatalf("StartSession A: %v", err)
	}
	sb, err := svc.StartSession(ctx, tenantB, uuid.New(), nil)
	if err != nil {
		t.Fatalf("StartSession B: %v", err)
	}

	// One tick hydrates both sessions (across tenants on the system path).
	if err := newTestLoop(t, svc, store).Tick(ctx); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	for _, id := range []struct {
		tenant uuid.UUID
		sess   uuid.UUID
	}{{tenantA, sa.ID}, {tenantB, sb.ID}} {
		prog, gerr := svc.GetProgress(ctx, id.tenant, id.sess)
		if gerr != nil {
			t.Fatalf("GetProgress: %v", gerr)
		}
		if prog.Session.State != StateReady {
			t.Fatalf("session %s state = %q, want READY", id.sess, prog.Session.State)
		}
	}
}

type recordingSystemRunner struct {
	memRunner
	systemTxOps   int
	systemReadOps int
}

func newRecordingSystemRunner() *recordingSystemRunner {
	return &recordingSystemRunner{memRunner: newMemRunner()}
}

func (r *recordingSystemRunner) RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error {
	r.systemTxOps++
	return r.memRunner.RunSystemTx(ctx, fn)
}

func (r *recordingSystemRunner) RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error {
	r.systemReadOps++
	return r.memRunner.RunSystemRead(ctx, fn)
}

func TestLoop_ClaimsSessionsWithWriteTransaction(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, newSequentialBase(1, 8), newMemSink("loc"), 0)
	tenantID := uuid.New()
	if _, err := svc.StartSession(ctx, tenantID, uuid.New(), nil); err != nil {
		t.Fatalf("StartSession: %v", err)
	}

	runner := newRecordingSystemRunner()
	loop, err := NewHydrateLoop(HydrateLoopConfig{
		Driver: svc,
		Store:  store,
		System: runner,
		Batch:  64,
	})
	if err != nil {
		t.Fatalf("NewHydrateLoop: %v", err)
	}

	if err := loop.Tick(ctx); err != nil {
		t.Fatalf("Tick: %v", err)
	}
	if runner.systemTxOps != 1 {
		t.Fatalf("system tx ops = %d, want 1", runner.systemTxOps)
	}
	if runner.systemReadOps != 0 {
		t.Fatalf("system read ops = %d, want 0", runner.systemReadOps)
	}
}

// failingBase makes ReadBaseChunk error so the loop must mark the session FAILED
// without propagating the error or stalling the batch.
type failingBase struct{ count int }

func (b failingBase) ChunkCount(context.Context) (int, error) { return b.count, nil }
func (b failingBase) ChunkSize(context.Context) (int, error)  { return 8, nil }
func (b failingBase) ReadBaseChunk(context.Context, int) ([]byte, error) {
	return nil, errors.New("simulated WORM read failure")
}

func TestLoop_FailingHydrationMarksSessionFailed(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	store := newMemStore()
	svc := newTestService(t, store, failingBase{count: 4}, newMemSink("loc"), 0)
	tenantID := uuid.New()

	sess, err := svc.StartSession(ctx, tenantID, uuid.New(), nil)
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}

	// Tick returns nil (per-session error is isolated), but the session is FAILED.
	if err := newTestLoop(t, svc, store).Tick(ctx); err != nil {
		t.Fatalf("Tick should isolate per-session errors, got %v", err)
	}
	prog, err := svc.GetProgress(ctx, tenantID, sess.ID)
	if err != nil {
		t.Fatalf("GetProgress: %v", err)
	}
	if prog.Session.State != StateFailed {
		t.Fatalf("state = %q, want FAILED", prog.Session.State)
	}
	if prog.Session.LastError == nil || *prog.Session.LastError == "" {
		t.Fatalf("FAILED session should record a reason, got %v", prog.Session.LastError)
	}
}

func TestNewHydrateLoop_Validation(t *testing.T) {
	t.Parallel()
	if _, err := NewHydrateLoop(HydrateLoopConfig{}); err == nil {
		t.Fatal("expected error with no driver")
	}
}
