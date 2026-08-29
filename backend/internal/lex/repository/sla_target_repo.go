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

// SLATargetRepository owns CRUD/list for the admin-maintained per-(service_code,
// priority) SLA target catalogue (CAP-012).
type SLATargetRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSLATargetRepository(db *pgxpool.Pool, logger zerolog.Logger) *SLATargetRepository {
	return &SLATargetRepository{db: db, logger: logger}
}

func (r *SLATargetRepository) Create(ctx context.Context, q Queryer, target *model.SLATarget) error {
	// metadata is NOT NULL; mirror legal_requests/legal_cases by always writing a
	// non-null jsonb (defaulting a nil map to '{}') so callers may omit metadata.
	metaJSON, err := json.Marshal(orEmptyMap(target.Metadata))
	if err != nil {
		return fmt.Errorf("marshal sla target metadata: %w", err)
	}
	query := `
		INSERT INTO legal_sla_targets (
			id, tenant_id, service_code, priority,
			turnaround_working_days_from, turnaround_working_days,
			ack_window_value, ack_window_unit,
			escalation_l1_days, escalation_l2_days, escalation_l3_days,
			active, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,
			$5,$6,
			$7,$8,
			$9,$10,$11,
			$12,$13::jsonb,$14
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		target.ID, target.TenantID, target.ServiceCode, target.Priority,
		target.TurnaroundWorkingDaysFrom, target.TurnaroundWorkingDays,
		target.AckWindowValue, target.AckWindowUnit,
		target.EscalationL1Days, target.EscalationL2Days, target.EscalationL3Days,
		target.Active, metaJSON, target.CreatedBy,
	).Scan(&target.CreatedAt, &target.UpdatedAt)
}

func (r *SLATargetRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.SLATarget, error) {
	query := slaTargetJSONSelect(`s.tenant_id = $1 AND s.id = $2 AND s.deleted_at IS NULL`)
	return queryRowJSON[model.SLATarget](ctx, r.db, query, tenantID, id)
}

// Resolve returns the active SLA target for a (service_code, priority) pair. It is
// the lookup the clock materialiser uses when a request's completeness is
// confirmed.
func (r *SLATargetRepository) Resolve(ctx context.Context, tenantID uuid.UUID, serviceCode string, priority model.SLATargetPriority) (*model.SLATarget, error) {
	query := slaTargetJSONSelect(`s.tenant_id = $1 AND lower(s.service_code) = lower($2) AND s.priority = $3 AND s.active AND s.deleted_at IS NULL`)
	return queryRowJSON[model.SLATarget](ctx, r.db, query, tenantID, strings.TrimSpace(serviceCode), priority)
}

func (r *SLATargetRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.SLATargetListFilters) ([]model.SLATarget, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"s.tenant_id = $1", "s.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("s.service_code ILIKE '%%' || $%d || '%%'", arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.ServiceCode != "" {
		conditions = append(conditions, fmt.Sprintf("lower(s.service_code) = lower($%d)", arg))
		args = append(args, strings.TrimSpace(filters.ServiceCode))
		arg++
	}
	if filters.Priority != nil {
		conditions = append(conditions, fmt.Sprintf("s.priority = $%d", arg))
		args = append(args, *filters.Priority)
		arg++
	}
	if filters.Active != nil {
		conditions = append(conditions, fmt.Sprintf("s.active = $%d", arg))
		args = append(args, *filters.Active)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_sla_targets s WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.SLATarget{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := slaTargetSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := slaTargetJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.SLATarget](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *SLATargetRepository) Update(ctx context.Context, q Queryer, target *model.SLATarget) error {
	// metadata is NOT NULL; default a nil map to '{}' so updates never write NULL.
	metaJSON, err := json.Marshal(orEmptyMap(target.Metadata))
	if err != nil {
		return fmt.Errorf("marshal sla target metadata: %w", err)
	}
	query := `
		UPDATE legal_sla_targets
		SET service_code = $3,
		    priority = $4,
		    turnaround_working_days = $5,
		    turnaround_working_days_from = $6,
		    ack_window_value = $7,
		    ack_window_unit = $8,
		    escalation_l1_days = $9,
		    escalation_l2_days = $10,
		    escalation_l3_days = $11,
		    active = $12,
		    metadata = $13::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		target.TenantID, target.ID, target.ServiceCode, target.Priority, target.TurnaroundWorkingDays,
		target.TurnaroundWorkingDaysFrom, target.AckWindowValue, target.AckWindowUnit,
		target.EscalationL1Days, target.EscalationL2Days, target.EscalationL3Days,
		target.Active, metaJSON,
	).Scan(&target.UpdatedAt)
}

func (r *SLATargetRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_sla_targets SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func slaTargetJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT s.id, s.tenant_id, s.service_code, s.priority,
			       s.turnaround_working_days_from, s.turnaround_working_days,
			       s.ack_window_value, s.ack_window_unit,
			       s.escalation_l1_days, s.escalation_l2_days, s.escalation_l3_days,
			       s.active, COALESCE(s.metadata, '{}'::jsonb) AS metadata,
			       s.created_by, s.created_at, s.updated_at, s.deleted_at
			FROM legal_sla_targets s
			WHERE ` + where + `
		) t`
}

func slaTargetSortColumn(column string) (string, bool) {
	switch column {
	case "s.service_code":
		return "t.service_code", true
	case "s.priority":
		return "t.priority", true
	case "s.turnaround_working_days":
		return "t.turnaround_working_days", true
	case "s.turnaround_working_days_from":
		return "t.turnaround_working_days_from", true
	case "s.updated_at":
		return "t.updated_at", true
	case "s.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
