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

type CaseDocumentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewCaseDocumentRepository(db *pgxpool.Pool, logger zerolog.Logger) *CaseDocumentRepository {
	return &CaseDocumentRepository{db: db, logger: logger}
}

func (r *CaseDocumentRepository) Create(ctx context.Context, q Queryer, link *model.CaseDocumentLink) error {
	metaJSON, err := json.Marshal(orEmptyMap(link.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case document link metadata: %w", err)
	}
	query := `
		INSERT INTO legal_case_documents (
			id, tenant_id, case_id, document_id, source, category, notes,
			evidence_status, court_reference, submitted_by, submitted_at,
			metadata, created_by, updated_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		link.ID, link.TenantID, link.CaseID, link.DocumentID, link.Source, link.Category,
		link.Notes, link.EvidenceStatus, link.CourtReference, link.SubmittedBy,
		link.SubmittedAt, metaJSON, link.CreatedBy, link.UpdatedBy,
	).Scan(&link.CreatedAt, &link.UpdatedAt)
}

func (r *CaseDocumentRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.CaseDocumentLink, error) {
	query := caseDocumentJSONSelect(`cd.tenant_id = $1 AND cd.case_id = $2 AND cd.id = $3 AND cd.deleted_at IS NULL`)
	return queryRowJSON[model.CaseDocumentLink](ctx, r.db, query, tenantID, caseID, id)
}

func (r *CaseDocumentRepository) ListByCase(ctx context.Context, tenantID, caseID uuid.UUID) ([]model.CaseDocumentLink, error) {
	query := caseDocumentJSONSelectWithSuffix(
		`cd.tenant_id = $1 AND cd.case_id = $2 AND cd.deleted_at IS NULL`,
		` ORDER BY cd.created_at DESC`,
	)
	return queryListJSON[model.CaseDocumentLink](ctx, r.db, query, tenantID, caseID)
}

func (r *CaseDocumentRepository) SoftDeleteTx(ctx context.Context, q Queryer, tenantID, caseID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_documents
		SET deleted_at = now()
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

func (r *CaseDocumentRepository) Update(ctx context.Context, q Queryer, link *model.CaseDocumentLink) error {
	metaJSON, err := json.Marshal(orEmptyMap(link.Metadata))
	if err != nil {
		return fmt.Errorf("marshal case document link metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_case_documents
		SET category = $4,
		    notes = $5,
		    evidence_status = $6,
		    court_reference = $7,
		    submitted_by = $8,
		    submitted_at = $9,
		    metadata = $10::jsonb,
		    updated_by = $11,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		link.TenantID, link.CaseID, link.ID, link.Category, link.Notes,
		link.EvidenceStatus, link.CourtReference, link.SubmittedBy, link.SubmittedAt,
		metaJSON, link.UpdatedBy,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func caseDocumentJSONSelect(where string) string {
	return caseDocumentJSONSelectWithSuffix(where, "")
}

func caseDocumentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT cd.id, cd.tenant_id, cd.case_id, cd.document_id,
			       cd.source, cd.category, cd.notes,
			       cd.evidence_status, cd.court_reference, cd.submitted_by, cd.submitted_at,
			       COALESCE(cd.metadata, '{}'::jsonb) AS metadata,
			       cd.created_by, cd.updated_by, cd.created_at, cd.updated_at, cd.deleted_at,
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
			FROM legal_case_documents cd
			LEFT JOIN legal_documents d
			  ON d.tenant_id = cd.tenant_id
			 AND d.id = cd.document_id
			 AND d.deleted_at IS NULL
			WHERE ` + where + suffix + `
		) t`
}
