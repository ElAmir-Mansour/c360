package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// LegalRequestAttachmentRepository persists the authoritative request/file
// relationship. File bytes and live scan state remain owned by file-service.
type LegalRequestAttachmentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalRequestAttachmentRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalRequestAttachmentRepository {
	return &LegalRequestAttachmentRepository{db: db, logger: logger}
}

func (r *LegalRequestAttachmentRepository) Create(ctx context.Context, q Queryer, item *model.LegalRequestAttachment) error {
	return q.QueryRow(ctx, `
		INSERT INTO legal_request_attachments (
			id, tenant_id, legal_request_id, file_id, slot_key, original_name,
			content_type, size_bytes, checksum_sha256, file_version,
			virus_scan_status, uploaded_by, cycle
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,
			-- Stamped from the request's round counter in the same statement, so an
			-- upload is always attributed to the round it actually arrived in.
			COALESCE((SELECT cycle FROM legal_requests WHERE tenant_id = $2 AND id = $3), 1))
		RETURNING created_at, updated_at, cycle`,
		item.ID, item.TenantID, item.LegalRequestID, item.FileID, item.SlotKey,
		item.OriginalName, item.ContentType, item.SizeBytes, item.ChecksumSHA256,
		item.FileVersion, item.VirusScanStatus, item.UploadedBy,
	).Scan(&item.CreatedAt, &item.UpdatedAt, &item.Cycle)
}

func (r *LegalRequestAttachmentRepository) Get(ctx context.Context, tenantID, requestID, attachmentID uuid.UUID) (*model.LegalRequestAttachment, error) {
	return queryRowJSON[model.LegalRequestAttachment](ctx, r.db, `
		SELECT row_to_json(a)
		FROM legal_request_attachments a
		WHERE a.tenant_id = $1 AND a.legal_request_id = $2 AND a.id = $3
		  AND a.deleted_at IS NULL`, tenantID, requestID, attachmentID)
}

func (r *LegalRequestAttachmentRepository) List(ctx context.Context, tenantID, requestID uuid.UUID) ([]model.LegalRequestAttachment, error) {
	return r.ListWith(ctx, r.db, tenantID, requestID)
}

func (r *LegalRequestAttachmentRepository) ListWith(ctx context.Context, q Queryer, tenantID, requestID uuid.UUID) ([]model.LegalRequestAttachment, error) {
	return queryListJSON[model.LegalRequestAttachment](ctx, q, `
		SELECT row_to_json(a)
		FROM legal_request_attachments a
		WHERE a.tenant_id = $1 AND a.legal_request_id = $2
		  AND a.deleted_at IS NULL
		ORDER BY a.created_at ASC, a.id ASC`, tenantID, requestID)
}

func (r *LegalRequestAttachmentRepository) UpdateScanStatus(ctx context.Context, tenantID, requestID, attachmentID uuid.UUID, status string) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE legal_request_attachments
		SET virus_scan_status = $4, updated_at = now()
		WHERE tenant_id = $1 AND legal_request_id = $2 AND id = $3
		  AND deleted_at IS NULL`, tenantID, requestID, attachmentID, status)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
