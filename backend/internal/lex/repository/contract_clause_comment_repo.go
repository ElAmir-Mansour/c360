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

// ContractClauseCommentRepository persists collaboration notes on contract
// clauses (CAP-110). It clones MatterCommentRepository: tenant_id-first scoping,
// JSON row projection for reads, soft delete, and a Queryer-driven write path so
// callers can run inside a transaction. Mentions are stored as a JSONB array of
// strings. Threads are scoped by (tenant_id, contract_id, clause_id) and ordered
// by created_at so the frontend renders the conversation in order.
type ContractClauseCommentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractClauseCommentRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractClauseCommentRepository {
	return &ContractClauseCommentRepository{db: db, logger: logger}
}

func (r *ContractClauseCommentRepository) Create(ctx context.Context, q Queryer, c *model.ContractClauseComment) error {
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal clause comment metadata: %w", err)
	}
	mentionsJSON, err := json.Marshal(orEmptyStringSlice(c.Mentions))
	if err != nil {
		return fmt.Errorf("marshal clause comment mentions: %w", err)
	}
	query := `
		INSERT INTO contract_clause_comments (
			id, tenant_id, contract_id, clause_id, parent_comment_id,
			body, mentions, metadata, author_user_id, author_name
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		c.ID, c.TenantID, c.ContractID, c.ClauseID, c.ParentCommentID,
		c.Body, mentionsJSON, metaJSON, c.AuthorUserID, c.AuthorName,
	).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *ContractClauseCommentRepository) Get(ctx context.Context, tenantID, clauseID, id uuid.UUID) (*model.ContractClauseComment, error) {
	query := clauseCommentJSONSelect(`cc.tenant_id = $1 AND cc.clause_id = $2 AND cc.id = $3 AND cc.deleted_at IS NULL`)
	return queryRowJSON[model.ContractClauseComment](ctx, r.db, query, tenantID, clauseID, id)
}

func (r *ContractClauseCommentRepository) ListByClause(ctx context.Context, tenantID, clauseID uuid.UUID) ([]model.ContractClauseComment, error) {
	query := clauseCommentJSONSelectWithSuffix(
		`cc.tenant_id = $1 AND cc.clause_id = $2 AND cc.deleted_at IS NULL`,
		` ORDER BY cc.created_at ASC`,
	)
	return queryListJSON[model.ContractClauseComment](ctx, r.db, query, tenantID, clauseID)
}

func (r *ContractClauseCommentRepository) Update(ctx context.Context, q Queryer, c *model.ContractClauseComment) error {
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal clause comment metadata: %w", err)
	}
	mentionsJSON, err := json.Marshal(orEmptyStringSlice(c.Mentions))
	if err != nil {
		return fmt.Errorf("marshal clause comment mentions: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE contract_clause_comments
		SET body = $4,
		    mentions = $5::jsonb,
		    metadata = $6::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND clause_id = $2 AND id = $3 AND deleted_at IS NULL`,
		c.TenantID, c.ClauseID, c.ID, c.Body, mentionsJSON, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *ContractClauseCommentRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, clauseID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE contract_clause_comments
		SET deleted_at = now(), updated_at = now()
		WHERE tenant_id = $1 AND clause_id = $2 AND id = $3 AND deleted_at IS NULL`,
		tenantID, clauseID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func clauseCommentJSONSelect(where string) string {
	return clauseCommentJSONSelectWithSuffix(where, "")
}

func clauseCommentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT cc.id, cc.tenant_id, cc.contract_id, cc.clause_id,
			       cc.parent_comment_id, cc.body,
			       COALESCE(cc.mentions, '[]'::jsonb) AS mentions,
			       COALESCE(cc.metadata, '{}'::jsonb) AS metadata,
			       cc.author_user_id, cc.author_name,
			       cc.created_at, cc.updated_at, cc.deleted_at
			FROM contract_clause_comments cc
			WHERE ` + where + suffix + `
		) t`
}
