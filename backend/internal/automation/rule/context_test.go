package rule

import (
	"testing"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/rs/zerolog"
)

// TestBuildContext_Shape asserts the context exposes trigger.data, the data
// alias, and variables — the exact shape the workflow engine uses, so one
// grammar spans both engines.
func TestBuildContext_Shape(t *testing.T) {
	ft := FiredTrigger{
		Data:      map[string]any{"k": "v"},
		Variables: map[string]any{"r": 1},
	}
	ctx := BuildContext(ft)

	trig, ok := ctx["trigger"].(map[string]any)
	if !ok {
		t.Fatal("trigger should be a map")
	}
	data, ok := trig["data"].(map[string]any)
	if !ok {
		t.Fatal("trigger.data should be a map")
	}
	if data["k"] != "v" {
		t.Fatalf("trigger.data.k wrong: %v", data["k"])
	}
	alias, ok := ctx["data"].(map[string]any)
	if !ok || alias["k"] != "v" {
		t.Fatalf("data alias missing or wrong: %v", ctx["data"])
	}
	vars, ok := ctx["variables"].(map[string]any)
	if !ok || vars["r"] != 1 {
		t.Fatalf("variables wrong: %v", ctx["variables"])
	}
}

// TestBuildContext_NilInputsResolvable: nil Data/Variables must still produce
// resolvable empty-map nodes so the Evaluator never errors at the root.
func TestBuildContext_NilInputsResolvable(t *testing.T) {
	ctx := BuildContext(FiredTrigger{})
	trig := ctx["trigger"].(map[string]any)
	if _, ok := trig["data"].(map[string]any); !ok {
		t.Fatal("trigger.data should be an empty map, not nil")
	}
	if _, ok := ctx["variables"].(map[string]any); !ok {
		t.Fatal("variables should be an empty map, not nil")
	}
}

// TestNormalize_DeepConversion proves a payload built with non-canonical Go
// types (nested map[string]string, []string, map[any]any) is converted to the
// map[string]interface{} / []interface{} tree the Evaluator can walk — and that
// the resulting context evaluates correctly.
func TestNormalize_DeepConversion(t *testing.T) {
	ft := FiredTrigger{
		Data: map[string]any{
			"labels": map[string]string{"env": "prod"},
			"tags":   []string{"a", "b"},
			"nested": map[any]any{"key": "deep"},
			"ints":   []int{1, 2, 3},
		},
	}
	eng := NewEngine(zerolog.Nop(), Options{})

	cases := []struct {
		expr string
		want bool
	}{
		{"trigger.data.labels.env == 'prod'", true},
		{"'a' in trigger.data.tags", true},
		{"'z' in trigger.data.tags", false},
		{"trigger.data.nested.key == 'deep'", true},
		{"2 in trigger.data.ints", true},
	}
	for _, c := range cases {
		rules := []model.Rule{{
			Priority:  1,
			When:      []model.Condition{{Expr: c.expr}},
			ActionRef: model.ActionRef{Kind: model.ActionNotification, Config: map[string]any{"k": "v"}},
		}}
		got := eng.Evaluate(ft, rules).HasActions()
		if got != c.want {
			t.Fatalf("expr %q: got %v want %v", c.expr, got, c.want)
		}
	}
}

// TestActionIdentity_ByValue: identity is by kind+config value, order-independent.
func TestActionIdentity_ByValue(t *testing.T) {
	a := model.ActionRef{Kind: model.ActionStartWorkflow, Config: map[string]any{"x": 1, "y": "two"}}
	b := model.ActionRef{Kind: model.ActionStartWorkflow, Config: map[string]any{"y": "two", "x": 1}}
	c := model.ActionRef{Kind: model.ActionStartWorkflow, Config: map[string]any{"x": 2, "y": "two"}}
	d := model.ActionRef{Kind: model.ActionNotification, Config: map[string]any{"x": 1, "y": "two"}}

	if actionIdentity(a) != actionIdentity(b) {
		t.Fatal("identical configs (different key order) should share identity")
	}
	if actionIdentity(a) == actionIdentity(c) {
		t.Fatal("different config values should differ in identity")
	}
	if actionIdentity(a) == actionIdentity(d) {
		t.Fatal("different kinds should differ in identity")
	}
}
