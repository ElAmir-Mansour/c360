package failback

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// recordingTxRunner records each system-transaction boundary. Each RunSystemTx
// call is a distinct transaction; the runner asserts they do not nest. It also
// marks the store "advancing" for the duration of the advance transaction so the
// store can detect any claim that overlaps an advance (which would prove the two
// were NOT in separate transactions).
type recordingTxRunner struct {
	mu     sync.Mutex
	store  *memStore
	calls  int
	nested bool
	open   bool
	// callDBs records the DBTX used in each transaction, so the test can assert
	// the claim and advance used different transaction contexts.
	dbs []repository.DBTX
}

// txDB is a unique per-transaction DBTX marker. It is never actually queried (the
// in-memory store ignores its DBTX argument); its identity is what the test uses
// to prove the claim and advance ran in different transactions.
type txDB struct {
	repository.DBTX
	id int
}

func (r *recordingTxRunner) RunSystemTx(ctx context.Context, fn func(db repository.DBTX) error) error {
	r.mu.Lock()
	if r.open {
		// A transaction is already open: this would be a nested/overlapping tx,
		// which violates the separate-transaction discipline.
		r.nested = true
	}
	r.open = true
	r.calls++
	// The first RunSystemTx is the claim; every subsequent one is an advance. Mark
	// the store "advancing" for the advance transaction so that if the driver were
	// to (incorrectly) issue a claim inside the advance tx, the store's
	// SystemClaimRun would observe advancing==true and trip claimedDuringAdvance.
	isAdvance := r.calls > 1
	db := txDB{id: r.calls}
	r.dbs = append(r.dbs, db)
	if isAdvance {
		r.store.setAdvancing(true)
	}
	r.mu.Unlock()

	err := fn(db)

	r.mu.Lock()
	if isAdvance {
		r.store.setAdvancing(false)
	}
	r.open = false
	r.mu.Unlock()
	return err
}

func TestLoopTick_ClaimAndAdvanceRunInSeparateTransactions(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusPlanning, InitiatedBy: "u",
	})
	sink := &recordingSink{}
	tracker, _ := NewDeltaTracker(fakeProber{probe: convergedProbe})
	drv, err := New(Config{
		Store:   store,
		Starter: &fakeStarter{},
		Tracker: tracker,
		Cutback: &fakeCutback{},
		Events:  sink,
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New driver: %v", err)
	}

	runner := &recordingTxRunner{store: store}
	loop, err := NewLoop(LoopConfig{
		Claimer: store,
		Driver:  drv,
		Logger:  zerolog.Nop(),
		runner:  runner,
	})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}

	advanced, err := loop.tick(ctx)
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if !advanced {
		t.Fatal("tick did not advance the PLANNING run")
	}

	// Two distinct transactions: one for the claim, one for the advance.
	if runner.calls != 2 {
		t.Fatalf("system transactions = %d, want 2 (claim + advance)", runner.calls)
	}
	if runner.nested {
		t.Fatal("claim and advance overlapped in the same transaction")
	}
	if store.claimedDuringAdvance {
		t.Fatal("a claim occurred during the advance transaction (not separated)")
	}
	if runner.dbs[0] == runner.dbs[1] {
		t.Fatal("claim and advance shared the same transaction context")
	}
}

func TestLoopTick_AwaitingApprovalIsNotAdvanced(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	// Only an awaiting-approval run exists. The claimer (mirroring the partial
	// index) skips it, so tick claims nothing and never advances.
	store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusAwaitingCutbackApproval, InitiatedBy: "u",
	})
	tracker, _ := NewDeltaTracker(fakeProber{probe: convergedProbe})
	cutback := &fakeCutback{}
	drv, err := New(Config{
		Store:   store,
		Starter: &fakeStarter{},
		Tracker: tracker,
		Cutback: cutback,
		Events:  &recordingSink{},
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	runner := &recordingTxRunner{store: store}
	loop, err := NewLoop(LoopConfig{Claimer: store, Driver: drv, Logger: zerolog.Nop(), runner: runner})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}
	advanced, err := loop.tick(ctx)
	if err != nil {
		t.Fatalf("tick: %v", err)
	}
	if advanced {
		t.Fatal("tick advanced an awaiting-approval run (cutback gate breached)")
	}
	if cutback.calls != 0 {
		t.Fatal("cutback ran without approval via the loop")
	}
}

func TestLoopTick_DrivesFullFSMOverMultipleTicks(t *testing.T) {
	ctx := context.Background()
	store := newMemStore()
	run := store.seed(&FailbackRun{
		TenantID: "tenant-1", GroupID: "g", FromSite: "a", ToSite: "b",
		Status: StatusPlanning, ConvergeThresholdBytes: 0, InitiatedBy: "u",
	})
	tracker, _ := NewDeltaTracker(fakeProber{probe: convergedProbe})
	cutback := &fakeCutback{detail: map[string]any{"ok": true}}
	drv, err := New(Config{
		Store:   store,
		Starter: &fakeStarter{},
		Tracker: tracker,
		Cutback: cutback,
		Events:  &recordingSink{},
		Now:     store.now,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	runner := &recordingTxRunner{store: store}
	loop, err := NewLoop(LoopConfig{Claimer: store, Driver: drv, Logger: zerolog.Nop(), runner: runner})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}

	// Drive ticks until the run parks at the cutback gate. Bound the loop so a
	// regression that fails to park (auto-cuts) cannot spin forever.
	for i := 0; i < 10; i++ {
		advanced, terr := loop.tick(ctx)
		if terr != nil {
			t.Fatalf("tick %d: %v", i, terr)
		}
		if !advanced {
			break
		}
	}
	parked := store.get(run.ID)
	if parked.Status != StatusAwaitingCutbackApproval {
		t.Fatalf("run did not park at the cutback gate: %s", parked.Status)
	}
	if cutback.calls != 0 {
		t.Fatal("cutback executed before approval")
	}

	// Approve, then one more tick completes the cutback.
	if err := store.ApproveCutback(ctx, nil, parked.TenantID, parked.ID, "approver"); err != nil {
		t.Fatalf("approve: %v", err)
	}
	advanced, err := loop.tick(ctx)
	if err != nil {
		t.Fatalf("tick after approval: %v", err)
	}
	if !advanced {
		t.Fatal("tick after approval did not advance CUTTING_BACK")
	}
	done := store.get(run.ID)
	if done.Status != StatusCompleted {
		t.Fatalf("final status = %s, want COMPLETED", done.Status)
	}
	if cutback.calls != 1 {
		t.Fatalf("cutback calls = %d, want 1", cutback.calls)
	}
	if done.NewDirection == nil || *done.NewDirection != DirectionPrimaryToDR {
		t.Fatalf("new direction = %v, want %s", done.NewDirection, DirectionPrimaryToDR)
	}
}

func TestNewLoop_RequiresPoolOrRunner(t *testing.T) {
	tracker, _ := NewDeltaTracker(fakeProber{})
	drv, _ := New(Config{Store: newMemStore(), Starter: &fakeStarter{}, Tracker: tracker, Cutback: &fakeCutback{}})
	if _, err := NewLoop(LoopConfig{Claimer: newMemStore(), Driver: drv}); err == nil {
		t.Fatal("expected error without a pool or runner")
	}
}

var _ = time.Second
