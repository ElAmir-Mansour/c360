package service

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/clario360/platform/internal/data/model"
)

func TestDerive_GeneratesFields(t *testing.T) {
	table := model.DiscoveredTable{
		Name: "customer_master",
		Columns: []model.DiscoveredColumn{
			{Name: "id", MappedType: "integer", NativeType: "int4", Nullable: false, IsPrimaryKey: true, InferredClass: model.DataClassificationInternal},
			{Name: "email", MappedType: "string", NativeType: "varchar(255)", Nullable: false, InferredPIIType: "email", InferredClass: model.DataClassificationConfidential, SampleValues: []string{"a@example.com", "b@example.com"}},
			{Name: "status", MappedType: "string", NativeType: "varchar(20)", Nullable: false, InferredClass: model.DataClassificationInternal, SampleValues: []string{"active", "inactive", "pending"}},
			{Name: "created_at", MappedType: "datetime", NativeType: "timestamptz", Nullable: false, InferredClass: model.DataClassificationInternal},
		},
	}

	fields := deriveModelFields(table)
	if len(fields) != 4 {
		t.Fatalf("deriveModelFields() len = %d, want 4", len(fields))
	}
	if fields[1].PIIType != "email" {
		t.Fatalf("fields[1].PIIType = %q, want email", fields[1].PIIType)
	}

	rules := deriveValidationRules(fields)
	assertHasRule(t, rules, "not_null", "id")
	assertHasRule(t, rules, "unique", "id")
	assertHasRule(t, rules, "max_length", "email")
	assertHasRule(t, rules, "enum", "status")
	assertHasRule(t, rules, "format", "email")
	assertHasRule(t, rules, "not_future", "created_at")
}

func TestDerive_Classification(t *testing.T) {
	fields := deriveModelFields(model.DiscoveredTable{
		Columns: []model.DiscoveredColumn{
			{Name: "employee_id", MappedType: "integer", NativeType: "int4", InferredClass: model.DataClassificationInternal},
			{Name: "ssn", MappedType: "string", NativeType: "varchar(20)", InferredPIIType: "national_id", InferredClass: model.DataClassificationRestricted},
		},
	})

	classification := model.DataClassificationPublic
	piiColumns := make([]string, 0)
	for _, field := range fields {
		classification = maxFieldClassification(classification, field.Classification)
		if field.PIIType != "" {
			piiColumns = append(piiColumns, field.Name)
		}
	}

	if classification != model.DataClassificationRestricted {
		t.Fatalf("classification = %q, want %q", classification, model.DataClassificationRestricted)
	}
	if len(piiColumns) != 1 || piiColumns[0] != "ssn" {
		t.Fatalf("piiColumns = %#v, want [\"ssn\"]", piiColumns)
	}
}

func TestMergeChangeNote_FreezesPublishProvenance(t *testing.T) {
	at := time.Date(2026, 7, 2, 10, 30, 0, 0, time.UTC)
	raw, err := mergeChangeNote(json.RawMessage(`{"owner":"data-team","cost_center":"CC-42"}`), "  quarterly refresh  ", 5, at)
	if err != nil {
		t.Fatalf("mergeChangeNote() error = %v", err)
	}

	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatalf("unmarshal merged metadata: %v", err)
	}

	// Existing keys must be preserved.
	if meta["owner"] != "data-team" {
		t.Fatalf("owner = %v, want data-team", meta["owner"])
	}
	if meta["cost_center"] != "CC-42" {
		t.Fatalf("cost_center = %v, want CC-42", meta["cost_center"])
	}

	publish, ok := meta["publish"].(map[string]any)
	if !ok {
		t.Fatalf("publish metadata missing, got %#v", meta["publish"])
	}
	if got := publish["version"]; got != float64(5) {
		t.Fatalf("publish.version = %v, want 5", got)
	}
	if got := publish["change_note"]; got != "quarterly refresh" {
		t.Fatalf("publish.change_note = %q, want trimmed %q", got, "quarterly refresh")
	}
	if got := publish["published_at"]; got != at.Format(time.RFC3339) {
		t.Fatalf("publish.published_at = %v, want %v", got, at.Format(time.RFC3339))
	}
}

func TestMergeChangeNote_EmptyMetadataAndBlankNote(t *testing.T) {
	at := time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC)
	raw, err := mergeChangeNote(nil, "   ", 1, at)
	if err != nil {
		t.Fatalf("mergeChangeNote() error = %v", err)
	}

	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		t.Fatalf("unmarshal merged metadata: %v", err)
	}
	publish, ok := meta["publish"].(map[string]any)
	if !ok {
		t.Fatalf("publish metadata missing, got %#v", meta["publish"])
	}
	if _, exists := publish["change_note"]; exists {
		t.Fatalf("change_note should be omitted for blank note, got %#v", publish)
	}
	if got := publish["version"]; got != float64(1) {
		t.Fatalf("publish.version = %v, want 1", got)
	}
}

func TestMergeChangeNote_InvalidMetadataErrors(t *testing.T) {
	if _, err := mergeChangeNote(json.RawMessage(`not-json`), "note", 2, time.Now()); err == nil {
		t.Fatal("mergeChangeNote() with invalid metadata: expected error, got nil")
	}
}

func assertHasRule(t *testing.T, rules []model.ValidationRule, ruleType, field string) {
	t.Helper()
	for _, rule := range rules {
		if rule.Type == ruleType && rule.Field == field {
			return
		}
	}
	t.Fatalf("missing rule type=%q field=%q in %#v", ruleType, field, rules)
}
