package forms

import (
	"testing"

	"github.com/clario360/platform/internal/workflow/model"
)

func TestFormFieldVisible(t *testing.T) {
	tests := []struct {
		name    string
		field   model.FormField
		values  map[string]any
		want    bool
		wantErr bool
	}{
		{
			name:   "empty expression always visible",
			field:  model.FormField{Name: "notes"},
			values: map[string]any{},
			want:   true,
		},
		{
			name:   "empty expression visible even with nil values",
			field:  model.FormField{Name: "notes"},
			values: nil,
			want:   true,
		},
		{
			name:   "bool true makes field visible",
			field:  model.FormField{Name: "reason", VisibleWhen: "needs_review == true"},
			values: map[string]any{"needs_review": true},
			want:   true,
		},
		{
			name:   "bool false hides field",
			field:  model.FormField{Name: "reason", VisibleWhen: "needs_review == true"},
			values: map[string]any{"needs_review": false},
			want:   false,
		},
		{
			name:   "string equality visible",
			field:  model.FormField{Name: "other", VisibleWhen: "decision == 'other'"},
			values: map[string]any{"decision": "other"},
			want:   true,
		},
		{
			name:   "string equality hidden",
			field:  model.FormField{Name: "other", VisibleWhen: "decision == 'other'"},
			values: map[string]any{"decision": "approve"},
			want:   false,
		},
		{
			name:   "numeric comparison visible",
			field:  model.FormField{Name: "justification", VisibleWhen: "amount > 1000"},
			values: map[string]any{"amount": float64(5000)},
			want:   true,
		},
		{
			name:   "compound expression",
			field:  model.FormField{Name: "x", VisibleWhen: "needs_review == true && amount > 100"},
			values: map[string]any{"needs_review": true, "amount": float64(50)},
			want:   false,
		},
		{
			name:    "malformed expression is an error",
			field:   model.FormField{Name: "x", VisibleWhen: "needs_review =="},
			values:  map[string]any{"needs_review": true},
			wantErr: true,
		},
		{
			name:    "reference to missing field is an error",
			field:   model.FormField{Name: "x", VisibleWhen: "missing == true"},
			values:  map[string]any{"present": true},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := FormFieldVisible(tt.field, tt.values)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("expected error, got nil (visible=%v)", got)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if got != tt.want {
				t.Fatalf("FormFieldVisible = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestVisibleRequiredFields_SkipsHiddenRequired(t *testing.T) {
	fields := []model.FormField{
		{Name: "decision", Type: "select", Required: true},
		{Name: "reject_reason", Type: "text", Required: true, VisibleWhen: "decision == 'reject'"},
		{Name: "approve_note", Type: "text", Required: false, VisibleWhen: "decision == 'approve'"},
	}

	// Decision == approve: reject_reason is hidden so it must NOT be required.
	values := map[string]any{"decision": "approve"}
	got, err := VisibleRequiredFields(fields, values)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "decision" {
		t.Fatalf("expected only 'decision' required, got %+v", names(got))
	}

	// Decision == reject: reject_reason becomes visible and required.
	values = map[string]any{"decision": "reject"}
	got, err = VisibleRequiredFields(fields, values)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected decision + reject_reason required, got %+v", names(got))
	}
}

func TestVisibleFields(t *testing.T) {
	fields := []model.FormField{
		{Name: "a"},
		{Name: "b", VisibleWhen: "a == 'show'"},
	}
	got, err := VisibleFields(fields, map[string]any{"a": "hide"})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(got) != 1 || got[0].Name != "a" {
		t.Fatalf("expected only 'a' visible, got %+v", names(got))
	}
}

func TestPruneHiddenValues(t *testing.T) {
	fields := []model.FormField{
		{Name: "decision", Type: "select"},
		{Name: "reject_reason", Type: "text", VisibleWhen: "decision == 'reject'"},
	}

	// reject_reason is hidden (decision != reject) but a stray value was sent;
	// it must be pruned.
	values := map[string]any{"decision": "approve", "reject_reason": "leftover"}
	out, err := PruneHiddenValues(fields, values)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := out["reject_reason"]; ok {
		t.Fatalf("expected reject_reason to be pruned, got %+v", out)
	}
	if out["decision"] != "approve" {
		t.Fatalf("expected decision preserved, got %+v", out)
	}

	// Original map must not be mutated.
	if _, ok := values["reject_reason"]; !ok {
		t.Fatalf("PruneHiddenValues mutated the input map")
	}

	// When visible, the value is retained.
	values = map[string]any{"decision": "reject", "reject_reason": "bad data"}
	out, err = PruneHiddenValues(fields, values)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out["reject_reason"] != "bad data" {
		t.Fatalf("expected reject_reason retained when visible, got %+v", out)
	}
}

func TestPruneHiddenValues_MalformedExpression(t *testing.T) {
	fields := []model.FormField{
		{Name: "x", VisibleWhen: "&& bogus"},
	}
	if _, err := PruneHiddenValues(fields, map[string]any{"x": 1}); err == nil {
		t.Fatal("expected error for malformed expression")
	}
}

func names(fields []model.FormField) []string {
	out := make([]string, len(fields))
	for i, f := range fields {
		out[i] = f.Name
	}
	return out
}
