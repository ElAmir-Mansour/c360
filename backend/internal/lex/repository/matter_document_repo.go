package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// MatterDocumentRepository persists the matter <-> document join rows in
// legal_matter_documents. It mirrors CaseDocumentRepository: links never store
// bytes, and the linked LegalDocument is hydrated via a LEFT JOIN.
type MatterDocumentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewMatterDocumentRepository(db *pgxpool.Pool, logger zerolog.Logger) *MatterDocumentRepository {
	return &MatterDocumentRepository{db: db, logger: logger}
}

func (r *MatterDocumentRepository) Create(ctx context.Context, q Queryer, link *model.MatterDocumentLink) error {
	query := `
		INSERT INTO legal_matter_documents (
			id, tenant_id, matter_id, document_id, relationship, created_by
		) VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		link.ID, link.TenantID, link.MatterID, link.DocumentID, link.Relationship, link.CreatedBy,
	).Scan(&link.CreatedAt)
}

func (r *MatterDocumentRepository) Get(ctx context.Context, tenantID, matterID, id uuid.UUID) (*model.MatterDocumentLink, error) {
	query := matterDocumentJSONSelect(`md.tenant_id = $1 AND md.matter_id = $2 AND md.id = $3 AND md.deleted_at IS NULL`)
	return queryRowJSON[model.MatterDocumentLink](ctx, r.db, query, tenantID, matterID, id)
}

func (r *MatterDocumentRepository) ListByMatter(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterDocumentLink, error) {
	query := matterDocumentJSONSelectWithSuffix(
		`md.tenant_id = $1 AND md.matter_id = $2 AND md.deleted_at IS NULL`,
		` ORDER BY md.created_at DESC`,
	)
	return queryListJSON[model.MatterDocumentLink](ctx, r.db, query, tenantID, matterID)
}

func (r *MatterDocumentRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, matterID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_matter_documents
		SET deleted_at = now()
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

func matterDocumentJSONSelect(where string) string {
	return matterDocumentJSONSelectWithSuffix(where, "")
}

func matterDocumentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT md.id, md.tenant_id, md.matter_id, md.document_id,
			       md.relationship,
			       md.created_by, md.created_at, md.deleted_at,
			       CASE WHEN d.id IS NULL THEN NULL ELSE jsonb_build_object(
			         'id', d.id,
			         'tenant_id', d.tenant_id,
			         'title', d.title,
			         'type', d.type,
			         'description', d.description,
			         'file_id', d.file_id,
			         'file_name', d.file_name,
			         'file_size_bytes', d.file_size_bytes,
			         'category', d.category,
			         'confidentiality', d.confidentiality,
			         'contract_id', d.contract_id,
			         'current_version', d.current_version,
			         'status', d.status,
			         'tags', COALESCE(d.tags, '{}'),
			         'metadata', COALESCE(d.metadata, '{}'::jsonb),
			         'created_by', d.created_by,
			         'created_at', d.created_at,
			         'updated_at', d.updated_at,
			         'deleted_at', d.deleted_at
			       ) END AS document
			FROM legal_matter_documents md
			LEFT JOIN legal_documents d
			  ON d.tenant_id = md.tenant_id
			 AND d.id = md.document_id
			 AND d.deleted_at IS NULL
			WHERE ` + where + suffix + `
		) t`
}
