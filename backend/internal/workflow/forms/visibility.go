// Package forms provides conditional-visibility evaluation for human-task form
// fields. A field may carry an optional VisibleWhen boolean expression (the same
// DSL as internal/workflow/expression.Evaluator) which is evaluated against the
// CURRENT submitted form values. A field whose VisibleWhen evaluates to false is
// hidden, and hidden fields are excluded from "required" validation and cleared
// on submit.
package forms

import (
	"fmt"

	"github.com/clario360/platform/internal/workflow/expression"
	"github.com/clario360/platform/internal/workflow/model"
)

// sharedEvaluator is stateless and safe for concurrent use; it carries only the
// configured length/depth limits, not any per-call state.
var sharedEvaluator = expression.NewEvaluator()

// FormFieldVisible reports whether a single form field should be visible given
// the supplied form values.
//
// An empty VisibleWhen expression always yields visible=true with no error.
// Otherwise the expression is evaluated against values (paths in the expression
// reference sibling field names directly, e.g. "needs_review == true"). A
// malformed expression, or one that references a value in an invalid way, is
// surfaced as an error so callers can reject the submission clearly rather than
// silently treating the field as hidden or visible.
func FormFieldVisible(field model.FormField, values map[string]any) (bool, error) {
	if field.VisibleWhen == "" {
		return true, nil
	}
	if values == nil {
		values = map[string]any{}
	}
	visible, err := sharedEvaluator.Evaluate(field.VisibleWhen, values)
	if err != nil {
		return false, fmt.Errorf("evaluating visible_when for field %q: %w", field.Name, err)
	}
	return visible, nil
}

// VisibleFields returns the subset of fields that are currently visible given
// values. A non-nil error indicates a malformed VisibleWhen expression on one of
// the fields; in that case the partial slice should be ignored.
func VisibleFields(fields []model.FormField, values map[string]any) ([]model.FormField, error) {
	out := make([]model.FormField, 0, len(fields))
	for _, f := range fields {
		visible, err := FormFieldVisible(f, values)
		if err != nil {
			return nil, err
		}
		if visible {
			out = append(out, f)
		}
	}
	return out, nil
}

// VisibleRequiredFields returns the fields that are BOTH currently visible and
// marked required. Hidden required fields are intentionally excluded so they do
// not block submission. A non-nil error indicates a malformed VisibleWhen
// expression.
func VisibleRequiredFields(fields []model.FormField, values map[string]any) ([]model.FormField, error) {
	out := make([]model.FormField, 0, len(fields))
	for _, f := range fields {
		if !f.Required {
			continue
		}
		visible, err := FormFieldVisible(f, values)
		if err != nil {
			return nil, err
		}
		if visible {
			out = append(out, f)
		}
	}
	return out, nil
}

// PruneHiddenValues returns a copy of values with entries for currently-hidden
// fields removed. Values for fields not present in the schema are preserved
// (the schema-level shape validation governs unknown keys). A non-nil error
// indicates a malformed VisibleWhen expression.
//
// Visibility is computed against the ORIGINAL submitted values so that a hidden
// field cannot, by being cleared, change the visibility of another field.
func PruneHiddenValues(fields []model.FormField, values map[string]any) (map[string]any, error) {
	if values == nil {
		return map[string]any{}, nil
	}

	hidden := make(map[string]struct{})
	for _, f := range fields {
		visible, err := FormFieldVisible(f, values)
		if err != nil {
			return nil, err
		}
		if !visible {
			hidden[f.Name] = struct{}{}
		}
	}

	out := make(map[string]any, len(values))
	for k, v := range values {
		if _, isHidden := hidden[k]; isHidden {
			continue
		}
		out[k] = v
	}
	return out, nil
}
