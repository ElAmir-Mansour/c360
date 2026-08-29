package bootgraph

import "sort"

// Planner computes BOOT TIERS from a service-dependency DAG via topological
// LONGEST-PATH levelisation (a Kahn variant). It is a pure engine over the
// service set and dependency edges — no I/O — so the levelisation and cycle
// rejection are unit-tested directly with deterministic fixtures.
//
// Levelisation rule: a service's tier is one greater than the MAXIMUM tier of
// any service it depends on; a service with no dependencies is tier 0. This is
// the longest-path level, which is exactly what a health-gated boot needs: a
// service may only boot once EVERY dependency (not just one) is in an earlier
// tier and therefore already healthy. Services that share a tier have all their
// dependencies satisfied by strictly-earlier tiers, so they boot in parallel.
//
// Example: db<-api<-web and cache<-api yields tiers
// [[db,cache],[api],[web]] — db and cache are independent (tier 0), api depends
// on both (tier 1, after both are healthy), web depends on api (tier 2).
type Planner struct{}

// NewPlanner constructs a Planner.
func NewPlanner() *Planner { return &Planner{} }

// dependsOn maps service ID -> set of service IDs it depends on (its in-edges).
// dependents maps service ID -> service IDs that depend on it (its out-edges).
type depIndex struct {
	dependsOn  map[string]map[string]struct{}
	dependents map[string][]string
	indegree   map[string]int
}

// buildIndex constructs the dependency adjacency from the edge list. Edges whose
// endpoints are not in the service set are reported via ErrUnknownDependency, and
// a self-dependency via ErrSelfDependency, so the planner never silently drops a
// constraint.
func buildIndex(services []Service, deps []Dependency) (depIndex, error) {
	idx := depIndex{
		dependsOn:  make(map[string]map[string]struct{}, len(services)),
		dependents: make(map[string][]string, len(services)),
		indegree:   make(map[string]int, len(services)),
	}
	known := make(map[string]struct{}, len(services))
	for _, s := range services {
		known[s.ID] = struct{}{}
		idx.dependsOn[s.ID] = make(map[string]struct{})
		idx.indegree[s.ID] = 0
	}
	for _, d := range deps {
		if _, ok := known[d.ServiceID]; !ok {
			return depIndex{}, ErrUnknownDependency
		}
		if _, ok := known[d.DependsOnID]; !ok {
			return depIndex{}, ErrUnknownDependency
		}
		if d.ServiceID == d.DependsOnID {
			return depIndex{}, ErrSelfDependency
		}
		// Deduplicate a repeated edge so indegree stays correct.
		if _, dup := idx.dependsOn[d.ServiceID][d.DependsOnID]; dup {
			continue
		}
		idx.dependsOn[d.ServiceID][d.DependsOnID] = struct{}{}
		idx.dependents[d.DependsOnID] = append(idx.dependents[d.DependsOnID], d.ServiceID)
		idx.indegree[d.ServiceID]++
	}
	return idx, nil
}

// Plan computes the boot tiers for a group's service set and dependency edges.
// It returns ErrCycle when the graph contains a cycle (no valid boot order),
// ErrUnknownDependency / ErrSelfDependency for malformed edges. Within a tier,
// services are ordered by name for deterministic, stable output.
func (Planner) Plan(groupID string, services []Service, deps []Dependency) (BootPlan, error) {
	idx, err := buildIndex(services, deps)
	if err != nil {
		return BootPlan{}, err
	}

	byID := make(map[string]Service, len(services))
	for _, s := range services {
		byID[s.ID] = s
	}

	// Kahn over a copy of the indegree map, assigning each settled node a LEVEL
	// equal to one more than the max level of its dependencies (longest path).
	indeg := make(map[string]int, len(idx.indegree))
	for id, d := range idx.indegree {
		indeg[id] = d
	}
	level := make(map[string]int, len(services))

	// Seed the queue with every zero-indegree (dependency-free) service.
	var ready []string
	for id, d := range indeg {
		if d == 0 {
			ready = append(ready, id)
			level[id] = 0
		}
	}
	sort.Strings(ready)

	settled := 0
	for len(ready) > 0 {
		// Pop the smallest ready node for determinism (does not affect levels).
		cur := ready[0]
		ready = ready[1:]
		settled++

		curLevel := level[cur]
		// Relax every dependent: its level is at least curLevel+1.
		newlyReady := make([]string, 0, len(idx.dependents[cur]))
		for _, dep := range idx.dependents[cur] {
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

	if settled != len(services) {
		// A cycle left some nodes with a positive indegree forever.
		return BootPlan{}, ErrCycle
	}

	// Bucket services by level into tiers, ordered within a tier by name.
	maxLevel := -1
	for _, lv := range level {
		if lv > maxLevel {
			maxLevel = lv
		}
	}
	plan := BootPlan{GroupID: groupID}
	if maxLevel < 0 {
		return plan, nil // no services
	}
	tiers := make([][]Service, maxLevel+1)
	for _, s := range services {
		lv := level[s.ID]
		tiers[lv] = append(tiers[lv], s)
	}
	for i := range tiers {
		sort.Slice(tiers[i], func(a, b int) bool {
			if tiers[i][a].Name != tiers[i][b].Name {
				return tiers[i][a].Name < tiers[i][b].Name
			}
			return tiers[i][a].ID < tiers[i][b].ID
		})
	}
	plan.Tiers = tiers
	return plan, nil
}

// HasCycle reports whether the dependency edges form a cycle over the service
// set, independent of the full plan. Used by the service to reject a definition
// before persisting it. It is a three-colour DFS (white/grey/black).
func (Planner) HasCycle(services []Service, deps []Dependency) (bool, error) {
	idx, err := buildIndex(services, deps)
	if err != nil {
		return false, err
	}
	const (
		white = 0
		grey  = 1
		black = 2
	)
	colour := make(map[string]int, len(services))
	ids := make([]string, 0, len(services))
	for _, s := range services {
		ids = append(ids, s.ID)
	}
	sort.Strings(ids)

	type frame struct {
		node string
		next int
	}
	// Build a stable adjacency (dependent -> dependency) so DFS follows depends_on.
	out := make(map[string][]string, len(services))
	for svc, set := range idx.dependsOn {
		for dep := range set {
			out[svc] = append(out[svc], dep)
		}
		sort.Strings(out[svc])
	}

	for _, start := range ids {
		if colour[start] != white {
			continue
		}
		stack := []frame{{node: start, next: 0}}
		colour[start] = grey
		for len(stack) > 0 {
			top := &stack[len(stack)-1]
			edges := out[top.node]
			if top.next >= len(edges) {
				colour[top.node] = black
				stack = stack[:len(stack)-1]
				continue
			}
			child := edges[top.next]
			top.next++
			switch colour[child] {
			case grey:
				return true, nil
			case white:
				colour[child] = grey
				stack = append(stack, frame{node: child, next: 0})
			}
		}
	}
	return false, nil
}
