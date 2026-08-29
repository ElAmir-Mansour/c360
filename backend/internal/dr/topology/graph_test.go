package topology

import (
	"sort"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Deterministic graph fixtures: a fan-out (1 source -> 3 targets) and a cascade
// (A -> B -> C). The graph algorithms are tested directly against these, with no
// database (the prompt's requirement).
// ---------------------------------------------------------------------------

func node(id, role string) Node {
	return Node{ID: id, SiteID: "site-" + id, SiteName: "site-" + id, Role: role}
}

func edge(id, from, to, stream string, priority int) Edge {
	return Edge{ID: id, FromNodeID: from, ToNodeID: to, StreamID: stream, Mode: ModeAsync, Priority: priority, Health: HealthUnknown}
}

func withHealth(e Edge, health string, lag int64, appliedSeq int64) Edge {
	e.Health = health
	l := lag
	e.LagSeconds = &l
	e.AppliedSeq = appliedSeq
	return e
}

// fanOut: source S replicates to T1, T2, T3 directly (1-to-many).
func fanOut() Topology {
	return Topology{
		GroupID: "g-fanout",
		Nodes: []Node{
			node("S", RoleSource),
			node("T1", RoleTarget),
			node("T2", RoleTarget),
			node("T3", RoleTarget),
		},
		Edges: []Edge{
			edge("e-s-t1", "S", "T1", "stream-1", 10),
			edge("e-s-t2", "S", "T2", "stream-2", 20),
			edge("e-s-t3", "S", "T3", "stream-3", 30),
		},
	}
}

// cascade: A -> B -> C (B is a relay: a target of A and the source of C).
func cascade() Topology {
	return Topology{
		GroupID: "g-cascade",
		Nodes: []Node{
			node("A", RoleSource),
			node("B", RoleRelay),
			node("C", RoleTarget),
		},
		Edges: []Edge{
			edge("e-a-b", "A", "B", "stream-ab", 10),
			edge("e-b-c", "B", "C", "stream-bc", 20),
		},
	}
}

func nodeIDs(nodes []Node) []string {
	out := make([]string, len(nodes))
	for i, n := range nodes {
		out[i] = n.ID
	}
	sort.Strings(out)
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

// ---------------------------------------------------------------------------
// ReachableTargets
// ---------------------------------------------------------------------------

func TestReachableTargets(t *testing.T) {
	tests := []struct {
		name   string
		topo   Topology
		source string
		want   []string
	}{
		{"fan-out from source", fanOut(), "S", []string{"T1", "T2", "T3"}},
		{"cascade from A reaches B and C", cascade(), "A", []string{"B", "C"}},
		{"cascade from B reaches only C", cascade(), "B", []string{"C"}},
		{"cascade from C reaches nothing", cascade(), "C", nil},
		{"fan-out from a leaf reaches nothing", fanOut(), "T1", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := NewGraph(tt.topo)
			got := nodeIDs(g.ReachableTargets(tt.source))
			want := append([]string(nil), tt.want...)
			sort.Strings(want)
			if !equalStrings(got, want) {
				t.Fatalf("ReachableTargets(%s) = %v, want %v", tt.source, got, want)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Cycle detection — incremental (WouldCreateCycle) and whole-graph (HasCycle)
// ---------------------------------------------------------------------------

func TestWouldCreateCycle(t *testing.T) {
	tests := []struct {
		name     string
		topo     Topology
		from, to string
		want     bool
	}{
		{"fan-out add S->T1 again is parallel not cycle", fanOut(), "S", "T1", false},
		{"fan-out add T1->S closes a cycle", fanOut(), "T1", "S", true},
		{"cascade add C->A closes the chain into a loop", cascade(), "C", "A", true},
		{"cascade add C->B closes a loop B->C->B", cascade(), "C", "B", true},
		{"cascade add A->C is a valid shortcut (no cycle)", cascade(), "A", "C", false},
		{"self edge is a trivial cycle", cascade(), "A", "A", true},
		{"fan-out cross edge T1->T2 is no cycle", fanOut(), "T1", "T2", false},
		{"fan-out reverse-then-forward T2->T1 is no cycle", fanOut(), "T2", "T1", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g := NewGraph(tt.topo)
			if got := g.WouldCreateCycle(tt.from, tt.to); got != tt.want {
				t.Fatalf("WouldCreateCycle(%s,%s) = %v, want %v", tt.from, tt.to, got, tt.want)
			}
		})
	}
}

func TestHasCycle(t *testing.T) {
	if NewGraph(fanOut()).HasCycle() {
		t.Fatal("fan-out must be acyclic")
	}
	if NewGraph(cascade()).HasCycle() {
		t.Fatal("cascade must be acyclic")
	}

	// Build a graph that actually contains a cycle A->B->C->A and assert detection.
	cyclic := Topology{
		GroupID: "g-cyclic",
		Nodes:   []Node{node("A", RoleSource), node("B", RoleRelay), node("C", RoleRelay)},
		Edges: []Edge{
			edge("e1", "A", "B", "s1", 1),
			edge("e2", "B", "C", "s2", 2),
			edge("e3", "C", "A", "s3", 3),
		},
	}
	if !NewGraph(cyclic).HasCycle() {
		t.Fatal("HasCycle must detect A->B->C->A")
	}
}

// ---------------------------------------------------------------------------
// TopoSort / Validate
// ---------------------------------------------------------------------------

func TestTopoSort(t *testing.T) {
	// Cascade: the only valid order is A, B, C.
	order, ok := NewGraph(cascade()).TopoSort()
	if !ok {
		t.Fatal("cascade must topo-sort")
	}
	if !equalStrings(order, []string{"A", "B", "C"}) {
		t.Fatalf("cascade topo order = %v, want [A B C]", order)
	}

	// Fan-out: S must come first; the targets follow in deterministic (sorted)
	// order because they are mutually unordered.
	order, ok = NewGraph(fanOut()).TopoSort()
	if !ok {
		t.Fatal("fan-out must topo-sort")
	}
	if len(order) != 4 || order[0] != "S" {
		t.Fatalf("fan-out topo order = %v, want S first then T1 T2 T3", order)
	}
	if !equalStrings(order[1:], []string{"T1", "T2", "T3"}) {
		t.Fatalf("fan-out target order = %v, want deterministic [T1 T2 T3]", order[1:])
	}

	// Determinism: repeated sorts produce the same order.
	for i := 0; i < 5; i++ {
		again, _ := NewGraph(fanOut()).TopoSort()
		if !equalStrings(order, again) {
			t.Fatalf("topo sort not deterministic: %v vs %v", order, again)
		}
	}
}

func TestTopoSortRejectsCycle(t *testing.T) {
	cyclic := Topology{
		GroupID: "g",
		Nodes:   []Node{node("A", RoleSource), node("B", RoleRelay)},
		Edges:   []Edge{edge("e1", "A", "B", "s1", 1), edge("e2", "B", "A", "s2", 2)},
	}
	if _, ok := NewGraph(cyclic).TopoSort(); ok {
		t.Fatal("TopoSort must reject a cyclic graph")
	}
	if _, err := NewGraph(cyclic).Validate(); err != ErrCycle {
		t.Fatalf("Validate cyclic = %v, want ErrCycle", err)
	}
	if _, err := NewGraph(cascade()).Validate(); err != nil {
		t.Fatalf("Validate cascade = %v, want nil", err)
	}
}

// ---------------------------------------------------------------------------
// SelectFailoverTarget — the real ranking
// ---------------------------------------------------------------------------

func TestSelectFailoverTarget_RanksHealthyLowLagHighPriority(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	// Fan-out where:
	//  T1: healthy, lag 5s, priority 30
	//  T2: healthy, lag 1s, priority 20  <- should win (lowest lag among eligible)
	//  T3: unhealthy (skipped)
	topo := fanOut()
	topo.Edges = []Edge{
		withHealth(edge("e-s-t1", "S", "T1", "stream-1", 30), HealthHealthy, 5, 100),
		withHealth(edge("e-s-t2", "S", "T2", "stream-2", 20), HealthHealthy, 1, 200),
		withHealth(edge("e-s-t3", "S", "T3", "stream-3", 10), HealthUnhealthy, 0, 50),
	}

	sel := NewGraph(topo).SelectFailoverTarget(now)
	if sel.Selected == nil {
		t.Fatal("expected a selected target")
	}
	if sel.Selected.NodeID != "T2" {
		t.Fatalf("selected = %s, want T2 (lowest lag among healthy)", sel.Selected.NodeID)
	}
	if len(sel.Ranking) != 3 {
		t.Fatalf("ranking length = %d, want 3", len(sel.Ranking))
	}
	// T3 (unhealthy) must rank last and be marked ineligible.
	last := sel.Ranking[len(sel.Ranking)-1]
	if last.NodeID != "T3" || last.Eligible {
		t.Fatalf("unhealthy T3 must rank last and be ineligible; got %+v", last)
	}
	// Eligible candidates come before ineligible ones.
	if !sel.Ranking[0].Eligible || !sel.Ranking[1].Eligible {
		t.Fatalf("first two ranked must be eligible; got %+v", sel.Ranking)
	}
}

func TestSelectFailoverTarget_PriorityBreaksLagTie(t *testing.T) {
	now := time.Now().UTC()
	topo := fanOut()
	// Two healthy edges with identical lag; the lower-priority (preferred) wins.
	topo.Nodes = []Node{node("S", RoleSource), node("T1", RoleTarget), node("T2", RoleTarget)}
	topo.Edges = []Edge{
		withHealth(edge("e-s-t1", "S", "T1", "stream-1", 50), HealthHealthy, 3, 100),
		withHealth(edge("e-s-t2", "S", "T2", "stream-2", 5), HealthHealthy, 3, 100),
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	if sel.Selected == nil || sel.Selected.NodeID != "T2" {
		t.Fatalf("priority tie-break failed: selected = %v, want T2 (priority 5 < 50)", sel.Selected)
	}
}

func TestSelectFailoverTarget_DegradedBeatsUnhealthyButHealthyWins(t *testing.T) {
	now := time.Now().UTC()
	topo := Topology{
		GroupID: "g",
		Nodes: []Node{
			node("S", RoleSource), node("Th", RoleTarget), node("Td", RoleTarget), node("Tu", RoleTarget),
		},
		Edges: []Edge{
			// Healthy but HIGH lag, Degraded with LOW lag, Unhealthy.
			withHealth(edge("e1", "S", "Th", "s1", 10), HealthHealthy, 200, 100),
			withHealth(edge("e2", "S", "Td", "s2", 10), HealthDegraded, 2, 100),
			withHealth(edge("e3", "S", "Tu", "s3", 10), HealthUnhealthy, 0, 100),
		},
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	// Both healthy and degraded are eligible; the tie-break is LAG, so the
	// low-lag degraded edge (2s) wins over the high-lag healthy one (200s).
	if sel.Selected == nil || sel.Selected.NodeID != "Td" {
		t.Fatalf("selected = %v, want Td (lowest lag among eligible)", sel.Selected)
	}
	// The unhealthy node must be ineligible and ranked last.
	last := sel.Ranking[len(sel.Ranking)-1]
	if last.NodeID != "Tu" || last.Eligible {
		t.Fatalf("Tu must be ineligible and last; got %+v", last)
	}
}

func TestSelectFailoverTarget_NoEligibleWhenAllUnhealthy(t *testing.T) {
	now := time.Now().UTC()
	// Every reachable target's inbound edge is unhealthy/unknown, so none is
	// eligible, but all three are still ranked (with their skip reasons).
	topo := fanOut()
	topo.Edges = []Edge{
		withHealth(edge("e-s-t1", "S", "T1", "stream-1", 10), HealthUnhealthy, 0, 0),
		withHealth(edge("e-s-t2", "S", "T2", "stream-2", 20), HealthUnknown, 0, 0),
		withHealth(edge("e-s-t3", "S", "T3", "stream-3", 30), HealthUnhealthy, 0, 0),
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	if sel.Selected != nil {
		t.Fatalf("expected no eligible target, got %v", sel.Selected)
	}
	if len(sel.Ranking) != 3 {
		t.Fatalf("ranking should list every reachable candidate (3), got %d", len(sel.Ranking))
	}
	for _, c := range sel.Ranking {
		if c.Eligible {
			t.Fatalf("no candidate should be eligible; %s was", c.NodeID)
		}
	}
}

func TestSelectFailoverTarget_TargetWithNoInboundEdgeIsSkipped(t *testing.T) {
	now := time.Now().UTC()
	// A diamond: S -> T1 (healthy) and S -> M -> T2, but T2's inbound edge is
	// missing health AND we ALSO add an isolated reachable target whose ONLY
	// inbound edge carries no stream/health so the "no inbound edge" branch is
	// reached. Concretely: S -> Iso has no edge, but Iso is reached via a relay
	// edge whose health is unknown — to hit the explicit no-edge branch we make a
	// target reachable through a node but give the LAST hop no inbound edge by
	// constructing a node reachable only as a from-node. Simpler and direct: a
	// promotable RELAY that is a source-with-no-inbound (the graph source itself
	// is a relay), exercised via the all-promotable fallback.
	topo := Topology{
		GroupID: "g",
		Nodes: []Node{
			node("R1", RoleRelay), // graph source but promotable: no inbound edge
			node("T", RoleTarget),
		},
		Edges: []Edge{
			withHealth(edge("e1", "R1", "T", "s1", 10), HealthHealthy, 1, 100),
		},
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	// T is reachable and healthy -> selected. R1 is the graph source (no inbound
	// edge) so it is not in the reachable set from itself; T is the only candidate.
	if sel.Selected == nil || sel.Selected.NodeID != "T" {
		t.Fatalf("selected = %v, want T", sel.Selected)
	}

	// Now an all-relay graph with no source-to edges at all: the fallback lists
	// every promotable node, and a node with no inbound edge reports the reason.
	isolated := Topology{
		GroupID: "g2",
		Nodes:   []Node{node("X", RoleTarget), node("Y", RoleTarget)},
		// No edges: both are isolated promotable nodes.
	}
	sel = NewGraph(isolated).SelectFailoverTarget(now)
	if sel.Selected != nil {
		t.Fatalf("isolated nodes have no inbound edge; none should be selected, got %v", sel.Selected)
	}
	if len(sel.Ranking) != 2 {
		t.Fatalf("fallback should list both promotable nodes; got %d", len(sel.Ranking))
	}
	for _, c := range sel.Ranking {
		if c.Reason != "no inbound replication edge" {
			t.Fatalf("isolated node %s must report no inbound edge; got %q", c.NodeID, c.Reason)
		}
	}
}

func TestSelectFailoverTarget_SourceNeverSelected(t *testing.T) {
	now := time.Now().UTC()
	// A pure source must never be selected even if it is the only healthy node.
	topo := Topology{
		GroupID: "g",
		Nodes:   []Node{node("S", RoleSource), node("T", RoleTarget)},
		Edges:   []Edge{withHealth(edge("e1", "S", "T", "s1", 1), HealthHealthy, 1, 100)},
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	if sel.Selected == nil || sel.Selected.NodeID != "T" {
		t.Fatalf("selected = %v, want the target T (never the source S)", sel.Selected)
	}
	for _, c := range sel.Ranking {
		if c.NodeID == "S" {
			t.Fatal("the source must not appear as a failover candidate")
		}
	}
}

func TestSelectFailoverTarget_CascadeRelayIsCandidate(t *testing.T) {
	now := time.Now().UTC()
	// A -> B(relay) -> C. Both B and C are promotable. Make B's edge healthier.
	topo := cascade()
	topo.Edges = []Edge{
		withHealth(edge("e-a-b", "A", "B", "stream-ab", 10), HealthHealthy, 1, 500),
		withHealth(edge("e-b-c", "B", "C", "stream-bc", 20), HealthHealthy, 50, 100),
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	if sel.Selected == nil {
		t.Fatal("expected a selection in the cascade")
	}
	if sel.Selected.NodeID != "B" {
		t.Fatalf("selected = %s, want B (relay, lowest lag)", sel.Selected.NodeID)
	}
	// Both B and C must be considered.
	if len(sel.Ranking) != 2 {
		t.Fatalf("ranking should consider both B and C; got %d", len(sel.Ranking))
	}
}

func TestSelectFailoverTarget_AppliedSeqBreaksFinalTie(t *testing.T) {
	now := time.Now().UTC()
	topo := fanOut()
	topo.Nodes = []Node{node("S", RoleSource), node("T1", RoleTarget), node("T2", RoleTarget)}
	// Identical health, lag and priority; higher applied_seq wins (more data).
	topo.Edges = []Edge{
		withHealth(edge("e-s-t1", "S", "T1", "stream-1", 10), HealthHealthy, 2, 100),
		withHealth(edge("e-s-t2", "S", "T2", "stream-2", 10), HealthHealthy, 2, 999),
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	if sel.Selected == nil || sel.Selected.NodeID != "T2" {
		t.Fatalf("applied_seq tie-break failed: selected = %v, want T2 (seq 999)", sel.Selected)
	}
}

func TestSelectFailoverTarget_KnownLagBeatsNilLag(t *testing.T) {
	now := time.Now().UTC()
	topo := fanOut()
	topo.Nodes = []Node{node("S", RoleSource), node("T1", RoleTarget), node("T2", RoleTarget)}
	// T1 healthy with a known lag; T2 healthy but lag unknown (nil). Known wins.
	e2 := edge("e-s-t2", "S", "T2", "stream-2", 5)
	e2.Health = HealthHealthy // eligible, but LagSeconds stays nil
	topo.Edges = []Edge{
		withHealth(edge("e-s-t1", "S", "T1", "stream-1", 90), HealthHealthy, 7, 100),
		e2,
	}
	sel := NewGraph(topo).SelectFailoverTarget(now)
	if sel.Selected == nil || sel.Selected.NodeID != "T1" {
		t.Fatalf("known-lag preference failed: selected = %v, want T1 (lag known)", sel.Selected)
	}
}
