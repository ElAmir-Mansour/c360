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

type CaseCommentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCaseCommentRepository(db *pgxpool.Pool, logger zerolog.Logger) *CaseCommentRepository {
	return &CaseCommentRepository{db: db, logger: logger}
}

func (r *CaseCommentRepository) Create(ctx context.Context, q Queryer, c *model.CaseComment) error {
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case comment metadata: %w", err)
	}
	// Mentions are a JSONB string array (user IDs OR display handles), mirroring
	// the matter/clause comment repos — a bare @handle must persist, not 400.
	mentionsJSON, err := json.Marshal(orEmptyStringSlice(c.Mentions))
	if err != nil {
		return fmt.Errorf("marshal case comment mentions: %w", err)
	}
	query := `
		INSERT INTO legal_case_comments (
			id, tenant_id, case_id, body, mentions, metadata, created_by
		) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		c.ID, c.TenantID, c.CaseID, c.Body, mentionsJSON, metaJSON, c.CreatedBy,
	).Scan(&c.CreatedAt, &c.UpdatedAt)
}

func (r *CaseCommentRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.CaseComment, error) {
	query := caseCommentJSONSelect(`cc.tenant_id = $1 AND cc.case_id = $2 AND cc.id = $3 AND cc.deleted_at IS NULL`)
	return queryRowJSON[model.CaseComment](ctx, r.db, query, tenantID, caseID, id)
}

func (r *CaseCommentRepository) ListByCase(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseComment, error) {
	query := caseCommentJSONSelectWithSuffix(
		`cc.tenant_id = $1 AND cc.case_id = $2 AND cc.deleted_at IS NULL`,
		` ORDER BY cc.created_at ASC`,
	)
	return queryListJSON[model.CaseComment](ctx, r.db, query, tenantID, caseID)
}

func (r *CaseCommentRepository) Update(ctx context.Context, q Queryer, c *model.CaseComment) error {
	metaJSON, err := json.Marshal(orEmptyMap(c.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case comment metadata: %w", err)
	}
	mentionsJSON, err := json.Marshal(orEmptyStringSlice(c.Mentions))
	if err != nil {
		return fmt.Errorf("marshal case comment mentions: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_comments
		SET body = $4,
		    mentions = $5::jsonb,
		    metadata = $6::jsonb,
		    updated_by = $7,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		c.TenantID, c.CaseID, c.ID, c.Body, mentionsJSON, metaJSON, c.UpdatedBy,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *CaseCommentRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, caseID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_comments
		SET deleted_at = now(), updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		tenantID, caseID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func caseCommentJSONSelect(where string) string {
	return caseCommentJSONSelectWithSuffix(where, "")
}

func caseCommentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT cc.id, cc.tenant_id, cc.case_id, cc.body,
			       COALESCE(cc.mentions, '[]'::jsonb) AS mentions,
			       COALESCE(cc.metadata, '{}'::jsonb) AS metadata,
			       cc.created_by, cc.updated_by, cc.created_at, cc.updated_at, cc.deleted_at
			FROM legal_case_comments cc
			WHERE ` + where + suffix + `
		) t`
}
