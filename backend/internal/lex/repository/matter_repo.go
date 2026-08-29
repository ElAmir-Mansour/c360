package repository

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

type MatterRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewMatterRepository(db *pgxpool.Pool, logger zerolog.Logger) *MatterRepository {
	return &MatterRepository{db: db, logger: logger}
}

func (r *MatterRepository) Create(ctx context.Context, q Queryer, matter *model.Matter) error {
	query := `
		INSERT INTO legal_matters (
			id, tenant_id, matter_number, title, description, type, status, priority,
			owner_user_id, owner_name, requester_user_id, requester_name, department,
			opened_at, due_date, closed_at, tags, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,
			$9,$10,$11,$12,$13,
			$14,$15,$16,$17,$18,$19
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		matter.ID, matter.TenantID, matter.MatterNumber, matter.Title, matter.Description, matter.Type, matter.Status, matter.Priority,
		matter.OwnerUserID, matter.OwnerName, matter.RequesterUserID, matter.RequesterName, matter.Department,
		matter.OpenedAt, lexDatePtr(matter.DueDate), matter.ClosedAt, matter.Tags, matter.Metadata, matter.CreatedBy,
	).Scan(&matter.CreatedAt, &matter.UpdatedAt)
}

func (r *MatterRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Matter, error) {
	query := matterJSONSelect(`m.tenant_id = $1 AND m.id = $2 AND m.deleted_at IS NULL`)
	return queryRowJSON[model.Matter](ctx, r.db, query, tenantID, id)
}

func (r *MatterRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.MatterListFilters) ([]model.Matter, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"m.tenant_id = $1", "m.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(m.title ILIKE '%%' || $%d || '%%' OR m.description ILIKE '%%' || $%d || '%%' OR m.matter_number ILIKE '%%' || $%d || '%%')", arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("m.status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.Type != nil {
		conditions = append(conditions, fmt.Sprintf("m.type = $%d", arg))
		args = append(args, *filters.Type)
		arg++
	}
	if filters.Priority != nil {
		conditions = append(conditions, fmt.Sprintf("m.priority = $%d", arg))
		args = append(args, *filters.Priority)
		arg++
	}
	if filters.OwnerUserID != nil {
		conditions = append(conditions, fmt.Sprintf("m.owner_user_id = $%d", arg))
		args = append(args, *filters.OwnerUserID)
		arg++
	}
	if filters.ContractID != nil {
		conditions = append(conditions, fmt.Sprintf("EXISTS (SELECT 1 FROM legal_matter_contracts mc WHERE mc.matter_id = m.id AND mc.tenant_id = m.tenant_id AND mc.contract_id = $%d)", arg))
		args = append(args, *filters.ContractID)
		arg++
	}
	if filters.Department != "" {
		conditions = append(conditions, fmt.Sprintf("m.department = $%d", arg))
		args = append(args, filters.Department)
		arg++
	}
	if filters.DueBefore != nil {
		conditions = append(conditions, fmt.Sprintf("m.due_date <= $%d", arg))
		args = append(args, lexDatePtr(filters.DueBefore))
		arg++
	}
	if filters.DueAfter != nil {
		conditions = append(conditions, fmt.Sprintf("m.due_date >= $%d", arg))
		args = append(args, lexDatePtr(filters.DueAfter))
		arg++
	}
	if filters.Tag != "" {
		conditions = append(conditions, fmt.Sprintf("$%d = ANY(m.tags)", arg))
		args = append(args, strings.ToLower(strings.TrimSpace(filters.Tag)))
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_matters m WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.Matter{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := matterSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := matterJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.Matter](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *MatterRepository) Update(ctx context.Context, q Queryer, matter *model.Matter) error {
	query := `
		UPDATE legal_matters
		SET matter_number = $3,
		    title = $4,
		    description = $5,
		    type = $6,
		    status = $7,
		    priority = $8,
		    owner_user_id = $9,
		    owner_name = $10,
		    requester_user_id = $11,
		    requester_name = $12,
		    department = $13,
		    due_date = $14,
		    closed_at = $15,
		    tags = $16,
		    metadata = $17,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		matter.TenantID, matter.ID, matter.MatterNumber, matter.Title, matter.Description,
		matter.Type, matter.Status, matter.Priority, matter.OwnerUserID, matter.OwnerName,
		matter.RequesterUserID, matter.RequesterName, matter.Department,
		lexDatePtr(matter.DueDate), matter.ClosedAt, matter.Tags, matter.Metadata,
	).Scan(&matter.UpdatedAt)
}

func (r *MatterRepository) UpdateStatus(ctx context.Context, q Queryer, tenantID, matterID uuid.UUID, status model.MatterStatus, closedAt *time.Time) error {
	ct, err := q.Exec(ctx, `
		UPDATE legal_matters
		SET status = $3,
		    closed_at = $4,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
		tenantID, matterID, status, closedAt,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *MatterRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_matters SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *MatterRepository) LinkContract(ctx context.Context, q Queryer, link *model.MatterContract) error {
	query := `
		INSERT INTO legal_matter_contracts (id, tenant_id, matter_id, contract_id, relationship, created_by)
		VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (matter_id, contract_id)
		DO UPDATE SET relationship = EXCLUDED.relationship
		RETURNING id, created_at`
	return q.QueryRow(ctx, query,
		link.ID, link.TenantID, link.MatterID, link.ContractID, link.Relationship, link.CreatedBy,
	).Scan(&link.ID, &link.CreatedAt)
}

func (r *MatterRepository) UnlinkContract(ctx context.Context, tenantID, matterID, contractID uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `DELETE FROM legal_matter_contracts WHERE tenant_id = $1 AND matter_id = $2 AND contract_id = $3`, tenantID, matterID, contractID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *MatterRepository) HasContractLink(ctx context.Context, tenantID, matterID, contractID uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM legal_matter_contracts
			WHERE tenant_id = $1 AND matter_id = $2 AND contract_id = $3
		)`,
		tenantID, matterID, contractID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

func (r *MatterRepository) ListContracts(ctx context.Context, tenantID, matterID uuid.UUID) ([]model.MatterContract, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT mc.id, mc.tenant_id, mc.matter_id, mc.contract_id, c.title AS contract_title,
			       mc.relationship, mc.created_by, mc.created_at
			FROM legal_matter_contracts mc
			LEFT JOIN contracts c ON c.id = mc.contract_id AND c.tenant_id = mc.tenant_id AND c.deleted_at IS NULL
			WHERE mc.tenant_id = $1 AND mc.matter_id = $2
			ORDER BY mc.created_at DESC
		) t`
	return queryListJSON[model.MatterContract](ctx, r.db, query, tenantID, matterID)
}

func matterJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT m.id, m.tenant_id, m.matter_number, m.title, m.description, m.type, m.status, m.priority,
			       m.owner_user_id, m.owner_name, m.requester_user_id, m.requester_name, m.department,
			       m.opened_at, m.due_date::timestamptz AS due_date, m.closed_at,
			       COALESCE(m.tags, '{}') AS tags, COALESCE(m.metadata, '{}'::jsonb) AS metadata,
			       m.created_by, m.created_at, m.updated_at, m.deleted_at
			FROM legal_matters m
			WHERE ` + where + `
		) t`
}

func matterSortColumn(column string) (string, bool) {
	switch column {
	case "m.title":
		return "t.title", true
	case "m.status":
		return "t.status", true
	case "m.type":
		return "t.type", true
	case "m.priority":
		return "t.priority", true
	case "m.due_date":
		return "t.due_date", true
	case "m.updated_at":
		return "t.updated_at", true
	case "m.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}

func normalizePage(page, perPage int) (int, int) {
	if page < 1 {
		page = 1
	}
	if perPage < 1 {
		perPage = 25
	}
	if perPage > 200 {
		perPage = 200
	}
	return page, perPage
}

func lexDatePtr(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}
	normalized := time.Date(value.UTC().Year(), value.UTC().Month(), value.UTC().Day(), 0, 0, 0, 0, time.UTC)
	return &normalized
}
