package iacdr

import (
	"errors"
	"testing"
)

func TestBuildReconstitutionPlan_TopologicalOrder(t *testing.T) {
	// The canonical chain: vpc <- subnet <- instance. Plus an independent
	// security group at wave 0 to prove parallel waves.
	resources := []Resource{
		mkRes("aws", "aws_instance", "web", nil, "aws_subnet.main"),
		mkRes("aws", "aws_subnet", "main", nil, "aws_vpc.main"),
		mkRes("aws", "aws_vpc", "main", nil),
		mkRes("aws", "aws_security_group", "sg", nil),
	}

	plan, err := BuildReconstitutionPlan(resources)
	if err != nil {
		t.Fatalf("BuildReconstitutionPlan: %v", err)
	}

	wave := map[string]int{}
	for _, s := range plan.Steps {
		wave[s.Address] = s.Wave
	}
	if wave["aws_vpc.main"] != 0 {
		t.Errorf("vpc wave = %d, want 0", wave["aws_vpc.main"])
	}
	if wave["aws_security_group.sg"] != 0 {
		t.Errorf("sg wave = %d, want 0", wave["aws_security_group.sg"])
	}
	if wave["aws_subnet.main"] != 1 {
		t.Errorf("subnet wave = %d, want 1", wave["aws_subnet.main"])
	}
	if wave["aws_instance.web"] != 2 {
		t.Errorf("instance wave = %d, want 2", wave["aws_instance.web"])
	}

	// The flattened order must respect dependencies: a dependency appears before
	// its dependent.
	order := map[string]int{}
	for _, s := range plan.Steps {
		order[s.Address] = s.Order
	}
	if !(order["aws_vpc.main"] < order["aws_subnet.main"] &&
		order["aws_subnet.main"] < order["aws_instance.web"]) {
		t.Fatalf("apply order not topological: %+v", order)
	}

	// 3 waves: [vpc,sg], [subnet], [instance].
	if len(plan.Waves) != 3 {
		t.Fatalf("waves = %d, want 3", len(plan.Waves))
	}
	if len(plan.Waves[0]) != 2 {
		t.Errorf("wave 0 size = %d, want 2 (vpc+sg)", len(plan.Waves[0]))
	}
}

func TestBuildReconstitutionPlan_CycleRejected(t *testing.T) {
	// a -> b -> c -> a is a cycle: no apply order exists.
	resources := []Resource{
		mkRes("p", "t", "a", nil, "t.b"),
		mkRes("p", "t", "b", nil, "t.c"),
		mkRes("p", "t", "c", nil, "t.a"),
	}
	_, err := BuildReconstitutionPlan(resources)
	if !errors.Is(err, ErrCycle) {
		t.Fatalf("err = %v, want ErrCycle", err)
	}
}

func TestBuildReconstitutionPlan_SelfCycleIgnored(t *testing.T) {
	// A self-edge is not a real cycle for planning (parser/diff strip these); the
	// planner ignores it rather than rejecting the whole graph.
	resources := []Resource{
		mkRes("p", "t", "a", nil, "t.a"),
	}
	plan, err := BuildReconstitutionPlan(resources)
	if err != nil {
		t.Fatalf("self-edge should not reject: %v", err)
	}
	if len(plan.Steps) != 1 || plan.Steps[0].Wave != 0 {
		t.Fatalf("self-edge plan wrong: %+v", plan.Steps)
	}
}

func TestBuildReconstitutionPlan_ExternalDependencyDropped(t *testing.T) {
	// A dependency on a resource NOT in the snapshot (e.g. a cross-state data
	// source) is dropped, not stalling the plan. The instance depends on the
	// in-snapshot subnet AND an external "data.aws_ami.x".
	resources := []Resource{
		mkRes("aws", "aws_instance", "web", nil, "aws_subnet.main", "data.aws_ami.x"),
		mkRes("aws", "aws_subnet", "main", nil),
	}
	plan, err := BuildReconstitutionPlan(resources)
	if err != nil {
		t.Fatalf("BuildReconstitutionPlan: %v", err)
	}
	wave := map[string]int{}
	deps := map[string][]string{}
	for _, s := range plan.Steps {
		wave[s.Address] = s.Wave
		deps[s.Address] = s.DependsOn
	}
	if wave["aws_subnet.main"] != 0 || wave["aws_instance.web"] != 1 {
		t.Fatalf("waves wrong: %+v", wave)
	}
	// The external edge must not appear in the step's in-snapshot deps.
	if contains(deps["aws_instance.web"], "data.aws_ami.x") {
		t.Errorf("external dependency leaked into plan: %v", deps["aws_instance.web"])
	}
	if !contains(deps["aws_instance.web"], "aws_subnet.main") {
		t.Errorf("in-snapshot dependency missing: %v", deps["aws_instance.web"])
	}
}

func TestBuildReconstitutionPlan_Empty(t *testing.T) {
	plan, err := BuildReconstitutionPlan(nil)
	if err != nil {
		t.Fatalf("empty plan err: %v", err)
	}
	if len(plan.Steps) != 0 || len(plan.Waves) != 0 {
		t.Fatalf("empty plan should be empty: %+v", plan)
	}
}
