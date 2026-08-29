package runbookstudio

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// store_integration_test.go exercises the REAL SQL store against a real Postgres,
// validating the model<->column alignment that the in-memory fake cannot: the
// uuid[] predecessors round-trip, the JSONB params/detail round-trip, the
// FOR UPDATE reads, the bulk status transition, and the system-path reads. It is
// guarded by STUDIO_DB_DSN so it is a no-op in normal CI; run it with a throwaway
// Postgres DSN (a superuser bypasses the FORCE RLS policies, so no tenant context
// is needed to drive the raw store).
//
// connectStore applies migration 000016 (plus a minimal consistency_group stub the
// GroupExists query references) to a fresh connection.
func connectStore(t *testing.T) (context.Context, *pgx.Conn) {
	t.Helper()
	dsn := os.Getenv("STUDIO_DB_DSN")
	if dsn == "" {
		t.Skip("set STUDIO_DB_DSN to run the studio store integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { conn.Close(ctx) })

	mig, err := os.ReadFile("../../../migrations/dr_db/000016_runbook_studio.up.sql")
	if err != nil {
		t.Fatalf("reading migration: %v", err)
	}
	// The store's GroupExists query references consistency_group; provide a minimal
	// stub so a group-bound runbook can be exercised.
	if _, err := conn.Exec(ctx, `CREATE TABLE IF NOT EXISTS consistency_group (id UUID PRIMARY KEY)`); err != nil {
		t.Fatalf("creating consistency_group stub: %v", err)
	}
	if _, err := conn.Exec(ctx, string(mig)); err != nil {
		t.Fatalf("applying migration: %v", err)
	}
	return ctx, conn
}

func TestStore_RoundTrip_FullLifecycle(t *testing.T) {
	ctx, conn := connectStore(t)
	st := NewStore()
	tenant := uuid.NewString()

	// ---- runbook -----------------------------------------------------------
	rb := &Runbook{TenantID: tenant, Name: "rb-" + uuid.NewString(), Description: "d", Source: SourceRegistry}
	if err := st.CreateRunbook(ctx, conn, rb); err != nil {
		t.Fatalf("CreateRunbook: %v", err)
	}
	if rb.ID == "" || rb.CreatedAt.IsZero() {
		t.Fatalf("CreateRunbook did not populate generated fields: %+v", rb)
	}
	got, err := st.GetRunbook(ctx, conn, rb.ID)
	if err != nil || got.Name != rb.Name || got.Source != SourceRegistry {
		t.Fatalf("GetRunbook = %+v, err=%v", got, err)
	}
	if _, err := st.UpdateRunbook(ctx, conn, rb.ID, "renamed", "d2", RunbookStatusPublished); err != nil {
		t.Fatalf("UpdateRunbook: %v", err)
	}

	// ---- tasks: predecessors (uuid[]) + params (jsonb) round-trip ----------
	a := &Task{TenantID: tenant, RunbookID: rb.ID, TaskKey: "a", Name: "A", TaskType: TaskTypeManual, Required: true, PlannedDurationSeconds: 10}
	if err := st.CreateTask(ctx, conn, a); err != nil {
		t.Fatalf("CreateTask a: %v", err)
	}
	b := &Task{
		TenantID: tenant, RunbookID: rb.ID, TaskKey: "b", Name: "B", TaskType: TaskTypeAutomated,
		Required: true, PlannedDurationSeconds: 20, AutomationAction: "boot",
		Predecessors: []string{a.ID},
		Params:       map[string]any{"site": "s1", "retries": float64(3)},
	}
	if err := st.CreateTask(ctx, conn, b); err != nil {
		t.Fatalf("CreateTask b: %v", err)
	}
	tasks, err := st.ListTasks(ctx, conn, rb.ID)
	if err != nil || len(tasks) != 2 {
		t.Fatalf("ListTasks = %d tasks, err=%v", len(tasks), err)
	}
	var bt Task
	for _, tk := range tasks {
		if tk.TaskKey == "b" {
			bt = tk
		}
	}
	if len(bt.Predecessors) != 1 || bt.Predecessors[0] != a.ID {
		t.Fatalf("predecessors did not round-trip: %v (want [%s])", bt.Predecessors, a.ID)
	}
	if bt.Params["site"] != "s1" || bt.Params["retries"] != float64(3) {
		t.Fatalf("params jsonb did not round-trip: %+v", bt.Params)
	}
	if locked, lerr := st.ListTasksForUpdate(ctx, conn, rb.ID); lerr != nil || len(locked) != 2 {
		t.Fatalf("ListTasksForUpdate = %d, err=%v", len(locked), lerr)
	}

	// ---- run + task-runs ---------------------------------------------------
	run := &Run{TenantID: tenant, RunbookID: rb.ID, Mode: RunModeLive, Status: RunStatusRunning, PlannedCriticalPathSeconds: 30}
	if err := st.CreateRun(ctx, conn, run); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}
	for _, tk := range tasks {
		if err := st.CreateTaskRun(ctx, conn, &TaskRun{TenantID: tenant, RunID: run.ID, TaskID: tk.ID, Status: TaskRunPending}); err != nil {
			t.Fatalf("CreateTaskRun %s: %v", tk.TaskKey, err)
		}
	}

	// SystemListActiveRuns / SystemGetPlan (the loop's cross-tenant reads).
	active, err := st.SystemListActiveRuns(ctx, conn)
	if err != nil || len(active) != 1 {
		t.Fatalf("SystemListActiveRuns = %d, err=%v", len(active), err)
	}
	plan, err := st.SystemGetPlan(ctx, conn, rb.ID)
	if err != nil || len(plan.Tasks) != 2 {
		t.Fatalf("SystemGetPlan = %d tasks, err=%v", len(plan.Tasks), err)
	}

	// Bulk transition pending -> runnable (the frontier mark), guarded by from-state.
	n, err := st.BulkSetTaskRunStatus(ctx, conn, run.ID, []string{a.ID}, TaskRunRunnable, []string{TaskRunPending})
	if err != nil || n != 1 {
		t.Fatalf("BulkSetTaskRunStatus = %d rows, err=%v", n, err)
	}
	// The from-state guard must not clobber a non-matching status.
	if n2, _ := st.BulkSetTaskRunStatus(ctx, conn, run.ID, []string{a.ID}, TaskRunRunnable, []string{TaskRunPending}); n2 != 0 {
		t.Fatalf("bulk set should be a no-op when no row is in the from-state, got %d", n2)
	}

	// Single task-run terminal transition with detail (jsonb) + duration.
	now := time.Now().UTC()
	dur := 7
	if err := st.UpdateTaskRunStatus(ctx, conn, run.ID, a.ID, TaskRunComplete, &tenant, &now, &now, &dur, map[string]any{"note": "done"}); err != nil {
		t.Fatalf("UpdateTaskRunStatus: %v", err)
	}
	trs, err := st.ListTaskRuns(ctx, conn, run.ID)
	if err != nil || len(trs) != 2 {
		t.Fatalf("ListTaskRuns = %d, err=%v", len(trs), err)
	}
	for _, tr := range trs {
		if tr.TaskID == a.ID {
			if tr.Status != TaskRunComplete || tr.ActualDurationSeconds == nil || *tr.ActualDurationSeconds != 7 {
				t.Fatalf("task-run a not updated correctly: %+v", tr)
			}
			if tr.Detail["note"] != "done" {
				t.Fatalf("detail jsonb did not round-trip: %+v", tr.Detail)
			}
		}
	}

	// Run terminal transition.
	if err := st.SetRunStatus(ctx, conn, run.ID, RunStatusCompleted, &now, &dur, nil); err != nil {
		t.Fatalf("SetRunStatus: %v", err)
	}
	if active2, _ := st.SystemListActiveRuns(ctx, conn); len(active2) != 0 {
		t.Fatalf("completed run should no longer be active, got %d", len(active2))
	}
}

// TestStore_Errors validates the sentinel-error mapping the router depends on.
func TestStore_Errors(t *testing.T) {
	ctx, conn := connectStore(t)
	st := NewStore()
	tenant := uuid.NewString()

	if _, err := st.GetRunbook(ctx, conn, uuid.NewString()); err == nil {
		t.Fatalf("GetRunbook of a missing id should error (ErrNotFound)")
	}
	rb := &Runbook{TenantID: tenant, Name: "dup-" + uuid.NewString()}
	if err := st.CreateRunbook(ctx, conn, rb); err != nil {
		t.Fatalf("CreateRunbook: %v", err)
	}
	dup := &Runbook{TenantID: tenant, Name: rb.Name}
	if err := st.CreateRunbook(ctx, conn, dup); err == nil {
		t.Fatalf("duplicate (tenant,name) runbook should violate the unique constraint")
	}
}
