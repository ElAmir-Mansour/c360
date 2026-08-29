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

// ServiceCatalogRepository persists the legal service catalog
// (legal_service_catalog + legal_service_eligibility_rules). Reads project rows
// through row_to_json so the bilingual name/description LocalizedText round-trips
// via queryRowJSON/queryListJSON; writes marshal the LocalizedText structs to
// JSONB. Writes accept a Queryer so a service + its eligibility rules commit
// atomically.
type ServiceCatalogRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewServiceCatalogRepository(db *pgxpool.Pool, logger zerolog.Logger) *ServiceCatalogRepository {
	return &ServiceCatalogRepository{db: db, logger: logger}
}

func (r *ServiceCatalogRepository) Create(ctx context.Context, q Queryer, entry *model.ServiceCatalogEntry) error {
	nameJSON, err := json.Marshal(entry.Name)
	if err != nil {
		return fmt.Errorf("marshal service name: %w", err)
	}
	descJSON, err := json.Marshal(entry.Description)
	if err != nil {
		return fmt.Errorf("marshal service description: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(entry.Metadata))
	if err != nil {
		return fmt.Errorf("marshal service metadata: %w", err)
	}
	query := `
		INSERT INTO legal_service_catalog (
			id, tenant_id, code, request_type, name, description, available_to,
			requester_approval_required, provider_approval_required, approval_policy_id,
			intake_email, channel, active, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,
			$8,$9,$10,
			$11,$12,$13,$14::jsonb,$15
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.Code, entry.RequestType, nameJSON, descJSON, entry.AvailableTo,
		entry.RequesterApprovalReqd, entry.ProviderApprovalReqd, entry.ApprovalPolicyID,
		entry.IntakeEmail, entry.Channel, entry.Active, metaJSON, entry.CreatedBy,
	).Scan(&entry.CreatedAt, &entry.UpdatedAt)
}

func (r *ServiceCatalogRepository) Update(ctx context.Context, q Queryer, entry *model.ServiceCatalogEntry) error {
	nameJSON, err := json.Marshal(entry.Name)
	if err != nil {
		return fmt.Errorf("marshal service name: %w", err)
	}
	descJSON, err := json.Marshal(entry.Description)
	if err != nil {
		return fmt.Errorf("marshal service description: %w", err)
	}
	metaJSON, err := json.Marshal(orEmptyMap(entry.Metadata))
	if err != nil {
		return fmt.Errorf("marshal service metadata: %w", err)
	}
	query := `
		UPDATE legal_service_catalog
		SET request_type = $3,
		    name = $4::jsonb,
		    description = $5::jsonb,
		    available_to = $6,
		    requester_approval_required = $7,
		    provider_approval_required = $8,
		    approval_policy_id = $9,
		    intake_email = $10,
		    channel = $11,
		    active = $12,
		    metadata = $13::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		entry.TenantID, entry.ID, entry.RequestType, nameJSON, descJSON, entry.AvailableTo,
		entry.RequesterApprovalReqd, entry.ProviderApprovalReqd, entry.ApprovalPolicyID,
		entry.IntakeEmail, entry.Channel, entry.Active, metaJSON,
	).Scan(&entry.UpdatedAt)
}

func (r *ServiceCatalogRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.ServiceCatalogEntry, error) {
	query := serviceCatalogJSONSelect(`s.tenant_id = $1 AND s.id = $2 AND s.deleted_at IS NULL`)
	return queryRowJSON[model.ServiceCatalogEntry](ctx, r.db, query, tenantID, id)
}

func (r *ServiceCatalogRepository) GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.ServiceCatalogEntry, error) {
	query := serviceCatalogJSONSelect(`s.tenant_id = $1 AND s.code = $2 AND s.deleted_at IS NULL`)
	return queryRowJSON[model.ServiceCatalogEntry](ctx, r.db, query, tenantID, strings.ToUpper(strings.TrimSpace(code)))
}

// GetByIntakeEmail resolves an active service whose intake_email matches address
// (case-insensitive). Used by the email intake pipeline to route to a service.
func (r *ServiceCatalogRepository) GetByIntakeEmail(ctx context.Context, tenantID uuid.UUID, address string) (*model.ServiceCatalogEntry, error) {
	query := serviceCatalogJSONSelect(`s.tenant_id = $1 AND lower(s.intake_email) = $2 AND s.deleted_at IS NULL AND s.active = true`)
	return queryRowJSON[model.ServiceCatalogEntry](ctx, r.db, query, tenantID, strings.ToLower(strings.TrimSpace(address)))
}

func (r *ServiceCatalogRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.ServiceCatalogListFilters) ([]model.ServiceCatalogEntry, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"s.tenant_id = $1", "s.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(s.code ILIKE '%%' || $%d || '%%' OR s.name->>'en' ILIKE '%%' || $%d || '%%' OR s.name->>'ar' ILIKE '%%' || $%d || '%%' OR s.request_type ILIKE '%%' || $%d || '%%')", arg, arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if len(filters.Channels) > 0 {
		channels := make([]string, 0, len(filters.Channels))
		for _, channel := range filters.Channels {
			channels = append(channels, string(channel))
		}
		conditions = append(conditions, fmt.Sprintf("s.channel = ANY($%d::text[])", arg))
		args = append(args, channels)
		arg++
	} else if filters.Channel != nil {
		conditions = append(conditions, fmt.Sprintf("s.channel = $%d", arg))
		args = append(args, *filters.Channel)
		arg++
	}
	if filters.Active != nil {
		conditions = append(conditions, fmt.Sprintf("s.active = $%d", arg))
		args = append(args, *filters.Active)
		arg++
	}
	if filters.RequestType != "" {
		conditions = append(conditions, fmt.Sprintf("s.request_type = $%d", arg))
		args = append(args, filters.RequestType)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_service_catalog s WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.ServiceCatalogEntry{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := serviceCatalogSortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := serviceCatalogJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.ServiceCatalogEntry](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *ServiceCatalogRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_service_catalog SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// ---- eligibility rules ----

// InsertRule appends one eligibility predicate to a service.
func (r *ServiceCatalogRepository) InsertRule(ctx context.Context, q Queryer, rule *model.ServiceEligibilityRule) error {
	query := `
		INSERT INTO legal_service_eligibility_rules (
			id, tenant_id, service_id, rule_type, value, created_by
		) VALUES ($1,$2,$3,$4,$5,$6)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		rule.ID, rule.TenantID, rule.ServiceID, rule.RuleType, rule.Value, rule.CreatedBy,
	).Scan(&rule.CreatedAt, &rule.UpdatedAt)
}

// DeleteRules soft-deletes all eligibility rules for a service. Used when an
// update REPLACES the rule set (CAP-005).
func (r *ServiceCatalogRepository) DeleteRules(ctx context.Context, q Queryer, tenantID, serviceID uuid.UUID) error {
	_, err := q.Exec(ctx, `
		UPDATE legal_service_eligibility_rules SET deleted_at = now(), updated_at = now()
		WHERE tenant_id = $1 AND service_id = $2 AND deleted_at IS NULL`,
		tenantID, serviceID,
	)
	return err
}

// ListRules returns the active eligibility predicates for a service.
func (r *ServiceCatalogRepository) ListRules(ctx context.Context, tenantID, serviceID uuid.UUID) ([]model.ServiceEligibilityRule, error) {
	query := serviceEligibilityRuleJSONSelect(`er.tenant_id = $1 AND er.service_id = $2 AND er.deleted_at IS NULL`) + ` ORDER BY t.rule_type ASC, t.created_at ASC`
	return queryListJSON[model.ServiceEligibilityRule](ctx, r.db, query, tenantID, serviceID)
}

func serviceCatalogJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT s.id, s.tenant_id, s.code, s.request_type,
			       COALESCE(s.name, '{}'::jsonb) AS name,
			       COALESCE(s.description, '{}'::jsonb) AS description,
			       COALESCE(s.available_to, '{}') AS available_to,
			       s.requester_approval_required, s.provider_approval_required,
			       s.approval_policy_id, s.intake_email, s.channel, s.active,
			       COALESCE(s.metadata, '{}'::jsonb) AS metadata,
			       s.created_by, s.created_at, s.updated_at, s.deleted_at
			FROM legal_service_catalog s
			WHERE ` + where + `
		) t`
}

func serviceEligibilityRuleJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT er.id, er.tenant_id, er.service_id, er.rule_type, er.value,
			       er.created_by, er.created_at, er.updated_at, er.deleted_at
			FROM legal_service_eligibility_rules er
			WHERE ` + where + `
		) t`
}

func serviceCatalogSortColumn(column string) (string, bool) {
	switch column {
	case "s.code":
		return "t.code", true
	case "s.request_type":
		return "t.request_type", true
	case "s.channel":
		return "t.channel", true
	case "s.active":
		return "t.active", true
	case "s.updated_at":
		return "t.updated_at", true
	case "s.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
