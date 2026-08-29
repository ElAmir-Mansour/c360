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

// ContractAttachmentRepository persists review-desk attachments and the per-slot
// attachment-requirement rows (CAP-099/CAP-103). Queries lead with tenant_id
// (primary predicate) with table RLS as a backstop; mutating methods accept a
// Queryer so they commit atomically with the desk-state + audit writes the
// service performs.
type ContractAttachmentRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewContractAttachmentRepository(db *pgxpool.Pool, logger zerolog.Logger) *ContractAttachmentRepository {
	return &ContractAttachmentRepository{db: db, logger: logger}
}

// --- Requirements (named slots) ---------------------------------------------

// UpsertRequirement inserts (or refreshes) one named-slot requirement row for a
// contract. Used by the service to seed the four named slots when an intake opens
// (CAP-099) and to toggle a slot required/optional.
func (r *ContractAttachmentRepository) UpsertRequirement(ctx context.Context, q Queryer, req *model.ContractAttachmentRequirement) error {
	query := `
		INSERT INTO lex_contract_attachment_requirements (
			id, tenant_id, contract_id, slot, required, label, sort_order, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		ON CONFLICT (tenant_id, contract_id, slot)
		DO UPDATE SET required = EXCLUDED.required,
		              label = EXCLUDED.label,
		              sort_order = EXCLUDED.sort_order,
		              updated_at = now()
		RETURNING id, created_at, updated_at`
	return q.QueryRow(ctx, query,
		req.ID, req.TenantID, req.ContractID, req.Slot, req.Required, req.Label, req.SortOrder, req.CreatedBy,
	).Scan(&req.ID, &req.CreatedAt, &req.UpdatedAt)
}

func (r *ContractAttachmentRepository) ListRequirements(ctx context.Context, tenantID, contractID uuid.UUID) ([]model.ContractAttachmentRequirement, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT ar.id, ar.tenant_id, ar.contract_id, ar.slot, ar.required, ar.label,
			       ar.sort_order, ar.created_by, ar.created_at, ar.updated_at
			FROM lex_contract_attachment_requirements ar
			WHERE ar.tenant_id = $1 AND ar.contract_id = $2
			ORDER BY ar.sort_order ASC, ar.slot ASC
		) t`
	return queryListJSON[model.ContractAttachmentRequirement](ctx, r.db, query, tenantID, contractID)
}

// --- Attachments ------------------------------------------------------------

func (r *ContractAttachmentRepository) Create(ctx context.Context, q Queryer, att *model.ContractAttachment) error {
	metaJSON, err := json.Marshal(orEmptyMap(att.Metadata))
	if err != nil {
		return fmt.Errorf("marshal contract attachment metadata: %w", err)
	}
	query := `
		INSERT INTO lex_contract_attachments (
			id, tenant_id, contract_id, slot, file_id, file_name, file_size_bytes,
			content_hash, version, superseded, notes, metadata, uploaded_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12::jsonb,$13
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		att.ID, att.TenantID, att.ContractID, att.Slot, att.FileID, att.FileName, att.FileSizeBytes,
		att.ContentHash, att.Version, att.Superseded, att.Notes, metaJSON, att.UploadedBy,
	).Scan(&att.CreatedAt, &att.UpdatedAt)
}

// MaxSlotVersion returns the highest version recorded for a contract/slot so a
// re-upload (CAP-115) can monotonically increment it. Returns 0 when none exist.
func (r *ContractAttachmentRepository) MaxSlotVersion(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID, slot model.ContractAttachmentSlot) (int, error) {
	var version int
	err := q.QueryRow(ctx, `
		SELECT COALESCE(MAX(version), 0)
		FROM lex_contract_attachments
		WHERE tenant_id = $1 AND contract_id = $2 AND slot = $3 AND deleted_at IS NULL`,
		tenantID, contractID, slot,
	).Scan(&version)
	if err != nil {
		return 0, err
	}
	return version, nil
}

// SupersedeSlot marks all live attachments for a contract/slot superseded so the
// newly uploaded one becomes the active document for that slot (CAP-115).
func (r *ContractAttachmentRepository) SupersedeSlot(ctx context.Context, q Queryer, tenantID, contractID uuid.UUID, slot model.ContractAttachmentSlot) error {
	_, err := q.Exec(ctx, `
		UPDATE lex_contract_attachments
		SET superseded = true, updated_at = now()
		WHERE tenant_id = $1 AND contract_id = $2 AND slot = $3
		  AND superseded = false AND deleted_at IS NULL`,
		tenantID, contractID, slot,
	)
	return err
}

func (r *ContractAttachmentRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.ContractAttachment, error) {
	query := contractAttachmentJSONSelect(`a.tenant_id = $1 AND a.id = $2 AND a.deleted_at IS NULL`)
	return queryRowJSON[model.ContractAttachment](ctx, r.db, query, tenantID, id)
}

func (r *ContractAttachmentRepository) ListByContract(ctx context.Context, tenantID, contractID uuid.UUID, includeSuperseded bool) ([]model.ContractAttachment, error) {
	where := `a.tenant_id = $1 AND a.contract_id = $2 AND a.deleted_at IS NULL`
	if !includeSuperseded {
		where += ` AND a.superseded = false`
	}
	query := contractAttachmentJSONSelect(where) + ` ORDER BY t.slot ASC, t.version DESC`
	return queryListJSON[model.ContractAttachment](ctx, r.db, query, tenantID, contractID)
}

// LiveSlots returns the active (non-superseded) attachment per slot for a
// contract, keyed by slot, used by the completeness check (CAP-103).
func (r *ContractAttachmentRepository) LiveSlots(ctx context.Context, tenantID, contractID uuid.UUID) (map[model.ContractAttachmentSlot]model.ContractAttachment, error) {
	rows, err := r.ListByContract(ctx, tenantID, contractID, false)
	if err != nil {
		return nil, err
	}
	out := make(map[model.ContractAttachmentSlot]model.ContractAttachment, len(rows))
	for _, row := range rows {
		// ListByContract orders version DESC within slot, so the first row per
		// slot is the newest live attachment.
		if _, ok := out[row.Slot]; !ok {
			out[row.Slot] = row
		}
	}
	return out, nil
}

func (r *ContractAttachmentRepository) SoftDelete(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	ct, err := q.Exec(ctx, `
		UPDATE lex_contract_attachments
		SET deleted_at = now(), updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func contractAttachmentJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.contract_id, a.slot, a.file_id, a.file_name,
			       a.file_size_bytes, a.content_hash, a.version, a.superseded, a.notes,
			       COALESCE(a.metadata, '{}'::jsonb) AS metadata,
			       a.uploaded_by, a.created_at, a.updated_at, a.deleted_at
			FROM lex_contract_attachments a
			WHERE ` + where + `
		) t`
}
