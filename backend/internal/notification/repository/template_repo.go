package repository

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

// DefaultTemplateTenantID is the sentinel tenant under which platform-default
// templates are stored. A per-tenant override is keyed by the tenant's own UUID;
// resolution prefers the tenant override, then this default, then the embedded
// Go-const template.
const DefaultTemplateTenantID = "00000000-0000-0000-0000-000000000000"

// TemplateRepository loads and stores DB-backed notification templates (#18).
// The notification_templates table already existed but was never queried — this
// repository makes it live so tenants can override the embedded defaults.
type TemplateRepository struct {
	// db is an interface seam (PgxDB) so the repository can be unit-tested with
	// pgxmock; production always passes a concrete *pgxpool.Pool.
	db     PgxDB
	logger zerolog.Logger
}

// NewTemplateRepository creates a new TemplateRepository.
func NewTemplateRepository(db *pgxpool.Pool, logger zerolog.Logger) *TemplateRepository {
	return &TemplateRepository{db: db, logger: logger.With().Str("component", "template_repo").Logger()}
}

// GetEmailTemplate returns the stored email template for (tenant, templateID),
// or found=false with a nil error when none exists. templateID is the
// notification type string (e.g. "alert.created").
func (r *TemplateRepository) GetEmailTemplate(ctx context.Context, tenantID, templateID string) (*model.TemplateConfig, bool, error) {
	if tenantID == "" {
		tenantID = DefaultTemplateTenantID
	}
	const query = `SELECT id, tenant_id, channel, subject_tmpl, body_tmpl, created_at, updated_at
		FROM notification_templates
		WHERE id = $1 AND tenant_id = $2 AND channel = 'email'`
	var (
		t   model.TemplateConfig
		tid string
	)
	err := r.db.QueryRow(ctx, query, templateID, tenantID).Scan(
		&t.ID, &tid, &t.Channel, &t.SubjectTmpl, &t.BodyTmpl, &t.CreatedAt, &t.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("get email template: %w", err)
	}
	t.TenantID = &tid
	return &t, true, nil
}

// Upsert stores or replaces a template (admin edit path). It overwrites an
// existing (id, channel, tenant) row.
func (r *TemplateRepository) Upsert(ctx context.Context, t *model.TemplateConfig) error {
	const query = `INSERT INTO notification_templates (id, tenant_id, channel, subject_tmpl, body_tmpl, updated_at)
		VALUES ($1, $2, $3, $4, $5, now())
		ON CONFLICT (id, channel, tenant_id)
		DO UPDATE SET subject_tmpl = EXCLUDED.subject_tmpl,
		              body_tmpl = EXCLUDED.body_tmpl,
		              updated_at = now()`
	if _, err := r.db.Exec(ctx, query, t.ID, templateTenant(t), t.Channel, t.SubjectTmpl, t.BodyTmpl); err != nil {
		return fmt.Errorf("upsert template: %w", err)
	}
	return nil
}

// SeedDefault inserts a platform-default template ONLY if the row is absent
// (ON CONFLICT DO NOTHING), so it never clobbers an operator's customization on
// restart. Used at startup to materialize the embedded defaults into the table.
func (r *TemplateRepository) SeedDefault(ctx context.Context, t *model.TemplateConfig) error {
	const query = `INSERT INTO notification_templates (id, tenant_id, channel, subject_tmpl, body_tmpl)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (id, channel, tenant_id) DO NOTHING`
	if _, err := r.db.Exec(ctx, query, t.ID, templateTenant(t), t.Channel, t.SubjectTmpl, t.BodyTmpl); err != nil {
		return fmt.Errorf("seed template %s: %w", t.ID, err)
	}
	return nil
}

// templateTenant resolves the tenant a template row is stored under, defaulting
// to the platform-default sentinel when unset.
func templateTenant(t *model.TemplateConfig) string {
	if t.TenantID != nil && *t.TenantID != "" {
		return *t.TenantID
	}
	return DefaultTemplateTenantID
}
