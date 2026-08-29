package migrate

import (
	"sort"
	"strings"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/topology"
)

// DependencyGraph is the visualization payload for a wave's move-group / workload
// dependency structure. It is shaped so a react-flow UI can render it directly:
// nodes carry an id/label/status/type, edges carry a source/target/type. The
// graph is derived from the SAME two real edge sources the wave critical path and
// the runbook generator use — (1) intra/inter-group workload hard dependencies and
// (2) the operator-defined move-group sequence chain — and, when a move group is
// bound to a DR consistency/topology group, the DR topology edges proxied through
// the Wave-2 DRTopology bridge are overlaid rather than re-derived. There is no
// second general-purpose graph engine here: ordering/cycle detection reuse
// internal/dr/topology.
type DependencyGraph struct {
	WaveID    uuid.UUID      `json:"wave_id"`
	WaveRef   string         `json:"wave_reference"`
	Nodes     []DepGraphNode `json:"nodes"`
	Edges     []DepGraphEdge `json:"edges"`
	TopoOrder []string       `json:"topo_order"`
	// HasCycle is true when the derived dependency graph is cyclic (illegal input).
	// The graph is still returned so the UI can render and highlight the problem,
	// but the topo order is best-effort in that case.
	HasCycle bool `json:"has_cycle"`
}

// DepGraphNodeType distinguishes the two kinds of vertices the UI renders.
type DepGraphNodeType string

const (
	NodeTypeMoveGroup DepGraphNodeType = "move_group"
	NodeTypeWorkload  DepGraphNodeType = "workload"
	// NodeTypeDRSite is a site vertex overlaid from a bound DR topology group.
	NodeTypeDRSite DepGraphNodeType = "dr_site"
)

// DepGraphEdgeType distinguishes the real edge sources so the UI can style them.
type DepGraphEdgeType string

const (
	// EdgeTypeContains links a move-group node to the workload nodes it owns.
	EdgeTypeContains DepGraphEdgeType = "contains"
	// EdgeTypeDependency is a hard workload dependency (dependency runs first).
	EdgeTypeDependency DepGraphEdgeType = "dependency"
	// EdgeTypeSequence is the operator-defined move-group ordering (group k -> k+1).
	EdgeTypeSequence DepGraphEdgeType = "sequence"
	// EdgeTypeReplication is a DR topology replication edge overlaid from the bridge.
	EdgeTypeReplication DepGraphEdgeType = "replication"
)

// DepGraphNode is one vertex. ID is stable and unique across the graph; for a
// workload it is "wl:<appKey>", for a move group "mg:<groupID>", for a DR site
// "dr:<groupID>:<siteNodeID>". Status carries the live entity status the UI
// colours the node by. GroupID/AppKey are the raw identifiers a click-through
// needs. ReplicationHealth is populated only for dr_site nodes.
type DepGraphNode struct {
	ID              string           `json:"id"`
	Type            DepGraphNodeType `json:"type"`
	Label           string           `json:"label"`
	Status          string           `json:"status"`
	MoveGroupID     string           `json:"move_group_id,omitempty"`
	AppKey          string           `json:"app_key,omitempty"`
	DurationSeconds int              `json:"duration_seconds,omitempty"`
	DRTopologyGroup string           `json:"dr_topology_group_id,omitempty"`
	Role            string           `json:"role,omitempty"`
}

// DepGraphEdge is one directed edge: source runs/depends-before target. Health is
// carried for replication edges overlaid from the DR topology.
type DepGraphEdge struct {
	ID     string           `json:"id"`
	Source string           `json:"source"`
	Target string           `json:"target"`
	Type   DepGraphEdgeType `json:"type"`
	Label  string           `json:"label,omitempty"`
	Health string           `json:"health,omitempty"`
}

// depEdgeKey is a deduplication key for a directed hard-dependency edge
// (From runs before To). It is shared between the graph builder and the topo-order
// helper so the dep-edge set can be passed through without re-keying.
type depEdgeKey struct{ From, To string }

// wlNodeID / mgNodeID / drNodeID produce the stable node ids used above.
func wlNodeID(appKey string) string { return "wl:" + appKey }
func mgNodeID(id uuid.UUID) string  { return "mg:" + id.String() }
func drNodeID(groupID uuid.UUID, siteNodeID string) string {
	return "dr:" + groupID.String() + ":" + siteNodeID
}

// buildWaveDependencyGraph projects a wave (with its move groups + workloads) into
// the react-flow graph payload. topologies maps a move-group id -> the DR topology
// fetched via the bridge for that group's dr_topology_group_id (nil/absent when the
// group has no binding or the DR engine was unreachable — the graph then simply
// omits the replication overlay for that group and still renders the native
// dependency structure).
//
// Ordering + cycle detection REUSE internal/dr/topology (the same engine
// orderMoveGroups/orderWorkloads use). We build one topology.Topology over the
// workload dependency edges + move-group sequence edges, run TopoSort once, and
// surface the result. No bespoke BFS/DFS is introduced.
func buildWaveDependencyGraph(wave Wave, topologies map[uuid.UUID]*DRTopology) DependencyGraph {
	out := DependencyGraph{WaveID: wave.ID, WaveRef: wave.Reference}

	// Sort move groups by the in-wave sequence (reference tie-break) so sequence
	// edges and node emission are deterministic — identical to the critical-path
	// and runbook ordering.
	groups := append([]MoveGroup(nil), wave.MoveGroups...)
	sort.SliceStable(groups, func(i, j int) bool {
		if groups[i].WaveSequence != groups[j].WaveSequence {
			return groups[i].WaveSequence < groups[j].WaveSequence
		}
		return groups[i].Reference < groups[j].Reference
	})

	// Emit move-group + workload nodes and the "contains" edges. Track which app
	// keys exist so a dependency to an unknown app key is not turned into a
	// dangling edge (it is surfaced as a real edge only when both endpoints exist).
	knownAppKey := map[string]struct{}{}
	for _, g := range groups {
		out.Nodes = append(out.Nodes, DepGraphNode{
			ID:              mgNodeID(g.ID),
			Type:            NodeTypeMoveGroup,
			Label:           moveGroupTaskName(g),
			Status:          string(g.Status),
			MoveGroupID:     g.ID.String(),
			DRTopologyGroup: topologyGroupString(g.DRTopologyGroupID),
		})
		for _, w := range g.Workloads {
			if w.AppKey == "" {
				continue
			}
			knownAppKey[w.AppKey] = struct{}{}
			dur, _ := workloadDurationSeconds(w)
			out.Nodes = append(out.Nodes, DepGraphNode{
				ID:              wlNodeID(w.AppKey),
				Type:            NodeTypeWorkload,
				Label:           workloadTaskName(w),
				Status:          string(w.Status),
				MoveGroupID:     g.ID.String(),
				AppKey:          w.AppKey,
				DurationSeconds: dur,
			})
			out.Edges = append(out.Edges, DepGraphEdge{
				ID:     "contains:" + g.ID.String() + ":" + w.AppKey,
				Source: mgNodeID(g.ID),
				Target: wlNodeID(w.AppKey),
				Type:   EdgeTypeContains,
			})
		}
	}

	// Build the dependency DAG edges (workload hard dependencies) and the
	// move-group sequence chain, and feed them to the reused topology engine for a
	// deterministic topo order + cycle detection. The dep-edge set is keyed by an
	// anonymous struct so it can be passed directly to computeDepTopoOrder.
	seenDep := map[depEdgeKey]struct{}{}
	for _, g := range groups {
		for _, w := range g.Workloads {
			if w.AppKey == "" {
				continue
			}
			for _, dep := range w.Dependencies {
				if strings.EqualFold(dep.Criticality, "soft") {
					continue
				}
				if _, ok := knownAppKey[dep.AppKey]; !ok || dep.AppKey == w.AppKey {
					continue
				}
				k := depEdgeKey{From: dep.AppKey, To: w.AppKey}
				if _, dup := seenDep[k]; dup {
					continue
				}
				seenDep[k] = struct{}{}
				// dep runs before w: edge dep -> w.
				out.Edges = append(out.Edges, DepGraphEdge{
					ID:     "dep:" + dep.AppKey + "->" + w.AppKey,
					Source: wlNodeID(dep.AppKey),
					Target: wlNodeID(w.AppKey),
					Type:   EdgeTypeDependency,
					Label:  dep.Criticality,
				})
			}
		}
	}

	// Move-group sequence chain: group at position i runs before group at i+1.
	for i := 0; i+1 < len(groups); i++ {
		from, to := groups[i], groups[i+1]
		out.Edges = append(out.Edges, DepGraphEdge{
			ID:     "seq:" + from.ID.String() + "->" + to.ID.String(),
			Source: mgNodeID(from.ID),
			Target: mgNodeID(to.ID),
			Type:   EdgeTypeSequence,
		})
	}

	// Overlay any DR topology (replication) graph for groups bound to a DR
	// consistency group. Reuse the DRTopology projection the Wave-2 bridge returns.
	for _, g := range groups {
		if g.DRTopologyGroupID == nil {
			continue
		}
		topo := topologies[g.ID]
		if topo == nil {
			continue
		}
		groupID := *g.DRTopologyGroupID
		for _, n := range topo.Nodes {
			out.Nodes = append(out.Nodes, DepGraphNode{
				ID:              drNodeID(groupID, n.ID),
				Type:            NodeTypeDRSite,
				Label:           n.SiteID,
				Status:          n.Role,
				DRTopologyGroup: groupID.String(),
				Role:            n.Role,
				MoveGroupID:     g.ID.String(),
			})
		}
		for _, e := range topo.Edges {
			out.Edges = append(out.Edges, DepGraphEdge{
				ID:     "repl:" + groupID.String() + ":" + e.ID,
				Source: drNodeID(groupID, e.FromNodeID),
				Target: drNodeID(groupID, e.ToNodeID),
				Type:   EdgeTypeReplication,
				Label:  e.Mode,
				Health: e.Health,
			})
		}
	}

	// Compute the deterministic execution topo order over the NATIVE dependency
	// DAG (workload dependency edges + group sequence edges), REUSING the topology
	// engine. Move groups and workloads share one node space keyed by their graph
	// ids so the order is a single coherent sequence the UI can step through.
	topoOrder, cyclic := computeDepTopoOrder(groups, seenDep)
	out.TopoOrder = topoOrder
	out.HasCycle = cyclic
	return out
}

// computeDepTopoOrder runs a single topological sort over the wave's native
// dependency DAG using the reused internal/dr/topology engine. Nodes are the
// workload graph ids (wl:<appKey>) plus the move-group graph ids (mg:<id>); edges
// are the hard workload dependencies, the group->workload containment (a group is
// "ready" before its workloads run), and the group sequence chain. It returns the
// deterministic order and whether the graph is cyclic.
func computeDepTopoOrder(groups []MoveGroup, depEdges map[depEdgeKey]struct{}) ([]string, bool) {
	nodes := make([]topology.Node, 0)
	seenNode := map[string]struct{}{}
	addNode := func(id string) {
		if _, ok := seenNode[id]; ok {
			return
		}
		seenNode[id] = struct{}{}
		nodes = append(nodes, topology.Node{ID: id, Role: topology.RoleTarget})
	}

	type ek struct{ from, to string }
	edgeSeen := map[ek]struct{}{}
	edges := make([]topology.Edge, 0)
	addEdge := func(from, to string) {
		if from == "" || to == "" || from == to {
			return
		}
		k := ek{from: from, to: to}
		if _, ok := edgeSeen[k]; ok {
			return
		}
		edgeSeen[k] = struct{}{}
		edges = append(edges, topology.Edge{ID: from + "->" + to, FromNodeID: from, ToNodeID: to})
	}

	for _, g := range groups {
		gid := mgNodeID(g.ID)
		addNode(gid)
		for _, w := range g.Workloads {
			if w.AppKey == "" {
				continue
			}
			wid := wlNodeID(w.AppKey)
			addNode(wid)
			// A group is available before its member workloads execute.
			addEdge(gid, wid)
		}
	}
	// Hard workload dependencies.
	for k := range depEdges {
		addEdge(wlNodeID(k.From), wlNodeID(k.To))
	}
	// Move-group sequence chain. A group at sequence k+1 (and therefore all of its
	// member workloads) starts only after every workload in the group at sequence k
	// has completed — the SAME serialization the wave critical path applies via
	// prevGroupKeys. We add (a) a group->group edge and (b) an edge from each
	// preceding-group workload to the next group node; the next group node already
	// precedes its own workloads via the contains edges, so the workloads of group
	// k+1 transitively follow the workloads of group k.
	for i := 0; i+1 < len(groups); i++ {
		nextGroupNode := mgNodeID(groups[i+1].ID)
		addEdge(mgNodeID(groups[i].ID), nextGroupNode)
		for _, w := range groups[i].Workloads {
			if w.AppKey == "" {
				continue
			}
			addEdge(wlNodeID(w.AppKey), nextGroupNode)
		}
	}

	g := topology.NewGraph(topology.Topology{Nodes: nodes, Edges: edges})
	order, ok := g.TopoSort()
	if !ok {
		// Cyclic input: return a stable node-id ordering so the UI still has
		// something to render, and flag the cycle.
		fallback := make([]string, 0, len(nodes))
		for _, n := range nodes {
			fallback = append(fallback, n.ID)
		}
		sort.Strings(fallback)
		return fallback, true
	}
	return order, false
}

func topologyGroupString(id *uuid.UUID) string {
	if id == nil {
		return ""
	}
	return id.String()
}
