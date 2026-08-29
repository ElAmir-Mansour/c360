package service

import (
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// baseDef wraps a set of steps into an otherwise-valid definition (manual
// trigger, a definition_key, entry step + end step) so validateStepConfig is the
// only thing under test.
func baseDef(defKey string, steps ...model.StepDefinition) *model.WorkflowDefinition {
	all := append([]model.StepDefinition{}, steps...)
	all = append(all, model.StepDefinition{ID: "end", Type: model.StepTypeEnd, Name: "End"})
	return &model.WorkflowDefinition{
		Name:          "DMN Test",
		Category:      model.CategoryCustom,
		DefinitionKey: defKey,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{},
		Steps:         all,
	}
}

// hasFieldError reports whether any validation error targets a field containing
// the given substring.
func hasFieldError(errs []dto.ValidationError, fieldSubstr string) bool {
	for _, e := range errs {
		if strings.Contains(e.Field, fieldSubstr) {
			return true
		}
	}
	return false
}

func validate(steps ...model.StepDefinition) []dto.ValidationError {
	svc := NewDefinitionService(nil, zerolog.Nop())
	return svc.ValidateDefinition(baseDef("parent-key", steps...))
}

func validateWithKey(defKey string, steps ...model.StepDefinition) []dto.ValidationError {
	svc := NewDefinitionService(nil, zerolog.Nop())
	return svc.ValidateDefinition(baseDef(defKey, steps...))
}

// ---------- decision_task ----------

func wellFormedDecisionStep() model.StepDefinition {
	return model.StepDefinition{
		ID:   "decide",
		Type: model.StepTypeDecisionTask,
		Name: "Decide",
		Config: map[string]interface{}{
			"decision_table": map[string]interface{}{
				"hit_policy": "FIRST",
				"inputs":     []interface{}{map[string]interface{}{"label": "amount", "expression": "variables.amount"}},
				"outputs":    []interface{}{map[string]interface{}{"label": "tier"}},
				"rules": []interface{}{
					map[string]interface{}{"when": []interface{}{">= 100"}, "then": map[string]interface{}{"tier": "'gold'"}},
					map[string]interface{}{"when": []interface{}{"-"}, "then": map[string]interface{}{"tier": "'std'"}},
				},
			},
		},
		Transitions: []model.Transition{{Target: "end"}},
	}
}

func TestValidate_DecisionTask_WellFormed(t *testing.T) {
	errs := validate(wellFormedDecisionStep())
	if hasFieldError(errs, "decision_table") {
		t.Fatalf("well-formed decision_task should not error: %+v", errs)
	}
}

func TestValidate_DecisionTask_Malformed(t *testing.T) {
	// Bad hit policy.
	step := wellFormedDecisionStep()
	tbl := step.Config["decision_table"].(map[string]interface{})
	tbl["hit_policy"] = "SOMETIMES"
	errs := validate(step)
	if !hasFieldError(errs, "decision_table") {
		t.Errorf("expected decision_table error for bad hit policy, got %+v", errs)
	}

	// Missing table entirely.
	step2 := model.StepDefinition{ID: "d2", Type: model.StepTypeDecisionTask, Name: "D2", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}}
	errs2 := validate(step2)
	if !hasFieldError(errs2, "decision_table") {
		t.Errorf("expected decision_table error for missing table, got %+v", errs2)
	}
}

func TestValidate_DecisionTask_InvalidExpression(t *testing.T) {
	step := wellFormedDecisionStep()
	tbl := step.Config["decision_table"].(map[string]interface{})
	// Syntactically invalid input expression.
	tbl["inputs"] = []interface{}{map[string]interface{}{"label": "x", "expression": "variables.amount +"}}
	errs := validate(step)
	if !hasFieldError(errs, "decision_table") {
		t.Errorf("expected error for invalid input expression, got %+v", errs)
	}
}

// ---------- call_activity ----------

func TestValidate_CallActivity_RequiresChildKey(t *testing.T) {
	step := model.StepDefinition{
		ID: "call", Type: model.StepTypeCallActivity, Name: "Call",
		Config:      map[string]interface{}{}, // no definition_key
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validate(step)
	if !hasFieldError(errs, "definition_key") {
		t.Errorf("expected definition_key error, got %+v", errs)
	}
}

func TestValidate_CallActivity_RejectsSelfReference(t *testing.T) {
	step := model.StepDefinition{
		ID: "call", Type: model.StepTypeCallActivity, Name: "Call",
		Config:      map[string]interface{}{"definition_key": "parent-key"}, // == enclosing key
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validateWithKey("parent-key", step)
	if !hasFieldError(errs, "definition_key") {
		t.Errorf("expected self-reference error, got %+v", errs)
	}
}

func TestValidate_CallActivity_WellFormed(t *testing.T) {
	step := model.StepDefinition{
		ID: "call", Type: model.StepTypeCallActivity, Name: "Call",
		Config:      map[string]interface{}{"definition_key": "child-key"},
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validateWithKey("parent-key", step)
	if hasFieldError(errs, "definition_key") || hasFieldError(errs, "input_mapping") {
		t.Errorf("well-formed call_activity should not error: %+v", errs)
	}
}

func TestValidate_CallActivity_BadInputMapping(t *testing.T) {
	step := model.StepDefinition{
		ID: "call", Type: model.StepTypeCallActivity, Name: "Call",
		Config:      map[string]interface{}{"definition_key": "child-key", "input_mapping": "not-a-map"},
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validateWithKey("parent-key", step)
	if !hasFieldError(errs, "input_mapping") {
		t.Errorf("expected input_mapping error, got %+v", errs)
	}
}

// ---------- boundary events (fail-closed) ----------

// TestValidate_EventGateway_RejectsAttachedBoundaryEvents proves the fail-closed
// guard: attaching interrupting boundary_events to an event_based_gateway is
// ambiguous (the gateway carries its own wait arms) and must be rejected at
// validation, so no unmarked/marked registration can leak on interruption.
func TestValidate_EventGateway_RejectsAttachedBoundaryEvents(t *testing.T) {
	step := model.StepDefinition{
		ID: "gw", Type: model.StepTypeEventGateway, Name: "GW",
		Config: map[string]interface{}{
			"events": []interface{}{
				map[string]interface{}{"id": "a", "type": "timer", "target": "end", "duration": "PT1H"},
			},
		},
		BoundaryEvents: []model.BoundaryEvent{
			{ID: "b", Type: model.BoundaryEventTypeTimer, HandlerStepID: "end",
				Config: map[string]interface{}{"duration": "PT30M"}},
		},
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validate(step)
	if !hasFieldError(errs, "boundary_events") {
		t.Errorf("expected boundary_events rejection on event_based_gateway, got %+v", errs)
	}
}

// TestValidate_TimerStep_AllowsBoundaryEvents proves the guard is scoped: a TIMER
// step MAY carry boundary events (its own durable work is torn down on
// interruption), so this must NOT be flagged.
func TestValidate_TimerStep_AllowsBoundaryEvents(t *testing.T) {
	step := model.StepDefinition{
		ID: "sleep", Type: model.StepTypeTimer, Name: "Sleep",
		Config: map[string]interface{}{"duration": "PT1H"},
		BoundaryEvents: []model.BoundaryEvent{
			{ID: "b", Type: model.BoundaryEventTypeMessage, HandlerStepID: "end",
				Config: map[string]interface{}{"topic": "cancel", "correlation_value": "c1"}},
		},
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validate(step)
	if hasFieldError(errs, "boundary_events") {
		t.Errorf("timer step boundary_events should be allowed, got %+v", errs)
	}
}

// ---------- multi_instance ----------

func TestValidate_MultiInstance_RequiresCollectionAndTarget(t *testing.T) {
	step := model.StepDefinition{
		ID: "mi", Type: model.StepTypeMultiInstance, Name: "MI",
		Config:      map[string]interface{}{}, // no collection, no fan-out target
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validate(step)
	if !hasFieldError(errs, "collection") {
		t.Errorf("expected collection error, got %+v", errs)
	}
	found := false
	for _, e := range errs {
		if strings.Contains(e.Message, "fan-out target") {
			found = true
		}
	}
	if !found {
		t.Errorf("expected fan-out target error, got %+v", errs)
	}
}

func TestValidate_MultiInstance_BadCompletionPolicy(t *testing.T) {
	step := model.StepDefinition{
		ID: "mi", Type: model.StepTypeMultiInstance, Name: "MI",
		Config: map[string]interface{}{
			"collection":           "${variables.items}",
			"child_definition_key": "child-key",
			"completion_policy":    "most",
		},
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validate(step)
	if !hasFieldError(errs, "completion_policy") {
		t.Errorf("expected completion_policy error, got %+v", errs)
	}
}

func TestValidate_MultiInstance_WellFormed(t *testing.T) {
	step := model.StepDefinition{
		ID: "mi", Type: model.StepTypeMultiInstance, Name: "MI",
		Config: map[string]interface{}{
			"collection":           "${variables.items}",
			"child_definition_key": "child-key",
			"completion_policy":    "any",
		},
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validate(step)
	if hasFieldError(errs, "collection") || hasFieldError(errs, "completion_policy") {
		t.Errorf("well-formed multi_instance should not error: %+v", errs)
	}
}

func TestValidate_MultiInstance_SelfReference(t *testing.T) {
	step := model.StepDefinition{
		ID: "mi", Type: model.StepTypeMultiInstance, Name: "MI",
		Config: map[string]interface{}{
			"collection":           "${variables.items}",
			"child_definition_key": "parent-key",
		},
		Transitions: []model.Transition{{Target: "end"}},
	}
	errs := validateWithKey("parent-key", step)
	if !hasFieldError(errs, "child_definition_key") {
		t.Errorf("expected self-reference error, got %+v", errs)
	}
}
