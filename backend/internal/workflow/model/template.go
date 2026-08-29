package model

import (
	"encoding/json"
	"time"
)

// WorkflowTemplate is a reusable, pre-built workflow definition that tenants
// can instantiate to create their own WorkflowDefinition. Templates are
// system-level (not tenant-scoped) and are typically seeded at deployment time.
type WorkflowTemplate struct {
	ID string `json:"id" db:"id"`
	// TenantScope is empty for GLOBAL templates (stored with tenant_id IS NULL,
	// visible to every tenant) and set to a tenant UUID for a private catalog
	// template. Data-driven catalog rows only.
	TenantScope string `json:"tenant_id,omitempty" db:"tenant_id"`
	Name        string `json:"name" db:"name"`
	Description string `json:"description" db:"description"`
	// NameI18n / DescriptionI18n carry the bilingual (ar/en) display strings for
	// data-driven catalog templates loaded from workflow_db.workflow_templates.
	// The flat Name/Description fields above are kept for the in-process built-in
	// catalog and as a localized convenience (populated from the i18n maps on
	// read). Empty for the legacy hard-coded built-ins.
	NameI18n        map[string]string `json:"name_i18n,omitempty" db:"name_i18n"`
	DescriptionI18n map[string]string `json:"description_i18n,omitempty" db:"description_i18n"`
	Category        string            `json:"category" db:"category"`
	DefinitionJSON  json.RawMessage   `json:"definition_json" db:"definition_json"`
	Icon            string            `json:"icon" db:"icon"`
	PreviewImageURL *string           `json:"preview_image_url,omitempty" db:"preview_image_url"`
	Tags            []string          `json:"tags,omitempty" db:"tags"`
	// Version is the catalog version for data-driven templates (1 for built-ins).
	Version    int       `json:"version" db:"version"`
	UsageCount int       `json:"usage_count" db:"usage_count"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
}

// TemplateDefinitionContent represents the parsed content of DefinitionJSON
// used for enriching the template response with steps and variables.
type TemplateDefinitionContent struct {
	Steps     []StepDefinition       `json:"steps"`
	Variables map[string]VariableDef `json:"variables"`
}
