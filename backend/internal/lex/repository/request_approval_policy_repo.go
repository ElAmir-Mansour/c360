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

// RequestApprovalPolicyRepository persists the subject-agnostic request-approval
// policy stack (CAP-006, CAP-007): the core legal_request_approval_policies CRUD
// plus the governance trio (immutable versions, append-only audit, reusable
// templates) and the scope-match / conflict-detection queries. Every statement
// is tenant-scoped explicitly (tenant_id = $1) and is additionally protected by
// the RLS policies declared in the staged migration.
type RequestApprovalPolicyRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewRequestApprovalPolicyRepository(db *pgxpool.Pool, logger zerolog.Logger) *RequestApprovalPolicyRepository {
	return &RequestApprovalPolicyRepository{db: db, logger: logger}
}

// ---------------------------------------------------------------------------
// Core CRUD / list / soft-delete
// ---------------------------------------------------------------------------

const requestApprovalPolicyColumns = `id, tenant_id, name, description, status, priority,
	request_type, service_id, stage, department, priority_tier,
	min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
	require_authority_evidence, required_role, required_authority_amount, metadata,
	created_by, updated_by, created_at, updated_at,
	version, valid_from, valid_until, template_id`

// Create inserts a new policy and scans the persisted row back into p.
func (r *RequestApprovalPolicyRepository) Create(ctx context.Context, q Queryer, p *model.RequestApprovalPolicy) error {
	approversJSON, formFieldsJSON, metadataJSON, err := marshalRequestApprovalPolicyJSON(p)
	if err != nil {
		return err
	}
	query := `
		INSERT INTO legal_request_approval_policies (
			id, tenant_id, name, description, status, priority,
			request_type, service_id, stage, department, priority_tier,
			min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
			require_authority_evidence, required_role, required_authority_amount, metadata,
			created_by, valid_from, valid_until, template_id
		) VALUES (
			$1,$2,$3,$4,$5,$6,
			$7,$8,$9,$10,$11,
			$12,$13,$14,$15,$16,$17,$18::jsonb,$19::jsonb,
			$20,$21,$22,$23::jsonb,
			$24,$25,$26,$27
		)
		RETURNING ` + requestApprovalPolicyColumns
	return scanRequestApprovalPolicyInto(q.QueryRow(ctx, query,
		p.ID, p.TenantID, p.Name, p.Description, p.Status, p.Priority,
		p.RequestType, p.ServiceID, requestStagePtr(p.Stage), p.Department, p.PriorityTier,
		p.MinValue, p.MaxValue, p.Currency, p.Mode, p.Quorum, p.QuorumN, approversJSON, formFieldsJSON,
		p.RequireAuthorityEvidence, p.RequiredRole, p.RequiredAuthorityAmount, metadataJSON,
		p.CreatedBy, p.ValidFrom, p.ValidUntil, p.TemplateID,
	), p)
}

// Get loads a single non-deleted policy by id.
func (r *RequestApprovalPolicyRepository) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.RequestApprovalPolicy, error) {
	query := `
		SELECT ` + requestApprovalPolicyColumns + `
		FROM legal_request_approval_policies
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`
	return scanRequestApprovalPolicy(r.db.QueryRow(ctx, query, tenantID, id))
}

// List returns a paginated page of non-deleted policies ordered by priority then
// recency (with an allowlisted sort override).
func (r *RequestApprovalPolicyRepository) List(ctx context.Context, tenantID uuid.UUID, filters model.RequestApprovalPolicyListFilters) ([]model.RequestApprovalPolicy, int, error) {
	args := []any{tenantID}
	arg := 2
	conditions := []string{"tenant_id = $1", "deleted_at IS NULL"}
	if filters.Search != "" {
		conditions = append(conditions, fmt.Sprintf("(name ILIKE '%%' || $%d || '%%' OR description ILIKE '%%' || $%d || '%%')", arg, arg))
		args = append(args, strings.TrimSpace(filters.Search))
		arg++
	}
	if filters.Status != nil {
		conditions = append(conditions, fmt.Sprintf("status = $%d", arg))
		args = append(args, *filters.Status)
		arg++
	}
	if filters.RequestType != nil {
		conditions = append(conditions, fmt.Sprintf("request_type = $%d", arg))
		args = append(args, strings.TrimSpace(*filters.RequestType))
		arg++
	}
	if filters.ServiceID != nil {
		conditions = append(conditions, fmt.Sprintf("service_id = $%d", arg))
		args = append(args, *filters.ServiceID)
		arg++
	}
	if filters.Stage != nil {
		conditions = append(conditions, fmt.Sprintf("stage = $%d", arg))
		args = append(args, string(*filters.Stage))
		arg++
	}
	where := strings.Join(conditions, " AND ")
	var total int
	if err := r.db.QueryRow(ctx, "SELECT COUNT(*) FROM legal_request_approval_policies WHERE "+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	if total == 0 {
		return []model.RequestApprovalPolicy{}, 0, nil
	}
	page, perPage := normalizePage(filters.Page, filters.PerPage)
	limitIdx := arg
	offsetIdx := arg + 1
	args = append(args, perPage, (page-1)*perPage)
	orderCol := "priority"
	if mapped, ok := requestApprovalPolicySortColumn(filters.SortColumn); ok {
		orderCol = mapped
	}
	orderDir := "DESC"
	if filters.SortDirection == "asc" {
		orderDir = "ASC"
	}
	query := `
		SELECT ` + requestApprovalPolicyColumns + `
		FROM legal_request_approval_policies
		WHERE ` + where + fmt.Sprintf(" ORDER BY %s %s, updated_at DESC LIMIT $%d OFFSET $%d", orderCol, orderDir, limitIdx, offsetIdx)
	rows, err := r.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]model.RequestApprovalPolicy, 0)
	for rows.Next() {
		item, err := scanRequestApprovalPolicy(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, *item)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// Update persists the desired state with an incremented version and scans the
// updated row back into p.
func (r *RequestApprovalPolicyRepository) Update(ctx context.Context, q Queryer, p *model.RequestApprovalPolicy) error {
	approversJSON, formFieldsJSON, metadataJSON, err := marshalRequestApprovalPolicyJSON(p)
	if err != nil {
		return err
	}
	query := `
		UPDATE legal_request_approval_policies
		SET name = $3,
		    description = $4,
		    status = $5,
		    priority = $6,
		    request_type = $7,
		    service_id = $8,
		    stage = $9,
		    department = $10,
		    priority_tier = $11,
		    min_value = $12,
		    max_value = $13,
		    currency = $14,
		    mode = $15,
		    quorum = $16,
		    quorum_n = $17,
		    approvers = $18::jsonb,
		    form_fields = $19::jsonb,
		    require_authority_evidence = $20,
		    required_role = $21,
		    required_authority_amount = $22,
		    metadata = $23::jsonb,
		    updated_by = $24,
		    valid_from = $25,
		    valid_until = $26,
		    template_id = $27,
		    version = version + 1,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING ` + requestApprovalPolicyColumns
	return scanRequestApprovalPolicyInto(q.QueryRow(ctx, query,
		p.TenantID, p.ID, p.Name, p.Description, p.Status, p.Priority,
		p.RequestType, p.ServiceID, requestStagePtr(p.Stage), p.Department, p.PriorityTier,
		p.MinValue, p.MaxValue, p.Currency, p.Mode, p.Quorum, p.QuorumN, approversJSON, formFieldsJSON,
		p.RequireAuthorityEvidence, p.RequiredRole, p.RequiredAuthorityAmount, metadataJSON,
		p.UpdatedBy, p.ValidFrom, p.ValidUntil, p.TemplateID,
	), p)
}

// Archive flips status to archived, bumps the version, and scans the row back.
func (r *RequestApprovalPolicyRepository) Archive(ctx context.Context, q Queryer, tenantID, id uuid.UUID, userID uuid.UUID) (*model.RequestApprovalPolicy, error) {
	query := `
		UPDATE legal_request_approval_policies
		SET status = 'archived',
		    updated_by = $3,
		    version = version + 1,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL
		RETURNING ` + requestApprovalPolicyColumns
	return scanRequestApprovalPolicy(q.QueryRow(ctx, query, tenantID, id, userID))
}

// SoftDelete marks a policy deleted (tenant-scoped).
func (r *RequestApprovalPolicyRepository) SoftDelete(ctx context.Context, tenantID, id uuid.UUID) error {
	tag, err := r.db.Exec(ctx, `UPDATE legal_request_approval_policies SET deleted_at = now(), updated_at = now() WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`, tenantID, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// RecommendCandidate carries the concrete request attributes used to resolve the
// best-match active policy. Nil/empty fields are treated as "any".
type RecommendCandidate struct {
	RequestType  *string
	ServiceID    *uuid.UUID
	Stage        *model.RequestApprovalStage
	Department   *string
	PriorityTier *string
	Value        float64
	Currency     string
	At           time.Time
}

// recommendPolicyQuery selects the single best-match active, in-window policy for
// a concrete request. It is a package-level const so its exact scope predicates
// (notably the currency clause) can be asserted by unit tests without a live DB.
//
// Currency clause semantics: an UNSPECIFIED candidate currency ($7 = ”) matches
// any policy (currency is not a filter); otherwise a policy matches only when it is
// currency-agnostic (currency = ”) or its currency equals the candidate's.
const recommendPolicyQuery = `
	SELECT ` + requestApprovalPolicyColumns + `
	FROM legal_request_approval_policies
	WHERE tenant_id = $1
	  AND status = 'active'
	  AND deleted_at IS NULL
	  AND (request_type IS NULL OR $2::text IS NULL OR request_type = $2)
	  AND (service_id IS NULL OR $3::uuid IS NULL OR service_id = $3)
	  AND (stage IS NULL OR $4::text IS NULL OR stage = $4)
	  AND (department IS NULL OR $5::text IS NULL OR department = $5)
	  AND (priority_tier IS NULL OR $6::text IS NULL OR priority_tier = $6)
	  AND ($7 = '' OR currency = '' OR currency = $7)
	  AND (min_value IS NULL OR min_value <= $8)
	  AND (max_value IS NULL OR max_value >= $8)
	  AND (valid_from IS NULL OR valid_from <= $9)
	  AND (valid_until IS NULL OR valid_until >= $9)
	ORDER BY priority DESC,
	         CASE WHEN request_type IS NULL THEN 0 ELSE 1 END DESC,
	         CASE WHEN service_id IS NULL THEN 0 ELSE 1 END DESC,
	         CASE WHEN stage IS NULL THEN 0 ELSE 1 END DESC,
	         CASE WHEN department IS NULL THEN 0 ELSE 1 END DESC,
	         CASE WHEN priority_tier IS NULL THEN 0 ELSE 1 END DESC,
	         min_value DESC NULLS LAST,
	         created_at DESC
	LIMIT 1`

// Recommend returns the single best-match active, in-window policy for a concrete
// request, ordered by priority DESC then specificity (more-specific scope first)
// then recency. NULL scope columns are wildcards that match any request.
func (r *RequestApprovalPolicyRepository) Recommend(ctx context.Context, tenantID uuid.UUID, candidate RecommendCandidate) (*model.RequestApprovalPolicy, error) {
	var stage *string
	if candidate.Stage != nil {
		s := string(*candidate.Stage)
		stage = &s
	}
	policy, err := scanRequestApprovalPolicy(r.db.QueryRow(ctx, recommendPolicyQuery,
		tenantID,
		candidate.RequestType,
		candidate.ServiceID,
		stage,
		candidate.Department,
		candidate.PriorityTier,
		strings.ToUpper(strings.TrimSpace(candidate.Currency)),
		candidate.Value,
		candidate.At,
	))
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return policy, nil
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

// RequestApprovalConflictCandidate carries the scope dimensions used to detect
// overlapping policies. Nil/empty fields are "any" (unbounded) for that
// dimension, mirroring the NULL semantics of the underlying columns.
type RequestApprovalConflictCandidate struct {
	ExcludeID    *uuid.UUID
	RequestType  *string
	ServiceID    *uuid.UUID
	Stage        *model.RequestApprovalStage
	Department   *string
	PriorityTier *string
	MinValue     *float64
	MaxValue     *float64
	ValidFrom    *time.Time
	ValidUntil   *time.Time
}

// FindConflicting returns active, non-deleted policies whose scope overlaps the
// candidate's on every dimension. A NULL on either side of a dimension is "any"
// and always overlaps. The candidate's ExcludeID (if set) is omitted so a policy
// never conflicts with itself.
func (r *RequestApprovalPolicyRepository) FindConflicting(ctx context.Context, tenantID uuid.UUID, candidate RequestApprovalConflictCandidate) ([]model.RequestApprovalPolicy, error) {
	var excludeID uuid.UUID
	if candidate.ExcludeID != nil {
		excludeID = *candidate.ExcludeID
	}
	var stage *string
	if candidate.Stage != nil {
		s := string(*candidate.Stage)
		stage = &s
	}
	query := `
		SELECT ` + requestApprovalPolicyColumns + `
		FROM legal_request_approval_policies
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND status = 'active'
		  AND ($2 = '00000000-0000-0000-0000-000000000000'::uuid OR id <> $2)
		  AND (request_type IS NULL OR $3::text IS NULL OR request_type = $3)
		  AND (service_id IS NULL OR $4::uuid IS NULL OR service_id = $4)
		  AND (stage IS NULL OR $5::text IS NULL OR stage = $5)
		  AND (department IS NULL OR $6::text IS NULL OR department = $6)
		  AND (priority_tier IS NULL OR $7::text IS NULL OR priority_tier = $7)
		  -- value-range overlap: existing.min <= candidate.max AND candidate.min <= existing.max
		  AND (min_value IS NULL OR $9::numeric IS NULL OR min_value <= $9)
		  AND ($8::numeric IS NULL OR max_value IS NULL OR $8 <= max_value)
		  -- effective-window overlap
		  AND (valid_from IS NULL OR $11::timestamptz IS NULL OR valid_from <= $11)
		  AND ($10::timestamptz IS NULL OR valid_until IS NULL OR $10 <= valid_until)
		ORDER BY priority DESC, updated_at DESC`
	rows, err := r.db.Query(ctx, query,
		tenantID,
		excludeID,
		candidate.RequestType,
		candidate.ServiceID,
		stage,
		candidate.Department,
		candidate.PriorityTier,
		candidate.MinValue,
		candidate.MaxValue,
		candidate.ValidFrom,
		candidate.ValidUntil,
	)
	if err != nil {
		return nil, fmt.Errorf("find conflicting request approval policies: %w", err)
	}
	defer rows.Close()
	out := make([]model.RequestApprovalPolicy, 0)
	for rows.Next() {
		p, err := scanRequestApprovalPolicy(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// ---------------------------------------------------------------------------
// Version history (immutable)
// ---------------------------------------------------------------------------

// SaveVersion appends an immutable snapshot row. The caller supplies the next
// version number; UNIQUE(policy_id, version) guarantees uniqueness (SQLSTATE
// 23505 on duplicate).
func (r *RequestApprovalPolicyRepository) SaveVersion(ctx context.Context, q Queryer, v *model.RequestApprovalPolicyVersion) error {
	snapshotJSON, err := json.Marshal(v.Snapshot)
	if err != nil {
		return fmt.Errorf("marshal request approval policy snapshot: %w", err)
	}
	query := `
		INSERT INTO legal_request_approval_policy_versions (
			id, policy_id, tenant_id, version, snapshot, change_reason, created_by
		) VALUES (
			COALESCE(NULLIF($1, '00000000-0000-0000-0000-000000000000'::uuid), gen_random_uuid()),
			$2, $3, $4, $5::jsonb, $6, $7
		)
		RETURNING id, created_at`
	return q.QueryRow(ctx, query,
		v.ID, v.PolicyID, v.TenantID, v.Version, snapshotJSON, v.ChangeReason, v.CreatedBy,
	).Scan(&v.ID, &v.CreatedAt)
}

// ListVersions returns the version history for a policy, newest first.
func (r *RequestApprovalPolicyRepository) ListVersions(ctx context.Context, tenantID, policyID uuid.UUID) ([]model.RequestApprovalPolicyVersion, error) {
	query := `
		SELECT id, policy_id, tenant_id, version, snapshot, change_reason, created_by, created_at
		FROM legal_request_approval_policy_versions
		WHERE tenant_id = $1 AND policy_id = $2
		ORDER BY version DESC`
	rows, err := r.db.Query(ctx, query, tenantID, policyID)
	if err != nil {
		return nil, fmt.Errorf("list request approval policy versions: %w", err)
	}
	defer rows.Close()
	out := make([]model.RequestApprovalPolicyVersion, 0)
	for rows.Next() {
		v, err := scanRequestApprovalPolicyVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// GetVersion loads a single snapshot by policy + version number.
func (r *RequestApprovalPolicyRepository) GetVersion(ctx context.Context, tenantID, policyID uuid.UUID, version int) (*model.RequestApprovalPolicyVersion, error) {
	query := `
		SELECT id, policy_id, tenant_id, version, snapshot, change_reason, created_by, created_at
		FROM legal_request_approval_policy_versions
		WHERE tenant_id = $1 AND policy_id = $2 AND version = $3`
	return scanRequestApprovalPolicyVersion(r.db.QueryRow(ctx, query, tenantID, policyID, version))
}

func scanRequestApprovalPolicyVersion(row pgx.Row) (*model.RequestApprovalPolicyVersion, error) {
	var v model.RequestApprovalPolicyVersion
	var snapshotJSON []byte
	if err := row.Scan(
		&v.ID, &v.PolicyID, &v.TenantID, &v.Version, &snapshotJSON, &v.ChangeReason, &v.CreatedBy, &v.CreatedAt,
	); err != nil {
		return nil, err
	}
	if len(snapshotJSON) > 0 {
		if err := json.Unmarshal(snapshotJSON, &v.Snapshot); err != nil {
			return nil, fmt.Errorf("decode request approval policy snapshot: %w", err)
		}
	}
	return &v, nil
}

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------

// AppendAudit writes a single append-only audit record. before/after may be nil.
func (r *RequestApprovalPolicyRepository) AppendAudit(ctx context.Context, q Queryer, entry *model.RequestApprovalPolicyAuditEntry) error {
	beforeJSON, err := marshalNullableJSON(entry.Before)
	if err != nil {
		return fmt.Errorf("marshal request approval policy audit before: %w", err)
	}
	afterJSON, err := marshalNullableJSON(entry.After)
	if err != nil {
		return fmt.Errorf("marshal request approval policy audit after: %w", err)
	}
	query := `
		INSERT INTO legal_request_approval_policy_audit_log (
			id, tenant_id, policy_id, action, actor_id, before, after, request_id
		) VALUES (
			COALESCE(NULLIF($1, '00000000-0000-0000-0000-000000000000'::uuid), gen_random_uuid()),
			$2, $3, $4, $5, $6::jsonb, $7::jsonb, $8
		)
		RETURNING id, created_at`
	return q.QueryRow(ctx, query,
		entry.ID, entry.TenantID, entry.PolicyID, string(entry.Action), entry.ActorID, beforeJSON, afterJSON, entry.RequestID,
	).Scan(&entry.ID, &entry.CreatedAt)
}

// ListAudit returns audit entries for a policy, newest first, paginated.
func (r *RequestApprovalPolicyRepository) ListAudit(ctx context.Context, tenantID, policyID uuid.UUID, limit, offset int) ([]model.RequestApprovalPolicyAuditEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := `
		SELECT id, tenant_id, policy_id, action, actor_id, before, after, request_id, created_at
		FROM legal_request_approval_policy_audit_log
		WHERE tenant_id = $1 AND policy_id = $2
		ORDER BY created_at DESC, id DESC
		LIMIT $3 OFFSET $4`
	rows, err := r.db.Query(ctx, query, tenantID, policyID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list request approval policy audit: %w", err)
	}
	defer rows.Close()
	out := make([]model.RequestApprovalPolicyAuditEntry, 0)
	for rows.Next() {
		entry, err := scanRequestApprovalPolicyAudit(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *entry)
	}
	return out, rows.Err()
}

func scanRequestApprovalPolicyAudit(row pgx.Row) (*model.RequestApprovalPolicyAuditEntry, error) {
	var entry model.RequestApprovalPolicyAuditEntry
	var action string
	var beforeJSON, afterJSON []byte
	if err := row.Scan(
		&entry.ID, &entry.TenantID, &entry.PolicyID, &action, &entry.ActorID, &beforeJSON, &afterJSON, &entry.RequestID, &entry.CreatedAt,
	); err != nil {
		return nil, err
	}
	entry.Action = model.RequestApprovalPolicyAuditAction(action)
	if len(beforeJSON) > 0 {
		var p model.RequestApprovalPolicy
		if err := json.Unmarshal(beforeJSON, &p); err != nil {
			return nil, fmt.Errorf("decode request approval policy audit before: %w", err)
		}
		entry.Before = &p
	}
	if len(afterJSON) > 0 {
		var p model.RequestApprovalPolicy
		if err := json.Unmarshal(afterJSON, &p); err != nil {
			return nil, fmt.Errorf("decode request approval policy audit after: %w", err)
		}
		entry.After = &p
	}
	return &entry, nil
}

// ---------------------------------------------------------------------------
// Templates (CRUD)
// ---------------------------------------------------------------------------

// CreateTemplate inserts a new template. A duplicate (tenant_id, name) surfaces
// as a unique violation (SQLSTATE 23505).
func (r *RequestApprovalPolicyRepository) CreateTemplate(ctx context.Context, q Queryer, t *model.RequestApprovalPolicyTemplate) error {
	definitionJSON, err := marshalDefinition(t.Definition)
	if err != nil {
		return fmt.Errorf("marshal request approval policy template definition: %w", err)
	}
	query := `
		INSERT INTO legal_request_approval_policy_templates (
			id, tenant_id, name, description, category, definition, created_by, updated_by
		) VALUES (
			COALESCE(NULLIF($1, '00000000-0000-0000-0000-000000000000'::uuid), gen_random_uuid()),
			$2, $3, $4, $5, $6::jsonb, $7, $8
		)
		RETURNING id, created_at, updated_at`
	return q.QueryRow(ctx, query,
		t.ID, t.TenantID, t.Name, t.Description, t.Category, definitionJSON, t.CreatedBy, t.UpdatedBy,
	).Scan(&t.ID, &t.CreatedAt, &t.UpdatedAt)
}

// UpdateTemplate updates a template in place.
func (r *RequestApprovalPolicyRepository) UpdateTemplate(ctx context.Context, q Queryer, t *model.RequestApprovalPolicyTemplate) error {
	definitionJSON, err := marshalDefinition(t.Definition)
	if err != nil {
		return fmt.Errorf("marshal request approval policy template definition: %w", err)
	}
	query := `
		UPDATE legal_request_approval_policy_templates
		SET name = $3,
		    description = $4,
		    category = $5,
		    definition = $6::jsonb,
		    updated_by = $7,
		    updated_at = now()
		WHERE tenant_id = $1 AND id = $2
		RETURNING created_at, updated_at`
	return q.QueryRow(ctx, query,
		t.TenantID, t.ID, t.Name, t.Description, t.Category, definitionJSON, t.UpdatedBy,
	).Scan(&t.CreatedAt, &t.UpdatedAt)
}

// DeleteTemplate removes a template. Policies referencing it have template_id set
// NULL by the ON DELETE SET NULL FK.
func (r *RequestApprovalPolicyRepository) DeleteTemplate(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	tag, err := q.Exec(ctx, `DELETE FROM legal_request_approval_policy_templates WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return fmt.Errorf("delete request approval policy template: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// GetTemplate loads a single template by id.
func (r *RequestApprovalPolicyRepository) GetTemplate(ctx context.Context, tenantID, id uuid.UUID) (*model.RequestApprovalPolicyTemplate, error) {
	query := `
		SELECT id, tenant_id, name, description, category, definition, created_by, updated_by, created_at, updated_at
		FROM legal_request_approval_policy_templates
		WHERE tenant_id = $1 AND id = $2`
	return scanRequestApprovalPolicyTemplate(r.db.QueryRow(ctx, query, tenantID, id))
}

// ListTemplates returns all templates for a tenant ordered by category then name.
func (r *RequestApprovalPolicyRepository) ListTemplates(ctx context.Context, tenantID uuid.UUID) ([]model.RequestApprovalPolicyTemplate, error) {
	query := `
		SELECT id, tenant_id, name, description, category, definition, created_by, updated_by, created_at, updated_at
		FROM legal_request_approval_policy_templates
		WHERE tenant_id = $1
		ORDER BY category ASC, name ASC`
	rows, err := r.db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list request approval policy templates: %w", err)
	}
	defer rows.Close()
	out := make([]model.RequestApprovalPolicyTemplate, 0)
	for rows.Next() {
		t, err := scanRequestApprovalPolicyTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func scanRequestApprovalPolicyTemplate(row pgx.Row) (*model.RequestApprovalPolicyTemplate, error) {
	var t model.RequestApprovalPolicyTemplate
	var definitionJSON []byte
	if err := row.Scan(
		&t.ID, &t.TenantID, &t.Name, &t.Description, &t.Category, &definitionJSON, &t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return nil, err
	}
	t.Definition = map[string]any{}
	if len(definitionJSON) > 0 {
		if err := json.Unmarshal(definitionJSON, &t.Definition); err != nil {
			return nil, fmt.Errorf("decode request approval policy template definition: %w", err)
		}
	}
	return &t, nil
}

// ---------------------------------------------------------------------------
// scan / marshal helpers
// ---------------------------------------------------------------------------

func requestStagePtr(stage *model.RequestApprovalStage) *string {
	if stage == nil {
		return nil
	}
	s := string(*stage)
	return &s
}

func marshalRequestApprovalPolicyJSON(p *model.RequestApprovalPolicy) (approvers, formFields, metadata []byte, err error) {
	approvers, err = json.Marshal(p.Approvers)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("marshal request approval policy approvers: %w", err)
	}
	formFields, err = json.Marshal(p.FormFields)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("marshal request approval policy form fields: %w", err)
	}
	metadata, err = json.Marshal(p.Metadata)
	if err != nil {
		return nil, nil, nil, fmt.Errorf("marshal request approval policy metadata: %w", err)
	}
	return approvers, formFields, metadata, nil
}

func scanRequestApprovalPolicy(row pgx.Row) (*model.RequestApprovalPolicy, error) {
	var item model.RequestApprovalPolicy
	if err := scanRequestApprovalPolicyInto(row, &item); err != nil {
		return nil, err
	}
	return &item, nil
}

func scanRequestApprovalPolicyInto(row pgx.Row, item *model.RequestApprovalPolicy) error {
	var status string
	var stage *string
	var approversJSON, formFieldsJSON, metadataJSON []byte
	if err := row.Scan(
		&item.ID, &item.TenantID, &item.Name, &item.Description, &status, &item.Priority,
		&item.RequestType, &item.ServiceID, &stage, &item.Department, &item.PriorityTier,
		&item.MinValue, &item.MaxValue, &item.Currency, &item.Mode, &item.Quorum, &item.QuorumN, &approversJSON, &formFieldsJSON,
		&item.RequireAuthorityEvidence, &item.RequiredRole, &item.RequiredAuthorityAmount, &metadataJSON,
		&item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt,
		&item.Version, &item.ValidFrom, &item.ValidUntil, &item.TemplateID,
	); err != nil {
		return err
	}
	item.Status = model.RequestApprovalPolicyStatus(status)
	if stage != nil {
		st := model.RequestApprovalStage(*stage)
		item.Stage = &st
	}
	if len(approversJSON) > 0 {
		if err := json.Unmarshal(approversJSON, &item.Approvers); err != nil {
			return fmt.Errorf("decode request approval policy approvers: %w", err)
		}
	}
	if len(formFieldsJSON) > 0 {
		if err := json.Unmarshal(formFieldsJSON, &item.FormFields); err != nil {
			return fmt.Errorf("decode request approval policy form fields: %w", err)
		}
	}
	item.Metadata = map[string]any{}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &item.Metadata); err != nil {
			return fmt.Errorf("decode request approval policy metadata: %w", err)
		}
	}
	if item.Approvers == nil {
		item.Approvers = []model.ApprovalPolicyApprover{}
	}
	if item.FormFields == nil {
		item.FormFields = []model.ApprovalPolicyFormField{}
	}
	return nil
}

func requestApprovalPolicySortColumn(column string) (string, bool) {
	switch column {
	case "name":
		return "name", true
	case "status":
		return "status", true
	case "priority":
		return "priority", true
	case "request_type":
		return "request_type", true
	case "updated_at":
		return "updated_at", true
	case "created_at":
		return "created_at", true
	default:
		return "", false
	}
}
