package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

type DocumentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewDocumentRepository(db *pgxpool.Pool, logger zerolog.Logger) *DocumentRepository {
	return &DocumentRepository{db: db, logger: logger}
}

func (r *DocumentRepository) Create(ctx context.Context, q Queryer, document *model.LegalDocument) error {
	query := `
		INSERT INTO legal_documents (
			id, tenant_id, title, type, description, file_id, file_name, file_size_bytes,
			extracted_text, category, confidentiality, contract_id, current_version, status, tags, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,
			$9,$10,$11,$12,$13,$14,$15,$16,$17
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		document.ID, document.TenantID, document.Title, document.Type, document.Description, document.FileID, document.FileName, document.FileSizeBytes,
		document.ExtractedText, document.Category, document.Confidentiality, document.ContractID, document.CurrentVersion, document.Status, document.Tags, document.Metadata, document.CreatedBy,
	).Scan(&document.CreatedAt, &document.UpdatedAt)
}

func (r *DocumentRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalDocument, error) {
	query := documentJSONSelect(`d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`)
	return queryRowJSON[model.LegalDocument](ctx, r.db, query, tenantID, id)
}

func (r *DocumentRepository) List(ctx context.Context, tenantID uuid.UUID, filter model.DocumentListFilter) ([]model.LegalDocument, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"d.tenant_id = $1", "d.deleted_at IS NULL"}
	if filter.Type != "" {
		conditions = append(conditions, fmt.Sprintf("d.type = $%d", arg))
		args = append(args, filter.Type)
		arg++
	}
	if filter.Status != "" {
		conditions = append(conditions, fmt.Sprintf("d.status = $%d", arg))
		args = append(args, filter.Status)
		arg++
	}
	if filter.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(d.title ILIKE '%%' || $%d || '%%' OR d.description ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filter.Search))
		arg++
	}
	if filter.Confidentiality != "" {
		conditions = append(conditions, fmt.Sprintf("d.confidentiality = $%d", arg))
		args = append(args, filter.Confidentiality)
		arg++
	}
	if filter.Category != "" {
		conditions = append(conditions, fmt.Sprintf("d.category = $%d", arg))
		args = append(args, filter.Category)
		arg++
	}
	if filter.FolderPath != "" {
		// Mirror documentFolderPath()'s metadata keys (folder_path / folderPath).
		conditions = append(conditions, fmt.Sprintf("COALESCE(d.metadata->>'folder_path', d.metadata->>'folderPath') = $%d", arg))
		args = append(args, filter.FolderPath)
		arg++
	}
	if filter.Tag != "" {
		conditions = append(conditions, fmt.Sprintf("$%d = ANY(d.tags)", arg))
		args = append(args, filter.Tag)
		arg++
	}
	if filter.MissingRetentionPolicy {
		// Mirror the repository summary: a document has a retention policy when
		// metadata retention_policy / retentionPolicy is a non-empty string.
		conditions = append(conditions, "COALESCE(NULLIF(d.metadata->>'retention_policy',''), NULLIF(d.metadata->>'retentionPolicy','')) IS NULL")
	}
	if filter.DispositionDue {
		// Mirror dispositionDue(): a document is due when its recorded
		// disposition date is not in the future. Guard the cast with a date
		// prefix match so malformed metadata can't error the whole query.
		conditions = append(conditions, `(
			((d.metadata->>'disposition_date') ~ '^\d{4}-\d{2}-\d{2}' AND (d.metadata->>'disposition_date')::timestamptz <= now())
			OR ((d.metadata->>'dispositionDate') ~ '^\d{4}-\d{2}-\d{2}' AND (d.metadata->>'dispositionDate')::timestamptz <= now())
		)`)
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_documents d WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalDocument{}, 0, nil
	}
	page := filter.Page
	perPage := filter.PerPage
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	query := documentJSONSelectWithSuffix(where, fmt.Sprintf(" ORDER BY d.updated_at DESC LIMIT $%d OFFSET $%d", arg, arg+1))
	args = append(args, perPage, (page-1)*perPage)
	items, err := queryListJSON[model.LegalDocument](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *DocumentRepository) ListRepositoryDocuments(ctx context.Context, tenantID uuid.UUID) ([]model.LegalDocument, error) {
	query := documentJSONSelectWithSuffix(`d.tenant_id = $1 AND d.deleted_at IS NULL`, ` ORDER BY d.updated_at DESC`)
	return queryListJSON[model.LegalDocument](ctx, r.db, query, tenantID)
}

func (r *DocumentRepository) Update(ctx context.Context, q Queryer, document *model.LegalDocument) error {
	query := `
		UPDATE legal_documents
		SET title = $3,
		    type = $4,
		    description = $5,
		    category = $6,
		    confidentiality = $7,
		    contract_id = $8,
		    status = $9,
		    tags = $10,
		    metadata = $11,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		document.TenantID, document.ID, document.Title, document.Type, document.Description,
		document.Category, document.Confidentiality, document.ContractID, document.Status, document.Tags, document.Metadata,
	).Scan(&document.UpdatedAt)
}

func (r *DocumentRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_documents SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *DocumentRepository) InsertVersion(ctx context.Context, q Queryer, version *model.DocumentVersion) error {
	query := `
		INSERT INTO document_versions (
			id, tenant_id, document_id, version, file_id, file_name, file_size_bytes, content_hash, extracted_text, change_summary, uploaded_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
		RETURNING uploaded_at`
	return q.QueryRow(ctx, query,
		version.ID, version.TenantID, version.DocumentID, version.Version, version.FileID, version.FileName, version.FileSizeBytes, version.ContentHash, version.ExtractedText, version.ChangeSummary, version.UploadedBy,
	).Scan(&version.UploadedAt)
}

func (r *DocumentRepository) UpdateFile(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, fileID uuid.UUID, fileName string, fileSize int64, currentVersion int) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_documents
		SET file_id = $3, file_name = $4, file_size_bytes = $5, current_version = $6, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, documentID, fileID, fileName, fileSize, currentVersion,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *DocumentRepository) UpdateExtractedText(ctx context.Context, q Queryer, tenantID, documentID uuid.UUID, text *string) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_documents
		SET extracted_text = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, documentID, text,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *DocumentRepository) ListVersions(ctx context.Context, tenantID, documentID uuid.UUID) ([]model.DocumentVersion, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, version, file_id, file_name, file_size_bytes, content_hash, extracted_text, change_summary, uploaded_by, uploaded_at
			FROM document_versions
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY version DESC
		) t`
	return queryListJSON[model.DocumentVersion](ctx, r.db, query, tenantID, documentID)
}

func (r *DocumentRepository) GetLatestVersion(ctx context.Context, tenantID, documentID uuid.UUID) (*model.DocumentVersion, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT id, tenant_id, document_id, version, file_id, file_name, file_size_bytes, content_hash, extracted_text, change_summary, uploaded_by, uploaded_at
			FROM document_versions
			WHERE tenant_id = $1 AND document_id = $2
			ORDER BY version DESC
			LIMIT 1
		) t`
	return queryRowJSON[model.DocumentVersion](ctx, r.db, query, tenantID, documentID)
}

func (r *DocumentRepository) CountByType(ctx context.Context, tenantID uuid.UUID) (map[string]int, error) {
	rows, err := r.db.Query(ctx, `SELECT type, COUNT(*) FROM legal_documents WHERE tenant_id = $1 AND deleted_at IS NULL GROUP BY type`, tenantID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var key string
		var value int
		if err := rows.Scan(&key, &value); err != nil {
			return nil, err
		}
		out[key] = value
	}
	return out, rows.Err()
}

func (r *DocumentRepository) GetByFileID(ctx context.Context, fileID uuid.UUID) ([]model.LegalDocument, error) {
	query := documentJSONSelect(`(d.file_id = $1 OR EXISTS (SELECT 1 FROM document_versions v WHERE v.document_id = d.id AND v.file_id = $1)) AND d.deleted_at IS NULL`)
	return queryListJSON[model.LegalDocument](ctx, r.db, query, fileID)
}

func documentJSONSelect(where string) string {
	return documentJSONSelectWithSuffix(where, "")
}

func documentJSONSelectWithSuffix(where, suffix string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT d.id, d.tenant_id, d.title, d.type, d.description,
			       d.file_id, d.file_name, d.file_size_bytes, d.extracted_text,
			       d.category, d.confidentiality, d.contract_id, d.current_version, d.status,
			       COALESCE(d.tags, '{}') AS tags, COALESCE(d.metadata, '{}'::jsonb) AS metadata,
			       d.created_by, d.created_at, d.updated_at, d.deleted_at
			FROM legal_documents d
			WHERE ` + where + suffix + `
		) t`
}
