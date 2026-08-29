package migrate

import "testing"

func TestWorkloadTransitions(t *testing.T) {
	for from, allowed := range WorkloadTransitionTable {
		for _, to := range allowed {
			if err := ValidateWorkloadTransition(from, to); err != nil {
				t.Fatalf("%s -> %s should be allowed: %v", from, to, err)
			}
		}
	}
	if err := ValidateWorkloadTransition(WorkloadDiscovered, WorkloadLive); err == nil {
		t.Fatal("discovered -> live should be rejected")
	}
	if err := ValidateWorkloadTransition(WorkloadLive, WorkloadPlanned); err == nil {
		t.Fatal("live -> planned should be rejected")
	}
}

func TestWaveTransitions(t *testing.T) {
	for from, allowed := range WaveTransitionTable {
		for _, to := range allowed {
			if err := ValidateWaveTransition(from, to); err != nil {
				t.Fatalf("%s -> %s should be allowed: %v", from, to, err)
			}
		}
	}
	if err := ValidateWaveTransition(WavePlanned, WaveCompleted); err == nil {
		t.Fatal("planned -> completed should be rejected")
	}
	if err := ValidateWaveTransition(WaveCompleted, WaveInProgress); err == nil {
		t.Fatal("completed -> in_progress should be rejected")
	}
}

func TestRequiredChecksBlock(t *testing.T) {
	if !requiredChecksBlock(nil) {
		t.Fatal("missing required checks must block")
	}
	if requiredChecksBlock([]GateCheck{{Required: true, Status: CheckPassed}}) {
		t.Fatal("passed required check should not block")
	}
	if requiredChecksBlock([]GateCheck{{Required: true, Status: CheckOverridden}}) {
		t.Fatal("overridden required check should not block")
	}
	if !requiredChecksBlock([]GateCheck{{Required: true, Status: CheckFailed}}) {
		t.Fatal("failed required check should block")
	}
}

// wl is a small builder for test workloads with an explicit effort estimate so
// durations are deterministic (estimated_effort path: hours*3600 seconds).
func wl(appKey string, effortHours float64, deps ...string) Workload {
	w := Workload{AppKey: appKey, Name: appKey, Strategy: StrategyRehost, EstimatedEffortHours: effortHours}
	for _, d := range deps {
		w.Dependencies = append(w.Dependencies, WorkloadDependency{AppKey: d, Criticality: "hard"})
	}
	return w
}

func TestComputeWaveCriticalPath_DependencyChainDrivesLongestPath(t *testing.T) {
	// a (1h) -> b (2h) -> c (3h) is a hard chain = 6h. d (5h) is independent.
	// Longest path = a->b->c = 6h = 21600s, NOT d's 5h and NOT a sum of all.
	wave := Wave{
		Reference: "WAV-2026-0001",
		MoveGroups: []MoveGroup{{
			Reference: "MG-1",
			Workloads: []Workload{
				wl("a", 1),
				wl("b", 2, "a"),
				wl("c", 3, "b"),
				wl("d", 5),
			},
		}},
	}
	cp := computeWaveCriticalPath(wave)
	if cp.TotalSeconds != 6*3600 {
		t.Fatalf("total = %d, want %d (a->b->c longest path)", cp.TotalSeconds, 6*3600)
	}
	if cp.Method != "estimated_effort" {
		t.Fatalf("method = %q, want estimated_effort", cp.Method)
	}
	// The critical path must respect dependency ordering: a before b before c.
	gotOrder := criticalAppKeys(cp)
	want := []string{"a", "b", "c"}
	if !equalStrings(gotOrder, want) {
		t.Fatalf("critical app-key order = %v, want %v", gotOrder, want)
	}
	// Offsets must be cumulative and increasing along the path.
	for i := 1; i < len(cp.Nodes); i++ {
		if cp.Nodes[i].OffsetSeconds <= cp.Nodes[i-1].OffsetSeconds {
			t.Fatalf("node offsets not strictly increasing: %#v", cp.Nodes)
		}
	}
}

func TestComputeWaveCriticalPath_DifferentGraphsDifferentPaths(t *testing.T) {
	// Graph A: a parallel pair, longest = max(2h, 3h) = 3h.
	graphA := Wave{MoveGroups: []MoveGroup{{Reference: "MG-A", Workloads: []Workload{
		wl("a", 2), wl("b", 3),
	}}}}
	// Graph B: same two nodes but now b depends on a -> serial 2h+3h = 5h.
	graphB := Wave{MoveGroups: []MoveGroup{{Reference: "MG-B", Workloads: []Workload{
		wl("a", 2), wl("b", 3, "a"),
	}}}}
	cpA := computeWaveCriticalPath(graphA)
	cpB := computeWaveCriticalPath(graphB)
	if cpA.TotalSeconds != 3*3600 {
		t.Fatalf("graphA total = %d, want %d", cpA.TotalSeconds, 3*3600)
	}
	if cpB.TotalSeconds != 5*3600 {
		t.Fatalf("graphB total = %d, want %d", cpB.TotalSeconds, 5*3600)
	}
	if cpA.TotalSeconds == cpB.TotalSeconds {
		t.Fatal("different dependency graphs must yield different critical paths")
	}
}

func TestComputeWaveCriticalPath_MoveGroupSequencingIsSerial(t *testing.T) {
	// Two groups with no intra-group deps. Group sequencing makes group 2 wait
	// for group 1, so the longest path crosses the group boundary.
	// Group 1: a(2h) + b(1h) ; Group 2: c(4h). a->c serial = 2h+4h = 6h.
	wave := Wave{
		MoveGroups: []MoveGroup{
			{Reference: "MG-1", WaveSequence: 1, Workloads: []Workload{wl("a", 2), wl("b", 1)}},
			{Reference: "MG-2", WaveSequence: 2, Workloads: []Workload{wl("c", 4)}},
		},
	}
	cp := computeWaveCriticalPath(wave)
	// c must wait for the longest group-1 workload (a=2h) before its own 4h.
	if cp.TotalSeconds != 6*3600 {
		t.Fatalf("total = %d, want %d (group sequencing serial)", cp.TotalSeconds, 6*3600)
	}
	order := criticalAppKeys(cp)
	if len(order) == 0 || order[len(order)-1] != "c" {
		t.Fatalf("critical path must end at group-2 workload c, got %v", order)
	}
}

func TestComputeWaveCriticalPath_DerivedDurationFromStrategyTierReadiness(t *testing.T) {
	// No effort estimates: duration is derived from strategy/tier/readiness.
	// A fully-ready rehost (no remediation, default tier) = base 4h.
	rehost := Workload{AppKey: "x", Strategy: StrategyRehost, ReadinessScore: 100}
	// A refactor at 0 readiness, tier-0: (24 base + 24 remediation) * 2.0 = 96h.
	refactor := Workload{AppKey: "y", Strategy: StrategyRefactor, ReadinessScore: 0, Tier: "tier-0"}
	dr, srcR := workloadDurationSeconds(rehost)
	df, srcF := workloadDurationSeconds(refactor)
	if dr != 4*3600 {
		t.Fatalf("rehost derived duration = %d, want %d", dr, 4*3600)
	}
	if df != 96*3600 {
		t.Fatalf("refactor derived duration = %d, want %d", df, 96*3600)
	}
	if srcR != "derived" || srcF != "derived" {
		t.Fatalf("derived sources = %q,%q want derived", srcR, srcF)
	}
	// And the refactor must dominate the critical path of a wave containing both.
	wave := Wave{MoveGroups: []MoveGroup{{Reference: "MG", Workloads: []Workload{rehost, refactor}}}}
	cp := computeWaveCriticalPath(wave)
	if cp.TotalSeconds != 96*3600 {
		t.Fatalf("wave total = %d, want %d", cp.TotalSeconds, 96*3600)
	}
	if cp.Method != "derived" {
		t.Fatalf("method = %q, want derived", cp.Method)
	}
}

func TestComputeWaveCriticalPath_MethodMixed(t *testing.T) {
	wave := Wave{MoveGroups: []MoveGroup{{Reference: "MG", Workloads: []Workload{
		wl("a", 3), // estimated effort
		{AppKey: "b", Strategy: StrategyRehost, ReadinessScore: 100}, // derived
	}}}}
	cp := computeWaveCriticalPath(wave)
	if cp.Method != "mixed" {
		t.Fatalf("method = %q, want mixed", cp.Method)
	}
}

func TestComputeWaveCriticalPath_PlannedDurationFloor(t *testing.T) {
	// When the DAG total is small but the operator set a larger planned
	// duration on the wave, the planned duration is the honest floor.
	wave := Wave{PlannedDurationSeconds: 100 * 3600, MoveGroups: []MoveGroup{{
		Reference: "MG", Workloads: []Workload{wl("a", 1)},
	}}}
	cp := computeWaveCriticalPath(wave)
	if cp.TotalSeconds != 100*3600 {
		t.Fatalf("total = %d, want planned floor %d", cp.TotalSeconds, 100*3600)
	}
}

func TestComputeWaveCriticalPath_CycleSafe(t *testing.T) {
	// a depends on b and b depends on a (illegal cycle). The computation must
	// terminate and not inflate the path beyond the two node durations.
	wave := Wave{MoveGroups: []MoveGroup{{Reference: "MG", Workloads: []Workload{
		wl("a", 2, "b"),
		wl("b", 3, "a"),
	}}}}
	cp := computeWaveCriticalPath(wave)
	if cp.TotalSeconds <= 0 || cp.TotalSeconds > 5*3600 {
		t.Fatalf("cyclic graph total = %d, want a finite value <= %d", cp.TotalSeconds, 5*3600)
	}
}

func TestNextHopToward(t *testing.T) {
	cases := []struct {
		from, target, wantFirst WorkloadStatus
		ok                      bool
	}{
		{WorkloadPlanned, WorkloadCutover, WorkloadInMigration, true},
		{WorkloadInMigration, WorkloadLive, WorkloadCutover, true},
		{WorkloadCutover, WorkloadLive, WorkloadValidated, true},
		{WorkloadDiscovered, WorkloadLive, WorkloadAssessed, true},
		{WorkloadPlanned, WorkloadRolledBack, WorkloadRolledBack, true},
		{WorkloadDecommissioned, WorkloadLive, "", false}, // terminal, no path
		{WorkloadLive, WorkloadLive, WorkloadLive, true},  // already there
	}
	for _, c := range cases {
		got, ok := nextHopToward(c.from, c.target)
		if ok != c.ok || got != c.wantFirst {
			t.Fatalf("nextHopToward(%s,%s) = (%s,%v), want (%s,%v)", c.from, c.target, got, ok, c.wantFirst, c.ok)
		}
	}
}

func criticalAppKeys(cp CriticalPath) []string {
	out := make([]string, 0, len(cp.Nodes))
	for _, n := range cp.Nodes {
		out = append(out, n.AppKey)
	}
	return out
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
