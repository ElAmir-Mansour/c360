package bootgraph

import (
	"errors"
	"reflect"
	"testing"
)

// svc is a tiny constructor for a service vertex in planner tests (only ID/Name
// matter to the planner).
func svc(id, name string) Service {
	return Service{ID: id, Name: name}
}

// dep builds a depends_on edge: service depends on dependsOn.
func dep(service, dependsOn string) Dependency {
	return Dependency{ServiceID: service, DependsOnID: dependsOn}
}

func TestPlanner_Tiers_DiamondParallelWithinTierOrderedAcross(t *testing.T) {
	// The canonical case from the prompt: db<-api<-web and cache<-api.
	// Expected tiers = [[db,cache],[api],[web]] (db & cache parallel in tier 0,
	// api in tier 1 after BOTH, web in tier 2).
	services := []Service{
		svc("s-db", "db"),
		svc("s-cache", "cache"),
		svc("s-api", "api"),
		svc("s-web", "web"),
	}
	deps := []Dependency{
		dep("s-api", "s-db"),    // api depends on db
		dep("s-api", "s-cache"), // api depends on cache
		dep("s-web", "s-api"),   // web depends on api
	}

	plan, err := NewPlanner().Plan("group-1", services, deps)
	if err != nil {
		t.Fatalf("Plan returned error: %v", err)
	}

	got := plan.ServiceNames()
	want := [][]string{{"cache", "db"}, {"api"}, {"web"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tiers = %v, want %v", got, want)
	}
	if plan.GroupID != "group-1" {
		t.Errorf("group id = %q, want group-1", plan.GroupID)
	}
}

func TestPlanner_LongestPathLevelisation(t *testing.T) {
	// d depends on BOTH a (tier0) and c (tier2 via c<-b<-a). The longest-path rule
	// must place d in tier 3, NOT tier 1 — a service boots only when EVERY dep is
	// healthy in a strictly-earlier tier.
	//   a (0) -> b (1) -> c (2) -> d (3)
	//   a (0) ----------------- -> d
	services := []Service{
		svc("a", "a"), svc("b", "b"), svc("c", "c"), svc("d", "d"),
	}
	deps := []Dependency{
		dep("b", "a"),
		dep("c", "b"),
		dep("d", "c"),
		dep("d", "a"),
	}
	plan, err := NewPlanner().Plan("g", services, deps)
	if err != nil {
		t.Fatalf("Plan error: %v", err)
	}
	want := [][]string{{"a"}, {"b"}, {"c"}, {"d"}}
	if got := plan.ServiceNames(); !reflect.DeepEqual(got, want) {
		t.Fatalf("tiers = %v, want %v (d must be in the LAST tier)", got, want)
	}
}

func TestPlanner_IndependentServicesAllTierZero(t *testing.T) {
	services := []Service{svc("a", "a"), svc("b", "b"), svc("c", "c")}
	plan, err := NewPlanner().Plan("g", services, nil)
	if err != nil {
		t.Fatalf("Plan error: %v", err)
	}
	want := [][]string{{"a", "b", "c"}}
	if got := plan.ServiceNames(); !reflect.DeepEqual(got, want) {
		t.Fatalf("tiers = %v, want %v", got, want)
	}
}

func TestPlanner_RejectsCycle(t *testing.T) {
	// a -> b -> c -> a is a cycle; no boot order exists.
	services := []Service{svc("a", "a"), svc("b", "b"), svc("c", "c")}
	deps := []Dependency{
		dep("a", "b"),
		dep("b", "c"),
		dep("c", "a"),
	}
	_, err := NewPlanner().Plan("g", services, deps)
	if !errors.Is(err, ErrCycle) {
		t.Fatalf("Plan error = %v, want ErrCycle", err)
	}

	cyclic, herr := NewPlanner().HasCycle(services, deps)
	if herr != nil {
		t.Fatalf("HasCycle error: %v", herr)
	}
	if !cyclic {
		t.Fatal("HasCycle = false, want true for a->b->c->a")
	}
}

func TestPlanner_RejectsSelfDependency(t *testing.T) {
	services := []Service{svc("a", "a")}
	deps := []Dependency{dep("a", "a")}
	if _, err := NewPlanner().Plan("g", services, deps); !errors.Is(err, ErrSelfDependency) {
		t.Fatalf("Plan error = %v, want ErrSelfDependency", err)
	}
}

func TestPlanner_RejectsUnknownDependency(t *testing.T) {
	services := []Service{svc("a", "a")}
	deps := []Dependency{dep("a", "ghost")}
	if _, err := NewPlanner().Plan("g", services, deps); !errors.Is(err, ErrUnknownDependency) {
		t.Fatalf("Plan error = %v, want ErrUnknownDependency", err)
	}
}

func TestPlanner_AcyclicHasNoCycle(t *testing.T) {
	services := []Service{svc("s-db", "db"), svc("s-api", "api"), svc("s-web", "web")}
	deps := []Dependency{dep("s-api", "s-db"), dep("s-web", "s-api")}
	cyclic, err := NewPlanner().HasCycle(services, deps)
	if err != nil {
		t.Fatalf("HasCycle error: %v", err)
	}
	if cyclic {
		t.Fatal("HasCycle = true, want false for an acyclic chain")
	}
}

func TestPlanner_DeduplicatesRepeatedEdge(t *testing.T) {
	// A repeated identical edge must not double the indegree and strand a node.
	services := []Service{svc("a", "a"), svc("b", "b")}
	deps := []Dependency{dep("b", "a"), dep("b", "a")}
	plan, err := NewPlanner().Plan("g", services, deps)
	if err != nil {
		t.Fatalf("Plan error: %v", err)
	}
	want := [][]string{{"a"}, {"b"}}
	if got := plan.ServiceNames(); !reflect.DeepEqual(got, want) {
		t.Fatalf("tiers = %v, want %v", got, want)
	}
}

func TestPlanner_EmptyServiceSet(t *testing.T) {
	plan, err := NewPlanner().Plan("g", nil, nil)
	if err != nil {
		t.Fatalf("Plan error: %v", err)
	}
	if len(plan.Tiers) != 0 {
		t.Fatalf("tiers = %v, want empty", plan.Tiers)
	}
}
