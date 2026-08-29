package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// LegalPleadingRepository persists plaintiff pleadings bound to a litigation case
// (CAP-052..055) plus their attachments and immutable draft version history.
// Mirrors matter_repo / legal_case_repo: tenant_id is the primary predicate with
// table RLS as backstop; reads project through row_to_json so map/jsonb fields
// round-trip; transactional writes accept a Queryer.
type LegalPleadingRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalPleadingRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalPleadingRepository {
	return &LegalPleadingRepository{db: db, logger: logger}
}

func (r *LegalPleadingRepository) Create(ctx context.Context, q Queryer, p *model.LegalPleading) error {
	metaJSON, err := json.Marshal(orEmptyMap(p.Metadata))
	if err != nil {
		return fmt.Errorf("marshal pleading metadata: %w", err)
	}
	query := `
		INSERT INTO legal_pleadings (
			id, tenant_id, case_id, pleading_number, type, direction, title, body,
			recipient, court_reference, response_deadline, response_owner_id, status,
			ai_generated, current_version, workflow_instance_id, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,
			$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		p.ID, p.TenantID, p.CaseID, p.PleadingNumber, p.Type, p.Direction, p.Title, p.Body,
		p.Recipient, p.CourtReference, lexDatePtr(p.ResponseDeadline), p.ResponseOwnerID,
		p.Status, p.AIGenerated, p.CurrentVersion, p.WorkflowInstanceID, metaJSON, p.CreatedBy,
	).Scan(&p.CreatedAt, &p.UpdatedAt)
}

func (r *LegalPleadingRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalPleading, error) {
	query := pleadingJSONSelect(`p.tenant_id = $1 AND p.case_id = $2 AND p.id = $3 AND p.deleted_at IS NULL`)
	return queryRowJSON[model.LegalPleading](ctx, r.db, query, tenantID, caseID, id)
}

func (r *LegalPleadingRepository) List(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalPleadingListFilters) ([]model.LegalPleading, int, error) {
	args := []any{tenantID, caseID}
	arg := 3
	conditions := []string{"p.tenant_id = $1", "p.case_id = $2", "p.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(p.title ILIKE '%%' || $%d || '%%' OR p.body ILIKE '%%' || $%d || '%%' OR p.pleading_number ILIKE '%%' || $%d || '%%')", arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("p.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.Type != nil {
		conditions = append(conditions, fmt.Sprintf("p.type = $%d", arg))
		args = append(args, *filters.Type)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_pleadings p WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalPleading{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := pleadingSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := pleadingJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalPleading](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// UpdateDraft updates the body/title of a pleading and bumps current_version inside
// a transaction; the caller appends the matching version snapshot.
func (r *LegalPleadingRepository) UpdateDraft(ctx context.Context, q Queryer, p *model.LegalPleading) error {
	metaJSON, err := json.Marshal(orEmptyMap(p.Metadata))
	if err != nil {
		return fmt.Errorf("marshal pleading metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_pleadings
		SET type = $4,
		    direction = $5,
		    title = $6,
		    body = $7,
		    recipient = $8,
		    court_reference = $9,
		    response_deadline = $10,
		    response_owner_id = $11,
		    ai_generated = $12,
		    current_version = $13,
		    metadata = $14::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		p.TenantID, p.CaseID, p.ID, p.Type, p.Direction, p.Title, p.Body,
		p.Recipient, p.CourtReference, lexDatePtr(p.ResponseDeadline), p.ResponseOwnerID,
		p.AIGenerated, p.CurrentVersion, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// LockStatus loads + row-locks the pleading (FOR UPDATE) and returns its FSM status.
// Used by the pleading approval orchestrator subject hook.
func (r *LegalPleadingRepository) LockStatus(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (string, error) {
	var status string
	err := tx.QueryRow(ctx, `
		SELECT status
		FROM legal_pleadings
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&status)
	return status, err
}

// UpdateStatusTx advances the pleading FSM inside a transaction, optionally linking a
// workflow instance + recording approval metadata.
func (r *LegalPleadingRepository) UpdateStatusTx(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.PleadingStatus, workflowInstanceID, approvedBy *uuid.UUID, approvedAt *time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_pleadings
		SET status = $3,
		    workflow_instance_id = COALESCE($4, workflow_instance_id),
		    approved_by = COALESCE($5, approved_by),
		    approved_at = COALESCE($6, approved_at),
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, status, workflowInstanceID, approvedBy, approvedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// MarkFiled records an approved pleading as filed with the court.
func (r *LegalPleadingRepository) MarkFiled(ctx context.Context, q Queryer, tenantID, id uuid.UUID, filedAt time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_pleadings
		SET status = 'filed', filed_at = $3, updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, id, filedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalPleadingRepository) SoftDelete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_pleadings SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, caseID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- governance audit + duration facts (WS2/WS3/WS4, C-2) --------------------

// AppendAudit writes one append-only litigation governance audit row for a pleading
// transition inside the caller's transaction (immutable: insert-only table).
func (r *LegalPleadingRepository) AppendAudit(ctx context.Context, q Queryer, e *LitigationAuditEntry) error {
	return appendLitigationAudit(ctx, q, "legal_pleading", e)
}

// ListAudit returns the append-only governance audit trail for one pleading.
func (r *LegalPleadingRepository) ListAudit(ctx context.Context, tenantID, id uuid.UUID) ([]LitigationAuditEntry, error) {
	return listLitigationAudit(ctx, r.db, tenantID, "legal_pleading", id)
}

// UpsertDurationFact idempotently records a pleading processing-time fact (C-2)
// inside the caller's transaction, keyed by (tenant_id, kind, subject_id).
func (r *LegalPleadingRepository) UpsertDurationFact(ctx context.Context, q Queryer, f *LitigationDurationFact) error {
	return upsertLitigationDurationFact(ctx, q, f)
}

// --- attachments ------------------------------------------------------------

func (r *LegalPleadingRepository) AddAttachment(ctx context.Context, q Queryer, a *model.LegalPleadingAttachment) error {
	query := `
		INSERT INTO legal_pleading_attachments (
			id, tenant_id, pleading_id, file_id, file_name, caption, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		a.ID, a.TenantID, a.PleadingID, a.FileID, a.FileName, a.Caption, a.CreatedBy,
	).Scan(&a.CreatedAt)
}

func (r *LegalPleadingRepository) ListAttachments(ctx context.Context, tenantID, pleadingID uuid.UUID) ([]model.LegalPleadingAttachment, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.pleading_id, a.file_id, a.file_name, a.caption, a.created_by, a.created_at
			FROM legal_pleading_attachments a
			WHERE a.tenant_id = $1 AND a.pleading_id = $2
			ORDER BY a.created_at ASC
		) t`
	return queryListJSON[model.LegalPleadingAttachment](ctx, r.db, query, tenantID, pleadingID)
}

// --- versions ---------------------------------------------------------------

// AppendVersion appends an immutable draft snapshot (CAP-054). The version number is
// computed as max(version)+1 for the pleading so callers need not race it.
func (r *LegalPleadingRepository) AppendVersion(ctx context.Context, q Queryer, v *model.LegalPleadingVersion) error {
	query := `
		INSERT INTO legal_pleading_versions (
			id, tenant_id, pleading_id, version, title, body, ai_generated, change_reason, created_by
		) VALUES (
			$1, $2, $3,
			COALESCE((SELECT MAX(version) FROM legal_pleading_versions WHERE pleading_id = $3), 0) + 1,
			$4, $5, $6, $7, $8
		)
		RETURNING version, created_at`
	return q.QueryRow(ctx, query,
		v.ID, v.TenantID, v.PleadingID, v.Title, v.Body, v.AIGenerated, v.ChangeReason, v.CreatedBy,
	).Scan(&v.Version, &v.CreatedAt)
}

func (r *LegalPleadingRepository) ListVersions(ctx context.Context, tenantID, pleadingID uuid.UUID) ([]model.LegalPleadingVersion, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT v.id, v.tenant_id, v.pleading_id, v.version, v.title, v.body,
			       v.ai_generated, v.change_reason, v.created_by, v.created_at
			FROM legal_pleading_versions v
			WHERE v.tenant_id = $1 AND v.pleading_id = $2
			ORDER BY v.version DESC
		) t`
	return queryListJSON[model.LegalPleadingVersion](ctx, r.db, query, tenantID, pleadingID)
}

func pleadingJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT p.id, p.tenant_id, p.case_id, p.pleading_number, p.type, p.direction,
			       p.title, p.body, p.recipient, p.court_reference,
			       p.response_deadline, p.response_owner_id,
			       p.status, p.ai_generated, p.current_version, p.workflow_instance_id,
			       p.approved_by, p.approved_at, p.filed_at,
			       COALESCE(p.metadata, '{}'::jsonb) AS metadata,
			       p.created_by, p.created_at, p.updated_at, p.deleted_at
			FROM legal_pleadings p
			WHERE ` + where + `
		) t`
}

func pleadingSortColumn(column string) (string, bool) {
	switch column {
	case "p.pleading_number":
		return "t.pleading_number", true
	case "p.status":
		return "t.status", true
	case "p.type":
		return "t.type", true
	case "p.updated_at":
		return "t.updated_at", true
	case "p.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
