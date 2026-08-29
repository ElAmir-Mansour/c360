package migrate

import (
	"fmt"
	"sort"
	"strings"

	"github.com/clario360/platform/internal/dr/topology"
)

// orderMoveGroups returns the move groups of a wave in their REAL execution
// order: a topological order over the move-group dependency DAG, tie-broken by
// the operator-defined wave sequence. The dependency edges are derived from two
// real sources — (1) inter-group hard workload dependencies (a workload in group
// B that hard-depends on a workload in group A makes B depend on A), and (2) the
// wave's own sequence chain (group at sequence k+1 runs after the group at
// sequence k) — exactly the same edge sources the wave critical-path uses.
//
// It REUSES the existing DR topology graph engine (internal/dr/topology) for the
// topological sort and cycle detection rather than implementing a second BFS:
// move groups become topology Nodes, dependency edges become topology Edges, and
// topology.NewGraph(...).TopoSort() yields the deterministic order. A cycle in
// the derived graph (illegal input) is reported as ErrInvalidTransition so the
// caller fails closed instead of generating a runbook that can never complete.
func orderMoveGroups(groups []MoveGroup) ([]MoveGroup, error) {
	byID := make(map[string]MoveGroup, len(groups))
	// appKeyToGroup maps a workload app key to the move-group id that owns it, so
	// an inter-group dependency edge can be resolved from a workload dependency.
	appKeyToGroup := make(map[string]string, len(groups))
	for _, g := range groups {
		gid := g.ID.String()
		byID[gid] = g
		for _, w := range g.Workloads {
			if w.AppKey != "" {
				appKeyToGroup[w.AppKey] = gid
			}
		}
	}

	nodes := make([]topology.Node, 0, len(groups))
	for _, g := range groups {
		nodes = append(nodes, topology.Node{ID: g.ID.String(), Role: topology.RoleTarget})
	}

	// Build the dependency edges. We deduplicate (from,to) pairs deterministically.
	type edgeKey struct{ from, to string }
	seen := map[edgeKey]struct{}{}
	var edges []topology.Edge
	addEdge := func(from, to string) {
		if from == "" || to == "" || from == to {
			return
		}
		k := edgeKey{from: from, to: to}
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		// topology edge direction is from->to meaning "from runs before to" in the
		// TopoSort apply order, which is exactly "to depends on from".
		edges = append(edges, topology.Edge{
			ID:         fmt.Sprintf("%s->%s", from, to),
			FromNodeID: from,
			ToNodeID:   to,
		})
	}

	// (1) Inter-group hard workload dependencies: workload w in group G hard-depends
	// on app key d owned by group D (D != G) => D must run before G (edge D->G).
	for _, g := range groups {
		gid := g.ID.String()
		for _, w := range g.Workloads {
			for _, dep := range w.Dependencies {
				if strings.EqualFold(dep.Criticality, "soft") {
					continue
				}
				depGroup, ok := appKeyToGroup[dep.AppKey]
				if !ok || depGroup == gid {
					continue
				}
				addEdge(depGroup, gid)
			}
		}
	}

	// Hard dependencies are authoritative; a true cycle among them is illegal
	// input and must be rejected. Validate the dependency-only DAG first via the
	// reused topology engine before layering the (soft) sequence chain on top.
	if topology.NewGraph(topology.Topology{Nodes: nodes, Edges: edges}).HasCycle() {
		return nil, fmt.Errorf("move group dependencies form a cycle: %w", ErrInvalidTransition)
	}

	// (2) Wave sequence chain: order groups by their in-wave sequence and add an
	// edge from each group to the next in sequence, so the operator-defined order
	// is honored when no hard dependency forces a different one. The sequence is
	// only a TIE-BREAKER: a hard dependency that already orders the pair the other
	// way takes precedence, so we skip any sequence edge whose reverse is already
	// reachable (which would otherwise create a spurious cycle against a real
	// dependency). Equal sequences are tie-broken by reference for determinism.
	ordered := append([]MoveGroup(nil), groups...)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].WaveSequence != ordered[j].WaveSequence {
			return ordered[i].WaveSequence < ordered[j].WaveSequence
		}
		return ordered[i].Reference < ordered[j].Reference
	})
	for i := 0; i+1 < len(ordered); i++ {
		from := ordered[i].ID.String()
		to := ordered[i+1].ID.String()
		// If `to` already runs before `from` via hard dependencies, adding from->to
		// would close a cycle; the dependency wins, so skip this sequence edge.
		if topology.NewGraph(topology.Topology{Nodes: nodes, Edges: edges}).WouldCreateCycle(from, to) {
			continue
		}
		addEdge(from, to)
	}

	g := topology.NewGraph(topology.Topology{Nodes: nodes, Edges: edges})
	order, ok := g.TopoSort()
	if !ok {
		// Defence in depth: dependency-only acyclicity was already proven and
		// sequence edges that would cycle were skipped, so this should not happen.
		return nil, fmt.Errorf("move group dependencies form a cycle: %w", ErrInvalidTransition)
	}

	out := make([]MoveGroup, 0, len(order))
	for _, id := range order {
		if mg, ok := byID[id]; ok {
			out = append(out, mg)
		}
	}
	return out, nil
}

// orderWorkloads returns a move group's workloads in dependency-respecting order
// using the SAME reused topology graph engine: a workload that hard-depends on
// another workload in the same group runs after it. Determinism comes from the
// graph's sorted Kahn ordering. Soft dependencies do not constrain order.
func orderWorkloads(group MoveGroup) ([]Workload, error) {
	byKey := make(map[string]Workload, len(group.Workloads))
	for _, w := range group.Workloads {
		if w.AppKey != "" {
			byKey[w.AppKey] = w
		}
	}
	nodes := make([]topology.Node, 0, len(byKey))
	for key := range byKey {
		nodes = append(nodes, topology.Node{ID: key, Role: topology.RoleTarget})
	}
	type edgeKey struct{ from, to string }
	seen := map[edgeKey]struct{}{}
	var edges []topology.Edge
	for _, w := range group.Workloads {
		for _, dep := range w.Dependencies {
			if strings.EqualFold(dep.Criticality, "soft") {
				continue
			}
			if _, ok := byKey[dep.AppKey]; !ok || dep.AppKey == w.AppKey {
				continue
			}
			k := edgeKey{from: dep.AppKey, to: w.AppKey}
			if _, dup := seen[k]; dup {
				continue
			}
			seen[k] = struct{}{}
			// dep runs before w: edge dep->w.
			edges = append(edges, topology.Edge{ID: dep.AppKey + "->" + w.AppKey, FromNodeID: dep.AppKey, ToNodeID: w.AppKey})
		}
	}
	g := topology.NewGraph(topology.Topology{Nodes: nodes, Edges: edges})
	order, ok := g.TopoSort()
	if !ok {
		return nil, fmt.Errorf("workload dependencies in move group %s form a cycle: %w", group.Reference, ErrInvalidTransition)
	}
	out := make([]Workload, 0, len(order))
	for _, key := range order {
		out = append(out, byKey[key])
	}
	return out, nil
}

// waveRunbookPlan is the fully-resolved structure the generator produces before
// it calls the DR engine: one parent runbook (a milestone per move group, chained
// in dependency order) and one child runbook per move group (a task per workload).
// It is a pure value so the generation algorithm is unit-testable without HTTP.
type waveRunbookPlan struct {
	Parent   CreateDRRunbookRequest
	Children []childRunbookPlan
}

type childRunbookPlan struct {
	MoveGroupID  string
	MoveGroupRef string
	Ordinal      int
	Request      CreateDRRunbookRequest
}

// buildWaveRunbookPlan projects a wave + its ordered move groups into the runbook
// structure to author in the DR engine. The parent runbook carries one milestone
// task per move group (its planned duration = the wave critical-path contribution
// of that group's workloads), chained in dependency order so the parent runbook's
// own DAG mirrors the move-group execution order. Each child runbook carries one
// manual task per workload, chained in intra-group dependency order, with the
// real per-workload planned duration. Nothing here is hardcoded: durations come
// from workloadDurationSeconds (operator effort or derived), owners from the
// workload/group owners.
func buildWaveRunbookPlan(wave Wave, connPlan connectorTaskPlan) (waveRunbookPlan, error) {
	orderedGroups, err := orderMoveGroups(wave.MoveGroups)
	if err != nil {
		return waveRunbookPlan{}, err
	}

	parent := CreateDRRunbookRequest{
		Name:        runbookName("Wave", wave.Reference, wave.Name),
		Description: fmt.Sprintf("Migrate wave %s cutover runbook (generated from %d move group(s))", wave.Reference, len(orderedGroups)),
	}
	if wave.DRTopologyGroupID != nil {
		parent.GroupID = wave.DRTopologyGroupID.String()
	}

	children := make([]childRunbookPlan, 0, len(orderedGroups))
	for i, group := range orderedGroups {
		orderedWL, werr := orderWorkloads(group)
		if werr != nil {
			return waveRunbookPlan{}, werr
		}

		// Parent milestone task for this move group. Its planned duration is the
		// sum of its workloads' real durations (a faithful rollup, not a constant).
		groupSeconds := 0
		for _, w := range orderedWL {
			dur, _ := workloadDurationSeconds(w)
			groupSeconds += dur
		}
		parent.ImportSteps = append(parent.ImportSteps, DRImportStep{
			Key:                    "mg-" + sanitizeKey(group.Reference),
			Name:                   moveGroupTaskName(group),
			TaskType:               "milestone",
			Required:               true,
			Owner:                  firstNonEmpty(group.Name),
			Instructions:           strings.TrimSpace(group.Description),
			PlannedDurationSeconds: groupSeconds,
			Params: map[string]any{
				"migrate_move_group_id": group.ID.String(),
				"migrate_wave_id":       wave.ID.String(),
				"workload_count":        len(orderedWL),
			},
		})

		// Child runbook: one manual task per workload in intra-group dependency order.
		child := CreateDRRunbookRequest{
			Name:        runbookName("Move group", group.Reference, group.Name),
			Description: fmt.Sprintf("Migrate move group %s (wave %s) — %d workload(s)", group.Reference, wave.Reference, len(orderedWL)),
		}
		if group.DRTopologyGroupID != nil {
			child.GroupID = group.DRTopologyGroupID.String()
		} else if wave.DRTopologyGroupID != nil {
			child.GroupID = wave.DRTopologyGroupID.String()
		}
		for _, w := range orderedWL {
			dur, src := workloadDurationSeconds(w)
			child.ImportSteps = append(child.ImportSteps, DRImportStep{
				Key:                    "wl-" + sanitizeKey(w.AppKey),
				Name:                   workloadTaskName(w),
				TaskType:               "manual",
				Required:               true,
				Owner:                  firstNonEmpty(w.OwnerName, group.Name),
				Instructions:           workloadInstructions(w),
				PlannedDurationSeconds: dur,
				Params: map[string]any{
					"migrate_workload_id": w.ID.String(),
					"app_key":             w.AppKey,
					"strategy":            string(w.Strategy),
					"duration_source":     src,
				},
			})
		}
		children = append(children, childRunbookPlan{
			MoveGroupID:  group.ID.String(),
			MoveGroupRef: group.Reference,
			Ordinal:      i + 1,
			Request:      child,
		})
	}

	if len(parent.ImportSteps) == 0 {
		return waveRunbookPlan{}, fmt.Errorf("wave %s has no move groups to generate a runbook from: %w", wave.Reference, ErrValidation)
	}

	// P10a: emit one AUTOMATED connector-invocation task per configured, enabled
	// connector, AFTER the move-group milestones, so each connector is actually
	// invoked (via migrate's webhook, dispatched by the DR engine's Executor) once
	// the wave's workloads are cut over. The "cutover" action tells the connector
	// this is the forward-migration phase. These are appended to the PARENT runbook
	// (the wave-level run the window executes), chained after the last milestone by
	// the DR engine's linear predecessor DAG.
	for _, connector := range connPlan.connectors {
		parent.ImportSteps = append(parent.ImportSteps, connPlan.automationTask(connector, "cutover", "cutover"))
	}

	return waveRunbookPlan{Parent: parent, Children: children}, nil
}

func runbookName(kind, ref, name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Sprintf("%s %s", kind, ref)
	}
	return fmt.Sprintf("%s %s — %s", kind, ref, name)
}

func moveGroupTaskName(g MoveGroup) string {
	name := strings.TrimSpace(g.Name)
	if name == "" {
		return g.Reference
	}
	return fmt.Sprintf("%s (%s)", name, g.Reference)
}

func workloadTaskName(w Workload) string {
	name := strings.TrimSpace(w.Name)
	if name == "" {
		return w.AppKey
	}
	return fmt.Sprintf("%s [%s]", name, w.AppKey)
}

func workloadInstructions(w Workload) string {
	parts := []string{fmt.Sprintf("Migrate %s using the %s strategy", w.AppKey, w.Strategy)}
	if strings.TrimSpace(w.TargetCloud) != "" {
		parts = append(parts, "target cloud "+w.TargetCloud)
	}
	if strings.TrimSpace(w.SourceEnv) != "" {
		parts = append(parts, "from "+w.SourceEnv)
	}
	return strings.Join(parts, "; ") + "."
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// sanitizeKey makes a stable, readable task key from a reference/app key.
func sanitizeKey(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			b.WriteRune('-')
		default:
			b.WriteRune('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "x"
	}
	return out
}
