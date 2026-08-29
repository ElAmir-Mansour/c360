package model

import "testing"

// TestClassifiedVariableKeys_FromVariablesFormsAndExplicitList verifies the three
// classification sources are unioned: explicit SensitiveVariableKeys, classified
// VariableDef.Sensitivity, and classified inline human-task form fields.
func TestClassifiedVariableKeys_FromVariablesFormsAndExplicitList(t *testing.T) {
	def := &WorkflowDefinition{
		SensitiveVariableKeys: []string{"explicit_secret", ""}, // empty entry dropped
		Variables: map[string]VariableDef{
			"national_id":  {Type: "string", Sensitivity: SensitivityPII},
			"amount":       {Type: "number", Sensitivity: SensitivityConfidential},
			"public_field": {Type: "string"},                                 // unclassified
			"bad_level":    {Type: "string", Sensitivity: "totally-made-up"}, // ignored
		},
		Steps: []StepDefinition{
			{
				Type: StepTypeHumanTask,
				Config: map[string]interface{}{
					"form_fields": []interface{}{
						map[string]interface{}{"name": "justification", "sensitivity": "sensitive"},
						map[string]interface{}{"name": "reviewer_note"}, // unclassified
					},
				},
			},
			{
				Type: StepTypeServiceTask, // non-human step ignored even if it had fields
				Config: map[string]interface{}{
					"form_fields": []interface{}{
						map[string]interface{}{"name": "ignored", "sensitivity": "pii"},
					},
				},
			},
		},
	}

	got := def.ClassifiedVariableKeys()

	want := map[string]bool{
		"explicit_secret": true,
		"national_id":     true,
		"amount":          true,
		"justification":   true,
	}
	for k := range want {
		if !got[k] {
			t.Errorf("expected %q to be classified, missing from %#v", k, got)
		}
	}
	for _, notWant := range []string{"public_field", "bad_level", "reviewer_note", "ignored", ""} {
		if got[notWant] {
			t.Errorf("did not expect %q to be classified", notWant)
		}
	}
	if len(got) != len(want) {
		t.Errorf("unexpected extra classified keys: got %#v want %#v", got, want)
	}
}

// TestClassifiedVariableKeys_LegacyDefinitionIsEmpty verifies a definition with no
// classification produces an empty set, so the engine stamps nothing and the
// write stays on the plaintext path.
func TestClassifiedVariableKeys_LegacyDefinitionIsEmpty(t *testing.T) {
	def := &WorkflowDefinition{
		Variables: map[string]VariableDef{"x": {Type: "string"}},
		Steps: []StepDefinition{
			{Type: StepTypeHumanTask, Config: map[string]interface{}{
				"form_fields": []interface{}{map[string]interface{}{"name": "note"}},
			}},
		},
	}
	if got := def.ClassifiedVariableKeys(); len(got) != 0 {
		t.Fatalf("legacy definition should classify nothing, got %#v", got)
	}
}

// TestFormFieldIsClassified checks the field-level classification predicate.
func TestFormFieldIsClassified(t *testing.T) {
	for level, wantClassified := range map[string]bool{
		SensitivityPII:          true,
		SensitivitySensitive:    true,
		SensitivityConfidential: true,
		"":                      false,
		"unknown":               false,
	} {
		if got := (FormField{Sensitivity: level}).IsClassified(); got != wantClassified {
			t.Errorf("FormField{Sensitivity:%q}.IsClassified() = %v, want %v", level, got, wantClassified)
		}
		if got := (VariableDef{Sensitivity: level}).IsClassified(); got != wantClassified {
			t.Errorf("VariableDef{Sensitivity:%q}.IsClassified() = %v, want %v", level, got, wantClassified)
		}
	}
}
