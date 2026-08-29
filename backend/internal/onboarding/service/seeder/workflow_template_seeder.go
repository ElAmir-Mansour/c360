package seeder

import (
	"context"
	"fmt"

	"github.com/rs/zerolog"

	workflowrepo "github.com/clario360/platform/internal/workflow/repository"
	"github.com/clario360/platform/internal/workflow/seed"
	workflowservice "github.com/clario360/platform/internal/workflow/service"
)

type WorkflowTemplateSeeder struct {
	definitions *workflowrepo.DefinitionRepository
	catalog     *workflowrepo.TemplateRepository
	templates   *workflowservice.TemplateService
	logger      zerolog.Logger
}

func NewWorkflowTemplateSeeder(definitions *workflowrepo.DefinitionRepository, catalog *workflowrepo.TemplateRepository, logger zerolog.Logger) *WorkflowTemplateSeeder {
	templates := workflowservice.NewTemplateService(definitions, logger)
	// WS-1: read the data-driven catalog (global + per-tenant) first, falling
	// back to the in-process built-ins. When catalog is nil the service stays on
	// built-ins only.
	if catalog != nil {
		templates.SetCatalogRepository(catalog)
	}
	return &WorkflowTemplateSeeder{
		definitions: definitions,
		catalog:     catalog,
		templates:   templates,
		logger:      logger.With().Str("component", "workflow_template_seeder").Logger(),
	}
}

func (s *WorkflowTemplateSeeder) Seed(ctx context.Context, tenantID, adminUserID string) error {
	// WS-1: load the golden legal pack (seed/legal_templates.json) into the
	// data-driven catalog so it is instantiated alongside the built-ins. The
	// Upsert is idempotent on the template id, so re-seeding is a no-op.
	if s.catalog != nil {
		legalTemplates, err := seed.LegalTemplates()
		if err != nil {
			return fmt.Errorf("loading legal template pack: %w", err)
		}
		for _, tmpl := range legalTemplates {
			if err := s.catalog.Upsert(ctx, tmpl); err != nil {
				return fmt.Errorf("upserting legal template %s into catalog: %w", tmpl.ID, err)
			}
		}
	}

	templates, err := s.templates.ListTemplates(ctx, "")
	if err != nil {
		return err
	}
	for _, tmpl := range templates {
		definitions, _, err := s.definitions.List(ctx, tenantID, "", tmpl.Name, "", "", "", 25, 0)
		if err != nil {
			return err
		}
		exists := false
		for _, definition := range definitions {
			if definition.Name == tmpl.Name {
				exists = true
				break
			}
		}
		if exists {
			continue
		}
		if _, err := s.templates.InstantiateTemplate(ctx, tenantID, adminUserID, tmpl.ID, "", ""); err != nil {
			return fmt.Errorf("instantiate workflow template %s: %w", tmpl.ID, err)
		}
	}
	return nil
}
