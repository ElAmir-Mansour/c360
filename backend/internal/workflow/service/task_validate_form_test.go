package service

import (
	"testing"

	"github.com/clario360/platform/internal/workflow/model"
)

// validateFormData is a pure method (touches no TaskService fields), so a
// zero-value receiver is sufficient to exercise the conditional-visibility
// behavior without a database.
func TestValidateFormData_HiddenRequiredFieldDoesNotBlock(t *testing.T) {
	s := &TaskService{}

	schema := []model.FormField{
		{Name: "decision", Type: "select", Required: true, Options: []string{"approve", "reject"}},
		{Name: "reject_reason", Type: "text", Required: true, VisibleWhen: "decision == 'reject'"},
	}

	// decision == approve hides reject_reason -> its required-ness must be skipped.
	if err := s.validateFormData(schema, map[string]interface{}{"decision": "approve"}); err != nil {
		t.Fatalf("expected hidden required field to be skipped, got error: %v", err)
	}

	// decision == reject makes reject_reason visible and required -> missing value fails.
	err := s.validateFormData(schema, map[string]interface{}{"decision": "reject"})
	if err == nil {
		t.Fatal("expected error when visible required field is missing")
	}

	// supplying the now-required value passes.
	if err := s.validateFormData(schema, map[string]interface{}{
		"decision":      "reject",
		"reject_reason": "insufficient evidence",
	}); err != nil {
		t.Fatalf("expected valid submission, got error: %v", err)
	}
}

func TestValidateFormData_HiddenFieldSkipsTypeCheck(t *testing.T) {
	s := &TaskService{}

	schema := []model.FormField{
		{Name: "advanced", Type: "boolean"},
		// number field, only visible when advanced == true; a malformed value
		// must be ignored while the field is hidden.
		{Name: "threshold", Type: "number", VisibleWhen: "advanced == true"},
	}

	if err := s.validateFormData(schema, map[string]interface{}{
		"advanced":  false,
		"threshold": "not-a-number",
	}); err != nil {
		t.Fatalf("expected hidden field type check to be skipped, got error: %v", err)
	}

	// When visible, the bad type is rejected.
	if err := s.validateFormData(schema, map[string]interface{}{
		"advanced":  true,
		"threshold": "not-a-number",
	}); err == nil {
		t.Fatal("expected type error for visible field with bad value")
	}
}

func TestValidateFormData_MalformedVisibleWhenIsError(t *testing.T) {
	s := &TaskService{}
	schema := []model.FormField{
		{Name: "x", Type: "text", VisibleWhen: "decision =="},
	}
	if err := s.validateFormData(schema, map[string]interface{}{"decision": "approve"}); err == nil {
		t.Fatal("expected malformed visible_when to surface as a validation error")
	}
}
