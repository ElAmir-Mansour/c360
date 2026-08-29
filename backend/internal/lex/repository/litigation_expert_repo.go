package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// LegalExpertRepository persists court-expert assignments (ندب خبير, CAP-060..062)
// and their furnished documents, AND the hearing reports / minutes (ضبط الجلسة,
// CAP-056..059) that hang off the BASE legal_case_hearings table. Both are
// case-child resources sharing the same tenant-leading + soft-delete + RLS
// conventions, so they live in one repository file.
type LegalExpertRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewLegalExpertRepository(db *pgxpool.Pool, logger zerolog.Logger) *LegalExpertRepository {
	return &LegalExpertRepository{db: db, logger: logger}
}

// =============================================================================
// Expert assignments (CAP-060..062)
// =============================================================================

func (r *LegalExpertRepository) Create(ctx context.Context, q Queryer, a *model.LegalExpertAssignment) error {
	metaJSON, err := json.Marshal(orEmptyMap(a.Metadata))
	if err != nil {
		return fmt.Errorf("marshal expert assignment metadata: %w", err)
	}
	query := `
		INSERT INTO legal_expert_assignments (
			id, tenant_id, case_id, expert_name, specialization, contact_info, mandate,
			status, appointed_at, report_due_date, report_received_at, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,
			$8,$9,$10,$11,$12::jsonb,$13
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		a.ID, a.TenantID, a.CaseID, a.ExpertName, a.Specialization, a.ContactInfo, a.Mandate,
		a.Status, lexDatePtr(a.AppointedAt), lexDatePtr(a.ReportDueDate), lexDatePtr(a.ReportReceivedAt), metaJSON, a.CreatedBy,
	).Scan(&a.CreatedAt, &a.UpdatedAt)
}

func (r *LegalExpertRepository) Get(ctx context.Context, tenantID, caseID, id uuid.UUID) (*model.LegalExpertAssignment, error) {
	query := expertAssignmentJSONSelect(`e.tenant_id = $1 AND e.case_id = $2 AND e.id = $3 AND e.deleted_at IS NULL`)
	return queryRowJSON[model.LegalExpertAssignment](ctx, r.db, query, tenantID, caseID, id)
}

func (r *LegalExpertRepository) List(ctx context.Context, tenantID, caseID uuid.UUID, filters model.LegalExpertAssignmentListFilters) ([]model.LegalExpertAssignment, int, error) {
	args := []any{tenantID, caseID}
	arg := 3
	conditions := []string{"e.tenant_id = $1", "e.case_id = $2", "e.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(e.expert_name ILIKE '%%' || $%d || '%%' OR e.specialization ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("e.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_expert_assignments e WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.LegalExpertAssignment{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := expertAssignmentSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := expertAssignmentJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.LegalExpertAssignment](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *LegalExpertRepository) Update(ctx context.Context, q Queryer, a *model.LegalExpertAssignment) error {
	metaJSON, err := json.Marshal(orEmptyMap(a.Metadata))
	if err != nil {
		return fmt.Errorf("marshal expert assignment metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_expert_assignments
		SET expert_name = $4,
		    specialization = $5,
		    contact_info = $6,
		    mandate = $7,
		    status = $8,
		    appointed_at = $9,
		    report_due_date = $10,
		    report_received_at = $11,
		    metadata = $12::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`,
		a.TenantID, a.CaseID, a.ID, a.ExpertName, a.Specialization, a.ContactInfo, a.Mandate,
		a.Status, lexDatePtr(a.AppointedAt), lexDatePtr(a.ReportDueDate), lexDatePtr(a.ReportReceivedAt), metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalExpertRepository) SoftDelete(ctx context.Context, tenantID, caseID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_expert_assignments SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, caseID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalExpertRepository) AddDocument(ctx context.Context, q Queryer, d *model.LegalExpertDocument) error {
	query := `
		INSERT INTO legal_expert_documents (
			id, tenant_id, assignment_id, file_id, file_name, caption, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7)
		RETURNING created_at`
	return q.QueryRow(ctx, query,
		d.ID, d.TenantID, d.AssignmentID, d.FileID, d.FileName, d.Caption, d.CreatedBy,
	).Scan(&d.CreatedAt)
}

func (r *LegalExpertRepository) ListDocuments(ctx context.Context, tenantID, assignmentID uuid.UUID) ([]model.LegalExpertDocument, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT d.id, d.tenant_id, d.assignment_id, d.file_id, d.file_name, d.caption, d.created_by, d.created_at
			FROM legal_expert_documents d
			WHERE d.tenant_id = $1 AND d.assignment_id = $2
			ORDER BY d.created_at ASC
		) t`
	return queryListJSON[model.LegalExpertDocument](ctx, r.db, query, tenantID, assignmentID)
}

// =============================================================================
// Hearing reports / minutes (ضبط الجلسة, CAP-056..059)
// =============================================================================

// HearingExists confirms a hearing belongs to the case + tenant (the report FKs
// legal_case_hearings; we validate the case scope before insert).
func (r *LegalExpertRepository) HearingExists(ctx context.Context, tenantID, caseID, hearingID uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM legal_case_hearings
			WHERE tenant_id = $1 AND case_id = $2 AND id = $3 AND deleted_at IS NULL
		)`,
		tenantID, caseID, hearingID,
	).Scan(&exists)
	return exists, err
}

func (r *LegalExpertRepository) CreateHearingReport(ctx context.Context, q Queryer, hr *model.LegalHearingReport) error {
	metaJSON, err := json.Marshal(orEmptyMap(hr.Metadata))
	if err != nil {
		return fmt.Errorf("marshal hearing report metadata: %w", err)
	}
	query := `
		INSERT INTO legal_hearing_reports (
			id, tenant_id, case_id, hearing_id, type, title, body, decision,
			recorded_at, file_id, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,
			$9,$10,$11::jsonb,$12
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		hr.ID, hr.TenantID, hr.CaseID, hr.HearingID, hr.Type, hr.Title, hr.Body, hr.Decision,
		hr.RecordedAt, hr.FileID, metaJSON, hr.CreatedBy,
	).Scan(&hr.CreatedAt, &hr.UpdatedAt)
}

func (r *LegalExpertRepository) GetHearingReport(ctx context.Context, tenantID, hearingID, id uuid.UUID) (*model.LegalHearingReport, error) {
	query := hearingReportJSONSelect(`hr.tenant_id = $1 AND hr.hearing_id = $2 AND hr.id = $3 AND hr.deleted_at IS NULL`)
	return queryRowJSON[model.LegalHearingReport](ctx, r.db, query, tenantID, hearingID, id)
}

func (r *LegalExpertRepository) ListHearingReports(ctx context.Context, tenantID, hearingID uuid.UUID) ([]model.LegalHearingReport, error) {
	query := hearingReportJSONSelect(`hr.tenant_id = $1 AND hr.hearing_id = $2 AND hr.deleted_at IS NULL`) + " ORDER BY t.recorded_at DESC"
	return queryListJSON[model.LegalHearingReport](ctx, r.db, query, tenantID, hearingID)
}

func (r *LegalExpertRepository) UpdateHearingReport(ctx context.Context, q Queryer, hr *model.LegalHearingReport) error {
	metaJSON, err := json.Marshal(orEmptyMap(hr.Metadata))
	if err != nil {
		return fmt.Errorf("marshal hearing report metadata: %w", err)
	}
	ct, err := q.Exec(ctx, `
		UPDATE legal_hearing_reports
		SET type = $4, title = $5, body = $6, decision = $7, file_id = $8, metadata = $9::jsonb, updated_at = now()
		WHERE tenant_id = $1 AND hearing_id = $2 AND id = $3 AND deleted_at IS NULL`,
		hr.TenantID, hr.HearingID, hr.ID, hr.Type, hr.Title, hr.Body, hr.Decision, hr.FileID, metaJSON,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *LegalExpertRepository) DeleteHearingReport(ctx context.Context, tenantID, hearingID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_hearing_reports SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND hearing_id = $2 AND id = $3 AND deleted_at IS NULL`, tenantID, hearingID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func expertAssignmentJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT e.id, e.tenant_id, e.case_id, e.expert_name, e.specialization, e.contact_info,
			       e.mandate, e.status,
			       e.appointed_at::timestamptz AS appointed_at,
			       e.report_due_date::timestamptz AS report_due_date,
			       e.report_received_at::timestamptz AS report_received_at,
			       COALESCE(e.metadata, '{}'::jsonb) AS metadata,
			       e.created_by, e.created_at, e.updated_at, e.deleted_at
			FROM legal_expert_assignments e
			WHERE ` + where + `
		) t`
}

func expertAssignmentSortColumn(column string) (string, bool) {
	switch column {
	case "e.expert_name":
		return "t.expert_name", true
	case "e.status":
		return "t.status", true
	case "e.report_due_date":
		return "t.report_due_date", true
	case "e.updated_at":
		return "t.updated_at", true
	case "e.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}

func hearingReportJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT hr.id, hr.tenant_id, hr.case_id, hr.hearing_id, hr.type, hr.title, hr.body,
			       hr.decision, hr.recorded_at, hr.file_id,
			       COALESCE(hr.metadata, '{}'::jsonb) AS metadata,
			       hr.created_by, hr.created_at, hr.updated_at, hr.deleted_at
			FROM legal_hearing_reports hr
			WHERE ` + where + `
		) t`
}
