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

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/lex/model"
)

// OrgEntityRepository persists the legal-org master-data registry
// (legal_org_entities + legal_org_roles). Reads project rows through
// row_to_json so the JSONB name/label LocalizedText round-trips cleanly via
// queryRowJSON/queryListJSON; writes marshal the LocalizedText structs to JSONB.
type OrgEntityRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewOrgEntityRepository(db *pgxpool.Pool, logger zerolog.Logger) *OrgEntityRepository {
	return &OrgEntityRepository{db: db, logger: logger}
}

func (r *OrgEntityRepository) Create(ctx context.Context, q Queryer, entity *model.OrgEntity) error {
	nameJSON, err := json.Marshal(entity.Name)
	if err != nil {
		return fmt.Errorf("marshal org entity name: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(entity.Metadata))
	if err != nil {
		return fmt.Errorf("marshal org entity metadata: %w", err)
	}
	query := `
		INSERT INTO legal_org_entities (
			id, tenant_id, parent_id, entity_type, code, name,
			platform_org_unit_id, path, active, metadata, created_by
		) VALUES (
			$1,$2,$3,$4,$5,$6::jsonb,
			$7,$8,$9,$10::jsonb,$11
		)
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		entity.ID, entity.TenantID, entity.ParentID, entity.EntityType, entity.Code, nameJSON,
		entity.PlatformOrgUnitID, entity.Path, entity.Active, metadataJSON, entity.CreatedBy,
	).Scan(&entity.CreatedAt, &entity.UpdatedAt)
}

func (r *OrgEntityRepository) Update(ctx context.Context, q Queryer, entity *model.OrgEntity) error {
	nameJSON, err := json.Marshal(entity.Name)
	if err != nil {
		return fmt.Errorf("marshal org entity name: %w", err)
	}
	metadataJSON, err := json.Marshal(orEmptyMap(entity.Metadata))
	if err != nil {
		return fmt.Errorf("marshal org entity metadata: %w", err)
	}
	query := `
		UPDATE legal_org_entities
		SET parent_id = $3,
		    entity_type = $4,
		    code = $5,
		    name = $6::jsonb,
		    platform_org_unit_id = $7,
		    path = $8,
		    active = $9,
		    metadata = $10::jsonb,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING updated_at`
	return q.QueryRow(ctx, query,
		entity.TenantID, entity.ID, entity.ParentID, entity.EntityType, entity.Code, nameJSON,
		entity.PlatformOrgUnitID, entity.Path, entity.Active, metadataJSON,
	).Scan(&entity.UpdatedAt)
}

// RepathDescendants rewrites materialized paths for every descendant of id
// after id itself has been moved. newSelfPath must be the moved entity's new
// path including id, while descendant suffixes below id are preserved.
func (r *OrgEntityRepository) RepathDescendants(ctx context.Context, q Queryer, tenantID, id uuid.UUID, newSelfPath []string) error {
	_, err := q.Exec(ctx, `
		UPDATE legal_org_entities
		SET path = $3::text[] || COALESCE(path[array_position(path, $2::text) + 1:array_length(path, 1)], '{}'::text[]),
		    updated_at = now()
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND $2 = ANY(path)`,
		tenantID, id.String(), newSelfPath,
	)
	return err
}

func (r *OrgEntityRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.OrgEntity, error) {
	query := orgEntityJSONSelect(`e.tenant_id = $1 AND e.id = $2 AND e.deleted_at IS NULL`)
	var entity *model.OrgEntity
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		entity, err = queryRowJSON[model.OrgEntity](ctx, tx, query, tenantID, id)
		return err
	})
	return entity, err
}

func (r *OrgEntityRepository) GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.OrgEntity, error) {
	query := orgEntityJSONSelect(`e.tenant_id = $1 AND e.code = $2 AND e.deleted_at IS NULL`)
	return queryRowJSON[model.OrgEntity](ctx, r.db, query, tenantID, strings.ToUpper(strings.TrimSpace(code)))
}

// ListAllWith returns the complete active registry through the supplied queryer.
// Bulk imports pass their transaction so validation and writes observe one
// tenant-locked snapshot.
func (r *OrgEntityRepository) ListAllWith(ctx context.Context, q Queryer, tenantID uuid.UUID) ([]model.OrgEntity, error) {
	query := orgEntityJSONSelect(`e.tenant_id = $1 AND e.deleted_at IS NULL`) + ` ORDER BY array_length(t.path, 1) ASC NULLS FIRST, t.code ASC`
	return queryListJSON[model.OrgEntity](ctx, q, query, tenantID)
}

func (r *OrgEntityRepository) SoftDeleteWith(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	_, err := q.Exec(ctx, `UPDATE legal_org_entities SET active = false, deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	return err
}

func (r *OrgEntityRepository) CreateImportJob(ctx context.Context, job *model.OrgImportJob, rows any) error {
	rowsJSON, err := json.Marshal(rows)
	if err != nil {
		return err
	}
	errorsJSON, err := json.Marshal(job.Errors)
	if err != nil {
		return err
	}
	return database.RunWithTenant(ctx, r.db, job.TenantID, func(tx pgx.Tx) error {
		return tx.QueryRow(ctx, `
		INSERT INTO legal_org_import_jobs (
			id, tenant_id, mode, dry_run, status, source_filename, rows, errors,
			total_rows, create_count, update_count, deactivate_count, role_count, employee_count,
			created_by, completed_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14,$15,$16)
		RETURNING created_at`,
			job.ID, job.TenantID, job.Mode, job.DryRun, job.Status, job.SourceFilename,
			rowsJSON, errorsJSON, job.TotalRows, job.CreateCount, job.UpdateCount,
			job.DeactivateCount, job.RoleCount, job.EmployeeCount, job.CreatedBy, job.CompletedAt,
		).Scan(&job.CreatedAt)
	})
}

func (r *OrgEntityRepository) ListImportJobs(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.OrgImportJob, error) {
	if limit < 1 || limit > 200 {
		limit = 50
	}
	var jobs []model.OrgImportJob
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		jobs, err = queryListJSON[model.OrgImportJob](ctx, tx, `
		SELECT row_to_json(t) FROM (
			SELECT id, tenant_id, mode, dry_run, status, source_filename,
			       COALESCE(NULLIF(errors, 'null'::jsonb), '[]'::jsonb) AS errors, total_rows, create_count,
			       update_count, deactivate_count, role_count, employee_count, created_by, created_at, completed_at
			FROM legal_org_import_jobs
			WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2
		) t`, tenantID, limit)
		return err
	})
	return jobs, err
}

func (r *OrgEntityRepository) GetImportJob(ctx context.Context, tenantID, id uuid.UUID) (*model.OrgImportJob, error) {
	var job *model.OrgImportJob
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		job, err = queryRowJSON[model.OrgImportJob](ctx, tx, `
		SELECT row_to_json(t) FROM (
			SELECT id, tenant_id, mode, dry_run, status, source_filename,
			       COALESCE(NULLIF(errors, 'null'::jsonb), '[]'::jsonb) AS errors, total_rows, create_count,
			       update_count, deactivate_count, role_count, employee_count, created_by, created_at, completed_at
			FROM legal_org_import_jobs WHERE tenant_id = $1 AND id = $2
		) t`, tenantID, id)
		return err
	})
	return job, err
}

func (r *OrgEntityRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.OrgEntityListFilters) ([]model.OrgEntity, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"e.tenant_id = $1", "e.deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(e.code ILIKE '%%' || $%d || '%%' OR e.name->>'en' ILIKE '%%' || $%d || '%%' OR e.name->>'ar' ILIKE '%%' || $%d || '%%')", arg, arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.EntityType != nil {
		conditions = append(conditions, fmt.Sprintf("e.entity_type = $%d", arg))
		args = append(args, *filters.EntityType)
		arg++
	}
	if filters.ParentID != nil {
		conditions = append(conditions, fmt.Sprintf("e.parent_id = $%d", arg))
		args = append(args, *filters.ParentID)
		arg++
	}
	if filters.Active != nil {
		conditions = append(conditions, fmt.Sprintf("e.active = $%d", arg))
		args = append(args, *filters.Active)
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_org_entities e WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.OrgEntity{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "t.updated_at"
	if mapped, ok := orgEntitySortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := orgEntityJSONSelect(where) + fmt.Sprintf(" ORDER BY %s %s LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	items, err := queryListJSON[model.OrgEntity](ctx, r.db, query, args...)
	if err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

func (r *OrgEntityRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	ct, err := r.db.Exec(ctx, `UPDATE legal_org_entities SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// HasChildren reports whether the entity has any non-deleted child node; used to
// refuse deletion of a node that still anchors a subtree.
func (r *OrgEntityRepository) HasChildren(ctx context.Context, tenantID, id uuid.UUID) (bool, error) {
	var exists bool
	err := r.db.QueryRow(ctx, `
		SELECT EXISTS (
			SELECT 1 FROM legal_org_entities
			WHERE tenant_id = $1 AND parent_id = $2 AND deleted_at IS NULL
		)`,
		tenantID, id,
	).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// Ancestors returns the entity rows along the materialized path (root-first),
// followed by the entity itself, ordered root → leaf. Used by escalation
// resolution to walk up the ladder. Deleted ancestors are excluded.
func (r *OrgEntityRepository) Ancestors(ctx context.Context, tenantID, id uuid.UUID) ([]model.OrgEntity, error) {
	query := orgEntityJSONSelect(`e.tenant_id = $1 AND e.deleted_at IS NULL AND e.id IN (
		SELECT (unnest(path))::uuid FROM legal_org_entities WHERE tenant_id = $1 AND id = $2
		UNION SELECT $2
	)`) + ` ORDER BY array_length(t.path, 1) ASC NULLS FIRST, t.created_at ASC`
	return queryListJSON[model.OrgEntity](ctx, r.db, query, tenantID, id)
}

// ---- roles ----

func (r *OrgEntityRepository) UpsertRole(ctx context.Context, q Queryer, role *model.OrgRole) error {
	labelJSON, err := json.Marshal(role.Label)
	if err != nil {
		return fmt.Errorf("marshal org role label: %w", err)
	}
	query := `
		INSERT INTO legal_org_roles (id, tenant_id, entity_id, role_key, user_id, label, created_by)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
		ON CONFLICT (tenant_id, entity_id, role_key)
		WHERE deleted_at IS NULL
		DO UPDATE SET user_id = EXCLUDED.user_id,
		              label = EXCLUDED.label,
		              updated_at = now()
		RETURNING id, created_at, updated_at`
	return q.QueryRow(ctx, query,
		role.ID, role.TenantID, role.EntityID, role.RoleKey, role.UserID, labelJSON, role.CreatedBy,
	).Scan(&role.ID, &role.CreatedAt, &role.UpdatedAt)
}

func (r *OrgEntityRepository) UpsertMembership(ctx context.Context, q Queryer, membership *model.OrgMembership) error {
	titleJSON, err := json.Marshal(membership.Title)
	if err != nil {
		return err
	}
	metadataJSON, err := json.Marshal(orEmptyMap(membership.Metadata))
	if err != nil {
		return err
	}
	if membership.ID == uuid.Nil {
		membership.ID = uuid.New()
	}
	return q.QueryRow(ctx, `
		INSERT INTO legal_org_memberships (id, tenant_id, entity_id, user_id, employee_code, title, manager_user_id, capacity_units, active, metadata, created_by)
		VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10::jsonb,$11)
		ON CONFLICT (tenant_id, entity_id, user_id) WHERE deleted_at IS NULL
		DO UPDATE SET employee_code = EXCLUDED.employee_code, title = EXCLUDED.title,
		              manager_user_id = EXCLUDED.manager_user_id, active = EXCLUDED.active,
		              capacity_units = EXCLUDED.capacity_units, metadata = EXCLUDED.metadata, updated_at = now()
		RETURNING id`, membership.ID, membership.TenantID, membership.EntityID, membership.UserID,
		membership.EmployeeCode, titleJSON, membership.ManagerUserID, membership.CapacityUnits,
		membership.Active, metadataJSON, membership.CreatedBy).Scan(&membership.ID)
}

// ListActiveMemberships returns the active employee mappings for one legal-org
// entity. The tenant + entity predicates are both explicit even though RLS is a
// backstop, and inactive/soft-deleted rows never become assignment candidates.
func (r *OrgEntityRepository) ListActiveMemberships(ctx context.Context, tenantID, entityID uuid.UUID) ([]model.OrgMembership, error) {
	var memberships []model.OrgMembership
	err := database.RunReadWithTenant(ctx, r.db, tenantID, func(tx pgx.Tx) error {
		var err error
		memberships, err = listActiveMembershipsWith(ctx, tx, tenantID, entityID)
		return err
	})
	return memberships, err
}

// listActiveMembershipsWith keeps the SELECT independently testable while the
// public repository method owns the tenant-scoped read transaction required by
// FORCE ROW LEVEL SECURITY on legal_org_memberships.
func listActiveMembershipsWith(ctx context.Context, q Queryer, tenantID, entityID uuid.UUID) ([]model.OrgMembership, error) {
	return queryListJSON[model.OrgMembership](ctx, q, `
		SELECT row_to_json(t) FROM (
			SELECT id, tenant_id, entity_id, user_id, employee_code,
			       COALESCE(NULLIF(title, 'null'::jsonb), '{}'::jsonb) AS title,
			       manager_user_id, capacity_units, active,
			       COALESCE(NULLIF(metadata, 'null'::jsonb), '{}'::jsonb) AS metadata,
			       created_by
			FROM legal_org_memberships
			WHERE tenant_id = $1
			  AND entity_id = $2
			  AND active = true
			  AND deleted_at IS NULL
			ORDER BY employee_code ASC, user_id ASC
		) t`, tenantID, entityID)
}

func (r *OrgEntityRepository) DeleteRole(ctx context.Context, tenantID, entityID uuid.UUID, roleKey model.OrgRoleKey) error {
	ct, err := r.db.Exec(ctx, `
		UPDATE legal_org_roles SET deleted_at = now(), updated_at = now()
		WHERE tenant_id = $1 AND entity_id = $2 AND role_key = $3 AND deleted_at IS NULL`,
		tenantID, entityID, roleKey,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

func (r *OrgEntityRepository) ListRoles(ctx context.Context, tenantID, entityID uuid.UUID) ([]model.OrgRole, error) {
	query := orgRoleJSONSelect(`ro.tenant_id = $1 AND ro.entity_id = $2 AND ro.deleted_at IS NULL`) + ` ORDER BY t.role_key ASC`
	return queryListJSON[model.OrgRole](ctx, r.db, query, tenantID, entityID)
}

// RoleForEntities returns the first non-deleted binding for roleKey among the
// supplied entity ids, preferring the order they are supplied (leaf → root for
// escalation). Returns pgx.ErrNoRows when none of the entities carry the role.
func (r *OrgEntityRepository) RoleForEntities(ctx context.Context, tenantID uuid.UUID, roleKey model.OrgRoleKey, entityIDs []uuid.UUID) (*model.OrgRole, error) {
	if len(entityIDs) == 0 {
		return nil, pgx.ErrNoRows
	}
	query := orgRoleJSONSelect(`ro.tenant_id = $1 AND ro.role_key = $2 AND ro.entity_id = ANY($3) AND ro.deleted_at IS NULL`) +
		` ORDER BY array_position($3, t.entity_id) ASC LIMIT 1`
	return queryRowJSON[model.OrgRole](ctx, r.db, query, tenantID, roleKey, entityIDs)
}

// ListAllForAudit returns every non-deleted org entity for the tenant ordered
// newest-activity-first (updated_at DESC, then created_at DESC). The service
// synthesizes timeline events from each row's created/updated metadata, so this
// is the read source for the tenant-wide audit feed. It is unpaginated at the
// repository layer; the service slices the synthesized event stream so a single
// reparented/updated row can contribute two ordered events without paging
// straddling them.
func (r *OrgEntityRepository) ListAllForAudit(ctx context.Context, tenantID uuid.UUID) ([]model.OrgEntity, error) {
	query := orgEntityJSONSelect(`e.tenant_id = $1 AND e.deleted_at IS NULL`) +
		` ORDER BY t.updated_at DESC, t.created_at DESC`
	return queryListJSON[model.OrgEntity](ctx, r.db, query, tenantID)
}

// ListPlatformOrgUnitRefs returns the DISTINCT non-null platform_org_unit_id
// values this tenant's legal org entities reference. platform_core org-units are
// NOT a table readable from the lex schema (no cross-service seam exists), so the
// honest, useful answer for reconciliation / "orphaned link" detection is the set
// of platform unit ids the registry actually points at, surfaced with the code +
// localized name of the linking legal entity. Where multiple entities link the
// same platform unit, the most-recently-updated linker supplies the code/name.
func (r *OrgEntityRepository) ListPlatformOrgUnitRefs(ctx context.Context, tenantID uuid.UUID) ([]model.PlatformOrgUnit, error) {
	query := `
		SELECT row_to_json(t)
		FROM (
			SELECT DISTINCT ON (e.platform_org_unit_id)
			       e.platform_org_unit_id AS id,
			       e.code AS code,
			       COALESCE(e.name, '{}'::jsonb) AS name,
			       e.parent_id AS parent_id,
			       e.active AS active
			FROM legal_org_entities e
			WHERE e.tenant_id = $1
			  AND e.deleted_at IS NULL
			  AND e.platform_org_unit_id IS NOT NULL
			ORDER BY e.platform_org_unit_id, e.updated_at DESC
		) t`
	return queryListJSON[model.PlatformOrgUnit](ctx, r.db, query, tenantID)
}

func orgEntityJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT e.id, e.tenant_id, e.parent_id, e.entity_type, e.code,
			       COALESCE(e.name, '{}'::jsonb) AS name,
			       e.platform_org_unit_id, COALESCE(e.path, '{}') AS path, e.active,
			       COALESCE(e.metadata, '{}'::jsonb) AS metadata,
			       e.created_by, e.created_at, e.updated_at, e.deleted_at
			FROM legal_org_entities e
			WHERE ` + where + `
		) t`
}

func orgRoleJSONSelect(where string) string {
	return `
		SELECT row_to_json(t)
		FROM (
			SELECT ro.id, ro.tenant_id, ro.entity_id, ro.role_key, ro.user_id,
			       COALESCE(ro.label, '{}'::jsonb) AS label,
			       ro.created_by, ro.created_at, ro.updated_at, ro.deleted_at
			FROM legal_org_roles ro
			WHERE ` + where + `
		) t`
}

func orgEntitySortColumn(column string) (string, bool) {
	switch column {
	case "e.code":
		return "t.code", true
	case "e.entity_type":
		return "t.entity_type", true
	case "e.active":
		return "t.active", true
	case "e.updated_at":
		return "t.updated_at", true
	case "e.created_at":
		return "t.created_at", true
	default:
		return "", false
	}
}
