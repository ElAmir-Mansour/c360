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

// MatterCommentRepository persists collaboration notes on legal matters. It
// mirrors CaseCommentRepository: tenant_id-first scoping, JSON row projection
// for reads, soft delete, and a Queryer-driven write path so callers can run
// inside a transaction. Mentions are stored as a JSONB array of strings.
type MatterCommentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewMatterCommentRepository(db *pgxpool.Pool, logger zerolog.Logger) *MatterCommentRepository {
	return &MatterCommentRepository{db: db, logger: logger}
}

func (r *MatterCommentRepository) Create(ctx context.Context, q Queryer, c *model.MatterComment) error {
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal matter comment metadata: %w", err)
	}
	mentionsJSON, err := json.Marshal(orEmptyStringSlice(c.Mentions))
	if err != nil {
		return fmt.Errorf("marshal matter comment mentions: %w", err)
	}
	query := `
		INSERT INTO legal_matter_comments (
			id, tenant_id, matter_id, body, mentions, metadata, author_user_id, author_name
		) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$8)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		c.ID, c.TenantID, c.MatterID, c.Body, mentionsJSON, metaJSON, c.AuthorUserID, c.AuthorName,
	).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *MatterCommentRepository) Get(ctx context.Context, tenantID, matterID, id uuid.UUID) (*model.MatterComment, error) {
	query := matterCommentJSONSelect(`mc.tenant_id = $1 AND mc.matter_id = $2 AND mc.id = $3 AND mc.deleted_at IS NULL`)
	return queryRowJSON[model.MatterComment](ctx, r.db, query, tenantID, matterID, id)
}

func (r *MatterCommentRepository) ListByMatter(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterComment, error) {
	query := matterCommentJSONSelectWithSuffix(
		`mc.tenant_id = $1 AND mc.matter_id = $2 AND mc.deleted_at IS NULL`,
		` ORDER BY mc.created_at ASC`,
	)
	return queryListJSON[model.MatterComment](ctx, r.db, query, tenantID, matterID)
}

func (r *MatterCommentRepository) Update(ctx context.Context, q Queryer, c *model.MatterComment) error {
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal matter comment metadata: %w", err)
	}
	mentionsJSON, err := json.Marshal(orEmptyStringSlice(c.Mentions))
	if err != nil {
		return fmt.Errorf("marshal matter comment mentions: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_matter_comments
		SET body = $4,
		    mentions = $5::jsonb,
		    metadata = $6::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND matter_id = $2 AND id = $3 AND deleted_at IS NULL`,
		c.TenantID, c.MatterID, c.ID, c.Body, mentionsJSON, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *MatterCommentRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, matterID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_matter_comments
		SET deleted_at = now(), updated_at = now()
		WHERE tenant_id = $1 AND matter_id = $2 AND id = $3 AND deleted_at IS NULL`,
		tenantID, matterID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func matterCommentJSONSelect(where string) string {
	return matterCommentJSONSelectWithSuffix(where, "")
}

func matterCommentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT mc.id, mc.tenant_id, mc.matter_id, mc.body,
			       COALESCE(mc.mentions, '[]'::jsonb) AS mentions,
			       COALESCE(mc.metadata, '{}'::jsonb) AS metadata,
			       mc.author_user_id, mc.author_name,
			       mc.created_at, mc.updated_at, mc.deleted_at
			FROM legal_matter_comments mc
			WHERE ` + where + suffix + `
		) t`
}

func orEmptyStringSlice(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
