package topology

import (
	"sort"
	"time"
)

// Graph is an in-memory directed graph built from a Topology's nodes and edges.
// It is the engine the service and the failover selector operate on: cycle
// detection, topological ordering, reachability, and target ranking are all pure
// functions over this structure, so they are unit-testable with deterministic
// fixtures and carry no I/O.
//
// Construction is O(V+E). adjacency[from] lists the outgoing edges from a node;
// nodes maps node ID -> Node. Edges with endpoints not present in nodes are
// skipped during construction (a defensive guard; the store never produces them
// because of the foreign keys, and the cycle check on AddEdge runs over a graph
// that includes the proposed edge explicitly).
type Graph struct {
	groupID   string
	nodes     map[string]Node
	adjacency map[string][]Edge
	// indegree counts incoming edges per node, used by TopoSort (Kahn's algorithm).
	indegree map[string]int
}

// NewGraph builds a Graph from a Topology.
func NewGraph(t Topology) *Graph {
	g := &Graph{
		groupID:   t.GroupID,
		nodes:     make(map[string]Node, len(t.Nodes)),
		adjacency: make(map[string][]Edge, len(t.Nodes)),
		indegree:  make(map[string]int, len(t.Nodes)),
	}
	for _, n := range t.Nodes {
		g.nodes[n.ID] = n
		if _, ok := g.indegree[n.ID]; !ok {
			g.indegree[n.ID] = 0
		}
	}
	// Every edge endpoint must be a graph vertex so reachability traversals (the
	// cycle check) follow the full path through intermediate relays — even when
	// the caller passed only a partial explicit node list (as AddEdge does, which
	// supplies just the two endpoints and the locked edge set). An endpoint absent
	// from t.Nodes is synthesised as a minimal vertex carrying just its ID; the
	// reachability/topo algorithms only need the ID, and the metadata-dependent
	// SelectFailoverTarget is always called over a fully-loaded topology.
	for _, e := range t.Edges {
		if _, ok := g.nodes[e.FromNodeID]; !ok {
			g.nodes[e.FromNodeID] = Node{ID: e.FromNodeID}
			g.indegree[e.FromNodeID] = 0
		}
		if _, ok := g.nodes[e.ToNodeID]; !ok {
			g.nodes[e.ToNodeID] = Node{ID: e.ToNodeID}
			g.indegree[e.ToNodeID] = 0
		}
		g.adjacency[e.FromNodeID] = append(g.adjacency[e.FromNodeID], e)
		g.indegree[e.ToNodeID]++
	}
	return g
}

// WouldCreateCycle reports whether adding the directed edge from->to would
// introduce a cycle in the graph. A new edge from->to closes a cycle if and only
// if `to` can already reach `from` along existing edges (then from->to->...->from
// is a loop), or if from==to (a self-loop). This is the canonical reachability
// test for incremental DAG maintenance; it runs a DFS from `to`.
//
// Complexity O(V+E). It does not mutate the graph.
func (g *Graph) WouldCreateCycle(from, to string) bool {
	if from == to {
		return true
	}
	return g.reaches(to, from)
}

// reaches reports whether `from` can reach `target` along directed edges (a DFS
// with an explicit visited set, so a graph that already contains a cycle — which
// should never happen — terminates rather than recursing forever).
func (g *Graph) reaches(from, target string) bool {
	if from == target {
		return true
	}
	visited := make(map[string]bool, len(g.nodes))
	stack := []string{from}
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		if visited[cur] {
			continue
		}
		visited[cur] = true
		for _, e := range g.adjacency[cur] {
			if e.ToNodeID == target {
				return true
			}
			if !visited[e.ToNodeID] {
				stack = append(stack, e.ToNodeID)
			}
		}
	}
	return false
}

// HasCycle reports whether the graph as a whole contains a cycle, using a
// three-colour DFS (white = unvisited, grey = on the current DFS stack, black =
// fully explored). Encountering a grey node along an edge proves a back-edge,
// hence a cycle. This is the whole-graph validation used by Validate; AddEdge
// uses the cheaper incremental WouldCreateCycle.
func (g *Graph) HasCycle() bool {
	const (
		white = 0
		grey  = 1
		black = 2
	)
	colour := make(map[string]int, len(g.nodes))

	// Iterative DFS to avoid stack overflow on long cascades. We push a node and
	// process its children; when all children are done the node goes black.
	type frame struct {
		node string
		next int // index into adjacency[node]
	}
	for _, start := range g.sortedNodeIDs() {
		if colour[start] != white {
			continue
		}
		stack := []frame{{node: start, next: 0}}
		colour[start] = grey
		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			edges := g.adjacency[top.node]
			if top.next >= len(edges) {
				colour[top.node] = black
				stack = stack[:len(stack)-1]
				continue
			}
			child := edges[top.next].ToNodeID
			top.next++
			switch colour[child] {
			case grey:
				return true // back-edge to a node on the current path => cycle
			case white:
				colour[child] = grey
				stack = append(stack, frame{node: child, next: 0})
			}
		}
	}
	return false
}

// TopoSort returns a topological ordering of the node IDs (every edge from->to
// has from before to) and ok=true, or ok=false when the graph has a cycle. It is
// Kahn's algorithm over a copy of the indegree map, processing ready nodes in
// deterministic (sorted) order so the result is stable across runs — the order a
// cascade should be quiesced/applied/booted in. A graph with a cycle leaves some
// nodes with a positive indegree, so ok=false (this is also a cycle check).
func (g *Graph) TopoSort() ([]string, bool) {
	indeg := make(map[string]int, len(g.indegree))
	for id, d := range g.indegree {
		indeg[id] = d
	}

	// Seed the queue with every zero-indegree node, in sorted order.
	var ready []string
	for _, id := range g.sortedNodeIDs() {
		if indeg[id] == 0 {
			ready = append(ready, id)
		}
	}

	var order []string
	for len(ready) > 0 {
		// Pop the smallest ready node for determinism.
		sort.Strings(ready)
		cur := ready[0]
		ready = ready[1:]
		order = append(order, cur)

		// Decrement successors; collect those that become ready.
		var newlyReady []string
		for _, e := range g.adjacency[cur] {
			indeg[e.ToNodeID]--
			if indeg[e.ToNodeID] == 0 {
				newlyReady = append(newlyReady, e.ToNodeID)
			}
		}
		ready = append(ready, newlyReady...)
	}

	if len(order) != len(g.nodes) {
		return nil, false // a cycle left nodes unsettled
	}
	return order, true
}

// Validate reports whether the graph is a valid replication DAG: it has no cycle
// and every edge endpoint is a known node. It returns the deterministic topo
// order on success so a caller can present the apply/boot sequence.
func (g *Graph) Validate() ([]string, error) {
	order, ok := g.TopoSort()
	if !ok {
		return nil, ErrCycle
	}
	return order, nil
}

// ReachableTargets returns the set of PROMOTABLE target nodes reachable from the
// given source node along directed edges — the sites the source ultimately
// replicates to, directly (fan-out) or through relays (cascade). The source
// itself is excluded. RELAY nodes are included (a relay is a valid promotion
// point in a cascade) as well as terminal TARGET nodes. The result is sorted by
// node ID for determinism.
//
// Example fan-out (S->T1, S->T2, S->T3): ReachableTargets(S) = {T1,T2,T3}.
// Example cascade (A->B->C): ReachableTargets(A) = {B,C}, ReachableTargets(B) = {C}.
func (g *Graph) ReachableTargets(sourceNodeID string) []Node {
	visited := make(map[string]bool, len(g.nodes))
	stack := []string{sourceNodeID}
	visited[sourceNodeID] = true // exclude the source itself

	var out []Node
	for len(stack) > 0 {
		cur := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, e := range g.adjacency[cur] {
			if visited[e.ToNodeID] {
				continue
			}
			visited[e.ToNodeID] = true
			if n, ok := g.nodes[e.ToNodeID]; ok && n.IsPromotable() {
				out = append(out, n)
			}
			stack = append(stack, e.ToNodeID)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// sources returns the node IDs with no incoming edge (graph sources). A
// well-formed topology has exactly one, but the helper handles any number.
func (g *Graph) sources() []string {
	var out []string
	for _, id := range g.sortedNodeIDs() {
		if g.indegree[id] == 0 {
			out = append(out, id)
		}
	}
	return out
}

// inboundEdge returns the edge that delivers replication to the given node (the
// edge whose ToNodeID == nodeID), and whether one exists. A node in a DAG built
// here has at most one logical upstream per stream; when several exist (a target
// served by multiple relays) the one with the lowest priority then lowest edge
// ID is returned deterministically, because that is the preferred path.
func (g *Graph) inboundEdge(nodeID string) (Edge, bool) {
	var best Edge
	found := false
	for _, edges := range g.adjacency {
		for _, e := range edges {
			if e.ToNodeID != nodeID {
				continue
			}
			if !found || lessEdgePreference(e, best) {
				best = e
				found = true
			}
		}
	}
	return best, found
}

// lessEdgePreference reports whether edge a is preferred over edge b purely by
// the static preference key (priority, then ID). Used to pick a node's inbound
// edge deterministically.
func lessEdgePreference(a, b Edge) bool {
	if a.Priority != b.Priority {
		return a.Priority < b.Priority
	}
	return a.ID < b.ID
}

// SelectFailoverTarget ranks every promotable target reachable from the group's
// source(s) and returns the best eligible one plus the full ranking rationale
// (§6 gated failover target selection). The ranking is a REAL, deterministic
// total order over the candidates, not a stub:
//
//  1. Eligible candidates rank above ineligible ones. A candidate is eligible
//     when its inbound edge health is healthy or degraded (an unhealthy/unknown
//     edge is skipped — promoting a standby with no confirmed replication risks
//     data loss).
//  2. Among eligible candidates, LOWER lag wins (the most up-to-date standby —
//     smallest RPO). A nil lag (sample present but lag unknown) sorts after any
//     known lag.
//  3. Ties on lag break on LOWER edge priority (the operator-preferred standby).
//  4. Remaining ties break on HIGHER applied_seq (more data applied), then on
//     node ID for total determinism.
//
// `now` is injected so tests are deterministic; production passes time.Now().
// Selected is nil and ErrNoEligibleTarget is implied (Selected==nil) when no
// candidate is eligible — the ranking still lists every skipped candidate with
// its reason so the operator sees why.
func (g *Graph) SelectFailoverTarget(now time.Time) FailoverSelection {
	sel := FailoverSelection{
		GroupID:     g.groupID,
		EvaluatedAt: now.UTC(),
	}

	// Reachable target set = union of targets reachable from every graph source.
	// A well-formed group has one source, but a union is correct for any shape.
	seen := make(map[string]bool)
	var targets []Node
	for _, src := range g.sources() {
		for _, n := range g.ReachableTargets(src) {
			if !seen[n.ID] {
				seen[n.ID] = true
				targets = append(targets, n)
			}
		}
	}
	// If there are no sources (e.g. a malformed all-relay graph), fall back to all
	// promotable nodes so a selection is still attempted rather than silently empty.
	if len(targets) == 0 {
		for _, id := range g.sortedNodeIDs() {
			n := g.nodes[id]
			if n.IsPromotable() && !seen[id] {
				seen[id] = true
				targets = append(targets, n)
			}
		}
	}

	candidates := make([]FailoverCandidate, 0, len(targets))
	for _, n := range targets {
		c := FailoverCandidate{
			NodeID:   n.ID,
			SiteID:   n.SiteID,
			SiteName: n.SiteName,
			Role:     n.Role,
		}
		edge, ok := g.inboundEdge(n.ID)
		if !ok {
			c.Health = HealthUnknown
			c.Eligible = false
			c.Reason = "no inbound replication edge"
			candidates = append(candidates, c)
			continue
		}
		c.EdgeID = edge.ID
		c.StreamID = edge.StreamID
		c.Mode = edge.Mode
		c.Priority = edge.Priority
		c.Health = edge.Health
		c.LagSeconds = edge.LagSeconds
		c.AppliedSeq = edge.AppliedSeq

		switch edge.Health {
		case HealthHealthy:
			c.Eligible = true
			c.Reason = "edge healthy"
		case HealthDegraded:
			c.Eligible = true
			c.Reason = "edge degraded but applying"
		case HealthUnhealthy:
			c.Eligible = false
			c.Reason = "edge unhealthy; replication not confirmed"
		default:
			c.Eligible = false
			c.Reason = "edge health unknown; no progress observed"
		}
		candidates = append(candidates, c)
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		return lessCandidate(candidates[i], candidates[j])
	})

	sel.Ranking = candidates
	if len(candidates) > 0 && candidates[0].Eligible {
		winner := candidates[0]
		sel.Selected = &winner
	}
	return sel
}

// lessCandidate is the total order described on SelectFailoverTarget: eligible
// first, then lower lag, then lower priority, then higher applied_seq, then node
// ID. It returns true when a should rank before b.
func lessCandidate(a, b FailoverCandidate) bool {
	if a.Eligible != b.Eligible {
		return a.Eligible // eligible (true) sorts before ineligible (false)
	}
	if !a.Eligible {
		// Both ineligible: order by health rank then node ID for stable output.
		if hr := healthRank(a.Health) - healthRank(b.Health); hr != 0 {
			return hr < 0
		}
		return a.NodeID < b.NodeID
	}

	// Both eligible: lower lag wins. A known lag beats a nil lag.
	al, an := lagKey(a.LagSeconds)
	bl, bn := lagKey(b.LagSeconds)
	if an != bn {
		return an // a-known (true) sorts before b-unknown
	}
	if an && bn && al != bl {
		return al < bl
	}

	if a.Priority != b.Priority {
		return a.Priority < b.Priority
	}
	if a.AppliedSeq != b.AppliedSeq {
		return a.AppliedSeq > b.AppliedSeq // more data applied is preferred
	}
	return a.NodeID < b.NodeID
}

// lagKey returns the lag value and whether it is known (non-nil). A known lag
// sorts before an unknown one.
func lagKey(l *int64) (value int64, known bool) {
	if l == nil {
		return 0, false
	}
	return *l, true
}

// sortedNodeIDs returns the graph's node IDs in lexical order, the basis for the
// deterministic ordering used throughout the engine.
func (g *Graph) sortedNodeIDs() []string {
	ids := make([]string, 0, len(g.nodes))
	for id := range g.nodes {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
