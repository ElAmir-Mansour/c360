package repository

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/model"
)

type ManagerTaskRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewManagerTaskRepository(db *pgxpool.Pool, logger zerolog.Logger) *ManagerTaskRepository {
	return &ManagerTaskRepository{db: db, logger: logger.With().Str("repository", "lex-manager-tasks").Logger()}
}

func (r *ManagerTaskRepository) Create(ctx context.Context, q Queryer, task *model.ManagerTask) error {
	var fileID, name, contentType, checksum, scan any
	var size, version, uploadedBy any
	if task.Attachment != nil {
		fileID, name, contentType = task.Attachment.FileID, task.Attachment.OriginalName, task.Attachment.ContentType
		size, checksum, version = task.Attachment.SizeBytes, task.Attachment.ChecksumSHA256, task.Attachment.FileVersion
		scan, uploadedBy = task.Attachment.VirusScanStatus, task.Attachment.UploadedBy
	}
	return q.QueryRow(ctx, `
		INSERT INTO legal_manager_tasks (
			id, tenant_id, title, description, assignee_id, status,
			attachment_file_id, attachment_name, attachment_content_type, attachment_size_bytes,
			attachment_checksum_sha256, attachment_file_version, attachment_virus_scan_status,
			attachment_uploaded_by, created_by
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING created_at, updated_at`,
		task.ID, task.TenantID, task.Title, task.Description, task.AssigneeID, task.Status,
		fileID, name, contentType, size, checksum, version, scan, uploadedBy, task.CreatedBy,
	).Scan(&task.CreatedAt, &task.UpdatedAt)
}

func (r *ManagerTaskRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.ManagerTask, error) {
	var task *model.ManagerTask
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		task, err = managerTaskGet(ctx, tx, tenantID, id)
		return err
	})
	return task, err
}

func managerTaskGet(ctx context.Context, q Queryer, tenantID, id uuid.UUID) (*model.ManagerTask, error) {
	return queryRowJSON[model.ManagerTask](ctx, q, managerTaskJSONSelect(`mt.tenant_id = $1 AND mt.id = $2 AND mt.deleted_at IS NULL`), tenantID, id)
}

func (r *ManagerTaskRepository) Lock(ctx context.Context, tx pgx.Tx, tenantID, id uuid.UUID) (*model.ManagerTask, error) {
	var locked uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM legal_manager_tasks WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE`, tenantID, id).Scan(&locked); err != nil {
		return nil, err
	}
	return managerTaskGet(ctx, tx, tenantID, id)
}

func (r *ManagerTaskRepository) Update(ctx context.Context, q Queryer, task *model.ManagerTask) error {
	return q.QueryRow(ctx, `
		UPDATE legal_manager_tasks
		SET status=$3, result=$4, correction_note=$5, submitted_at=$6,
		    reviewed_by=$7, reviewed_at=$8, updated_at=now()
		WHERE tenant_id=$1 AND id=$2 AND deleted_at IS NULL
		RETURNING updated_at`,
		task.TenantID, task.ID, task.Status, task.Result, task.CorrectionNote, task.SubmittedAt,
		task.ReviewedBy, task.ReviewedAt,
	).Scan(&task.UpdatedAt)
}

func (r *ManagerTaskRepository) AppendAudit(ctx context.Context, q Queryer, tenantID, taskID, actorID uuid.UUID, action string, from, to *model.ManagerTaskStatus, note string) error {
	_, err := q.Exec(ctx, `
		INSERT INTO legal_manager_task_audit
			(id, tenant_id, task_id, action, from_status, to_status, note, actor_user_id)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
		uuid.New(), tenantID, taskID, action, from, to, note, actorID,
	)
	return err
}

func (r *ManagerTaskRepository) List(ctx context.Context, tenantID, actorID uuid.UUID, all bool, filters model.ManagerTaskListFilters) ([]model.ManagerTask, int, error) {
	var items []model.ManagerTask
	var total int
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		items, total, err = managerTaskListWith(ctx, tx, tenantID, actorID, all, filters)
		return err
	})
	return items, total, err
}

func managerTaskListWith(ctx context.Context, q Queryer, tenantID, actorID uuid.UUID, all bool, filters model.ManagerTaskListFilters) ([]model.ManagerTask, int, error) {
	conditions := []string{"mt.tenant_id = $1", "mt.deleted_at IS NULL"}
	args := []any{tenantID}
	arg := 2
	if !all {
		conditions = append(conditions, fmt.Sprintf("(mt.assignee_id = $%d OR mt.created_by = $%d)", arg, arg))
		args = append(args, actorID)
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("mt.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.AssigneeID != nil {
		conditions = append(conditions, fmt.Sprintf("mt.assignee_id = $%d", arg))
		args = append(args, *filters.AssigneeID)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := q.QueryRow(ctx, "SELECT COUNT(*) FROM legal_manager_tasks mt WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.ManagerTask{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	args = append(args, perPage, (page-1)*perPage)
	query := managerTaskJSONSelect(where) + fmt.Sprintf(" ORDER BY t.updated_at DESC, t.id ASC LIMIT $%d OFFSET $%d", arg, arg+1)
	items, err := queryListJSON[model.ManagerTask](ctx, q, query, args...)
	return items, total, err
}

func managerTaskJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT mt.id, mt.tenant_id, mt.title, mt.description, mt.assignee_id, mt.status,
			       CASE WHEN mt.attachment_file_id IS NULL THEN NULL ELSE jsonb_build_object(
			         'file_id', mt.attachment_file_id, 'original_name', mt.attachment_name,
			         'content_type', mt.attachment_content_type, 'size_bytes', mt.attachment_size_bytes,
			         'checksum_sha256', mt.attachment_checksum_sha256, 'file_version', mt.attachment_file_version,
			         'virus_scan_status', mt.attachment_virus_scan_status, 'uploaded_by', mt.attachment_uploaded_by
			       ) END AS attachment,
			       mt.result, mt.correction_note, mt.created_by, mt.submitted_at,
			       mt.reviewed_by, mt.reviewed_at, mt.created_at, mt.updated_at, mt.deleted_at
			FROM legal_manager_tasks mt
			WHERE ` + where + `
		) t`
}
