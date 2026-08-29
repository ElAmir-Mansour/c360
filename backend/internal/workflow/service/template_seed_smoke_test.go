package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/seed"
)

// TestSeedSmoke_AllCatalogTemplatesValidate is the WS-1 seed-smoke gate
// (Workflow_Module_Design §3 E2E plan #3): it loads every template in the
// catalog — the in-process built-ins AND the data-driven legal pack
// (seed/legal_templates.json) — parses each into a WorkflowDefinition, and
// asserts it passes the engine's ValidateDefinition. This catches malformed seed
// JSON before it ships and PINS the JSON schema for the later content phase.
func TestSeedSmoke_AllCatalogTemplatesValidate(t *testing.T) {
	defSvc := NewDefinitionService(nil, zerolog.Nop())

	validate := func(t *testing.T, id string, def *model.WorkflowDefinition) {
		t.Helper()
		// ValidateDefinition skips name-length only; ensure a name is present so
		// the smoke gate exercises the structural rules, not the name rule.
		if def.Name == "" {
			t.Fatalf("template %q: definition has empty name", id)
		}
		if errs := defSvc.ValidateDefinition(def); len(errs) > 0 {
			t.Fatalf("template %q failed ValidateDefinition: %s", id, formatValidationErrors(errs))
		}
	}

	// 1. Built-in catalog (the original 5, hard-coded in buildTemplates()).
	t.Run("builtins", func(t *testing.T) {
		svc := NewTemplateService(nil, zerolog.Nop())
		builtins := svc.buildTemplates()
		if len(builtins) == 0 {
			t.Fatal("expected at least one built-in template")
		}
		for _, tmpl := range builtins {
			def := parseTemplateDefinition(t, tmpl)
			validate(t, tmpl.ID, def)
		}
	})

	// 2. Data-driven legal pack (the golden templates that pin the schema).
	t.Run("legal_pack", func(t *testing.T) {
		defs, err := seed.LegalTemplateDefinitions()
		if err != nil {
			t.Fatalf("loading legal template definitions: %v", err)
		}
		if len(defs) < 3 {
			t.Fatalf("expected at least 3 golden legal templates, got %d", len(defs))
		}
		for id, def := range defs {
			validate(t, id, def)
		}
	})

	// 3. The catalog as the TemplateService surfaces it (built-ins via the
	// service API). With a catalog repo wired this would also cover DB rows; here
	// it confirms ListTemplates returns structurally valid definitions.
	t.Run("service_list", func(t *testing.T) {
		svc := NewTemplateService(nil, zerolog.Nop())
		tmpls, err := svc.ListTemplates(context.Background(), "")
		if err != nil {
			t.Fatalf("ListTemplates() error = %v", err)
		}
		for _, tmpl := range tmpls {
			def := parseTemplateDefinition(t, tmpl)
			validate(t, tmpl.ID, def)
		}
	})
}

// parseTemplateDefinition unmarshals a template's DefinitionJSON into a
// WorkflowDefinition, mirroring InstantiateTemplate's parse path.
func parseTemplateDefinition(t *testing.T, tmpl *model.WorkflowTemplate) *model.WorkflowDefinition {
	t.Helper()
	var td templateDefinition
	if err := json.Unmarshal(tmpl.DefinitionJSON, &td); err != nil {
		t.Fatalf("template %q: parsing DefinitionJSON: %v", tmpl.ID, err)
	}
	return &model.WorkflowDefinition{
		Name:          td.Name,
		Description:   td.Description,
		TriggerConfig: td.TriggerConfig,
		Variables:     td.Variables,
		Steps:         td.Steps,
	}
}
