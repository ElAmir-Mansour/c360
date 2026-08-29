package selfdr

import (
	"fmt"
	"sort"
)

// Planner computes restore waves from a component dependency DAG.
type Planner struct{}

// NewPlanner constructs a Planner.
func NewPlanner() *Planner { return &Planner{} }

// PlanRestoreWaves computes restore waves with the default planner.
func PlanRestoreWaves(profile SelfDRProfile) (RestorePlan, error) {
	return NewPlanner().Plan(profile)
}

type dependencyIndex struct {
	dependsOn  map[string]map[string]struct{}
	dependents map[string][]string
	indegree   map[string]int
}

func buildDependencyIndex(components []Component, deps []Dependency) (dependencyIndex, error) {
	idx := dependencyIndex{
		dependsOn:  make(map[string]map[string]struct{}, len(components)),
		dependents: make(map[string][]string, len(components)),
		indegree:   make(map[string]int, len(components)),
	}
	known := make(map[string]struct{}, len(components))
	for _, c := range components {
		if c.ID == "" {
			return dependencyIndex{}, fmt.Errorf("%w: empty component id", ErrInvalidComponent)
		}
		if _, exists := known[c.ID]; exists {
			return dependencyIndex{}, fmt.Errorf("%w: %s", ErrDuplicateComponent, c.ID)
		}
		known[c.ID] = struct{}{}
		idx.dependsOn[c.ID] = make(map[string]struct{})
		idx.indegree[c.ID] = 0
	}
	for _, d := range deps {
		if _, ok := known[d.ComponentID]; !ok {
			return dependencyIndex{}, fmt.Errorf("%w: %s", ErrUnknownDependency, d.ComponentID)
		}
		if _, ok := known[d.DependsOnID]; !ok {
			return dependencyIndex{}, fmt.Errorf("%w: %s", ErrUnknownDependency, d.DependsOnID)
		}
		if d.ComponentID == d.DependsOnID {
			return dependencyIndex{}, ErrSelfDependency
		}
		if _, dup := idx.dependsOn[d.ComponentID][d.DependsOnID]; dup {
			continue
		}
		idx.dependsOn[d.ComponentID][d.DependsOnID] = struct{}{}
		idx.dependents[d.DependsOnID] = append(idx.dependents[d.DependsOnID], d.ComponentID)
		idx.indegree[d.ComponentID]++
	}
	for id := range idx.dependents {
		sort.Strings(idx.dependents[id])
	}
	return idx, nil
}

// Plan computes restore waves. A component appears in wave N only after every
// declared dependency appears in an earlier wave. Components within a wave are
// sorted deterministically by name, kind, then ID.
func (Planner) Plan(profile SelfDRProfile) (RestorePlan, error) {
	idx, err := buildDependencyIndex(profile.Components, profile.Dependencies)
	if err != nil {
		return RestorePlan{}, err
	}

	byID := make(map[string]Component, len(profile.Components))
	for _, c := range profile.Components {
		byID[c.ID] = c
	}

	indeg := make(map[string]int, len(idx.indegree))
	for id, d := range idx.indegree {
		indeg[id] = d
	}
	level := make(map[string]int, len(profile.Components))

	var ready []string
	for id, d := range indeg {
		if d == 0 {
			ready = append(ready, id)
			level[id] = 0
		}
	}
	sortIDsByComponent(ready, byID)

	settled := 0
	for len(ready) > 0 {
		cur := ready[0]
		ready = ready[1:]
		settled++

		curLevel := level[cur]
		newlyReady := make([]string, 0, len(idx.dependents[cur]))
		for _, dependent := range idx.dependents[cur] {
			if curLevel+1 > level[dependent] {
				level[dependent] = curLevel + 1
			}
			indeg[dependent]--
			if indeg[dependent] == 0 {
				newlyReady = append(newlyReady, dependent)
			}
		}
		ready = append(ready, newlyReady...)
		sortIDsByComponent(ready, byID)
	}

	if settled != len(profile.Components) {
		return RestorePlan{}, ErrCycle
	}

	plan := RestorePlan{ProfileID: profile.ID}
	if len(profile.Components) == 0 {
		return plan, nil
	}

	maxLevel := 0
	for _, lv := range level {
		if lv > maxLevel {
			maxLevel = lv
		}
	}
	waves := make([][]Component, maxLevel+1)
	for _, c := range profile.Components {
		waves[level[c.ID]] = append(waves[level[c.ID]], c)
	}
	for i := range waves {
		sort.Slice(waves[i], func(a, b int) bool {
			return componentLess(waves[i][a], waves[i][b])
		})
		plan.Waves = append(plan.Waves, RestoreWave{
			Sequence:   i + 1,
			Components: cloneComponents(waves[i]),
		})
	}
	return plan, nil
}

// HasCycle reports whether the profile dependency graph contains a cycle.
func (p Planner) HasCycle(profile SelfDRProfile) (bool, error) {
	_, err := p.Plan(profile)
	if err == nil {
		return false, nil
	}
	if err == ErrCycle {
		return true, nil
	}
	return false, err
}

func sortIDsByComponent(ids []string, byID map[string]Component) {
	sort.Slice(ids, func(i, j int) bool {
		return componentLess(byID[ids[i]], byID[ids[j]])
	})
}

func componentLess(a, b Component) bool {
	if a.Name != b.Name {
		return a.Name < b.Name
	}
	if a.Kind != b.Kind {
		return a.Kind < b.Kind
	}
	return a.ID < b.ID
}

func cloneComponents(in []Component) []Component {
	out := make([]Component, len(in))
	for i, c := range in {
		out[i] = c
		out[i].RecoveryLocations = append([]string(nil), c.RecoveryLocations...)
		if c.Metadata != nil {
			out[i].Metadata = cloneStringMap(c.Metadata)
		}
	}
	return out
}

func cloneStringMap(in map[string]string) map[string]string {
	if in == nil {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[k] = v
	}
	return out
}
