package executor

import (
	"context"
	"testing"

	"github.com/clario360/platform/internal/workflow/model"
)

// decisionInstance builds a workflow instance whose variables drive the table.
func decisionInstance(vars map[string]interface{}) *model.WorkflowInstance {
	return &model.WorkflowInstance{
		ID:        "inst-dec",
		TenantID:  "tenant-dec",
		Variables: vars,
	}
}

// input column referencing variables.<label>.
func in(label, expr string) map[string]interface{} {
	return map[string]interface{}{"label": label, "expression": expr}
}
func out(label string) map[string]interface{} {
	return map[string]interface{}{"label": label}
}

func runDecision(t *testing.T, cfg map[string]interface{}, vars map[string]interface{}) (*ExecutionResult, *model.WorkflowInstance, error) {
	t.Helper()
	e := NewDecisionExecutor()
	inst := decisionInstance(vars)
	step := &model.StepDefinition{ID: "decide", Type: model.StepTypeDecisionTask, Config: cfg}
	res, err := e.Execute(context.Background(), inst, step, &model.StepExecution{})
	return res, inst, err
}

// A classic discount decision table used across policy tests.
func discountTable(hitPolicy string) map[string]interface{} {
	return map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": hitPolicy,
			"inputs": []interface{}{
				in("amount", "variables.amount"),
				in("region", "variables.region"),
			},
			"outputs": []interface{}{out("discount"), out("tier")},
			"rules": []interface{}{
				map[string]interface{}{
					"when": []interface{}{">= 1000", "'EU'"},
					"then": map[string]interface{}{"discount": float64(0.2), "tier": "'gold'"},
				},
				map[string]interface{}{
					"when": []interface{}{">= 500", "-"},
					"then": map[string]interface{}{"discount": float64(0.1), "tier": "'silver'"},
				},
				map[string]interface{}{
					"when": []interface{}{"-", "-"},
					"then": map[string]interface{}{"discount": float64(0), "tier": "'none'"},
				},
			},
		},
	}
}

func TestDecision_First(t *testing.T) {
	cfg := discountTable(HitPolicyFirst)
	res, inst, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(1500), "region": "EU"})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if res.Output["discount"] != float64(0.2) {
		t.Errorf("discount = %v, want 0.2", res.Output["discount"])
	}
	if res.Output["tier"] != "gold" {
		t.Errorf("tier = %v, want gold", res.Output["tier"])
	}
	// FIRST stops at the first match even though rows 2 and 3 also match.
	if res.Output["_matched_rules"] != 1 {
		t.Errorf("_matched_rules = %v, want 1 (FIRST short-circuits)", res.Output["_matched_rules"])
	}
	// Outputs are also merged into instance variables for downstream routing.
	if inst.Variables["discount"] != float64(0.2) || inst.Variables["tier"] != "gold" {
		t.Errorf("variables not merged: %v", inst.Variables)
	}
}

func TestDecision_First_FallThrough(t *testing.T) {
	cfg := discountTable(HitPolicyFirst)
	res, _, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(100), "region": "US"})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if res.Output["tier"] != "none" {
		t.Errorf("tier = %v, want none (catch-all row)", res.Output["tier"])
	}
}

func TestDecision_Unique_OK(t *testing.T) {
	// A table where exactly one rule matches.
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": HitPolicyUnique,
			"inputs":     []interface{}{in("sev", "variables.sev")},
			"outputs":    []interface{}{out("route")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{"'low'"}, "then": map[string]interface{}{"route": "'queue-a'"}},
				map[string]interface{}{"when": []interface{}{"'high'"}, "then": map[string]interface{}{"route": "'queue-b'"}},
			},
		},
	}
	res, _, err := runDecision(t, cfg, map[string]interface{}{"sev": "high"})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if res.Output["route"] != "queue-b" {
		t.Errorf("route = %v, want queue-b", res.Output["route"])
	}
}

func TestDecision_Unique_Violation(t *testing.T) {
	// Two overlapping rules both match under UNIQUE => error (fail-closed).
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": HitPolicyUnique,
			"inputs":     []interface{}{in("amount", "variables.amount")},
			"outputs":    []interface{}{out("flag")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"flag": "'a'"}},
				map[string]interface{}{"when": []interface{}{">= 50"}, "then": map[string]interface{}{"flag": "'b'"}},
			},
		},
	}
	_, _, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(200)})
	if err == nil {
		t.Fatal("expected UNIQUE hit-policy violation error for 2 matches")
	}
}

func TestDecision_NoMatch_Errors(t *testing.T) {
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": HitPolicyUnique,
			"inputs":     []interface{}{in("sev", "variables.sev")},
			"outputs":    []interface{}{out("route")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{"'low'"}, "then": map[string]interface{}{"route": "'queue-a'"}},
			},
		},
	}
	_, _, err := runDecision(t, cfg, map[string]interface{}{"sev": "critical"})
	if err == nil {
		t.Fatal("expected no-match error when no rule matches and no default_output")
	}
}

func TestDecision_NoMatch_DefaultOutput(t *testing.T) {
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": HitPolicyUnique,
			"inputs":     []interface{}{in("sev", "variables.sev")},
			"outputs":    []interface{}{out("route")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{"'low'"}, "then": map[string]interface{}{"route": "'queue-a'"}},
			},
			"default_output": map[string]interface{}{"route": "'queue-default'"},
		},
	}
	res, _, err := runDecision(t, cfg, map[string]interface{}{"sev": "critical"})
	if err != nil {
		t.Fatalf("expected default output, got error: %v", err)
	}
	if res.Output["route"] != "queue-default" {
		t.Errorf("route = %v, want queue-default", res.Output["route"])
	}
}

func TestDecision_Priority(t *testing.T) {
	// Multiple rules match; the highest-priority one wins.
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": HitPolicyPriority,
			"inputs":     []interface{}{in("amount", "variables.amount")},
			"outputs":    []interface{}{out("level")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"level": "'low'"}, "priority": int64(1)},
				map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"level": "'high'"}, "priority": int64(10)},
				map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"level": "'mid'"}, "priority": int64(5)},
			},
		},
	}
	res, _, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(200)})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if res.Output["level"] != "high" {
		t.Errorf("level = %v, want high (priority 10)", res.Output["level"])
	}
}

func TestDecision_Collect_List(t *testing.T) {
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": HitPolicyCollect,
			"inputs":     []interface{}{in("amount", "variables.amount")},
			"outputs":    []interface{}{out("tag")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"tag": "'big'"}},
				map[string]interface{}{"when": []interface{}{">= 50"}, "then": map[string]interface{}{"tag": "'medium'"}},
				map[string]interface{}{"when": []interface{}{">= 10000"}, "then": map[string]interface{}{"tag": "'huge'"}},
			},
		},
	}
	res, _, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(200)})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	list, ok := res.Output["tag"].([]interface{})
	if !ok {
		t.Fatalf("tag output not a list: %T", res.Output["tag"])
	}
	if len(list) != 2 || list[0] != "big" || list[1] != "medium" {
		t.Errorf("collected tags = %v, want [big medium]", list)
	}
}

func TestDecision_Collect_Sum(t *testing.T) {
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy":  HitPolicyCollect,
			"aggregation": "sum",
			"inputs":      []interface{}{in("amount", "variables.amount")},
			"outputs":     []interface{}{out("points")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"points": int64(5)}},
				map[string]interface{}{"when": []interface{}{">= 50"}, "then": map[string]interface{}{"points": int64(3)}},
				map[string]interface{}{"when": []interface{}{">= 10000"}, "then": map[string]interface{}{"points": int64(50)}},
			},
		},
	}
	res, _, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(200)})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if res.Output["points"] != int64(8) {
		t.Errorf("summed points = %v, want 8", res.Output["points"])
	}
}

func TestDecision_Collect_Count(t *testing.T) {
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy":  HitPolicyCollect,
			"aggregation": "count",
			"inputs":      []interface{}{in("amount", "variables.amount")},
			"outputs":     []interface{}{out("hit")},
			"rules": []interface{}{
				map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"hit": "'x'"}},
				map[string]interface{}{"when": []interface{}{">= 50"}, "then": map[string]interface{}{"hit": "'y'"}},
			},
		},
	}
	res, _, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(200)})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if res.Output["hit"] != int64(2) {
		t.Errorf("count = %v, want 2", res.Output["hit"])
	}
}

// TestDecision_InputMembershipCell exercises an "in [...]" input cell and a
// FEEL arithmetic output cell (discount computed from the input value).
func TestDecision_MembershipAndComputedOutput(t *testing.T) {
	cfg := map[string]interface{}{
		"decision_table": map[string]interface{}{
			"hit_policy": HitPolicyFirst,
			"inputs":     []interface{}{in("region", "variables.region"), in("amount", "variables.amount")},
			"outputs":    []interface{}{out("final")},
			"rules": []interface{}{
				map[string]interface{}{
					"when": []interface{}{"in ['EU','UK']", "> 0"},
					"then": map[string]interface{}{"final": "variables.amount - variables.amount * 0.2"},
				},
				map[string]interface{}{
					"when": []interface{}{"-", "-"},
					"then": map[string]interface{}{"final": "variables.amount"},
				},
			},
		},
	}
	res, _, err := runDecision(t, cfg, map[string]interface{}{"region": "UK", "amount": int64(1000)})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if res.Output["final"] != float64(800) {
		t.Errorf("final = %v, want 800", res.Output["final"])
	}
}

func TestDecision_WriteToVariablesDisabled(t *testing.T) {
	cfg := discountTable(HitPolicyFirst)
	cfg["write_to_variables"] = false
	_, inst, err := runDecision(t, cfg, map[string]interface{}{"amount": int64(1500), "region": "EU"})
	if err != nil {
		t.Fatalf("execute error: %v", err)
	}
	if _, ok := inst.Variables["discount"]; ok {
		t.Error("expected discount NOT merged into variables when write_to_variables=false")
	}
}

func TestDecision_MalformedTableFailsClosed(t *testing.T) {
	cases := []map[string]interface{}{
		{},                                  // missing decision_table
		{"decision_table": "not-an-object"}, // wrong type
		{"decision_table": map[string]interface{}{}}, // missing hit_policy/inputs/outputs/rules
		{"decision_table": map[string]interface{}{ // bad hit policy
			"hit_policy": "MAYBE",
			"inputs":     []interface{}{in("a", "variables.a")},
			"outputs":    []interface{}{out("o")},
			"rules":      []interface{}{map[string]interface{}{"when": []interface{}{"-"}, "then": map[string]interface{}{"o": "1"}}},
		}},
		{"decision_table": map[string]interface{}{ // rule when-arity mismatch
			"hit_policy": "FIRST",
			"inputs":     []interface{}{in("a", "variables.a"), in("b", "variables.b")},
			"outputs":    []interface{}{out("o")},
			"rules":      []interface{}{map[string]interface{}{"when": []interface{}{"-"}, "then": map[string]interface{}{"o": "1"}}},
		}},
		{"decision_table": map[string]interface{}{ // then references unknown output
			"hit_policy": "FIRST",
			"inputs":     []interface{}{in("a", "variables.a")},
			"outputs":    []interface{}{out("o")},
			"rules":      []interface{}{map[string]interface{}{"when": []interface{}{"-"}, "then": map[string]interface{}{"zzz": "1"}}},
		}},
	}
	for i, cfg := range cases {
		if _, err := ParseDecisionTable(cfg); err == nil {
			t.Errorf("case %d: expected parse error for malformed table", i)
		}
	}
}
