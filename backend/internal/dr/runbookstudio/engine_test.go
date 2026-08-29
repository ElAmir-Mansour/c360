package runbookstudio

import (
	"reflect"
	"testing"
	"time"
)

// task is a test helper building a Task with an ID, planned duration, and
// predecessor IDs.
func task(id string, planned int, preds ...string) Task {
	return Task{
		ID:                     id,
		TaskType:               TaskTypeManual,
		Required:               true,
		PlannedDurationSeconds: planned,
		Predecessors:           preds,
	}
}

// diamondPlan is the canonical A->{B,C}->D fixture used by several tests.
//
//	  A
//	 / \
//	B   C
//	 \ /
//	  D
func diamondPlan() Plan {
	return Plan{
		Runbook: Runbook{ID: "rb"},
		Tasks: []Task{
			task("A", 10),
			task("B", 20, "A"),
			task("C", 30, "A"),
			task("D", 5, "B", "C"),
		},
	}
}

func TestValidate_AcyclicDiamond(t *testing.T) {
	if err := diamondPlan().Validate(); err != nil {
		t.Fatalf("diamond should be valid, got %v", err)
	}
}

func TestValidate_RejectsCycle(t *testing.T) {
	// A->B->C->A is a cycle.
	p := Plan{Tasks: []Task{
		task("A", 1, "C"),
		task("B", 1, "A"),
		task("C", 1, "B"),
	}}
	if err := p.Validate(); err != ErrCycle {
		t.Fatalf("expected ErrCycle, got %v", err)
	}
}

func TestValidate_RejectsSelfEdge(t *testing.T) {
	p := Plan{Tasks: []Task{task("A", 1, "A")}}
	if err := p.Validate(); err != ErrCycle {
		t.Fatalf("expected ErrCycle on self-edge, got %v", err)
	}
}

func TestValidate_RejectsUnknownPredecessor(t *testing.T) {
	p := Plan{Tasks: []Task{task("A", 1, "ghost")}}
	if err := p.Validate(); err != ErrUnknownPredecessor {
		t.Fatalf("expected ErrUnknownPredecessor, got %v", err)
	}
}

func TestValidate_RejectsLongCycle(t *testing.T) {
	// A long chain that loops back at the end: A->B->C->D->B.
	p := Plan{Tasks: []Task{
		task("A", 1),
		task("B", 1, "A", "D"),
		task("C", 1, "B"),
		task("D", 1, "C"),
	}}
	if err := p.Validate(); err != ErrCycle {
		t.Fatalf("expected ErrCycle on back-edge, got %v", err)
	}
}

func TestTopoOrder_DiamondRespectsDependencies(t *testing.T) {
	order, ok := diamondPlan().TopoOrder()
	if !ok {
		t.Fatalf("topo order should succeed on a DAG")
	}
	pos := map[string]int{}
	for i, id := range order {
		pos[id] = i
	}
	// A before B and C; B and C before D.
	if !(pos["A"] < pos["B"] && pos["A"] < pos["C"] && pos["B"] < pos["D"] && pos["C"] < pos["D"]) {
		t.Fatalf("topo order violates dependencies: %v", order)
	}
}

func TestTopoOrder_DetectsCycle(t *testing.T) {
	p := Plan{Tasks: []Task{task("A", 1, "B"), task("B", 1, "A")}}
	if _, ok := p.TopoOrder(); ok {
		t.Fatalf("topo order should fail on a cycle")
	}
}

func TestCriticalPath_KnownDurations(t *testing.T) {
	// Diamond durations A=10, B=20, C=30, D=5.
	// Path A->B->D = 10+20+5 = 35; A->C->D = 10+30+5 = 45. Critical = 45.
	cp := diamondPlan().CriticalPath()
	if cp.TotalSeconds != 45 {
		t.Fatalf("critical path total = %d, want 45", cp.TotalSeconds)
	}
	want := []string{"A", "C", "D"}
	if !reflect.DeepEqual(cp.Path, want) {
		t.Fatalf("critical path = %v, want %v", cp.Path, want)
	}
	// Earliest finishes: A=10, B=30, C=40, D=45.
	checks := map[string]int{"A": 10, "B": 30, "C": 40, "D": 45}
	for id, ef := range checks {
		if cp.EarliestFinish[id] != ef {
			t.Fatalf("earliest finish %s = %d, want %d", id, cp.EarliestFinish[id], ef)
		}
	}
}

func TestCriticalPath_LinearChain(t *testing.T) {
	// A(5)->B(7)->C(3) = 15.
	p := Plan{Tasks: []Task{task("A", 5), task("B", 7, "A"), task("C", 3, "B")}}
	cp := p.CriticalPath()
	if cp.TotalSeconds != 15 {
		t.Fatalf("linear critical path = %d, want 15", cp.TotalSeconds)
	}
	if !reflect.DeepEqual(cp.Path, []string{"A", "B", "C"}) {
		t.Fatalf("linear path = %v, want [A B C]", cp.Path)
	}
}

func TestCriticalPath_ParallelRoots(t *testing.T) {
	// Two independent roots converging: A(10)->C(1), B(40)->C(1). Critical=41 via B.
	p := Plan{Tasks: []Task{
		task("A", 10),
		task("B", 40),
		task("C", 1, "A", "B"),
	}}
	cp := p.CriticalPath()
	if cp.TotalSeconds != 41 {
		t.Fatalf("parallel-roots critical path = %d, want 41", cp.TotalSeconds)
	}
	if !reflect.DeepEqual(cp.Path, []string{"B", "C"}) {
		t.Fatalf("parallel-roots path = %v, want [B C]", cp.Path)
	}
}

func TestFrontier_DiamondProgression(t *testing.T) {
	plan := diamondPlan()

	// Initially: only A (no predecessors) is runnable.
	rs := NewRunState(plan, nil)
	if got := rs.Frontier(); !reflect.DeepEqual(got, []string{"A"}) {
		t.Fatalf("initial frontier = %v, want [A]", got)
	}

	// After A completes: B and C become runnable, D still blocked.
	rs = NewRunState(plan, map[string]string{"A": TaskRunComplete})
	if got := rs.Frontier(); !reflect.DeepEqual(got, []string{"B", "C"}) {
		t.Fatalf("frontier after A = %v, want [B C]", got)
	}

	// After only B completes: C runnable, D still blocked (needs C too).
	rs = NewRunState(plan, map[string]string{"A": TaskRunComplete, "B": TaskRunComplete})
	if got := rs.Frontier(); !reflect.DeepEqual(got, []string{"C"}) {
		t.Fatalf("frontier after A,B = %v, want [C]", got)
	}

	// After both B and C complete: D becomes runnable.
	rs = NewRunState(plan, map[string]string{"A": TaskRunComplete, "B": TaskRunComplete, "C": TaskRunComplete})
	if got := rs.Frontier(); !reflect.DeepEqual(got, []string{"D"}) {
		t.Fatalf("frontier after A,B,C = %v, want [D]", got)
	}

	// After D completes: empty frontier, all required done.
	rs = NewRunState(plan, map[string]string{"A": TaskRunComplete, "B": TaskRunComplete, "C": TaskRunComplete, "D": TaskRunComplete})
	if got := rs.Frontier(); len(got) != 0 {
		t.Fatalf("frontier after all = %v, want empty", got)
	}
	if !rs.AllRequiredDone() {
		t.Fatalf("all required should be done")
	}
}

func TestFrontier_SkipIsCompleteEquivalent(t *testing.T) {
	plan := diamondPlan()
	// Skipping A still unblocks B and C (skip is complete-equivalent for readiness).
	rs := NewRunState(plan, map[string]string{"A": TaskRunSkipped})
	if got := rs.Frontier(); !reflect.DeepEqual(got, []string{"B", "C"}) {
		t.Fatalf("frontier after A skipped = %v, want [B C]", got)
	}
	// But a skipped required A means the run is not "all required done".
	rs = NewRunState(plan, map[string]string{
		"A": TaskRunSkipped, "B": TaskRunComplete, "C": TaskRunComplete, "D": TaskRunComplete,
	})
	if rs.AllRequiredDone() {
		t.Fatalf("a skipped REQUIRED task must not satisfy AllRequiredDone")
	}
}

func TestFrontier_FailedPredecessorBlocksDownstream(t *testing.T) {
	plan := diamondPlan()
	// A failed: B and C are blocked (a failed predecessor), not runnable.
	rs := NewRunState(plan, map[string]string{"A": TaskRunFailed})
	if got := rs.Frontier(); len(got) != 0 {
		t.Fatalf("frontier after A failed = %v, want empty (downstream blocked)", got)
	}
	blocked := rs.Blocked()
	wantBlocked := []string{"B", "C", "D"} // B,C directly; D transitively
	if !reflect.DeepEqual(blocked, wantBlocked) {
		t.Fatalf("blocked after A failed = %v, want %v", blocked, wantBlocked)
	}
	if !rs.HasFailedRequired() {
		t.Fatalf("a failed required task should report HasFailedRequired")
	}
	if !rs.Stalled() {
		t.Fatalf("run with failed root and no frontier should be Stalled")
	}
}

func TestStalled_FalseWhileWorkInFlight(t *testing.T) {
	plan := diamondPlan()
	// A is running: not stalled even though frontier is empty.
	rs := NewRunState(plan, map[string]string{"A": TaskRunRunning})
	if rs.Stalled() {
		t.Fatalf("run should not be stalled while a task is running")
	}
}

func TestProjection_OnTrackAndVariance(t *testing.T) {
	plan := diamondPlan() // planned critical path = 45
	start := time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC)

	// Nothing done, 0 elapsed: remaining = full critical path 45, projected 45, on track.
	rs := NewRunState(plan, nil)
	proj := rs.Projection(start, start, 45)
	if proj.RemainingCriticalPathSeconds != 45 {
		t.Fatalf("remaining at start = %d, want 45", proj.RemainingCriticalPathSeconds)
	}
	if proj.ProjectedFinishSeconds != 45 || !proj.OnTrack || proj.VarianceSeconds != 0 {
		t.Fatalf("projection at start = %+v, want projected 45 on-track", proj)
	}

	// A done, 5s elapsed (A took 5 vs planned 10 — ahead). Remaining critical path
	// over {B,C,D} = max(B+D=25, C+D=35) = 35. Projected = 5 + 35 = 40 <= 45 => on track.
	rs = NewRunState(plan, map[string]string{"A": TaskRunComplete})
	now := start.Add(5 * time.Second)
	proj = rs.Projection(start, now, 45)
	if proj.RemainingCriticalPathSeconds != 35 {
		t.Fatalf("remaining after A = %d, want 35", proj.RemainingCriticalPathSeconds)
	}
	if proj.ProjectedFinishSeconds != 40 || !proj.OnTrack {
		t.Fatalf("projection after A (5s) = %+v, want projected 40 on-track", proj)
	}
	if proj.CompletedTasks != 1 || proj.TotalTasks != 4 {
		t.Fatalf("progress = %d/%d, want 1/4", proj.CompletedTasks, proj.TotalTasks)
	}

	// A done but 20s elapsed (slow): projected = 20 + 35 = 55 > 45 => behind, variance +10.
	now = start.Add(20 * time.Second)
	proj = rs.Projection(start, now, 45)
	if proj.OnTrack {
		t.Fatalf("projection should be behind schedule at 20s elapsed")
	}
	if proj.VarianceSeconds != 10 {
		t.Fatalf("variance = %d, want +10", proj.VarianceSeconds)
	}
}

func TestProjection_AllDoneRemainingZero(t *testing.T) {
	plan := diamondPlan()
	start := time.Now().UTC()
	rs := NewRunState(plan, map[string]string{
		"A": TaskRunComplete, "B": TaskRunComplete, "C": TaskRunComplete, "D": TaskRunComplete,
	})
	proj := rs.Projection(start, start.Add(40*time.Second), 45)
	if proj.RemainingCriticalPathSeconds != 0 {
		t.Fatalf("remaining when all done = %d, want 0", proj.RemainingCriticalPathSeconds)
	}
}

func TestApprovalGateBlocksDownstreamUntilApproved(t *testing.T) {
	// boot depends on an approval gate. Until the gate completes, boot is blocked.
	plan := Plan{Tasks: []Task{
		{ID: "pin", TaskType: TaskTypeManual, Required: true, PlannedDurationSeconds: 1},
		{ID: "gate", TaskType: TaskTypeApprovalGate, Required: true, PlannedDurationSeconds: 0, Predecessors: []string{"pin"}},
		{ID: "boot", TaskType: TaskTypeManual, Required: true, PlannedDurationSeconds: 10, Predecessors: []string{"gate"}},
	}}

	// pin complete: gate is runnable, boot still blocked behind the gate.
	rs := NewRunState(plan, map[string]string{"pin": TaskRunComplete})
	if got := rs.Frontier(); !reflect.DeepEqual(got, []string{"gate"}) {
		t.Fatalf("frontier with pin done = %v, want [gate]", got)
	}

	// gate NOT yet approved (still runnable, not complete): boot must NOT be runnable.
	rs = NewRunState(plan, map[string]string{"pin": TaskRunComplete, "gate": TaskRunRunnable})
	if onFrontier(rs.Frontier(), "boot") {
		t.Fatalf("boot must be blocked while approval gate is unapproved; frontier=%v", rs.Frontier())
	}

	// gate approved (complete): boot becomes runnable.
	rs = NewRunState(plan, map[string]string{"pin": TaskRunComplete, "gate": TaskRunComplete})
	if got := rs.Frontier(); !reflect.DeepEqual(got, []string{"boot"}) {
		t.Fatalf("frontier after gate approved = %v, want [boot]", got)
	}
}

func TestAllRequiredDone_IgnoresOptionalTasks(t *testing.T) {
	// An optional comms task that is not complete must not block run completion.
	plan := Plan{Tasks: []Task{
		{ID: "core", TaskType: TaskTypeManual, Required: true, PlannedDurationSeconds: 1},
		{ID: "notify", TaskType: TaskTypeComms, Required: false, PlannedDurationSeconds: 1, Predecessors: []string{"core"}},
	}}
	rs := NewRunState(plan, map[string]string{"core": TaskRunComplete})
	if !rs.AllRequiredDone() {
		t.Fatalf("optional notify should not block completion when required core is done")
	}
}
