package migrate

import (
	"testing"

	"github.com/google/uuid"
)

// findNode / findEdge locate a node/edge by id in the built graph.
func findNode(g DependencyGraph, id string) (DepGraphNode, bool) {
	for _, n := range g.Nodes {
		if n.ID == id {
			return n, true
		}
	}
	return DepGraphNode{}, false
}

func hasEdge(g DependencyGraph, source, target string, typ DepGraphEdgeType) bool {
	for _, e := range g.Edges {
		if e.Source == source && e.Target == target && e.Type == typ {
			return true
		}
	}
	return false
}

// indexOf returns the position of id in the topo order, or -1.
func indexOf(order []string, id string) int {
	for i, v := range order {
		if v == id {
			return i
		}
	}
	return -1
}

// TestBuildWaveDependencyGraph_NodesEdgesAndOrder proves the graph carries a node
// per move group + workload (with their real status), the three native edge kinds
// (contains, dependency, sequence), and a topo order that respects BOTH the hard
// workload dependency and the move-group sequence.
func TestBuildWaveDependencyGraph_NodesEdgesAndOrder(t *testing.T) {
	// Group A (seq 1): web. Group B (seq 2): api, db where db hard-depends on api.
	web := mkWorkload("web", "Web", StrategyRehost, 4)
	web.Status = WorkloadPlanned
	api := mkWorkload("api", "API", StrategyReplatform, 6)
	api.Status = WorkloadInMigration
	db := mkWorkload("db", "DB", StrategyRehost, 5, WorkloadDependency{AppKey: "api", Criticality: "hard"})
	db.Status = WorkloadDiscovered

	groupA := mkGroup("MG-A", "Edge", 1, web)
	groupA.Status = MoveGroupApproved
	groupB := mkGroup("MG-B", "Core", 2, api, db)
	groupB.Status = MoveGroupApproved

	wave := Wave{ID: uuid.New(), Reference: "WAV-2026-0001", MoveGroups: []MoveGroup{groupB, groupA}} // deliberately out of order
	g := buildWaveDependencyGraph(wave, nil)

	if g.HasCycle {
		t.Fatal("acyclic wave must not report a cycle")
	}

	// A node exists for each move group and each workload, carrying live status.
	if n, ok := findNode(g, mgNodeID(groupA.ID)); !ok || n.Type != NodeTypeMoveGroup || n.Status != string(MoveGroupApproved) {
		t.Fatalf("move-group A node missing/wrong: %#v ok=%v", n, ok)
	}
	if n, ok := findNode(g, wlNodeID("db")); !ok || n.Type != NodeTypeWorkload || n.Status != string(WorkloadDiscovered) {
		t.Fatalf("workload db node missing/wrong: %#v ok=%v", n, ok)
	}
	if n, ok := findNode(g, wlNodeID("api")); !ok || n.Status != string(WorkloadInMigration) || n.DurationSeconds != 6*3600 {
		t.Fatalf("workload api node missing/wrong (want in_migration, 6h): %#v ok=%v", n, ok)
	}

	// Contains edges group -> workload.
	if !hasEdge(g, mgNodeID(groupB.ID), wlNodeID("api"), EdgeTypeContains) {
		t.Fatal("missing contains edge MG-B -> api")
	}
	// Hard dependency edge api -> db (dependency runs first).
	if !hasEdge(g, wlNodeID("api"), wlNodeID("db"), EdgeTypeDependency) {
		t.Fatal("missing dependency edge api -> db")
	}
	// Move-group sequence edge A -> B (seq 1 before seq 2).
	if !hasEdge(g, mgNodeID(groupA.ID), mgNodeID(groupB.ID), EdgeTypeSequence) {
		t.Fatal("missing sequence edge MG-A -> MG-B")
	}

	// Topo order must place the dependency before the dependent, and group A's
	// workload before group B's workloads (via the sequence chain).
	order := g.TopoOrder
	if indexOf(order, wlNodeID("api")) >= indexOf(order, wlNodeID("db")) {
		t.Fatalf("topo order must place api before db: %v", order)
	}
	if indexOf(order, mgNodeID(groupA.ID)) >= indexOf(order, mgNodeID(groupB.ID)) {
		t.Fatalf("topo order must place MG-A before MG-B: %v", order)
	}
	if indexOf(order, wlNodeID("web")) >= indexOf(order, wlNodeID("api")) {
		t.Fatalf("group sequencing: web (group A) must precede api (group B): %v", order)
	}
}

// TestBuildWaveDependencyGraph_SoftDependencyExcluded proves a SOFT dependency does
// not create a hard dependency edge (it must not constrain the ordering), matching
// the critical-path / runbook edge semantics.
func TestBuildWaveDependencyGraph_SoftDependencyExcluded(t *testing.T) {
	a := mkWorkload("a", "A", StrategyRehost, 1)
	b := mkWorkload("b", "B", StrategyRehost, 1, WorkloadDependency{AppKey: "a", Criticality: "soft"})
	wave := Wave{ID: uuid.New(), Reference: "WAV-S", MoveGroups: []MoveGroup{mkGroup("MG", "G", 1, a, b)}}
	g := buildWaveDependencyGraph(wave, nil)
	if hasEdge(g, wlNodeID("a"), wlNodeID("b"), EdgeTypeDependency) {
		t.Fatal("soft dependency must NOT produce a hard dependency edge")
	}
}

// TestBuildWaveDependencyGraph_UnknownDependencyNoDanglingEdge proves a dependency
// on an app key that is not present in the wave does not create a dangling edge to
// a non-existent node.
func TestBuildWaveDependencyGraph_UnknownDependencyNoDanglingEdge(t *testing.T) {
	a := mkWorkload("a", "A", StrategyRehost, 1, WorkloadDependency{AppKey: "ghost", Criticality: "hard"})
	wave := Wave{ID: uuid.New(), Reference: "WAV-U", MoveGroups: []MoveGroup{mkGroup("MG", "G", 1, a)}}
	g := buildWaveDependencyGraph(wave, nil)
	if _, ok := findNode(g, wlNodeID("ghost")); ok {
		t.Fatal("unknown dependency app key must not create a node")
	}
	if hasEdge(g, wlNodeID("ghost"), wlNodeID("a"), EdgeTypeDependency) {
		t.Fatal("unknown dependency must not create a dangling edge")
	}
}

// TestBuildWaveDependencyGraph_CycleFlagged proves an illegal dependency cycle is
// flagged (not looping forever) while still returning the nodes for rendering.
func TestBuildWaveDependencyGraph_CycleFlagged(t *testing.T) {
	a := mkWorkload("a", "A", StrategyRehost, 1, WorkloadDependency{AppKey: "b", Criticality: "hard"})
	b := mkWorkload("b", "B", StrategyRehost, 1, WorkloadDependency{AppKey: "a", Criticality: "hard"})
	wave := Wave{ID: uuid.New(), Reference: "WAV-C", MoveGroups: []MoveGroup{mkGroup("MG", "G", 1, a, b)}}
	g := buildWaveDependencyGraph(wave, nil)
	if !g.HasCycle {
		t.Fatal("cyclic dependency graph must be flagged HasCycle=true")
	}
	if len(g.Nodes) == 0 {
		t.Fatal("cyclic graph must still return nodes for rendering")
	}
}

// TestBuildWaveDependencyGraph_DRTopologyOverlay proves that when a move group is
// bound to a DR consistency group, the DR topology nodes/edges (proxied from the
// Wave-2 bridge) are overlaid as dr_site nodes + replication edges, REUSING the
// DRTopology projection rather than re-deriving a graph.
func TestBuildWaveDependencyGraph_DRTopologyOverlay(t *testing.T) {
	drGroup := uuid.New()
	group := mkGroup("MG-A", "Core", 1, mkWorkload("api", "API", StrategyRehost, 2))
	group.DRTopologyGroupID = &drGroup
	wave := Wave{ID: uuid.New(), Reference: "WAV-DR", MoveGroups: []MoveGroup{group}}

	topo := &DRTopology{
		GroupID: drGroup.String(),
		Nodes: []DRNode{
			{ID: "site-primary", SiteID: "riyadh", Role: "source"},
			{ID: "site-dr", SiteID: "jeddah", Role: "target"},
		},
		Edges: []DREdge{
			{ID: "e1", FromNodeID: "site-primary", ToNodeID: "site-dr", Mode: "async", Health: "healthy"},
		},
	}
	g := buildWaveDependencyGraph(wave, map[uuid.UUID]*DRTopology{group.ID: topo})

	primary := drNodeID(drGroup, "site-primary")
	drStandby := drNodeID(drGroup, "site-dr")
	if n, ok := findNode(g, primary); !ok || n.Type != NodeTypeDRSite || n.Role != "source" {
		t.Fatalf("dr_site primary node missing/wrong: %#v ok=%v", n, ok)
	}
	if !hasEdge(g, primary, drStandby, EdgeTypeReplication) {
		t.Fatal("missing replication edge site-primary -> site-dr")
	}
	// The replication edge carries the health rolled up by the DR topology.
	found := false
	for _, e := range g.Edges {
		if e.Type == EdgeTypeReplication && e.Health == "healthy" && e.Label == "async" {
			found = true
		}
	}
	if !found {
		t.Fatal("replication edge must carry the DR topology health + mode")
	}
}

// TestWaveCompletionPercent proves the %complete rollup is derived from the real
// wave lifecycle status (monotonic through the happy path, 0 for terminal-failed).
func TestWaveCompletionPercent(t *testing.T) {
	if waveCompletionPercent(WavePlanned) != 0 {
		t.Fatal("planned wave must be 0%")
	}
	if waveCompletionPercent(WaveInProgress) <= waveCompletionPercent(WaveReady) {
		t.Fatal("in_progress must be further along than ready")
	}
	if waveCompletionPercent(WaveCutover) <= waveCompletionPercent(WaveInProgress) {
		t.Fatal("cutover must be further along than in_progress")
	}
	if waveCompletionPercent(WaveCompleted) != 100 {
		t.Fatal("completed wave must be 100%")
	}
	if waveCompletionPercent(WaveRolledBack) != 0 {
		t.Fatal("rolled-back wave must be 0%")
	}
}
