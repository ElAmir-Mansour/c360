package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// PromptTemplateRepository persists reusable LLM prompt templates (AID-09).
// Queries filter by tenant_id (primary) with table RLS as a backstop, mirroring
// the other lex repositories.
type PromptTemplateRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewPromptTemplateRepository(db *pgxpool.Pool, logger zerolog.Logger) *PromptTemplateRepository {
	return &PromptTemplateRepository{db: db, logger: logger}
}

const promptTemplateColumns = `id, tenant_id, name, description, category, system_prompt, user_prompt,
	variables, metadata, created_by, updated_by, created_at, updated_at`

func (r *PromptTemplateRepository) Create(ctx context.Context, q Queryer, t *model.PromptTemplate) error {
	varsJSON, err := json.Marshal(orEmptyStrings(t.Variables))
	if err != nil {
		return fmt.Errorf("marshal prompt variables: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(t.Metadata))
	if err != nil {
		return fmt.Errorf("marshal prompt metadata: %w", err)
	}
	row := q.QueryRow(ctx, `
		INSERT INTO lex_prompt_templates (
			id, tenant_id, name, description, category, system_prompt, user_prompt, variables, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
		RETURNING `+promptTemplateColumns,
		t.ID, t.TenantID, t.Name, t.Description, t.Category, t.SystemPrompt, t.UserPrompt, varsJSON, metaJSON, t.CreatedBy,
	)
	created, err := scanPromptTemplate(row)
	if err != nil {
		return err
	}
	*t = *created
	return nil
}

func (r *PromptTemplateRepository) Update(ctx context.Context, q Queryer, t *model.PromptTemplate, updatedBy uuid.UUID) error {
	varsJSON, err := json.Marshal(orEmptyStrings(t.Variables))
	if err != nil {
		return fmt.Errorf("marshal prompt variables: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(t.Metadata))
	if err != nil {
		return fmt.Errorf("marshal prompt metadata: %w", err)
	}
	row := q.QueryRow(ctx, `
		UPDATE lex_prompt_templates
		SET name = $3, description = $4, category = $5, system_prompt = $6, user_prompt = $7,
		    variables = $8::jsonb, metadata = $9::jsonb, updated_by = $10, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING `+promptTemplateColumns,
		t.TenantID, t.ID, t.Name, t.Description, t.Category, t.SystemPrompt, t.UserPrompt, varsJSON, metaJSON, updatedBy,
	)
	updated, err := scanPromptTemplate(row)
	if err != nil {
		return err
	}
	*t = *updated
	return nil
}

func (r *PromptTemplateRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.PromptTemplate, error) {
	row := r.db.QueryRow(ctx, `
		SELECT `+promptTemplateColumns+`
		FROM lex_prompt_templates
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	)
	return scanPromptTemplate(row)
}

func (r *PromptTemplateRepository) List(ctx context.Context, tenantID uuid.UUID, page, perPage int) ([]model.PromptTemplate, int, error) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 50
	}
	if perPage > 200 {
		perPage = 200
	}
	var total int
	if err := r.db.QueryRow(ctx, `SELECT COUNT(*) FROM lex_prompt_templates WHERE tenant_id = $1 AND deleted_at IS NULL`, tenantID).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.PromptTemplate{}, 0, nil
	}
	rows, err := r.db.Query(ctx, `
		SELECT `+promptTemplateColumns+`
		FROM lex_prompt_templates
		WHERE tenant_id = $1 AND deleted_at IS NULL
		ORDER BY category ASC, updated_at DESC
		LIMIT $2 OFFSET $3`,
		tenantID, perPage, (page-1)*perPage,
	)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]model.PromptTemplate, 0)
	for rows.Next() {
		item, err := scanPromptTemplate(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, *item)
	}
	return items, total, rows.Err()
}

func (r *PromptTemplateRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE lex_prompt_templates SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func scanPromptTemplate(row pgx.Row) (*model.PromptTemplate, error) {
	var item model.PromptTemplate
	var varsJSON, metaJSON []byte
	if err := row.Scan(
		&item.ID, &item.TenantID, &item.Name, &item.Description, &item.Category,
		&item.SystemPrompt, &item.UserPrompt, &varsJSON, &metaJSON,
		&item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt,
	); err != nil {
		return nil, err
	}
	item.Variables = []string{}
	if len(varsJSON) > 0 {
		if err := json.Unmarshal(varsJSON, &item.Variables); err != nil {
			return nil, fmt.Errorf("decode prompt variables: %w", err)
		}
	}
	item.Metadata = map[string]any{}
	if len(metaJSON) > 0 {
		if err := json.Unmarshal(metaJSON, &item.Metadata); err != nil {
			return nil, fmt.Errorf("decode prompt metadata: %w", err)
		}
	}
	return &item, nil
}

func orEmptyStrings(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
