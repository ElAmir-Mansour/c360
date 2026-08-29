package repository

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// ApprovalPolicyGovernanceRepository persists the governance surfaces for
// approval policies (Feature 1): immutable version history, the append-only
// audit log, reusable templates, and conflict-detection / effective-window
// queries. Every statement is tenant-scoped explicitly and is additionally
// protected by the RLS policies declared in migration 000016.
//
// This repository deliberately owns only the governance tables it introduced;
// the core lex_approval_policies CRUD continues to live in the workflow
// service. The conflict-detection query reads lex_approval_policies but never
// mutates it.
type ApprovalPolicyGovernanceRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewApprovalPolicyGovernanceRepository(db *pgxpool.Pool, logger zerolog.Logger) *ApprovalPolicyGovernanceRepository {
	return &ApprovalPolicyGovernanceRepository{db: db, logger: logger}
}

// ApprovalPolicyConflictCandidate carries the scope dimensions used to detect
// overlapping policies. Nil/empty fields are treated as "any" (unbounded) for
// that dimension, mirroring the NULL semantics of the underlying columns.
type ApprovalPolicyConflictCandidate struct {
	// ExcludeID, when non-nil, is omitted from the result set (the policy being
	// created/updated must not conflict with itself).
	ExcludeID    *uuid.UUID
	ContractType *model.ContractType
	Department   *string
	MinValue     *float64
	MaxValue     *float64
	ValidFrom    *time.Time
	ValidUntil   *time.Time
}

// ---------------------------------------------------------------------------
// Version history (immutable)
// ---------------------------------------------------------------------------

// SaveApprovalPolicyVersion appends an immutable snapshot row. The caller is
// responsible for supplying the next version number; the UNIQUE(policy_id,
// version) constraint guarantees no two snapshots share a version (a duplicate
// surfaces as SQLSTATE 23505).
func (r *ApprovalPolicyGovernanceRepository) SaveApprovalPolicyVersion(ctx context.Context, q Queryer, v *model.ApprovalPolicyVersion) error {
	snapshotJSON, err := json.Marshal(v.Snapshot)
	if err != nil {
		return fmt.Errorf("marshal approval policy snapshot: %w", err)
	}
	query := `
		INSERT INTO lex_approval_policy_versions (
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

// ListApprovalPolicyVersions returns the version history for a policy, newest
// version first.
func (r *ApprovalPolicyGovernanceRepository) ListApprovalPolicyVersions(ctx context.Context, tenantID, policyID uuid.UUID) ([]model.ApprovalPolicyVersion, error) {
	query := `
		SELECT id, policy_id, tenant_id, version, snapshot, change_reason, created_by, created_at
		FROM lex_approval_policy_versions
		WHERE tenant_id = $1 AND policy_id = $2
		ORDER BY version DESC`
	rows, err := r.db.Query(ctx, query, tenantID, policyID)
	if err != nil {
		return nil, fmt.Errorf("list approval policy versions: %w", err)
	}
	defer rows.Close()
	out := make([]model.ApprovalPolicyVersion, 0)
	for rows.Next() {
		v, err := scanApprovalPolicyVersion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

// GetApprovalPolicyVersion loads a single snapshot by policy + version number.
func (r *ApprovalPolicyGovernanceRepository) GetApprovalPolicyVersion(ctx context.Context, tenantID, policyID uuid.UUID, version int) (*model.ApprovalPolicyVersion, error) {
	query := `
		SELECT id, policy_id, tenant_id, version, snapshot, change_reason, created_by, created_at
		FROM lex_approval_policy_versions
		WHERE tenant_id = $1 AND policy_id = $2 AND version = $3`
	return scanApprovalPolicyVersion(r.db.QueryRow(ctx, query, tenantID, policyID, version))
}

func scanApprovalPolicyVersion(row pgx.Row) (*model.ApprovalPolicyVersion, error) {
	var v model.ApprovalPolicyVersion
	var snapshotJSON []byte
	if err := row.Scan(
		&v.ID, &v.PolicyID, &v.TenantID, &v.Version, &snapshotJSON, &v.ChangeReason, &v.CreatedBy, &v.CreatedAt,
	); err != nil {
		return nil, err
	}
	if len(snapshotJSON) > 0 {
		if err := json.Unmarshal(snapshotJSON, &v.Snapshot); err != nil {
			return nil, fmt.Errorf("decode approval policy snapshot: %w", err)
		}
	}
	return &v, nil
}

// ---------------------------------------------------------------------------
// Audit log (append-only)
// ---------------------------------------------------------------------------

// AppendApprovalPolicyAudit writes a single append-only audit record. before/
// after may be nil (e.g. before is nil on create, after is nil on hard delete).
func (r *ApprovalPolicyGovernanceRepository) AppendApprovalPolicyAudit(ctx context.Context, q Queryer, entry *model.ApprovalPolicyAuditEntry) error {
	beforeJSON, err := marshalNullableJSON(entry.Before)
	if err != nil {
		return fmt.Errorf("marshal approval policy audit before: %w", err)
	}
	afterJSON, err := marshalNullableJSON(entry.After)
	if err != nil {
		return fmt.Errorf("marshal approval policy audit after: %w", err)
	}
	query := `
		INSERT INTO lex_approval_policy_audit_log (
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

// ListApprovalPolicyAudit returns audit entries for a policy, newest first,
// paginated by limit/offset. A limit <= 0 defaults to 50; offset < 0 to 0.
func (r *ApprovalPolicyGovernanceRepository) ListApprovalPolicyAudit(ctx context.Context, tenantID, policyID uuid.UUID, limit, offset int) ([]model.ApprovalPolicyAuditEntry, error) {
	if limit <= 0 {
		limit = 50
	}
	if offset < 0 {
		offset = 0
	}
	query := `
		SELECT id, tenant_id, policy_id, action, actor_id, before, after, request_id, created_at
		FROM lex_approval_policy_audit_log
		WHERE tenant_id = $1 AND policy_id = $2
		ORDER BY created_at DESC, id DESC
		LIMIT $3 OFFSET $4`
	rows, err := r.db.Query(ctx, query, tenantID, policyID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("list approval policy audit: %w", err)
	}
	defer rows.Close()
	out := make([]model.ApprovalPolicyAuditEntry, 0)
	for rows.Next() {
		entry, err := scanApprovalPolicyAudit(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *entry)
	}
	return out, rows.Err()
}

func scanApprovalPolicyAudit(row pgx.Row) (*model.ApprovalPolicyAuditEntry, error) {
	var entry model.ApprovalPolicyAuditEntry
	var action string
	var beforeJSON, afterJSON []byte
	if err := row.Scan(
		&entry.ID, &entry.TenantID, &entry.PolicyID, &action, &entry.ActorID, &beforeJSON, &afterJSON, &entry.RequestID, &entry.CreatedAt,
	); err != nil {
		return nil, err
	}
	entry.Action = model.ApprovalPolicyAuditAction(action)
	if len(beforeJSON) > 0 {
		var p model.ApprovalPolicy
		if err := json.Unmarshal(beforeJSON, &p); err != nil {
			return nil, fmt.Errorf("decode approval policy audit before: %w", err)
		}
		entry.Before = &p
	}
	if len(afterJSON) > 0 {
		var p model.ApprovalPolicy
		if err := json.Unmarshal(afterJSON, &p); err != nil {
			return nil, fmt.Errorf("decode approval policy audit after: %w", err)
		}
		entry.After = &p
	}
	return &entry, nil
}

// ---------------------------------------------------------------------------
// Templates (CRUD)
// ---------------------------------------------------------------------------

// CreateApprovalPolicyTemplate inserts a new template. A duplicate
// (tenant_id, name) surfaces as a unique violation (SQLSTATE 23505) the service
// can translate into a 409.
func (r *ApprovalPolicyGovernanceRepository) CreateApprovalPolicyTemplate(ctx context.Context, q Queryer, t *model.ApprovalPolicyTemplate) error {
	definitionJSON, err := marshalDefinition(t.Definition)
	if err != nil {
		return fmt.Errorf("marshal approval policy template definition: %w", err)
	}
	query := `
		INSERT INTO lex_approval_policy_templates (
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

// UpdateApprovalPolicyTemplate updates a template in place.
func (r *ApprovalPolicyGovernanceRepository) UpdateApprovalPolicyTemplate(ctx context.Context, q Queryer, t *model.ApprovalPolicyTemplate) error {
	definitionJSON, err := marshalDefinition(t.Definition)
	if err != nil {
		return fmt.Errorf("marshal approval policy template definition: %w", err)
	}
	query := `
		UPDATE lex_approval_policy_templates
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

// DeleteApprovalPolicyTemplate removes a template. Policies referencing it have
// their template_id set to NULL by the ON DELETE SET NULL FK.
func (r *ApprovalPolicyGovernanceRepository) DeleteApprovalPolicyTemplate(ctx context.Context, q Queryer, tenantID, id uuid.UUID) error {
	tag, err := q.Exec(ctx, `DELETE FROM lex_approval_policy_templates WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	if err != nil {
		return fmt.Errorf("delete approval policy template: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}

// GetApprovalPolicyTemplate loads a single template by id.
func (r *ApprovalPolicyGovernanceRepository) GetApprovalPolicyTemplate(ctx context.Context, tenantID, id uuid.UUID) (*model.ApprovalPolicyTemplate, error) {
	query := `
		SELECT id, tenant_id, name, description, category, definition, created_by, updated_by, created_at, updated_at
		FROM lex_approval_policy_templates
		WHERE tenant_id = $1 AND id = $2`
	return scanApprovalPolicyTemplate(r.db.QueryRow(ctx, query, tenantID, id))
}

// ListApprovalPolicyTemplates returns all templates for a tenant ordered by
// category then name.
func (r *ApprovalPolicyGovernanceRepository) ListApprovalPolicyTemplates(ctx context.Context, tenantID uuid.UUID) ([]model.ApprovalPolicyTemplate, error) {
	query := `
		SELECT id, tenant_id, name, description, category, definition, created_by, updated_by, created_at, updated_at
		FROM lex_approval_policy_templates
		WHERE tenant_id = $1
		ORDER BY category ASC, name ASC`
	rows, err := r.db.Query(ctx, query, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list approval policy templates: %w", err)
	}
	defer rows.Close()
	out := make([]model.ApprovalPolicyTemplate, 0)
	for rows.Next() {
		t, err := scanApprovalPolicyTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *t)
	}
	return out, rows.Err()
}

func scanApprovalPolicyTemplate(row pgx.Row) (*model.ApprovalPolicyTemplate, error) {
	var t model.ApprovalPolicyTemplate
	var definitionJSON []byte
	if err := row.Scan(
		&t.ID, &t.TenantID, &t.Name, &t.Description, &t.Category, &definitionJSON, &t.CreatedBy, &t.UpdatedBy, &t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return nil, err
	}
	t.Definition = map[string]any{}
	if len(definitionJSON) > 0 {
		if err := json.Unmarshal(definitionJSON, &t.Definition); err != nil {
			return nil, fmt.Errorf("decode approval policy template definition: %w", err)
		}
	}
	return &t, nil
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

// FindConflictingApprovalPolicies returns active, non-deleted policies whose
// scope overlaps the candidate's: same-or-any contract_type, overlapping
// [min_value, max_value] range, same-or-any department, and an overlapping
// effective window. A NULL on either side of a dimension is treated as "any"
// and therefore always overlaps on that dimension. The candidate's ExcludeID
// (if set) is omitted so a policy never conflicts with itself.
//
// Range overlap is the standard a.min <= b.max && b.min <= a.max with NULLs as
// open ends. Effective-window overlap is the same test on
// [valid_from, valid_until].
func (r *ApprovalPolicyGovernanceRepository) FindConflictingApprovalPolicies(ctx context.Context, tenantID uuid.UUID, candidate ApprovalPolicyConflictCandidate) ([]model.ApprovalPolicy, error) {
	var excludeID uuid.UUID
	if candidate.ExcludeID != nil {
		excludeID = *candidate.ExcludeID
	}
	query := `
		SELECT id, tenant_id, name, description, status, priority, contract_type, department,
		       min_value, max_value, currency, mode, quorum, quorum_n, approvers, form_fields,
		       require_authority_evidence, required_role, required_authority_amount, metadata,
		       created_by, updated_by, created_at, updated_at,
		       version, valid_from, valid_until, template_id
		FROM lex_approval_policies
		WHERE tenant_id = $1
		  AND deleted_at IS NULL
		  AND status = 'active'
		  AND ($2 = '00000000-0000-0000-0000-000000000000'::uuid OR id <> $2)
		  -- contract_type overlap (NULL = any on either side)
		  AND (contract_type IS NULL OR $3::text IS NULL OR contract_type = $3)
		  -- department overlap (NULL = any on either side)
		  AND (department IS NULL OR $4::text IS NULL OR department = $4)
		  -- value-range overlap: existing.min <= candidate.max AND candidate.min <= existing.max
		  AND (min_value IS NULL OR $6::numeric IS NULL OR min_value <= $6)
		  AND ($5::numeric IS NULL OR max_value IS NULL OR $5 <= max_value)
		  -- effective-window overlap: existing.from <= candidate.until AND candidate.from <= existing.until
		  AND (valid_from IS NULL OR $8::timestamptz IS NULL OR valid_from <= $8)
		  AND ($7::timestamptz IS NULL OR valid_until IS NULL OR $7 <= valid_until)
		ORDER BY priority DESC, updated_at DESC`
	rows, err := r.db.Query(ctx, query,
		tenantID,
		excludeID,
		candidate.ContractType,
		candidate.Department,
		candidate.MinValue,
		candidate.MaxValue,
		candidate.ValidFrom,
		candidate.ValidUntil,
	)
	if err != nil {
		return nil, fmt.Errorf("find conflicting approval policies: %w", err)
	}
	defer rows.Close()
	out := make([]model.ApprovalPolicy, 0)
	for rows.Next() {
		p, err := scanApprovalPolicyGov(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *p)
	}
	return out, rows.Err()
}

// scanApprovalPolicyGov scans a full approval-policy row including the
// governance columns. It mirrors the service-layer scanApprovalPolicy so the
// repository can read policies without importing the service package.
func scanApprovalPolicyGov(row pgx.Row) (*model.ApprovalPolicy, error) {
	var item model.ApprovalPolicy
	var status string
	var approversJSON, formFieldsJSON, metadataJSON []byte
	if err := row.Scan(
		&item.ID, &item.TenantID, &item.Name, &item.Description, &status, &item.Priority, &item.ContractType, &item.Department,
		&item.MinValue, &item.MaxValue, &item.Currency, &item.Mode, &item.Quorum, &item.QuorumN, &approversJSON, &formFieldsJSON,
		&item.RequireAuthorityEvidence, &item.RequiredRole, &item.RequiredAuthorityAmount, &metadataJSON,
		&item.CreatedBy, &item.UpdatedBy, &item.CreatedAt, &item.UpdatedAt,
		&item.Version, &item.ValidFrom, &item.ValidUntil, &item.TemplateID,
	); err != nil {
		return nil, err
	}
	item.Status = model.ApprovalPolicyStatus(status)
	if len(approversJSON) > 0 {
		if err := json.Unmarshal(approversJSON, &item.Approvers); err != nil {
			return nil, fmt.Errorf("decode approval policy approvers: %w", err)
		}
	}
	if len(formFieldsJSON) > 0 {
		if err := json.Unmarshal(formFieldsJSON, &item.FormFields); err != nil {
			return nil, fmt.Errorf("decode approval policy form fields: %w", err)
		}
	}
	item.Metadata = map[string]any{}
	if len(metadataJSON) > 0 {
		if err := json.Unmarshal(metadataJSON, &item.Metadata); err != nil {
			return nil, fmt.Errorf("decode approval policy metadata: %w", err)
		}
	}
	if item.Approvers == nil {
		item.Approvers = []model.ApprovalPolicyApprover{}
	}
	if item.FormFields == nil {
		item.FormFields = []model.ApprovalPolicyFormField{}
	}
	return &item, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func marshalNullableJSON(v any) ([]byte, error) {
	if v == nil {
		return nil, nil
	}
	return json.Marshal(v)
}

func marshalDefinition(def map[string]any) ([]byte, error) {
	if def == nil {
		def = map[string]any{}
	}
	return json.Marshal(def)
}
