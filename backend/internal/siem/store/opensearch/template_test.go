package opensearch

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

func TestBuildTemplate_Deterministic(t *testing.T) {
	tenant := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	body, hash, err := BuildTemplate(tenant)
	if err != nil {
		t.Fatalf("BuildTemplate: %v", err)
	}
	if hash == "" {
		t.Fatal("empty hash")
	}
	if !strings.Contains(string(body), "siem-"+tenant.String()+"-*") {
		t.Errorf("body missing index pattern: %s", body)
	}
	if strings.Contains(string(body), "__siem_template_placeholder__") {
		t.Errorf("placeholder not replaced")
	}

	// Idempotent: same tenant -> same hash.
	_, hash2, err := BuildTemplate(tenant)
	if err != nil {
		t.Fatal(err)
	}
	if hash != hash2 {
		t.Errorf("hash mismatch %s != %s", hash, hash2)
	}
}

func TestBuildTemplate_ContainsExtensions(t *testing.T) {
	tenant := uuid.New()
	body, _, err := BuildTemplate(tenant)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	tpl := parsed["template"].(map[string]any)
	mappings := tpl["mappings"].(map[string]any)
	props := mappings["properties"].(map[string]any)
	for _, key := range []string{"tenant_id", "cbn", "pii", "regulator", "mitre"} {
		if _, ok := props[key]; !ok {
			t.Errorf("missing extension key %q", key)
		}
	}
	meta := parsed["_meta"].(map[string]any)
	if meta["schema_version"] != schemaVersion {
		t.Errorf("schema_version = %v", meta["schema_version"])
	}
	if meta["template_hash"] == "" {
		t.Error("template_hash missing")
	}
}

func TestBuildTemplate_DifferentTenantDifferentHash(t *testing.T) {
	a, _ := uuid.NewRandomFromReader(strReader("aaaaaaaaaaaaaaaa"))
	b, _ := uuid.NewRandomFromReader(strReader("bbbbbbbbbbbbbbbb"))
	if a == b {
		t.Skip("uuids equal")
	}
	_, hashA, _ := BuildTemplate(a)
	_, hashB, _ := BuildTemplate(b)
	if hashA == hashB {
		t.Errorf("template hash should differ across tenants: %s == %s", hashA, hashB)
	}
}

// strReader is a deterministic byte source for uuid.NewRandomFromReader.
type strReader string

func (s strReader) Read(p []byte) (int, error) {
	n := copy(p, []byte(s))
	if n < len(p) {
		for i := n; i < len(p); i++ {
			p[i] = byte(i)
		}
	}
	return len(p), nil
}
