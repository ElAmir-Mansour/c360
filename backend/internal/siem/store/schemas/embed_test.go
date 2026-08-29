package schemas

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestECSMapping_Embedded(t *testing.T) {
	if len(ECSMapping) == 0 {
		t.Fatal("ECSMapping empty")
	}
	var m map[string]any
	if err := json.Unmarshal(ECSMapping, &m); err != nil {
		t.Fatalf("ECSMapping not JSON: %v", err)
	}
	if !bytes.Contains(ECSMapping, []byte("__siem_template_placeholder__")) {
		t.Error("ECSMapping should contain placeholder")
	}
	meta, _ := m["_meta"].(map[string]any)
	if meta == nil || meta["schema_version"] == "" {
		t.Errorf("_meta.schema_version missing: %+v", meta)
	}
}

func TestClarioExtensions_Embedded(t *testing.T) {
	if len(ClarioExtensions) == 0 {
		t.Fatal("ClarioExtensions empty")
	}
	var m map[string]any
	if err := json.Unmarshal(ClarioExtensions, &m); err != nil {
		t.Fatalf("ClarioExtensions not JSON: %v", err)
	}
	mappings, _ := m["mappings"].(map[string]any)
	if mappings == nil {
		t.Fatal("mappings missing")
	}
	props, _ := mappings["properties"].(map[string]any)
	if _, ok := props["tenant_id"]; !ok {
		t.Error("tenant_id property missing")
	}
}

func TestPIIFieldsYAML_Embedded(t *testing.T) {
	if len(PIIFieldsYAML) == 0 {
		t.Fatal("PIIFieldsYAML empty")
	}
	s := string(PIIFieldsYAML)
	if !strings.Contains(s, "schema_id") || !strings.Contains(s, "clario-pii-1.0") {
		t.Errorf("missing schema_id: %s", s[:200])
	}
}
