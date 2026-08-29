package service

import (
	"testing"

	"github.com/clario360/platform/internal/lex/dto"
)

func TestValidateFormFieldVisibleWhen(t *testing.T) {
	cases := []struct {
		name    string
		expr    string
		wantErr bool
	}{
		{"empty is always valid", "", false},
		{"simple equality", "decision == 'approve'", false},
		{"boolean and", "amount > 1000 && region == 'eu'", false},
		{"unbalanced parens", "(decision == 'approve'", true},
		{"dangling operator", "decision ==", true},
		{"garbage", "@@@ not an expr @@@", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateFormFieldVisibleWhen(tc.expr)
			if tc.wantErr && err == nil {
				t.Fatalf("expected error for %q", tc.expr)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.expr, err)
			}
		})
	}
}

// TestApprovalFormField_VisibleWhenPassThrough verifies the DSL expression is
// carried onto the engine FormField so conditional visibility reaches the
// workflow task form (Feature 2 lex side).
func TestApprovalFormField_VisibleWhenPassThrough(t *testing.T) {
	field, err := approvalFormField(dto.ApprovalFormFieldRequest{
		Name:        "justification",
		Type:        "textarea",
		Label:       "Justification",
		VisibleWhen: "decision == 'reject'",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if field.VisibleWhen != "decision == 'reject'" {
		t.Fatalf("VisibleWhen not passed through, got %q", field.VisibleWhen)
	}
}

func TestApprovalFormField_InvalidVisibleWhenRejected(t *testing.T) {
	_, err := approvalFormField(dto.ApprovalFormFieldRequest{
		Name:        "f",
		Type:        "text",
		Label:       "F",
		VisibleWhen: "(broken",
	})
	if err == nil {
		t.Fatal("expected a malformed visible_when expression to be rejected")
	}
}

// TestApprovalPolicyFormFields_VisibleWhenPersisted verifies the model form field
// carries VisibleWhen end-to-end through approvalPolicyFormFields, and that
// workflowModelFormFields hands it to the engine model.
func TestApprovalPolicyFormFields_VisibleWhenPersisted(t *testing.T) {
	fields, err := approvalPolicyFormFields([]dto.ApprovalFormFieldRequest{
		{Name: "extra", Type: "text", Label: "Extra", VisibleWhen: "decision == 'approve'"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(fields) != 1 || fields[0].VisibleWhen != "decision == 'approve'" {
		t.Fatalf("model field VisibleWhen not persisted: %+v", fields)
	}
	engine := workflowModelFormFields(fields)
	if len(engine) != 1 || engine[0].VisibleWhen != "decision == 'approve'" {
		t.Fatalf("engine FormField VisibleWhen not propagated: %+v", engine)
	}
}
