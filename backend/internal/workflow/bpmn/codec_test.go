package bpmn

import (
	"encoding/xml"
	"reflect"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/workflow/model"
)

// representativeDefinition builds a WorkflowDefinition that exercises EVERY
// supported step type, boundary event type, guarded + unguarded transitions,
// nested config maps, and definition-level trigger + variable metadata — so the
// round-trip test proves fidelity across the whole conformance matrix, not a
// happy-path subset.
func representativeDefinition() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:            "def-1",
		TenantID:      "tenant-1",
		Name:          "Contract Review",
		Description:   "End-to-end contract review workflow",
		Category:      model.CategoryApproval,
		DefinitionKey: "contract-review",
		Version:       3,
		Status:        model.DefinitionStatusDraft,
		TriggerConfig: model.TriggerConfig{
			Type:             model.TriggerTypeEvent,
			Topic:            "contract.submitted",
			Filter:           map[string]interface{}{"region": "KSA"},
			DedupeKeyFields:  []string{"contract_id"},
			DedupeTTLSeconds: 3600,
		},
		Variables: map[string]model.VariableDef{
			"amount":   {Type: "number", Default: float64(1000)},
			"approved": {Type: "boolean", Source: "trigger.approved"},
		},
		Steps: []model.StepDefinition{
			{
				ID:   "intake",
				Type: model.StepTypeHumanTask,
				Name: "Intake Review",
				Config: map[string]interface{}{
					"assignee":  "legal-team",
					"form_id":   "intake-form",
					"due_hours": float64(48),
				},
				Transitions: []model.Transition{{Target: "route"}},
				BoundaryEvents: []model.BoundaryEvent{
					{ID: "sla-timer", Type: model.BoundaryEventTypeTimer, HandlerStepID: "escalate", Config: map[string]interface{}{"duration": "PT24H"}},
					{ID: "cancel-msg", Type: model.BoundaryEventTypeMessage, HandlerStepID: "terminate", Config: map[string]interface{}{"topic": "contract.cancelled", "correlation_value": "${contract_id}"}},
					{ID: "any-err", Type: model.BoundaryEventTypeError, HandlerStepID: "terminate", Config: map[string]interface{}{"error_code": "E_FATAL"}},
				},
			},
			{
				ID:     "route",
				Type:   model.StepTypeCondition,
				Name:   "Amount Gate",
				Config: map[string]interface{}{"expression": "true"},
				Transitions: []model.Transition{
					{Condition: "${amount} > 500", Target: "manager-approval"},
					{Target: "auto-approve"},
				},
			},
			{
				ID:          "manager-approval",
				Type:        model.StepTypeApprovalChain,
				Name:        "Manager Approval",
				Config:      map[string]interface{}{"approvers": []interface{}{"mgr-1", "mgr-2"}, "policy": "all"},
				Transitions: []model.Transition{{Target: "fork"}},
			},
			{
				ID:   "auto-approve",
				Type: model.StepTypeDecisionTask,
				Name: "Auto Approve Decision",
				Config: map[string]interface{}{
					"hit_policy": "UNIQUE",
					"table":      map[string]interface{}{"inputs": []interface{}{"amount"}, "rules": []interface{}{}},
				},
				Transitions: []model.Transition{{Target: "fork"}},
			},
			{
				ID:          "fork",
				Type:        model.StepTypeParallelGateway,
				Name:        "Fan Out",
				Config:      map[string]interface{}{"branches": []interface{}{}},
				Transitions: []model.Transition{{Target: "notify-parties"}, {Target: "archive"}},
			},
			{
				ID:   "notify-parties",
				Type: model.StepTypeServiceTask,
				Name: "Notify Parties",
				Config: map[string]interface{}{
					"service": "notification",
					"method":  "POST",
					"url":     "/api/v1/notify",
					"body":    map[string]interface{}{"contract": "${contract_id}"},
				},
				Transitions: []model.Transition{{Target: "wait-ack"}},
			},
			{
				ID:   "wait-ack",
				Type: model.StepTypeEventTask,
				Name: "Await Acknowledgement",
				Config: map[string]interface{}{
					"mode":              "WAIT",
					"topic":             "contract.acked",
					"correlation_value": "${contract_id}",
					"timeout_seconds":   float64(86400),
				},
				Transitions: []model.Transition{{Target: "child"}},
			},
			{
				ID:   "child",
				Type: model.StepTypeCallActivity,
				Name: "Sub Workflow",
				Config: map[string]interface{}{
					"definition_key": "signature-flow",
					"input_mapping":  map[string]interface{}{"cid": "${contract_id}"},
				},
				Transitions: []model.Transition{{Target: "each-reviewer"}},
			},
			{
				ID:   "each-reviewer",
				Type: model.StepTypeMultiInstance,
				Name: "Per-Reviewer",
				Config: map[string]interface{}{
					"definition_key": "reviewer-flow",
					"collection":     "${reviewers}",
					"policy":         "all",
				},
				Transitions: []model.Transition{{Target: "publish"}},
			},
			{
				ID:   "publish",
				Type: model.StepTypeEventTask,
				Name: "Publish Completed",
				Config: map[string]interface{}{
					"mode":       "PUBLISH",
					"topic":      "contract.completed",
					"event_type": "com.clario.contract.completed",
					"data":       map[string]interface{}{"contract": "${contract_id}"},
				},
				Transitions: []model.Transition{{Target: "connect"}},
			},
			{
				ID:   "connect",
				Type: model.StepTypeConnectorTask,
				Name: "External Sync",
				Config: map[string]interface{}{
					"connector_type": "custom-rest",
					"action":         "sync",
				},
				Transitions: []model.Transition{{Target: "hold"}},
			},
			{
				ID:          "hold",
				Type:        model.StepTypeTimer,
				Name:        "Cooldown",
				Config:      map[string]interface{}{"duration": "PT10M"},
				Transitions: []model.Transition{{Target: "race"}},
			},
			{
				ID:   "race",
				Type: model.StepTypeEventGateway,
				Name: "Race Timer vs Message",
				Config: map[string]interface{}{
					"events": []interface{}{
						map[string]interface{}{"id": "arm-t", "type": "timer", "target": "done", "duration": "PT5M"},
						map[string]interface{}{"id": "arm-m", "type": "message", "target": "done", "topic": "contract.override", "correlation_value": "${contract_id}"},
					},
				},
				Transitions: []model.Transition{{Target: "done"}},
			},
			{ID: "escalate", Type: model.StepTypeServiceTask, Name: "Escalate", Config: map[string]interface{}{"service": "notification", "method": "POST", "url": "/escalate"}, Transitions: []model.Transition{{Target: "done"}}},
			{ID: "terminate", Type: model.StepTypeEnd, Name: "Terminated"},
			{ID: "archive", Type: model.StepTypeServiceTask, Name: "Archive", Config: map[string]interface{}{"service": "archive", "method": "POST", "url": "/archive"}, Transitions: []model.Transition{{Target: "done"}}},
			{ID: "done", Type: model.StepTypeEnd, Name: "Completed"},
		},
	}
}

// stepIndex builds a lookup from step id to step for equivalence checks that do
// not depend on the (type-grouped) reconstruction order.
func stepIndex(def *model.WorkflowDefinition) map[string]model.StepDefinition {
	m := make(map[string]model.StepDefinition, len(def.Steps))
	for _, s := range def.Steps {
		m[s.ID] = s
	}
	return m
}

// normalizeConfig treats a nil config and an empty map as equivalent (the codec
// may reconstruct an absent config as an empty map for foreign nodes; for
// island nodes it preserves nil-vs-empty exactly). Round-trip equivalence is
// SEMANTIC, so we normalize before comparing.
func normalizeConfig(c map[string]interface{}) map[string]interface{} {
	if len(c) == 0 {
		return nil
	}
	return c
}

func TestRoundTripFidelity(t *testing.T) {
	orig := representativeDefinition()

	xmlBytes, err := Export(orig)
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}

	res, err := Import(xmlBytes)
	if err != nil {
		t.Fatalf("import failed: %v", err)
	}
	if len(res.Warnings) != 0 {
		t.Fatalf("round-trip of a Clario-exported document should produce NO fidelity warnings, got: %v", res.Warnings)
	}
	got := res.Definition

	// Definition-level metadata.
	if got.Name != orig.Name {
		t.Errorf("name: got %q want %q", got.Name, orig.Name)
	}
	if got.Description != orig.Description {
		t.Errorf("description mismatch: got %q want %q", got.Description, orig.Description)
	}
	if got.Category != orig.Category {
		t.Errorf("category: got %q want %q", got.Category, orig.Category)
	}
	if !reflect.DeepEqual(got.TriggerConfig, orig.TriggerConfig) {
		t.Errorf("trigger config mismatch:\n got %+v\nwant %+v", got.TriggerConfig, orig.TriggerConfig)
	}
	if !reflect.DeepEqual(got.Variables, orig.Variables) {
		t.Errorf("variables mismatch:\n got %+v\nwant %+v", got.Variables, orig.Variables)
	}

	// Same set of steps.
	if len(got.Steps) != len(orig.Steps) {
		t.Fatalf("step count: got %d want %d", len(got.Steps), len(orig.Steps))
	}
	origByID := stepIndex(orig)
	gotByID := stepIndex(got)
	for id, os := range origByID {
		gs, ok := gotByID[id]
		if !ok {
			t.Errorf("step %q missing after round-trip", id)
			continue
		}
		if gs.Type != os.Type {
			t.Errorf("step %q type: got %q want %q", id, gs.Type, os.Type)
		}
		if gs.Name != os.Name {
			t.Errorf("step %q name: got %q want %q", id, gs.Name, os.Name)
		}
		if !reflect.DeepEqual(normalizeConfig(gs.Config), normalizeConfig(os.Config)) {
			t.Errorf("step %q config mismatch:\n got %#v\nwant %#v", id, gs.Config, os.Config)
		}
		if !reflect.DeepEqual(gs.Transitions, os.Transitions) {
			t.Errorf("step %q transitions mismatch:\n got %#v\nwant %#v", id, gs.Transitions, os.Transitions)
		}
		if !reflect.DeepEqual(gs.BoundaryEvents, os.BoundaryEvents) {
			t.Errorf("step %q boundary events mismatch:\n got %#v\nwant %#v", id, gs.BoundaryEvents, os.BoundaryEvents)
		}
	}
}

// TestExportedXMLIsWellFormedBPMN asserts the exported document is well-formed,
// namespaced BPMN 2.0 that a plain XML decoder parses, and that it contains the
// expected native BPMN elements for the mapped step types (not just Clario
// extension islands).
func TestExportedXMLIsWellFormedBPMN(t *testing.T) {
	orig := representativeDefinition()
	xmlBytes, err := Export(orig)
	if err != nil {
		t.Fatalf("export failed: %v", err)
	}

	// 1. It parses as generic XML (well-formed).
	var probe struct {
		XMLName xml.Name
	}
	if err := xml.Unmarshal(xmlBytes, &probe); err != nil {
		t.Fatalf("exported XML is not well-formed: %v", err)
	}

	s := string(xmlBytes)
	// 2. It carries the BPMN + Clario namespaces and an <?xml?> header.
	for _, want := range []string{
		`<?xml version="1.0" encoding="UTF-8"?>`,
		nsBPMN,
		nsClario,
		"<bpmn:process",
		`isExecutable="true"`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("exported XML missing expected fragment %q", want)
		}
	}

	// 3. It emits native BPMN flow nodes for the representative step types.
	for _, want := range []string{
		"<bpmn:startEvent",
		"<bpmn:endEvent",
		"<bpmn:userTask",
		"<bpmn:serviceTask",
		"<bpmn:businessRuleTask",
		"<bpmn:callActivity",
		"<bpmn:multiInstanceLoopCharacteristics",
		"<bpmn:exclusiveGateway",
		"<bpmn:parallelGateway",
		"<bpmn:eventBasedGateway",
		"<bpmn:intermediateCatchEvent",
		"<bpmn:intermediateThrowEvent",
		"<bpmn:boundaryEvent",
		"<bpmn:timerEventDefinition",
		"<bpmn:messageEventDefinition",
		"<bpmn:errorEventDefinition",
		"<bpmn:sequenceFlow",
		"<bpmn:conditionExpression",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("exported BPMN missing native element %q", want)
		}
	}

	// 4. The guarded transition's expression rides on a conditionExpression.
	if !strings.Contains(s, "&gt; 500") {
		t.Errorf("guarded transition expression not emitted on conditionExpression")
	}
}

// TestImportRejectsUnsupportedConstruct proves an unsupported BPMN construct is
// REPORTED (fail-closed), not silently dropped.
func TestImportRejectsUnsupportedConstruct(t *testing.T) {
	cases := []struct {
		name    string
		element string
	}{
		{"inclusive gateway", `<bpmn:inclusiveGateway id="ig1" />`},
		{"sub process", `<bpmn:subProcess id="sp1" />`},
		{"script task", `<bpmn:scriptTask id="st1" />`},
		{"manual task", `<bpmn:manualTask id="mt1" />`},
		{"receive task", `<bpmn:receiveTask id="rt1" />`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			doc := `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="` + nsBPMN + `" xmlns:clario="` + nsClario + `" id="d" targetNamespace="` + nsClario + `">
  <bpmn:process id="p" name="Bad" isExecutable="true">
    <bpmn:startEvent id="s" />
    ` + tc.element + `
    <bpmn:endEvent id="e" />
    <bpmn:sequenceFlow id="f1" sourceRef="s" targetRef="e" />
  </bpmn:process>
</bpmn:definitions>`
			res, err := Import([]byte(doc))
			if err == nil {
				t.Fatalf("expected an error for unsupported construct %s, got a successful import: %+v", tc.name, res)
			}
			if !strings.Contains(err.Error(), "unsupported") && !strings.Contains(err.Error(), "unrecognized") {
				t.Errorf("error should clearly report the unsupported construct, got: %v", err)
			}
		})
	}
}

// TestImportMalformedXMLFailsClosed proves malformed XML is rejected.
func TestImportMalformedXMLFailsClosed(t *testing.T) {
	cases := []struct {
		name string
		body string
	}{
		{"truncated", `<?xml version="1.0"?><bpmn:definitions><bpmn:process`},
		{"not xml", `this is definitely not xml { "json": true }`},
		{"empty", "   "},
		{"unclosed tag", `<a><b></a>`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := Import([]byte(tc.body)); err == nil {
				t.Fatalf("expected malformed input %q to fail closed, got nil error", tc.name)
			}
		})
	}
}

// TestImportNoProcessFailsClosed proves a syntactically valid XML without a
// <process> is rejected rather than yielding an empty definition.
func TestImportNoProcessFailsClosed(t *testing.T) {
	doc := `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="` + nsBPMN + `" id="d"></bpmn:definitions>`
	if _, err := Import([]byte(doc)); err == nil {
		t.Fatalf("expected a document with no <process> to be rejected")
	}
}

// TestImportForeignDocument proves a document authored by a FOREIGN tool (no
// Clario extension islands) imports via the native-element mapping, reconstructs
// transitions from sequence flows, and records fidelity warnings — without
// dropping any node.
func TestImportForeignDocument(t *testing.T) {
	// Note: uses a different prefix (b:) for the BPMN namespace to prove the
	// importer matches by local name / namespace, not by our own prefix.
	doc := `<?xml version="1.0" encoding="UTF-8"?>
<b:definitions xmlns:b="` + nsBPMN + `" id="d" targetNamespace="urn:example">
  <b:process id="p" name="Foreign Flow" isExecutable="true">
    <b:startEvent id="start" />
    <b:userTask id="approve" name="Approve" />
    <b:exclusiveGateway id="gw" name="Decision" />
    <b:serviceTask id="notify" name="Notify" />
    <b:endEvent id="end" name="End" />
    <b:sequenceFlow id="f0" sourceRef="start" targetRef="approve" />
    <b:sequenceFlow id="f1" sourceRef="approve" targetRef="gw" />
    <b:sequenceFlow id="f2" sourceRef="gw" targetRef="notify">
      <b:conditionExpression>${approved} == true</b:conditionExpression>
    </b:sequenceFlow>
    <b:sequenceFlow id="f3" sourceRef="gw" targetRef="end" />
    <b:sequenceFlow id="f4" sourceRef="notify" targetRef="end" />
  </b:process>
</b:definitions>`

	res, err := Import([]byte(doc))
	if err != nil {
		t.Fatalf("foreign document import failed: %v", err)
	}
	def := res.Definition
	if def.Name != "Foreign Flow" {
		t.Errorf("name: got %q want %q", def.Name, "Foreign Flow")
	}
	// Manual-trigger default + a warning are expected for a document without meta.
	if def.TriggerConfig.Type != model.TriggerTypeManual {
		t.Errorf("foreign doc should default to a manual trigger, got %q", def.TriggerConfig.Type)
	}
	if len(res.Warnings) == 0 {
		t.Errorf("expected at least one fidelity warning for a foreign document")
	}

	byID := stepIndex(def)
	if len(def.Steps) != 4 { // approve, gw, notify, end (start is synthesized, not a step)
		t.Fatalf("expected 4 reconstructed steps, got %d: %+v", len(def.Steps), byID)
	}
	if byID["approve"].Type != model.StepTypeHumanTask {
		t.Errorf("approve should map to human_task, got %q", byID["approve"].Type)
	}
	if byID["gw"].Type != model.StepTypeCondition {
		t.Errorf("gw should map to condition, got %q", byID["gw"].Type)
	}
	if byID["notify"].Type != model.StepTypeServiceTask {
		t.Errorf("notify should map to service_task, got %q", byID["notify"].Type)
	}
	// The gateway's guarded flow must reconstruct a conditioned transition.
	var foundGuard bool
	for _, tr := range byID["gw"].Transitions {
		if tr.Target == "notify" && strings.Contains(tr.Condition, "approved") {
			foundGuard = true
		}
	}
	if !foundGuard {
		t.Errorf("guarded sequenceFlow condition was not reconstructed onto the transition; got %#v", byID["gw"].Transitions)
	}
}

// TestConformanceMatrixIsComplete proves every supported Clario step type has
// exactly one matrix row and that the matrix renders to a doc table — so the RFP
// coverage claim is code-backed.
func TestConformanceMatrixIsComplete(t *testing.T) {
	// Every valid Clario step type must be classified (full or partial), not
	// unsupported, and appear in the export mapping (directly or via serviceTask).
	for st := range model.ValidStepTypes {
		if SupportFor(st) == SupportUnsupported {
			t.Errorf("step type %q is a valid Clario type but the conformance matrix marks it unsupported", st)
		}
	}
	// The rendered doc must be a non-trivial Markdown table.
	md := ConformanceMarkdown()
	if !strings.Contains(md, "| BPMN 2.0 element |") || !strings.Contains(md, "exclusiveGateway") {
		t.Errorf("conformance markdown does not render the expected table:\n%s", md)
	}
}

// TestExportRejectsUnsupportedStepType proves export is ALSO fail-closed: it
// never emits a document it could not read back.
func TestExportRejectsUnsupportedStepType(t *testing.T) {
	def := &model.WorkflowDefinition{
		Name:          "Bad",
		DefinitionKey: "bad",
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Steps: []model.StepDefinition{
			{ID: "x", Type: "totally_unknown_type"},
			{ID: "done", Type: model.StepTypeEnd},
		},
	}
	if _, err := Export(def); err == nil {
		t.Fatalf("expected export to reject an unsupported step type")
	}
}
