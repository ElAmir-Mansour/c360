package executor

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// echoSyncExecutor completes an inner step synchronously, echoing the per-element
// "item" variable it was given. failItem, when set, makes the element with that
// value fail — used to exercise the completion policies over partial failure.
type echoSyncExecutor struct {
	failItem string
}

func (e *echoSyncExecutor) Execute(_ context.Context, inst *model.WorkflowInstance, step *model.StepDefinition, _ *model.StepExecution) (*ExecutionResult, error) {
	item, _ := inst.Variables["item"].(string)
	if e.failItem != "" && item == e.failItem {
		return nil, errors.New("inner element failed: " + item)
	}
	return &ExecutionResult{Output: map[string]interface{}{"item": item}}, nil
}

// buildSyncMIExecutor wires a MultiInstanceExecutor whose registry dispatches the
// inner step to echoSyncExecutor. The starter is nil (sync mode does not use it).
func buildSyncMIExecutor(failItem string) (*MultiInstanceExecutor, *ExecutorRegistry, *model.StepDefinition) {
	reg := NewExecutorRegistry()
	reg.Register("service_task", &echoSyncExecutor{failItem: failItem})
	innerStep := &model.StepDefinition{ID: "inner", Type: "service_task", Name: "Inner", Config: map[string]interface{}{}}
	lookup := func(id string) (*model.StepDefinition, bool) {
		if id == "inner" {
			return innerStep, true
		}
		return nil, false
	}
	mi := NewMultiInstanceExecutor(nil, reg, lookup, zerolog.Nop())
	return mi, reg, innerStep
}

func syncMIStep(policy interface{}) *model.StepDefinition {
	cfg := map[string]interface{}{
		"collection":  "${variables.items}",
		"inner_step":  "inner",
		"element_var": "item",
	}
	if policy != nil {
		cfg["completion_policy"] = policy
	}
	return &model.StepDefinition{ID: "fanout", Type: model.StepTypeMultiInstance, Name: "Fan Out", Config: cfg}
}

func miParentInstance(items ...string) *model.WorkflowInstance {
	coll := make([]interface{}, len(items))
	for i, s := range items {
		coll[i] = s
	}
	return &model.WorkflowInstance{
		ID:        "inst-sync-mi",
		TenantID:  "tenant-sync-mi",
		Variables: map[string]interface{}{"items": coll},
	}
}

// TestMultiInstanceSyncFanOutAll proves the sync inner-step fan-out runs the inner
// step once per element and aggregates outputs under the default "all" policy.
func TestMultiInstanceSyncFanOutAll(t *testing.T) {
	mi, _, _ := buildSyncMIExecutor("")
	res, err := mi.Execute(context.Background(), miParentInstance("a", "b", "c"), syncMIStep(nil), &model.StepExecution{})
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if res.Parked {
		t.Fatal("sync fan-out must NOT park")
	}
	results, _ := res.Output["results"].([]interface{})
	if len(results) != 3 {
		t.Fatalf("results len = %d, want 3", len(results))
	}
	if got := res.Output["completed_children"]; got != 3 {
		t.Fatalf("completed_children = %v, want 3", got)
	}
}

// TestMultiInstanceSyncFanOutAllFailsWhenElementFails proves "all" fails the step
// when an element fails.
func TestMultiInstanceSyncFanOutAllFailsWhenElementFails(t *testing.T) {
	mi, _, _ := buildSyncMIExecutor("b")
	_, err := mi.Execute(context.Background(), miParentInstance("a", "b", "c"), syncMIStep(nil), &model.StepExecution{})
	if err == nil {
		t.Fatal("Execute under 'all' with a failing element returned nil, want an error")
	}
}

// TestMultiInstanceSyncFanOutAnyToleratesFailure proves "any" completes as long as
// at least one element succeeds, even when another fails.
func TestMultiInstanceSyncFanOutAnyToleratesFailure(t *testing.T) {
	mi, _, _ := buildSyncMIExecutor("a")
	res, err := mi.Execute(context.Background(), miParentInstance("a", "b", "c"), syncMIStep("any"), &model.StepExecution{})
	if err != nil {
		t.Fatalf("Execute under 'any' error = %v", err)
	}
	results, _ := res.Output["results"].([]interface{})
	if len(results) < 1 {
		t.Fatalf("results len = %d, want >=1 under 'any'", len(results))
	}
}

// TestMultiInstanceEmptyCollectionSync proves an empty collection completes the
// step immediately with an empty result (and does not park).
func TestMultiInstanceEmptyCollectionSync(t *testing.T) {
	mi, _, _ := buildSyncMIExecutor("")
	res, err := mi.Execute(context.Background(), miParentInstance(), syncMIStep(nil), &model.StepExecution{})
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if res.Parked {
		t.Fatal("empty collection must not park")
	}
	if got := res.Output["collection_size"]; got != 0 {
		t.Fatalf("collection_size = %v, want 0", got)
	}
}

// TestMICompletionSatisfied pins the engine-side fan-in policy decision.
func TestMICompletionSatisfied(t *testing.T) {
	cases := []struct {
		name              string
		policy            interface{}
		total, done, fail int
		wantSat, wantFail bool
	}{
		{"all-incomplete", nil, 3, 2, 0, false, false},
		{"all-complete", nil, 3, 3, 0, true, false},
		{"all-one-failed", nil, 3, 2, 1, false, true},
		{"any-none-yet", "any", 3, 0, 0, false, false},
		{"any-one-done", "any", 3, 1, 0, true, false},
		{"any-all-failed", "any", 3, 0, 3, false, true},
		{"nofm-below", float64(2), 3, 1, 0, false, false},
		{"nofm-met", float64(2), 3, 2, 0, true, false},
		{"nofm-impossible", float64(2), 3, 1, 2, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := map[string]interface{}{}
			if tc.policy != nil {
				cfg["completion_policy"] = tc.policy
			}
			sat, failed := MICompletionSatisfied(cfg, tc.total, tc.done, tc.fail)
			if sat != tc.wantSat || failed != tc.wantFail {
				t.Fatalf("MICompletionSatisfied = (%v,%v), want (%v,%v)", sat, failed, tc.wantSat, tc.wantFail)
			}
		})
	}
}

// TestMultiInstanceValidStepTypeRegistered guards the additive step-type set.
func TestMultiInstanceValidStepTypeRegistered(t *testing.T) {
	if !model.ValidStepTypes[model.StepTypeMultiInstance] {
		t.Fatal("multi_instance not in ValidStepTypes")
	}
	if !model.ValidStepTypes[model.StepTypeCallActivity] {
		t.Fatal("call_activity not in ValidStepTypes")
	}
}
