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

// LegalDefendantRepository persists incoming-lawsuit (defendant-side) registrations
// (CAP-067..073) and their served-document attachments. case_id FKs legal_cases
// (the company_status='defendant' case). Mirrors the sibling litigation repos:
// tenant_id primary predicate + RLS backstop, soft-delete, transactional writes via
// Queryer, row_to_json projection.
type LegalDefendantRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalDefendantRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalDefendantRepository {
	return &LegalDefendantRepository{db: db, logger: logger}
}

func (r *LegalDefendantRepository) Create(ctx context.Context, q Queryer, d *model.LegalDefendantCase) error {
	metaJSON, err := json.Marshal(orEmptyMap(d.Metadata))
	if err != nil {
		return fmt.Errorf("marshal defendant case metadata: %w", err)
	}
	query := `
		INSERT INTO legal_defendant_cases (
			id, tenant_id, case_id, plaintiff_name, court_name, notification_date,
			company_representative, najiz_status, najiz_reference,
			concerned_department, dept_notified_at, response_memo, response_memo_ai,
			status, workflow_instance_id, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,
			$10,$11,$12,$13,
			$14,$15,$16::jsonb,$17
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		d.ID, d.TenantID, d.CaseID, d.PlaintiffName, d.CourtName, lexDatePtr(d.NotificationDate),
		d.CompanyRepresentative, d.NajizStatus, d.NajizReference,
		d.ConcernedDepartment, d.DeptNotifiedAt, d.ResponseMemo, d.ResponseMemoAI,
		d.Status, d.WorkflowInstanceID, metaJSON, d.CreatedBy,
	).Scan(&d.CreatedAt, &d.UpdatedAt)
}

func (r *LegalDefendantRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalDefendantCase, error) {
	query := defendantCaseJSONSelect(`d.tenant_id = $1 AND d.case_id = $2 AND d.id = $3 AND d.deleted_at IS NULL`)
	return queryRowJSON[model.LegalDefendantCase](ctx, r.db, query, tenantID, caseID, id)
}

// GetByID loads a defendant case by id alone (tenant-scoped), for approval flows
// where the case_id is not in the path.
func (r *LegalDefendantRepository) GetByID(ctx context.Context, tenantID, id uuid.UUID) (*model.LegalDefendantCase, error) {
	query := defendantCaseJSONSelect(`d.tenant_id = $1 AND d.id = $2 AND d.deleted_at IS NULL`)
	return queryRowJSON[model.LegalDefendantCase](ctx, r.db, query, tenantID, id)
}

func (r *LegalDefendantRepository) List(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalDefendantCaseListFilters) ([]model.LegalDefendantCase, int, error) {
	args := []any{tenantID, caseID}
	arg := 3
	conditions := []string{"d.tenant_id = $1", "d.case_id = $2", "d.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(d.plaintiff_name ILIKE '%%' || $%d || '%%' OR d.company_representative ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("d.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_defendant_cases d WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalDefendantCase{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := defendantCaseSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := defendantCaseJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalDefendantCase](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *LegalDefendantRepository) Update(ctx context.Context, q Queryer, d *model.LegalDefendantCase) error {
	metaJSON, err := json.Marshal(orEmptyMap(d.Metadata))
	if err != nil {
		return fmt.Errorf("marshal defendant case metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_defendant_cases
		SET plaintiff_name = $4,
		    court_name = $5,
		    notification_date = $6,
		    company_representative = $7,
		    najiz_status = $8,
		    najiz_reference = $9,
		    concerned_department = $10,
		    dept_notified_at = $11,
		    response_memo = $12,
		    response_memo_ai = $13,
		    status = $14,
		    metadata = $15::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		d.TenantID, d.CaseID, d.ID, d.PlaintiffName, d.CourtName, lexDatePtr(d.NotificationDate),
		d.CompanyRepresentative, d.NajizStatus, d.NajizReference,
		d.ConcernedDepartment, d.DeptNotifiedAt, d.ResponseMemo, d.ResponseMemoAI,
		d.Status, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// LockStatus loads + row-locks the defendant case (FOR UPDATE) and returns its FSM
// status. Used by the response-memo approval orchestrator subject hook.
func (r *LegalDefendantRepository) LockStatus(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (string, error) {
	var status string
	err := tx.QueryRow(ctx, `
		SELECT status
		FROM legal_defendant_cases
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		FOR UPDATE`,
		tenantID, id,
	).Scan(&status)
	return status, err
}

// UpdateStatusTx advances the defendant-case FSM inside a transaction, optionally
// linking a workflow instance + recording approval metadata.
func (r *LegalDefendantRepository) UpdateStatusTx(ctx context.Context, q Queryer, tenantID, id uuid.UUID, status model.DefendantCaseStatus, workflowInstanceID, approvedBy *uuid.UUID, approvedAt *time.Time, clearWorkflow bool) error {
	var (
		ct  int64
		err error
	)
	if clearWorkflow {
		tag, e := q.Exec(ctx, `
			UPDATE legal_defendant_cases
			SET status = $3, workflow_instance_id = NULL,
			    response_approved_by = COALESCE($4, response_approved_by),
			    response_approved_at = COALESCE($5, response_approved_at),
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
			tenantID, id, status, approvedBy, approvedAt,
		)
		ct, err = tag.RowsAffected(), e
	} else {
		tag, e := q.Exec(ctx, `
			UPDATE legal_defendant_cases
			SET status = $3,
			    workflow_instance_id = COALESCE($4, workflow_instance_id),
			    response_approved_by = COALESCE($5, response_approved_by),
			    response_approved_at = COALESCE($6, response_approved_at),
			    updated_at = now()
			WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
			tenantID, id, status, workflowInstanceID, approvedBy, approvedAt,
		)
		ct, err = tag.RowsAffected(), e
	}
	if err != nil {
		return err
	}
	if ct == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalDefendantRepository) SoftDelete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_defendant_cases SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, caseID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// --- governance audit + duration facts (WS2/WS3/WS4, C-2) --------------------

// AppendAudit writes one append-only litigation governance audit row for a defendant
// case transition inside the caller's transaction (immutable: insert-only table).
func (r *LegalDefendantRepository) AppendAudit(ctx context.Context, q Queryer, e *LitigationAuditEntry) error {
	return appendLitigationAudit(ctx, q, "legal_defendant_case", e)
}

// ListAudit returns the append-only governance audit trail for one defendant case.
func (r *LegalDefendantRepository) ListAudit(ctx context.Context, tenantID, id uuid.UUID) ([]LitigationAuditEntry, error) {
	return listLitigationAudit(ctx, r.db, tenantID, "legal_defendant_case", id)
}

// UpsertDurationFact idempotently records a defendant first-response processing-time
// fact (C-2) inside the caller's transaction, keyed by (tenant_id, kind, subject_id).
func (r *LegalDefendantRepository) UpsertDurationFact(ctx context.Context, q Queryer, f *LitigationDurationFact) error {
	return upsertLitigationDurationFact(ctx, q, f)
}

func (r *LegalDefendantRepository) AddAttachment(ctx context.Context, q Queryer, a *model.LegalDefendantAttachment) error {
	query := `
		INSERT INTO legal_defendant_attachments (
			id, tenant_id, defendant_case_id, file_id, file_name, caption, kind, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		a.ID, a.TenantID, a.DefendantCaseID, a.FileID, a.FileName, a.Caption, a.Kind, a.CreatedBy,
	).Scan(&a.CreatedAt)
}

func (r *LegalDefendantRepository) ListAttachments(ctx context.Context, tenantID, defendantCaseID uuid.UUID) ([]model.LegalDefendantAttachment, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT a.id, a.tenant_id, a.defendant_case_id, a.file_id, a.file_name, a.caption, a.kind, a.created_by, a.created_at
			FROM legal_defendant_attachments a
			WHERE a.tenant_id = $1 AND a.defendant_case_id = $2
			ORDER BY a.created_at ASC
		) t`
	return queryListJSON[model.LegalDefendantAttachment](ctx, r.db, query, tenantID, defendantCaseID)
}

func defendantCaseJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT d.id, d.tenant_id, d.case_id, d.plaintiff_name, d.court_name,
			       d.notification_date::timestamptz AS notification_date,
			       d.company_representative, d.najiz_status, d.najiz_reference,
			       d.concerned_department, d.dept_notified_at, d.response_memo, d.response_memo_ai,
			       d.status, d.workflow_instance_id, d.response_approved_by, d.response_approved_at,
			       COALESCE(d.metadata, '{}'::jsonb) AS metadata,
			       d.created_by, d.created_at, d.updated_at, d.deleted_at
			FROM legal_defendant_cases d
			WHERE ` + where + `
		) t`
}

func defendantCaseSortColumn(column string) (string, bool) {
	switch column {
	case "d.plaintiff_name":
		return "t.plaintiff_name", true
	case "d.status":
		return "t.status", true
	case "d.notification_date":
		return "t.notification_date", true
	case "d.updated_at":
		return "t.updated_at", true
	case "d.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
