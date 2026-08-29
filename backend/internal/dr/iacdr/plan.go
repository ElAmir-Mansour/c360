package iacdr

import "sort"

// PlanStep is one resource in the reconstitution plan, annotated with the WAVE
// (level) it may be applied in. Resources in the same wave have all their
// dependencies satisfied by strictly-earlier waves, so they may be applied in
// parallel; waves are applied strictly in order.
type PlanStep struct {
	// Order is the resource's 0-based position in the flattened apply order.
	Order int `json:"order"`
	// Wave is the longest-path level: a resource's wave is one greater than the
	// MAXIMUM wave of any resource it depends on; a resource with no (in-snapshot)
	// dependencies is wave 0.
	Wave     int         `json:"wave"`
	Key      ResourceKey `json:"key"`
	Address  string      `json:"address"`
	Provider string      `json:"provider"`
	Type     string      `json:"type"`
	Name     string      `json:"name"`
	// DependsOn lists the in-snapshot dependency addresses this step waits on.
	DependsOn []string `json:"depends_on,omitempty"`
}

// ReconstitutionPlan is a topologically-ordered apply plan over a snapshot's
// resources. Steps is the flattened, dependency-respecting order; Waves groups
// the same steps by parallelisable level.
type ReconstitutionPlan struct {
	SnapshotID string       `json:"snapshot_id,omitempty"`
	Steps      []PlanStep   `json:"steps"`
	Waves      [][]PlanStep `json:"waves"`
}

// BuildReconstitutionPlan builds a dependency graph from the resources'
// depends_on edges (resolved by canonical ADDRESS) and produces a
// topologically-ordered apply plan with parallelisable waves. It rejects a graph
// with a cycle (ErrCycle) so the plan is always a valid apply order.
//
// Edges whose target address is NOT one of the snapshot's resources are dropped
// (an external/cross-state dependency cannot be reconstituted here and must not
// stall the plan), which is the correct conservative behaviour for a single
// snapshot's plan. This is REAL graph construction + Kahn longest-path
// levelisation + DFS cycle detection — no I/O — and is unit-tested directly.
func BuildReconstitutionPlan(resources []Resource) (ReconstitutionPlan, error) {
	// Index resources by address; build an address->Resource map. If two resources
	// share an address (should not happen post-parse), the first wins for stable
	// edges.
	byAddr := make(map[string]Resource, len(resources))
	order := make([]string, 0, len(resources))
	for _, r := range resources {
		if _, exists := byAddr[r.Address]; exists {
			continue
		}
		byAddr[r.Address] = r
		order = append(order, r.Address)
	}

	// Build the dependency adjacency restricted to in-snapshot edges.
	// dependsOn[a] = set of addresses a depends on (its in-edges).
	// dependents[b] = addresses that depend on b (its out-edges).
	dependsOn := make(map[string]map[string]struct{}, len(byAddr))
	dependents := make(map[string][]string, len(byAddr))
	indegree := make(map[string]int, len(byAddr))
	for _, addr := range order {
		dependsOn[addr] = make(map[string]struct{})
		indegree[addr] = 0
	}
	for _, addr := range order {
		r := byAddr[addr]
		for _, dep := range r.DependsOn {
			if dep == addr {
				continue // self-edge: ignore (the diff/parse layers also drop these)
			}
			if _, ok := byAddr[dep]; !ok {
				continue // external dependency, not in this snapshot
			}
			if _, dup := dependsOn[addr][dep]; dup {
				continue
			}
			dependsOn[addr][dep] = struct{}{}
			dependents[dep] = append(dependents[dep], addr)
			indegree[addr]++
		}
	}

	// Detect a cycle up front via DFS so we return ErrCycle rather than a partial
	// plan.
	if hasCycle(order, dependsOn) {
		return ReconstitutionPlan{}, ErrCycle
	}

	// Kahn longest-path levelisation. Seed with zero-indegree addresses.
	indeg := make(map[string]int, len(indegree))
	for a, d := range indegree {
		indeg[a] = d
	}
	level := make(map[string]int, len(byAddr))
	var ready []string
	for _, addr := range order {
		if indeg[addr] == 0 {
			ready = append(ready, addr)
			level[addr] = 0
		}
	}
	sort.Strings(ready)

	settled := 0
	for len(ready) > 0 {
		cur := ready[0]
		ready = ready[1:]
		settled++
		curLevel := level[cur]
		deps := append([]string(nil), dependents[cur]...)
		sort.Strings(deps)
		var newlyReady []string
		for _, dep := range deps {
			if curLevel+1 > level[dep] {
				level[dep] = curLevel + 1
			}
			indeg[dep]--
			if indeg[dep] == 0 {
				newlyReady = append(newlyReady, dep)
			}
		}
		ready = append(ready, newlyReady...)
		sort.Strings(ready)
	}

	if settled != len(byAddr) {
		// A cycle would leave nodes with positive indegree forever. hasCycle should
		// have caught it; this is a defensive backstop.
		return ReconstitutionPlan{}, ErrCycle
	}

	// Bucket addresses by level into waves, ordered within a wave by address.
	maxLevel := -1
	for _, lv := range level {
		if lv > maxLevel {
			maxLevel = lv
		}
	}
	plan := ReconstitutionPlan{}
	if maxLevel < 0 {
		return plan, nil
	}
	waveAddrs := make([][]string, maxLevel+1)
	for _, addr := range order {
		lv := level[addr]
		waveAddrs[lv] = append(waveAddrs[lv], addr)
	}

	globalOrder := 0
	for wave, addrs := range waveAddrs {
		sort.Strings(addrs)
		waveSteps := make([]PlanStep, 0, len(addrs))
		for _, addr := range addrs {
			r := byAddr[addr]
			deps := inSnapshotDeps(r, byAddr)
			step := PlanStep{
				Order:     globalOrder,
				Wave:      wave,
				Key:       r.Key(),
				Address:   r.Address,
				Provider:  r.Provider,
				Type:      r.Type,
				Name:      r.Name,
				DependsOn: deps,
			}
			plan.Steps = append(plan.Steps, step)
			waveSteps = append(waveSteps, step)
			globalOrder++
		}
		plan.Waves = append(plan.Waves, waveSteps)
	}
	return plan, nil
}

// inSnapshotDeps returns a resource's dependency addresses restricted to the ones
// present in the snapshot, sorted and de-self-referenced.
func inSnapshotDeps(r Resource, byAddr map[string]Resource) []string {
	if len(r.DependsOn) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(r.DependsOn))
	var out []string
	for _, dep := range r.DependsOn {
		if dep == r.Address {
			continue
		}
		if _, ok := byAddr[dep]; !ok {
			continue
		}
		if _, dup := seen[dep]; dup {
			continue
		}
		seen[dep] = struct{}{}
		out = append(out, dep)
	}
	sort.Strings(out)
	return out
}

// hasCycle reports whether the dependency graph (address -> set of addresses it
// depends on) contains a cycle, via an iterative three-colour DFS
// (white/grey/black). Iterative so deep graphs cannot blow the stack.
func hasCycle(order []string, dependsOn map[string]map[string]struct{}) bool {
	const (
		white = 0
		grey  = 1
		black = 2
	)
	colour := make(map[string]int, len(order))

	// Stable adjacency for deterministic traversal.
	adj := make(map[string][]string, len(dependsOn))
	for node, set := range dependsOn {
		edges := make([]string, 0, len(set))
		for dep := range set {
			edges = append(edges, dep)
		}
		sort.Strings(edges)
		adj[node] = edges
	}

	type frame struct {
		node string
		next int
	}
	for _, start := range order {
		if colour[start] != white {
			continue
		}
		stack := []frame{{node: start, next: 0}}
		colour[start] = grey
		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			edges := adj[top.node]
			if top.next >= len(edges) {
				colour[top.node] = black
				stack = stack[:len(stack)-1]
				continue
			}
			child := edges[top.next]
			top.next++
			switch colour[child] {
			case grey:
				return true
			case white:
				colour[child] = grey
				stack = append(stack, frame{node: child, next: 0})
			}
		}
	}
	return false
}
