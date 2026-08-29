package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
)

// newLoop wires a Loop over the in-memory store with the supplied transaction
// runners (so the claim/advance separation and rollback are exercised without a
// database). The leader-election seam is intentionally not driven here — the
// loop's Run is started from OnAcquire in production; the unit tests drive
// driveOnce/sweepGates directly, which is what each leader tick calls.
func newLoop(t *testing.T, m *memStore, drv Driver, txRun txRunner, readRun readRunner) *Loop {
	t.Helper()
	gs, err := NewGateService(GateServiceConfig{Repository: repoAdapter{m}})
	if err != nil {
		t.Fatalf("NewGateService: %v", err)
	}
	l, err := NewLoop(LoopConfig{
		Claimer:     m,
		Driver:      drv,
		Gates:       m,
		Runbooks:    repoAdapter{m},
		GateApplier: gs,
		Logger:      zerolog.Nop(),
		TxRunner:    txRun,
		ReadRunner:  readRun,
		BatchSize:   10,
	})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}
	return l
}

// drive runs driveOnce until nothing more advances or maxTicks elapse.
func drive(t *testing.T, l *Loop, maxTicks int) {
	t.Helper()
	for i := 0; i < maxTicks; i++ {
		advanced, err := l.driveOnce(context.Background())
		if err != nil {
			t.Fatalf("driveOnce tick %d: %v", i, err)
		}
		if !advanced {
			return
		}
	}
}

func TestLoop_DrivesRunToCompletion(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0), actionStep(1))
	seedRun(m, "loop-run")
	exec := newFakeExecutor()
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)
	cr := &commitRunner{}
	l := newLoop(t, m, o, cr.asTxRunner(), cr.asReadRunner())

	drive(t, l, 30)

	if m.run("loop-run").Status != model.RunStatusCompleted {
		t.Fatalf("loop did not complete run: %s", m.run("loop-run").Status)
	}
	for i := 0; i < 2; i++ {
		if exec.callCount(i) != 1 {
			t.Fatalf("step %d executed %d times, want 1", i, exec.callCount(i))
		}
	}
}

// txCountingRunner records, per logical phase, how many transactions wrapped each
// repository call. It distinguishes a "claim" transaction (the one in which
// SystemClaimRunnableRuns was called) from an "advance" transaction (the one in
// which UpdateRunState was called), so the test can prove they are separate.
type txCountingRunner struct {
	mu            sync.Mutex
	currentClaims int
	currentWrites int
	// claimTxns counts transactions that performed a claim.
	claimTxns int
	// advanceTxns counts transactions that performed at least one run write but
	// no claim — i.e. an advance transaction.
	advanceTxns int
	// sharedTxns counts any transaction that did BOTH a claim and a write (the
	// forbidden case the separate-tx rule prevents).
	sharedTxns int
}

func (r *txCountingRunner) markClaim() {
	r.mu.Lock()
	r.currentClaims++
	r.mu.Unlock()
}

func (r *txCountingRunner) markWrite() {
	r.mu.Lock()
	r.currentWrites++
	r.mu.Unlock()
}

func (r *txCountingRunner) asTxRunner(store *memStore) txRunner {
	return func(_ context.Context, fn func(db repository.DBTX) error) error {
		r.mu.Lock()
		r.currentClaims = 0
		r.currentWrites = 0
		r.mu.Unlock()
		err := fn(nil)
		r.mu.Lock()
		switch {
		case r.currentClaims > 0 && r.currentWrites > 0:
			r.sharedTxns++
		case r.currentClaims > 0:
			r.claimTxns++
		case r.currentWrites > 0:
			r.advanceTxns++
		}
		r.mu.Unlock()
		return err
	}
}

// claimWriteStore wraps memStore to signal the txCountingRunner which kind of
// operation happened inside the current transaction.
type claimWriteStore struct {
	*memStore
	tracker *txCountingRunner
}

func (s claimWriteStore) SystemClaimRunnableRuns(ctx context.Context, db repository.DBTX, limit int) ([]*model.Run, error) {
	s.tracker.markClaim()
	return s.memStore.SystemClaimRunnableRuns(ctx, db, limit)
}

func (s claimWriteStore) UpdateRunState(ctx context.Context, db repository.DBTX, run *model.Run) error {
	s.tracker.markWrite()
	return s.memStore.UpdateRunState(ctx, db, run)
}

// writeTrackingRepo is the orchestrator Repository that also signals writes.
type writeTrackingRepo struct {
	repoAdapter
	tracker *txCountingRunner
}

func (r writeTrackingRepo) UpdateRunState(ctx context.Context, db repository.DBTX, run *model.Run) error {
	r.tracker.markWrite()
	return r.repoAdapter.UpdateRunState(ctx, db, run)
}

func TestLoop_ClaimAndAdvanceUseSeparateTransactions(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0), actionStep(1))
	seedRun(m, "sep-run")
	tracker := &txCountingRunner{}

	// The orchestrator writes run state through writeTrackingRepo (marks writes);
	// the loop claims through claimWriteStore (marks claims). Each runs inside the
	// runner, which classifies each transaction as claim-only or advance-only.
	exec := newFakeExecutor()
	o, err := NewRunbookOrchestrator(OrchestratorConfig{
		Repository:  writeTrackingRepo{repoAdapter{m}, tracker},
		Executor:    exec,
		MaxAttempts: 3,
	})
	if err != nil {
		t.Fatalf("NewRunbookOrchestrator: %v", err)
	}
	cws := claimWriteStore{m, tracker}
	txRun := tracker.asTxRunner(m)
	readRun := func(_ context.Context, fn func(db repository.DBTX) error) error { return fn(nil) }

	l, err := NewLoop(LoopConfig{
		Claimer:     cws,
		Driver:      o,
		Gates:       m,
		Runbooks:    repoAdapter{m},
		GateApplier: mustGateService(t, m),
		Logger:      zerolog.Nop(),
		TxRunner:    txRun,
		ReadRunner:  readRun,
		BatchSize:   10,
	})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}

	drive(t, l, 30)

	if m.run("sep-run").Status != model.RunStatusCompleted {
		t.Fatalf("run not completed: %s", m.run("sep-run").Status)
	}
	if tracker.sharedTxns != 0 {
		t.Fatalf("found %d transactions that BOTH claimed and advanced — claim/advance must be separate", tracker.sharedTxns)
	}
	if tracker.claimTxns == 0 {
		t.Fatal("no claim-only transaction recorded")
	}
	if tracker.advanceTxns == 0 {
		t.Fatal("no advance-only transaction recorded")
	}
}

func mustGateService(t *testing.T, m *memStore) *GateService {
	t.Helper()
	gs, err := NewGateService(GateServiceConfig{Repository: repoAdapter{m}})
	if err != nil {
		t.Fatalf("NewGateService: %v", err)
	}
	return gs
}

func TestLoop_DoesNotClaimParkedRun(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 1, 0, model.TimeoutActionEscalate), actionStep(1))
	seedRun(m, "park-run")
	exec := newFakeExecutor()
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)
	cr := &commitRunner{}
	l := newLoop(t, m, o, cr.asTxRunner(), cr.asReadRunner())

	drive(t, l, 30)

	if m.run("park-run").Status != model.RunStatusAwaitingApproval {
		t.Fatalf("run not parked: %s", m.run("park-run").Status)
	}
	// Further driving must not advance the parked run nor execute the post-gate
	// step — the claim predicate excludes AWAITING_APPROVAL.
	advanced, err := l.driveOnce(context.Background())
	if err != nil {
		t.Fatalf("driveOnce on parked: %v", err)
	}
	if advanced {
		t.Fatal("loop advanced a parked AWAITING_APPROVAL run")
	}
	if exec.callCount(1) != 0 {
		t.Fatal("post-gate step executed while parked")
	}
}

func TestLoop_SweepEscalatesTimedOutGate(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 1, 1, model.TimeoutActionEscalate), actionStep(1))
	seedRun(m, "sweep-run")
	o := newOrchestrator(t, m, newFakeExecutor(), &recordingSink{}, 3)
	cr := &commitRunner{}
	l := newLoop(t, m, o, cr.asTxRunner(), cr.asReadRunner())
	drive(t, l, 10)

	// Force the gate past its deadline.
	g := m.gate("sweep-run", 0)
	past := time.Now().Add(-time.Minute)
	g.DeadlineAt = &past

	if err := l.sweepGates(context.Background()); err != nil {
		t.Fatalf("sweepGates: %v", err)
	}
	if m.run("sweep-run").Status != model.RunStatusEscalated {
		t.Fatalf("sweep did not escalate run: %s", m.run("sweep-run").Status)
	}
	if m.gate("sweep-run", 0).Status != model.GateStatusEscalated {
		t.Fatalf("gate not ESCALATED after sweep")
	}
}

func TestLoop_SweepAbortsTimedOutGate(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 1, 1, model.TimeoutActionAbort), actionStep(1))
	seedRun(m, "sweep-abort")
	o := newOrchestrator(t, m, newFakeExecutor(), &recordingSink{}, 3)
	cr := &commitRunner{}
	l := newLoop(t, m, o, cr.asTxRunner(), cr.asReadRunner())
	drive(t, l, 10)

	g := m.gate("sweep-abort", 0)
	past := time.Now().Add(-time.Minute)
	g.DeadlineAt = &past

	if err := l.sweepGates(context.Background()); err != nil {
		t.Fatalf("sweepGates: %v", err)
	}
	if m.run("sweep-abort").Status != model.RunStatusAborted {
		t.Fatalf("sweep did not abort run: %s", m.run("sweep-abort").Status)
	}
}

// failingDriver returns a non-recorded error from Advance with the run left
// untouched (the orchestrator owns its own tx boundaries now, so a real driver's
// partial write would have rolled back inside its own persist tx — modelled here
// by not mutating the persisted run at all). The loop must classify this as a
// non-terminal failure that leaves the run claimable on the next tick.
type failingDriver struct {
	store *memStore
}

func (d failingDriver) Advance(_ context.Context, _ *model.Run, _ txRunner) (bool, error) {
	// Do NOT persist any mutation: a real driver advancing through its own
	// persist tx would roll that tx back on a persistence failure, leaving the
	// committed run row unchanged. Return a non-recorded, non-terminal error.
	return false, errors.New("transient advance failure")
}

func TestLoop_AdvanceFailureLeavesRunRetryable(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0))
	seedRun(m, "rollback-run")
	cr := &commitRunner{}
	readRun := func(_ context.Context, fn func(db repository.DBTX) error) error { return fn(nil) }
	l, err := NewLoop(LoopConfig{
		Claimer:     m,
		Driver:      failingDriver{store: m},
		Gates:       m,
		Runbooks:    repoAdapter{m},
		GateApplier: mustGateService(t, m),
		Logger:      zerolog.Nop(),
		TxRunner:    cr.asTxRunner(),
		ReadRunner:  readRun,
		BatchSize:   10,
	})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}

	// driveOnce returns advanced=false (the only run failed to advance), but must
	// not error out the whole tick (per-run failures are logged and skipped).
	advanced, err := l.driveOnce(context.Background())
	if err != nil {
		t.Fatalf("driveOnce: %v", err)
	}
	if advanced {
		t.Fatal("driveOnce reported advance despite a non-terminal failure")
	}
	// The run is unchanged (the orchestrator's persist tx would have rolled back),
	// so it remains claimable in its pre-advance PENDING state.
	r := m.run("rollback-run")
	if r.Status != model.RunStatusPending {
		t.Fatalf("run state = %s after failed advance, want PENDING (unchanged/retryable)", r.Status)
	}
}
