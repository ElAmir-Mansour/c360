package runbookstudio

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// seedStalledRun builds a runbook with a required task and a run whose required
// task is left FAILED while the run is still RUNNING — the exact state the
// reconciliation loop's safety net exists to resolve (e.g. a crash between an
// automated task failing and the run-decision committing). It writes the rows
// directly through the store so the run is genuinely "stuck" rather than resolved
// by the action path.
func seedStalledRun(t *testing.T, store *fakeStore, svc *Service, tenant uuid.UUID) Run {
	t.Helper()
	ctx := context.Background()
	rb, _, err := svc.CreateRunbook(ctx, tenant, CreateRunbookInput{Name: "stalled-" + uuid.NewString()})
	if err != nil {
		t.Fatalf("CreateRunbook: %v", err)
	}
	a, _ := svc.AddTask(ctx, tenant, rb.ID, AddTaskInput{TaskKey: "a", Name: "a", Required: boolPtr(true)})
	b, _ := svc.AddTask(ctx, tenant, rb.ID, AddTaskInput{TaskKey: "b", Name: "b", Required: boolPtr(true), Predecessors: []string{a.ID}})

	run := &Run{TenantID: tenant.String(), RunbookID: rb.ID, Mode: RunModeLive, Status: RunStatusRunning, PlannedCriticalPathSeconds: 0}
	if cerr := store.CreateRun(ctx, nil, run); cerr != nil {
		t.Fatalf("CreateRun: %v", cerr)
	}
	// a FAILED, b PENDING — required work outstanding, no frontier, nothing running.
	for _, tr := range []*TaskRun{
		{TenantID: tenant.String(), RunID: run.ID, TaskID: a.ID, Status: TaskRunFailed},
		{TenantID: tenant.String(), RunID: run.ID, TaskID: b.ID, Status: TaskRunPending},
	} {
		if cerr := store.CreateTaskRun(ctx, nil, tr); cerr != nil {
			t.Fatalf("CreateTaskRun: %v", cerr)
		}
	}
	return *run
}

func TestReconcileRun_FailsGenuinelyStalledRun(t *testing.T) {
	store := newFakeStore()
	svc, _ := newTestService(t, store, nil)
	tenant := uuid.New()
	run := seedStalledRun(t, store, svc, tenant)

	changed, err := svc.ReconcileRun(context.Background(), run)
	if err != nil {
		t.Fatalf("ReconcileRun: %v", err)
	}
	if !changed {
		t.Fatalf("reconcile should fail a genuinely stalled run")
	}
	updated, _ := store.GetRun(context.Background(), nil, run.ID)
	if updated.Status != RunStatusFailed {
		t.Fatalf("stalled run status = %q, want failed", updated.Status)
	}
	if updated.LastError == nil {
		t.Fatalf("failed run should record a reason")
	}
}

func TestLoop_Tick_ScansAndReconciles(t *testing.T) {
	store := newFakeStore()
	svc, _ := newTestService(t, store, nil)
	tenant := uuid.New()
	stalled := seedStalledRun(t, store, svc, tenant)

	// A second, healthy run that must be left alone.
	ctx := context.Background()
	rb2, _, _ := svc.CreateRunbook(ctx, tenant, CreateRunbookInput{Name: "healthy"})
	only, _ := svc.AddTask(ctx, tenant, rb2.ID, AddTaskInput{TaskKey: "only", Name: "only", Required: boolPtr(true)})
	healthy := &Run{TenantID: tenant.String(), RunbookID: rb2.ID, Mode: RunModeLive, Status: RunStatusRunning}
	_ = store.CreateRun(ctx, nil, healthy)
	_ = store.CreateTaskRun(ctx, nil, &TaskRun{TenantID: tenant.String(), RunID: healthy.ID, TaskID: only.ID, Status: TaskRunRunnable})

	loop, err := NewLoop(LoopConfig{
		Reader:     fakeRunner{},
		Lister:     store,
		Reconciler: svc,
		Logger:     zerolog.Nop(),
		Interval:   time.Second,
	})
	if err != nil {
		t.Fatalf("NewLoop: %v", err)
	}

	// Run one real tick: it scans active runs across tenants and reconciles each.
	if terr := loop.tick(ctx); terr != nil {
		t.Fatalf("tick: %v", terr)
	}

	gotStalled, _ := store.GetRun(ctx, nil, stalled.ID)
	if gotStalled.Status != RunStatusFailed {
		t.Fatalf("stalled run should be failed by reconcile, got %q", gotStalled.Status)
	}
	gotHealthy, _ := store.GetRun(ctx, nil, healthy.ID)
	if gotHealthy.Status != RunStatusRunning {
		t.Fatalf("healthy run must be left running, got %q", gotHealthy.Status)
	}
}

func TestNewLoop_RequiresDependencies(t *testing.T) {
	if _, err := NewLoop(LoopConfig{Lister: newFakeStore()}); err == nil {
		t.Fatalf("NewLoop without reader/reconciler should error")
	}
}
