package executor

import (
	"context"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// recordingChildStarter records the child-start it was asked to perform and
// returns a canned child instance id.
type recordingChildStarter struct {
	tenantID, startedBy, parentInstance, parentStep, defKey string
	inputs                                                  map[string]interface{}
	called                                                  bool
}

func (r *recordingChildStarter) StartChildInstance(_ context.Context, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey string, inputVars map[string]interface{}) (string, error) {
	r.called = true
	r.tenantID, r.startedBy, r.parentInstance, r.parentStep, r.defKey, r.inputs = tenantID, startedBy, parentInstanceID, parentStepID, definitionKey, inputVars
	return "child-123", nil
}

func (r *recordingChildStarter) StartMultiInstanceChild(_ context.Context, tenantID, startedBy, parentInstanceID, parentStepID, definitionKey string, childIndex int, inputVars map[string]interface{}) (string, error) {
	return "child-mi", nil
}

func (r *recordingChildStarter) SeedMultiInstanceSlot(_ context.Context, tenantID, parentInstanceID, parentStepID string, childIndex int) error {
	return nil
}

var _ ChildStarter = (*recordingChildStarter)(nil)

func callParentInstance() *model.WorkflowInstance {
	return &model.WorkflowInstance{
		ID:        "parent-1",
		TenantID:  "tenant-ca",
		Variables: map[string]interface{}{"subject": "hello"},
	}
}

// TestCallActivityExecuteParksAndMapsInput proves the executor resolves the child
// definition key + input mapping, calls the starter, and PARKS the parent.
func TestCallActivityExecuteParksAndMapsInput(t *testing.T) {
	starter := &recordingChildStarter{}
	e := NewCallActivityExecutor(starter, zerolog.Nop())

	step := &model.StepDefinition{
		ID:   "call",
		Type: model.StepTypeCallActivity,
		Name: "Call",
		Config: map[string]interface{}{
			"definition_key": "child-flow",
			"input_mapping":  map[string]interface{}{"item": "${variables.subject}"},
		},
	}
	res, err := e.Execute(context.Background(), callParentInstance(), step, &model.StepExecution{})
	if err != nil {
		t.Fatalf("Execute error = %v", err)
	}
	if !res.Parked {
		t.Fatal("call_activity must PARK the parent")
	}
	if !starter.called {
		t.Fatal("child starter was not called")
	}
	if starter.defKey != "child-flow" {
		t.Fatalf("child def key = %q, want child-flow", starter.defKey)
	}
	if starter.parentInstance != "parent-1" || starter.parentStep != "call" {
		t.Fatalf("parent link = (%s,%s), want (parent-1,call)", starter.parentInstance, starter.parentStep)
	}
	if got := starter.inputs["item"]; got != "hello" {
		t.Fatalf("mapped input item = %v, want hello", got)
	}
	if got := res.Output["child_instance_id"]; got != "child-123" {
		t.Fatalf("output child_instance_id = %v, want child-123", got)
	}
}

// TestCallActivityMissingDefinitionKey proves a missing definition_key is a clear
// config error (never a silent no-op).
func TestCallActivityMissingDefinitionKey(t *testing.T) {
	e := NewCallActivityExecutor(&recordingChildStarter{}, zerolog.Nop())
	step := &model.StepDefinition{ID: "call", Type: model.StepTypeCallActivity, Config: map[string]interface{}{}}
	if _, err := e.Execute(context.Background(), callParentInstance(), step, &model.StepExecution{}); err == nil {
		t.Fatal("Execute without definition_key returned nil, want a config error")
	}
}

// TestCallActivityNilStarterErrors proves an unwired starter fails loudly.
func TestCallActivityNilStarterErrors(t *testing.T) {
	e := NewCallActivityExecutor(nil, zerolog.Nop())
	step := &model.StepDefinition{ID: "call", Type: model.StepTypeCallActivity, Config: map[string]interface{}{"definition_key": "x"}}
	if _, err := e.Execute(context.Background(), callParentInstance(), step, &model.StepExecution{}); err == nil {
		t.Fatal("Execute with nil starter returned nil, want an error")
	}
}
