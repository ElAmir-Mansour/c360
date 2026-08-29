//go:build integration

package migrate

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// statefulDRBridge is a FAITHFUL in-memory stand-in for the DR Runbook Studio
// engine for the Wave-3 execution tests. Unlike the minimal fakeDRBridge it
// tracks runbooks, their tasks (with the Required flag), live runs and per-task
// run state, and — crucially — recomputes the RUN STATUS the same way the real
// engine does (runbookstudio.Service.decideRunOutcome): the run becomes
// "completed" only once every REQUIRED task is complete, and "failed" when a
// required task fails. This lets the tests exercise the REAL validation gate and
// transition path (StartWindowRun → ActOnWindowTask → reconcileCutoverRunState)
// rather than a canned outcome. It is a test double for the cross-service
// boundary only; the migrate logic under test is the real code.
type statefulDRBridge struct {
	mu        sync.Mutex
	runbooks  map[uuid.UUID]*DRRunbook
	runs      map[uuid.UUID]*drRunRecord
	created   []CreateDRRunbookRequest
	startMode map[uuid.UUID]string
}

type drRunRecord struct {
	runID      uuid.UUID
	runbookID  uuid.UUID
	status     string
	taskStatus map[uuid.UUID]string // taskID -> per-task run status
	tasks      []DRTask
}

func newStatefulDRBridge() *statefulDRBridge {
	return &statefulDRBridge{
		runbooks:  map[uuid.UUID]*DRRunbook{},
		runs:      map[uuid.UUID]*drRunRecord{},
		startMode: map[uuid.UUID]string{},
	}
}

func (f *statefulDRBridge) CreateRunbook(ctx context.Context, tenantID uuid.UUID, in CreateDRRunbookRequest) (*DRRunbook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.created = append(f.created, in)
	id := uuid.New()
	rb := &DRRunbook{ID: id, Name: in.Name, Description: in.Description, Status: "draft", Source: "registry"}
	for _, st := range in.ImportSteps {
		rb.Tasks = append(rb.Tasks, DRTask{
			ID: uuid.New(), TaskKey: st.Key, Name: st.Name, TaskType: st.TaskType,
			Required: st.Required, PlannedDurationSeconds: st.PlannedDurationSeconds,
		})
	}
	f.runbooks[id] = rb
	return rb, nil
}

func (f *statefulDRBridge) GetRunbook(ctx context.Context, tenantID, runbookID uuid.UUID) (*DRRunbook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rb, ok := f.runbooks[runbookID]
	if !ok {
		return nil, ErrDRBridgeRejected
	}
	return rb, nil
}

func (f *statefulDRBridge) StartRun(ctx context.Context, tenantID, runbookID uuid.UUID, mode string) (*DRRunLiveState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rb, ok := f.runbooks[runbookID]
	if !ok {
		return nil, ErrDRBridgeRejected
	}
	runID := uuid.New()
	rec := &drRunRecord{
		runID:      runID,
		runbookID:  runbookID,
		status:     DRRunStatusRunning,
		taskStatus: map[uuid.UUID]string{},
		tasks:      append([]DRTask(nil), rb.Tasks...),
	}
	for _, t := range rb.Tasks {
		rec.taskStatus[t.ID] = "runnable"
	}
	f.runs[runID] = rec
	f.startMode[runID] = mode
	return f.liveLocked(rec), nil
}

func (f *statefulDRBridge) GetRun(ctx context.Context, tenantID, runID uuid.UUID) (*DRRunLiveState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.runs[runID]
	if !ok {
		return nil, ErrDRBridgeRejected
	}
	return f.liveLocked(rec), nil
}

func (f *statefulDRBridge) ActOnTask(ctx context.Context, tenantID, runID, taskID uuid.UUID, action DRTaskAction, note string, failRun bool) (*DRRunLiveState, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.runs[runID]
	if !ok {
		return nil, ErrDRBridgeRejected
	}
	if _, exists := rec.taskStatus[taskID]; !exists {
		return nil, ErrDRBridgeRejected
	}
	switch action {
	case DRActionComplete:
		rec.taskStatus[taskID] = DRTaskRunComplete
	case DRActionSkip:
		rec.taskStatus[taskID] = DRTaskRunSkipped
	case DRActionFail:
		rec.taskStatus[taskID] = DRTaskRunFailed
	}
	// Recompute run status exactly as the real engine: a required failure fails
	// the run; all-required-complete completes it; otherwise still running.
	f.recomputeLocked(rec, failRun && action == DRActionFail)
	return f.liveLocked(rec), nil
}

func (f *statefulDRBridge) GetTopology(ctx context.Context, tenantID, groupID uuid.UUID) (*DRTopology, error) {
	return &DRTopology{GroupID: groupID.String()}, nil
}

func (f *statefulDRBridge) recomputeLocked(rec *drRunRecord, explicitFailRun bool) {
	requiredFailed := false
	allRequiredDone := true
	sawRequired := false
	for _, t := range rec.tasks {
		st := rec.taskStatus[t.ID]
		if t.Required {
			sawRequired = true
			if st == DRTaskRunFailed {
				requiredFailed = true
			}
			if st != DRTaskRunComplete {
				allRequiredDone = false
			}
		}
	}
	switch {
	case requiredFailed || explicitFailRun:
		rec.status = DRRunStatusFailed
	case sawRequired && allRequiredDone:
		rec.status = DRRunStatusCompleted
	default:
		rec.status = DRRunStatusRunning
	}
}

func (f *statefulDRBridge) liveLocked(rec *drRunRecord) *DRRunLiveState {
	ls := &DRRunLiveState{
		RunID:     rec.runID,
		RunbookID: rec.runbookID,
		Status:    rec.status,
		Mode:      "live",
		Tasks:     append([]DRTask(nil), rec.tasks...),
	}
	for _, t := range rec.tasks {
		ls.TaskRuns = append(ls.TaskRuns, DRTaskRun{TaskID: t.ID.String(), Status: rec.taskStatus[t.ID]})
	}
	return ls
}

var _ DRBridge = (*statefulDRBridge)(nil)

// readyWaveForRun seeds a wave for cutover, drives workloads to planned, passes
// the readiness gate, records a GO decision, and generates the wave runbook, so a
// cutover DR run can be started. It returns the program/wave/window ids.
func readyWaveForRun(t *testing.T, ctx context.Context, svc *Service, tenantID uuid.UUID, actor Actor) (programID, waveID, windowID uuid.UUID) {
	t.Helper()
	programID, waveID, windowID = seedWaveForCutover(t, ctx, svc, tenantID, actor)

	// Drive workloads discovered -> planned via the real transition path.
	wls, _, err := svc.ListWorkloads(ctx, tenantID, programID, actor, "", nil, 100, 0)
	if err != nil {
		t.Fatalf("list workloads: %v", err)
	}
	for _, w := range wls {
		cur := w
		for _, to := range []WorkloadStatus{WorkloadAssessed, WorkloadPlanned} {
			updated, err := svc.TransitionWorkload(ctx, tenantID, cur.ID, to, cur.RowVersion, "prep", actor)
			if err != nil {
				t.Fatalf("transition %s -> %s: %v", cur.AppKey, to, err)
			}
			cur = *updated
		}
	}

	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckReadiness, actor)
	if _, err := svc.DecideGoNoGo(ctx, tenantID, DecisionInput{ID: windowID, Decision: DecisionGo, ExpectedVersion: 1, Actor: actor}); err != nil {
		t.Fatalf("go decision: %v", err)
	}
	if _, err := svc.GenerateWaveRunbook(ctx, tenantID, waveID, actor); err != nil {
		t.Fatalf("generate wave runbook: %v", err)
	}
	return programID, waveID, windowID
}

// TestIntegrationStartWindowRunPersistsDRRunID proves P7(1): StartWindowRun starts
// a DR run via the bridge and persists the returned run id into BOTH the window
// (dr_run_id) and the wave's parent binding — the dr_run_id stops being
// write-only. It also drives member workloads into cutover.
func TestIntegrationStartWindowRunPersistsDRRunID(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newStatefulDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	programID, waveID, windowID := readyWaveForRun(t, ctx, svc, tenantID, actor)

	out, err := svc.StartWindowRun(ctx, tenantID, windowID, "live", actor)
	if err != nil {
		t.Fatalf("start window run: %v", err)
	}
	if out.LiveState == nil || out.LiveState.RunID == uuid.Nil {
		t.Fatal("start run returned no live run id")
	}
	if out.Binding == nil || out.Binding.DRRunID == nil || *out.Binding.DRRunID != out.LiveState.RunID {
		t.Fatalf("binding dr_run_id = %v, want %s", out.Binding, out.LiveState.RunID)
	}
	if out.Binding.Status != BindingStatusRunning {
		t.Fatalf("binding status = %s, want running", out.Binding.Status)
	}

	// The window row now carries the dr_run_id (no longer write-only) + provenance.
	var drRun *uuid.UUID
	var startedBy *uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT dr_run_id, run_started_by FROM migrate_cutover_window WHERE tenant_id=$1 AND id=$2`,
		tenantID, windowID).Scan(&drRun, &startedBy); err != nil {
		t.Fatalf("read window dr_run_id: %v", err)
	}
	if drRun == nil || *drRun != out.LiveState.RunID {
		t.Fatalf("window dr_run_id = %v, want %s", drRun, out.LiveState.RunID)
	}
	if startedBy == nil || *startedBy != actor.UserID {
		t.Fatalf("window run_started_by = %v, want %s", startedBy, actor.UserID)
	}

	// Starting the run drove workloads into cutover and the wave to in_progress.
	for app, st := range workloadStatuses(t, ctx, svc, tenantID, programID, actor) {
		if st != WorkloadCutover {
			t.Fatalf("after start-run, workload %s = %s, want cutover", app, st)
		}
	}
	wave, _ := svc.GetWave(ctx, tenantID, waveID, actor)
	if wave.Status != WaveInProgress {
		t.Fatalf("wave status = %s, want in_progress", wave.Status)
	}
}

// TestIntegrationActOnTaskCompletesCutover proves P7(2),(3),(4): act-on-task
// proxies to the engine; the run state reflects real per-task progress; and only
// when the DR run actually COMPLETES (all required tasks complete) do the
// workloads transition to live and the wave complete. The gate is the engine's
// real state, not a canned string.
func TestIntegrationActOnTaskCompletesCutover(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newStatefulDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	programID, waveID, windowID := readyWaveForRun(t, ctx, svc, tenantID, actor)
	started, err := svc.StartWindowRun(ctx, tenantID, windowID, "live", actor)
	if err != nil {
		t.Fatalf("start window run: %v", err)
	}

	// The parent runbook here has one milestone task (the single move group). It is
	// required, so completing it completes the run. Gather the live tasks.
	live := started.LiveState
	if len(live.Tasks) == 0 {
		t.Fatal("started run has no tasks")
	}

	// Complete every task but the last; the run must still be RUNNING and the
	// workloads must NOT yet be live (the gate reflects real state).
	for i := 0; i < len(live.Tasks)-1; i++ {
		out, err := svc.ActOnWindowTask(ctx, tenantID, windowID, live.Tasks[i].ID, DRActionComplete, "", false, actor)
		if err != nil {
			t.Fatalf("act on task %d: %v", i, err)
		}
		if out.LiveState.Succeeded() {
			t.Fatalf("run completed early after task %d", i)
		}
	}
	mid := workloadStatuses(t, ctx, svc, tenantID, programID, actor)
	for app, st := range mid {
		if st == WorkloadLive {
			t.Fatalf("workload %s reached live before the run completed", app)
		}
	}

	// Complete the final task: the run completes and the gate fires.
	last := live.Tasks[len(live.Tasks)-1]
	final, err := svc.ActOnWindowTask(ctx, tenantID, windowID, last.ID, DRActionComplete, "done", false, actor)
	if err != nil {
		t.Fatalf("act on final task: %v", err)
	}
	if !final.LiveState.Succeeded() {
		t.Fatalf("run status = %s, want completed", final.LiveState.Status)
	}
	if final.Binding == nil || final.Binding.Status != BindingStatusCompleted {
		t.Fatalf("binding status = %v, want completed", final.Binding)
	}

	// On real cutover success the workloads are live and the wave is completed.
	for app, st := range workloadStatuses(t, ctx, svc, tenantID, programID, actor) {
		if st != WorkloadLive {
			t.Fatalf("after run completion, workload %s = %s, want live", app, st)
		}
	}
	wave, _ := svc.GetWave(ctx, tenantID, waveID, actor)
	if wave.Status != WaveCompleted {
		t.Fatalf("wave status = %s, want completed", wave.Status)
	}

	// GetWindowRun proxies GetRun and returns the live (completed) state.
	got, err := svc.GetWindowRun(ctx, tenantID, windowID, actor)
	if err != nil {
		t.Fatalf("get window run: %v", err)
	}
	if got.LiveState == nil || !got.LiveState.Succeeded() {
		t.Fatalf("GetWindowRun live state = %v, want completed", got.LiveState)
	}
}

// TestIntegrationStartWindowRunRequiresBridge proves the execution endpoints fail
// closed (not a stub) without a DR engine.
func TestIntegrationStartWindowRunRequiresBridge(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}) // no bridge
	tenantID := uuid.New()
	actor := fullActor()
	_, _, windowID := seedWaveForCutover(t, ctx, svc, tenantID, actor)
	if _, err := svc.StartWindowRun(ctx, tenantID, windowID, "live", actor); err == nil {
		t.Fatal("start-run without a DR bridge must fail closed")
	}
	if _, err := svc.ExecuteRollback(ctx, tenantID, windowID, "reason", "live", actor); err == nil {
		t.Fatal("execute-rollback without a DR bridge must fail closed")
	}
}

// TestIntegrationExecuteRollbackTransitionsToRolledBack proves P8(5),(6),(7):
// ExecuteRollback generates a rollback runbook, records trigger provenance
// (who + why), starts the rollback run, and on the run's success transitions the
// wave + workloads into the RolledBack states (previously unreachable).
func TestIntegrationExecuteRollbackTransitionsToRolledBack(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newStatefulDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	programID, waveID, windowID := readyWaveForRun(t, ctx, svc, tenantID, actor)
	// Start the forward cutover run so the wave is in_progress (a realistic state
	// to roll back from).
	if _, err := svc.StartWindowRun(ctx, tenantID, windowID, "live", actor); err != nil {
		t.Fatalf("start window run: %v", err)
	}

	// Execute the rollback: provenance is mandatory.
	if _, err := svc.ExecuteRollback(ctx, tenantID, windowID, "", "live", actor); err == nil {
		t.Fatal("rollback without a reason must be rejected (provenance required)")
	}
	run, err := svc.ExecuteRollback(ctx, tenantID, windowID, "data corruption detected", "live", actor)
	if err != nil {
		t.Fatalf("execute rollback: %v", err)
	}
	if run.TriggeredBy != actor.UserID || run.Reason != "data corruption detected" {
		t.Fatalf("rollback provenance = (%s, %q), want (%s, data corruption detected)", run.TriggeredBy, run.Reason, actor.UserID)
	}
	if run.DRRunID == uuid.Nil || run.DRRunbookID == uuid.Nil {
		t.Fatalf("rollback run missing dr ids: %+v", run)
	}
	if run.Status != RollbackRunRunning {
		t.Fatalf("rollback status = %s, want running", run.Status)
	}

	// A rollback (role=rollback) binding was generated for the window.
	var rollbackBindings int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM migrate_runbook_binding
WHERE tenant_id=$1 AND window_id=$2 AND role='rollback' AND status<>'superseded'`, tenantID, windowID).Scan(&rollbackBindings); err != nil {
		t.Fatalf("count rollback bindings: %v", err)
	}
	if rollbackBindings != 1 {
		t.Fatalf("active rollback bindings = %d, want 1", rollbackBindings)
	}

	// Drive the rollback DR run to completion via the engine (every required task).
	live, err := bridge.GetRun(ctx, tenantID, run.DRRunID)
	if err != nil {
		t.Fatalf("get rollback run state: %v", err)
	}
	for _, task := range live.Tasks {
		if _, err := bridge.ActOnTask(ctx, tenantID, run.DRRunID, task.ID, DRActionComplete, "", false); err != nil {
			t.Fatalf("complete rollback task: %v", err)
		}
	}
	post, _ := bridge.GetRun(ctx, tenantID, run.DRRunID)
	if !post.Succeeded() {
		t.Fatalf("rollback run did not complete: %s", post.Status)
	}

	// GetRollbackRun observes the completed run and applies the success transition.
	gotRun, gotLive, err := svc.GetRollbackRun(ctx, tenantID, windowID, actor)
	if err != nil {
		t.Fatalf("get rollback run: %v", err)
	}
	if gotLive == nil || !gotLive.Succeeded() {
		t.Fatalf("rollback live state = %v, want completed", gotLive)
	}
	if gotRun.Status != RollbackRunCompleted {
		t.Fatalf("rollback provenance status = %s, want completed", gotRun.Status)
	}

	// The wave and every workload are now in the rolled_back state — reachable
	// only through this real, success-gated rollback path.
	wave, _ := svc.GetWave(ctx, tenantID, waveID, actor)
	if wave.Status != WaveRolledBack {
		t.Fatalf("wave status = %s, want rolled_back", wave.Status)
	}
	for app, st := range workloadStatuses(t, ctx, svc, tenantID, programID, actor) {
		if st != WorkloadRolledBack {
			t.Fatalf("after rollback, workload %s = %s, want rolled_back", app, st)
		}
	}
}

// TestIntegrationExecuteRollbackRequiresApprovedPlan proves the rollback gate: an
// unapproved rollback plan blocks execution (no fake success).
func TestIntegrationExecuteRollbackRequiresApprovedPlan(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	bridge := newStatefulDRBridge()
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{}, WithDRBridge(bridge))
	tenantID := uuid.New()
	actor := fullActor()

	// Seed a program/wave/window WITHOUT approving the rollback plan.
	prog, err := svc.CreateProgram(ctx, tenantID, CreateProgramInput{Name: "P", Actor: actor})
	if err != nil {
		t.Fatalf("create program: %v", err)
	}
	if _, err := svc.UpsertWorkload(ctx, tenantID, prog.ID, WorkloadInput{AppKey: "api", Name: "API", Strategy: StrategyRehost, EstimatedEffortHours: 2}, actor); err != nil {
		t.Fatalf("upsert workload: %v", err)
	}
	mg, err := svc.CreateMoveGroup(ctx, tenantID, CreateMoveGroupInput{ProgramID: prog.ID, Name: "G", AppKeys: []string{"api"}, Actor: actor})
	if err != nil {
		t.Fatalf("create move group: %v", err)
	}
	checked, _ := svc.ValidateMoveGroupCompleteness(ctx, tenantID, mg.ID, actor, mg.RowVersion)
	submitted, _ := svc.SubmitMoveGroup(ctx, tenantID, mg.ID, actor, checked.RowVersion)
	if _, err := svc.DecideMoveGroup(ctx, tenantID, mg.ID, actor, true, "ok", submitted.RowVersion, false); err != nil {
		t.Fatalf("approve move group: %v", err)
	}
	wave, err := svc.CreateWave(ctx, tenantID, CreateWaveInput{ProgramID: prog.ID, Name: "W", Sequence: 1, MoveGroupIDs: []uuid.UUID{mg.ID}, PlannedDurationSeconds: 60, Actor: actor})
	if err != nil {
		t.Fatalf("create wave: %v", err)
	}
	window, _, err := svc.CreateWindow(ctx, tenantID, CreateWindowInput{ProgramID: prog.ID, WaveID: wave.ID, Name: "win", WindowType: WindowMaintenance,
		StartsAt: time.Now().Add(time.Hour), EndsAt: time.Now().Add(2 * time.Hour), Actor: actor})
	if err != nil {
		t.Fatalf("create window: %v", err)
	}
	if _, err := svc.UpsertRollbackPlan(ctx, tenantID, RollbackPlan{WindowID: window.ID, Strategy: "s", Procedures: "p", SuccessCriteria: "c"}, actor); err != nil {
		t.Fatalf("upsert rollback plan: %v", err)
	}
	// No DecideRollbackPlan -> plan is pending.
	if _, err := svc.ExecuteRollback(ctx, tenantID, window.ID, "reason", "live", actor); err == nil {
		t.Fatal("execute-rollback with an unapproved plan must be blocked")
	}
}
