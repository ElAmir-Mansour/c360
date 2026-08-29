package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/model"
)

// TemplateRepository handles persistence for the data-driven workflow template
// catalog (workflow_db.workflow_templates). Templates are either GLOBAL
// (tenant_id IS NULL — visible to every tenant) or scoped to a single tenant.
// Reads always union the requested tenant's private rows with the globals so a
// caller sees the full catalog available to it.
//
// Like the other workflow repositories, queries filter by tenant_id in SQL and
// the underlying table is intentionally NOT RLS-forced (see 000005 migration),
// so the bare pool is used here.
type TemplateRepository struct {
	db definitionDBTX
}

// NewTemplateRepository creates a new TemplateRepository backed by the provided
// connection pool.
func NewTemplateRepository(pool *pgxpool.Pool) *TemplateRepository {
	return &TemplateRepository{db: pool}
}

const templateSelectColumns = `
	id, tenant_id, name_i18n, description_i18n, category, tags, icon,
	definition_json, version, created_at`

// List returns every template visible to the given tenant: the tenant's own
// rows plus all global (tenant_id IS NULL) rows. An empty tenantID returns the
// globals only. Results are ordered by category then id for stable display.
func (r *TemplateRepository) List(ctx context.Context, tenantID string) ([]*model.WorkflowTemplate, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_templates
		WHERE tenant_id IS NULL OR tenant_id = NULLIF($1, '')::uuid
		ORDER BY category, id`, templateSelectColumns)

	rows, err := r.db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("listing workflow templates: %w", err)
	}
	defer rows.Close()

	return scanTemplates(rows)
}

// ListByCategory returns the templates visible to the tenant filtered to a
// single category.
func (r *TemplateRepository) ListByCategory(ctx context.Context, tenantID, category string) ([]*model.WorkflowTemplate, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_templates
		WHERE category = $2
		  AND (tenant_id IS NULL OR tenant_id = NULLIF($1, '')::uuid)
		ORDER BY id`, templateSelectColumns)

	rows, err := r.db.Query(ctx, query, tenantID, category)
	if err != nil {
		return nil, fmt.Errorf("listing workflow templates by category: %w", err)
	}
	defer rows.Close()

	return scanTemplates(rows)
}

// Get retrieves a single template by id that is visible to the tenant (the
// tenant's own row or a global row). Returns model.ErrNotFound when absent.
func (r *TemplateRepository) Get(ctx context.Context, tenantID, id string) (*model.WorkflowTemplate, error) {
	query := fmt.Sprintf(`
		SELECT %s
		FROM workflow_templates
		WHERE id = $2
		  AND (tenant_id IS NULL OR tenant_id = NULLIF($1, '')::uuid)
		ORDER BY tenant_id NULLS LAST
		LIMIT 1`, templateSelectColumns)

	return scanTemplate(r.db.QueryRow(ctx, query, tenantID, id))
}

// Upsert inserts or updates a template by id. An empty tenantID stores a global
// template (tenant_id IS NULL). definition_json, name_i18n, description_i18n and
// tags are marshaled to JSONB. Idempotent: re-applying the same template is a
// no-op beyond refreshing updated_at.
func (r *TemplateRepository) Upsert(ctx context.Context, tmpl *model.WorkflowTemplate) error {
	nameJSON, err := json.Marshal(orEmptyMap(tmpl.NameI18n))
	if err != nil {
		return fmt.Errorf("marshaling name_i18n: %w", err)
	}
	descJSON, err := json.Marshal(orEmptyMap(tmpl.DescriptionI18n))
	if err != nil {
		return fmt.Errorf("marshaling description_i18n: %w", err)
	}
	tags := tmpl.Tags
	if tags == nil {
		tags = []string{}
	}
	tagsJSON, err := json.Marshal(tags)
	if err != nil {
		return fmt.Errorf("marshaling tags: %w", err)
	}
	defJSON := []byte(tmpl.DefinitionJSON)
	if len(defJSON) == 0 {
		defJSON = []byte("{}")
	}
	version := tmpl.Version
	if version == 0 {
		version = 1
	}

	query := `
		INSERT INTO workflow_templates (
			id, tenant_id, name_i18n, description_i18n, category, tags, icon,
			definition_json, version
		) VALUES ($1, NULLIF($2, '')::uuid, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (id) DO UPDATE SET
			tenant_id       = EXCLUDED.tenant_id,
			name_i18n       = EXCLUDED.name_i18n,
			description_i18n = EXCLUDED.description_i18n,
			category        = EXCLUDED.category,
			tags            = EXCLUDED.tags,
			icon            = EXCLUDED.icon,
			definition_json = EXCLUDED.definition_json,
			version         = EXCLUDED.version,
			updated_at      = now()`

	_, err = r.db.Exec(ctx, query,
		tmpl.ID,
		tmpl.TenantScope,
		nameJSON,
		descJSON,
		tmpl.Category,
		tagsJSON,
		tmpl.Icon,
		defJSON,
		version,
	)
	if err != nil {
		return fmt.Errorf("upserting workflow template %q: %w", tmpl.ID, err)
	}
	return nil
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func scanTemplate(row pgx.Row) (*model.WorkflowTemplate, error) {
	tmpl, err := scanTemplateRow(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, fmt.Errorf("workflow template: %w", model.ErrNotFound)
		}
		return nil, fmt.Errorf("scanning workflow template: %w", err)
	}
	return tmpl, nil
}

func scanTemplates(rows pgx.Rows) ([]*model.WorkflowTemplate, error) {
	var out []*model.WorkflowTemplate
	for rows.Next() {
		tmpl, err := scanTemplateRow(rows)
		if err != nil {
			return nil, fmt.Errorf("scanning workflow template row: %w", err)
		}
		out = append(out, tmpl)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating workflow template rows: %w", err)
	}
	return out, nil
}

// scanTemplateRow scans one row (pgx.Row or pgx.Rows, via the shared rowScanner
// declared in promotion_repo.go) into a WorkflowTemplate.
func scanTemplateRow(s rowScanner) (*model.WorkflowTemplate, error) {
	var (
		tmpl           model.WorkflowTemplate
		tenantID       *string
		nameJSON       []byte
		descJSON       []byte
		tagsJSON       []byte
		definitionJSON []byte
	)

	if err := s.Scan(
		&tmpl.ID,
		&tenantID,
		&nameJSON,
		&descJSON,
		&tmpl.Category,
		&tagsJSON,
		&tmpl.Icon,
		&definitionJSON,
		&tmpl.Version,
		&tmpl.CreatedAt,
	); err != nil {
		return nil, err
	}

	if tenantID != nil {
		tmpl.TenantScope = *tenantID
	}

	if err := json.Unmarshal(nameJSON, &tmpl.NameI18n); err != nil {
		return nil, fmt.Errorf("unmarshaling name_i18n: %w", err)
	}
	if err := json.Unmarshal(descJSON, &tmpl.DescriptionI18n); err != nil {
		return nil, fmt.Errorf("unmarshaling description_i18n: %w", err)
	}
	if len(tagsJSON) > 0 {
		if err := json.Unmarshal(tagsJSON, &tmpl.Tags); err != nil {
			return nil, fmt.Errorf("unmarshaling tags: %w", err)
		}
	}
	tmpl.DefinitionJSON = definitionJSON

	// Populate the flat Name/Description convenience fields from the i18n maps
	// (English preferred, then Arabic) so existing consumers keep working.
	tmpl.Name = localize(tmpl.NameI18n)
	tmpl.Description = localize(tmpl.DescriptionI18n)

	return &tmpl, nil
}

// localize returns the en value, falling back to ar, then any present value.
func localize(m map[string]string) string {
	if m == nil {
		return ""
	}
	if v := m["en"]; v != "" {
		return v
	}
	if v := m["ar"]; v != "" {
		return v
	}
	for _, v := range m {
		if v != "" {
			return v
		}
	}
	return ""
}

func orEmptyMap(m map[string]string) map[string]string {
	if m == nil {
		return map[string]string{}
	}
	return m
}
