package service

import (
	"errors"
	"fmt"
	"testing"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/workflow/model"
)

func validAuthoringForm() *forms.FormDefinition {
	return &forms.FormDefinition{
		TenantID:      "aaaaaaaa-0000-0000-0000-000000000001",
		Name:          "watheeq_approval",
		Version:       1,
		Locales:       []string{"ar", "en"},
		DefaultLocale: "en",
		Fields: []forms.FormField{{
			Name:     "decision_reason",
			Type:     forms.FieldTextarea,
			Label:    forms.LocalizedText{AR: "Decision reason AR", EN: "Decision reason"},
			Required: true,
		}},
	}
}

func TestValidateAuthoringForm(t *testing.T) {
	t.Parallel()

	t.Run("valid create form", func(t *testing.T) {
		if err := validateAuthoringForm(validAuthoringForm(), true); err != nil {
			t.Fatalf("validateAuthoringForm returned error: %v", err)
		}
	})

	t.Run("create requires name", func(t *testing.T) {
		fd := validAuthoringForm()
		fd.Name = ""
		if err := validateAuthoringForm(fd, true); err == nil {
			t.Fatal("expected error for missing name")
		}
	})

	t.Run("update can preserve immutable name from row", func(t *testing.T) {
		fd := validAuthoringForm()
		fd.Name = ""
		if err := validateAuthoringForm(fd, false); err != nil {
			t.Fatalf("validateAuthoringForm update returned error: %v", err)
		}
	})

	t.Run("rejects structurally invalid fields", func(t *testing.T) {
		fd := validAuthoringForm()
		fd.Fields[0].Label.EN = ""
		if err := validateAuthoringForm(fd, true); err == nil {
			t.Fatal("expected structural validation error")
		}
	})
}

func TestMapFormsError(t *testing.T) {
	t.Parallel()

	if err := mapFormsError(fmt.Errorf("wrapped: %w", forms.ErrNotFound)); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("not found mapped to %v, want model.ErrNotFound", err)
	}
	if err := mapFormsError(fmt.Errorf("wrapped: %w", forms.ErrConflict)); !errors.Is(err, model.ErrConflict) {
		t.Fatalf("conflict mapped to %v, want model.ErrConflict", err)
	}
	if err := mapFormsError(fmt.Errorf("wrapped: %w", forms.ErrInvalid)); err == nil {
		t.Fatal("invalid form error should remain non-nil")
	}
}
