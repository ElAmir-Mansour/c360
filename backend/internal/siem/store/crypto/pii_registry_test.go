package crypto

import (
	"errors"
	"strings"
	"testing"
)

func TestNewPIIRegistry_Embedded(t *testing.T) {
	r, err := NewPIIRegistry()
	if err != nil {
		t.Fatalf("NewPIIRegistry: %v", err)
	}
	if r.SchemaID() != "clario-pii-1.0" {
		t.Errorf("SchemaID = %q, want clario-pii-1.0", r.SchemaID())
	}
	if r.SchemaVersion() != 1 {
		t.Errorf("SchemaVersion = %d, want 1", r.SchemaVersion())
	}
	if r.SchemaHash() == "" {
		t.Error("SchemaHash empty")
	}
	if !r.IsPII("user.email") {
		t.Error("user.email should be PII")
	}
	if r.IsPII("tenant_id") {
		t.Error("tenant_id is in not_pii — should NOT be PII")
	}
	if len(r.AllPaths()) == 0 {
		t.Error("AllPaths empty")
	}
}

func TestNewPIIRegistry_FromBytes_BadYAML(t *testing.T) {
	_, err := newPIIRegistryFromBytes([]byte("::: not yaml :::"))
	if err == nil {
		t.Fatal("expected error on bad YAML")
	}
	if !errors.Is(err, ErrPIIRegistryLoad) {
		t.Errorf("err is not ErrPIIRegistryLoad: %v", err)
	}
}

func TestNewPIIRegistry_FromBytes_MissingSchemaID(t *testing.T) {
	_, err := newPIIRegistryFromBytes([]byte("version: 1\nfields: []\n"))
	if err == nil {
		t.Fatal("expected error on missing schema_id")
	}
}

func TestNewPIIRegistry_AllPathsSorted(t *testing.T) {
	r, err := NewPIIRegistry()
	if err != nil {
		t.Fatal(err)
	}
	paths := r.AllPaths()
	for i := 1; i < len(paths); i++ {
		if strings.Compare(paths[i-1], paths[i]) > 0 {
			t.Errorf("paths not sorted at index %d: %q > %q", i, paths[i-1], paths[i])
		}
	}
}
