package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// SettlementDocumentRepository persists the settlement <-> document join rows in
// legal_settlement_documents. It mirrors MatterDocumentRepository: links never
// store bytes, and the linked LegalDocument is hydrated via a LEFT JOIN.
type SettlementDocumentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSettlementDocumentRepository(db *pgxpool.Pool, logger zerolog.Logger) *SettlementDocumentRepository {
	return &SettlementDocumentRepository{db: db, logger: logger}
}

func (r *SettlementDocumentRepository) Create(ctx context.Context, q Queryer, link *model.SettlementDocumentLink) error {
	query := `
		INSERT INTO legal_settlement_documents (
			id, tenant_id, settlement_id, document_id, relationship, created_by
		) VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		link.ID, link.TenantID, link.SettlementID, link.DocumentID, link.Relationship, link.CreatedBy,
	).Scan(&link.CreatedAt)
}

func (r *SettlementDocumentRepository) Get(ctx context.Context, tenantID, settlementID, id uuid.UUID) (*model.SettlementDocumentLink, error) {
	query := settlementDocumentJSONSelect(`sd.tenant_id = $1 AND sd.settlement_id = $2 AND sd.id = $3 AND sd.deleted_at IS NULL`)
	return queryRowJSON[model.SettlementDocumentLink](ctx, r.db, query, tenantID, settlementID, id)
}

func (r *SettlementDocumentRepository) ListBySettlement(ctx context.Context, tenantID, settlementID uuid.UUID) ([]model.SettlementDocumentLink, error) {
	query := settlementDocumentJSONSelectWithSuffix(
		`sd.tenant_id = $1 AND sd.settlement_id = $2 AND sd.deleted_at IS NULL`,
		` ORDER BY sd.created_at DESC`,
	)
	return queryListJSON[model.SettlementDocumentLink](ctx, r.db, query, tenantID, settlementID)
}

func (r *SettlementDocumentRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, settlementID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_settlement_documents
		SET deleted_at = now()
		WHERE tenant_id = $1 AND settlement_id = $2 AND id = $3 AND deleted_at IS NULL`,
		tenantID, settlementID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func settlementDocumentJSONSelect(where string) string {
	return settlementDocumentJSONSelectWithSuffix(where, "")
}

func settlementDocumentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT sd.id, sd.tenant_id, sd.settlement_id, sd.document_id,
			       sd.relationship,
			       sd.created_by, sd.created_at, sd.deleted_at,
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
			FROM legal_settlement_documents sd
			LEFT JOIN legal_documents d
			  ON d.tenant_id = sd.tenant_id
			 AND d.id = sd.document_id
			 AND d.deleted_at IS NULL
			WHERE ` + where + suffix + `
		) t`
}
