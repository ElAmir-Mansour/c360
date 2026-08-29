package llm

import (
	"encoding/json"
	"testing"

	"github.com/clario360/platform/internal/lex/model"
)

func TestClauseSchema_EnumMatchesEnum(t *testing.T) {
	schema := ClauseAnalysisSchema()
	if schema.Name != ToolEmitClauseAnalysis {
		t.Fatalf("schema name = %q, want %q", schema.Name, ToolEmitClauseAnalysis)
	}
	clauses := navigate(t, schema.Parameters, "properties", "clauses", "items", "properties", "clause_type")
	enumRaw, ok := clauses["enum"].([]any)
	if !ok {
		t.Fatalf("clause_type enum missing or wrong type: %T", clauses["enum"])
	}
	want := model.ClauseTypesForExtraction()
	if len(enumRaw) != len(want) {
		t.Fatalf("clause_type enum length = %d, want %d", len(enumRaw), len(want))
	}
	for i, ct := range want {
		if enumRaw[i] != string(ct) {
			t.Fatalf("clause_type enum[%d] = %v, want %s", i, enumRaw[i], ct)
		}
	}
	// "other" must be present.
	found := false
	for _, e := range enumRaw {
		if e == string(model.ClauseTypeOther) {
			found = true
		}
	}
	if !found {
		t.Fatalf("clause_type enum missing 'other'")
	}
}

func TestSchemas_AdditionalPropertiesFalse(t *testing.T) {
	for _, schema := range []map[string]any{ClauseAnalysisSchema().Parameters, ObligationSchema().Parameters} {
		if ap, ok := schema["additionalProperties"].(bool); !ok || ap {
			t.Fatalf("top-level additionalProperties not false: %v", schema["additionalProperties"])
		}
	}
}

func TestSchemas_ValidJSON(t *testing.T) {
	for name, schema := range map[string]map[string]any{
		"clause":     ClauseAnalysisSchema().Parameters,
		"obligation": ObligationSchema().Parameters,
	} {
		if _, err := json.Marshal(schema); err != nil {
			t.Fatalf("%s schema not marshalable: %v", name, err)
		}
	}
}

func TestObligationSchema_RequiredFields(t *testing.T) {
	schema := ObligationSchema()
	item := navigate(t, schema.Parameters, "properties", "obligations", "items")
	required, ok := item["required"].([]string)
	if !ok {
		t.Fatalf("obligation item required wrong type: %T", item["required"])
	}
	wantRequired := map[string]bool{"title": true, "due_date": true, "confidence": true}
	for _, r := range required {
		delete(wantRequired, r)
	}
	if len(wantRequired) != 0 {
		t.Fatalf("obligation item missing required fields: %v", wantRequired)
	}
}

// navigate walks a nested map[string]any schema by keys.
func navigate(t *testing.T, root map[string]any, keys ...string) map[string]any {
	t.Helper()
	cur := root
	for _, k := range keys {
		next, ok := cur[k].(map[string]any)
		if !ok {
			t.Fatalf("schema path %v: key %q missing or not an object (%T)", keys, k, cur[k])
		}
		cur = next
	}
	return cur
}
