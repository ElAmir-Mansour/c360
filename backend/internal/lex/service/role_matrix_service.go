package service

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// RoleMatrixService implements the tenant Role-Matrix Import
// (Lex_Role_Matrix_Import_Design.md §6–§8): template export, dry-run
// validation with diff preview, draft-version commit, four-eyes activation and
// rollback. It runs against the platform_core pool (the roles table's home,
// like LegalAffairsRoleSeeder) with STRICT tenant scoping on every query.
type RoleMatrixService struct {
	pool   *pgxpool.Pool
	logger zerolog.Logger
}

func NewRoleMatrixService(pool *pgxpool.Pool, logger zerolog.Logger) *RoleMatrixService {
	return &RoleMatrixService{pool: pool, logger: logger}
}

// NewRoleMatrixOverlayLoader is the enforcement bridge (design §3, Option A):
// it loads EVERY role row written by an activated import (source='import'):
//   - ACTIVE rows carry their grants plus the same baseline fold-ins the code
//     map applies, so imported matrices keep exact baseline semantics;
//   - INACTIVE rows load as explicit TOMBSTONES (empty grant set) so a role the
//     tenant deactivated truly grants nothing instead of silently falling back
//     to the code-map default (revocation must revoke).
//
// Reserved platform slugs are skipped defensively (the validator already
// rejects them at import time) so an overlay can never rewrite platform
// authority outside the legal matrix.
func NewRoleMatrixOverlayLoader(pool *pgxpool.Pool) auth.TenantOverlayLoader {
	return func(ctx context.Context, tenantID string) (map[string][]string, error) {
		tid, err := uuid.Parse(tenantID)
		if err != nil {
			return nil, nil // non-UUID tenant contexts can never have an overlay
		}
		rows, err := pool.Query(ctx, `
SELECT slug, permissions, active
FROM roles
WHERE tenant_id = $1 AND source = 'import' AND matrix_version IS NOT NULL`, tid)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		out := make(map[string][]string)
		for rows.Next() {
			var slug string
			var permsJSON []byte
			var active bool
			if err := rows.Scan(&slug, &permsJSON, &active); err != nil {
				return nil, err
			}
			if auth.IsReservedRoleSlug(slug) {
				continue
			}
			key := strings.ReplaceAll(slug, "-", "_")
			if !active {
				out[key] = []string{} // tombstone: deactivated ⇒ grants nothing
				continue
			}
			var perms []string
			if err := json.Unmarshal(permsJSON, &perms); err != nil {
				return nil, err
			}
			out[key] = auth.ApplyLegalRoleBaselines(slug, perms)
		}
		return out, rows.Err()
	}
}

/* ------------------------------------------------------------------------- *
 * Current state
 * ------------------------------------------------------------------------- */

// loadCurrent composes the tenant's per-slug current state, SCOPED TO THE
// LEGAL MATRIX: the 14 baseline slugs plus roles written by a prior import.
// Platform roles (super-admin, tenant-admin, viewer, …) are deliberately
// excluded — the matrix must never read, template, or rewrite them. Activated-
// import rows are ENFORCED; seeded baseline rows contribute richer display
// metadata while the CODE MAP stays the grant source; the code-map defs fill
// any baseline slug with no DB row.
func (s *RoleMatrixService) loadCurrent(ctx context.Context, tenantID uuid.UUID) (map[string]roleMatrixCurrentRole, error) {
	current := make(map[string]roleMatrixCurrentRole)
	for slug, snap := range legalBaselineDefs() {
		current[slug] = roleMatrixCurrentRole{Snapshot: snap, Enforced: true}
	}

	rows, err := s.pool.Query(ctx, `
SELECT slug, name, description, is_system_role, permissions, metadata, source, active, matrix_version
FROM roles
WHERE tenant_id = $1 AND (source = 'import' OR slug = ANY($2))`, tenantID, legalBaselineSlugs())
	if err != nil {
		return nil, fmt.Errorf("load tenant roles: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			slug, name, description, source string
			isSystem, active                bool
			permsJSON, metaJSON             []byte
			matrixVersion                   *int
		)
		if err := rows.Scan(&slug, &name, &description, &isSystem, &permsJSON, &metaJSON, &source, &active, &matrixVersion); err != nil {
			return nil, fmt.Errorf("scan tenant role: %w", err)
		}
		// Defence in depth: never surface a reserved platform slug through the
		// matrix pipeline, even if a legacy row carries import provenance.
		if auth.IsReservedRoleSlug(slug) {
			continue
		}
		var perms []string
		_ = json.Unmarshal(permsJSON, &perms)
		sort.Strings(perms)
		var meta struct {
			Tier            string `json:"tier"`
			ReportsTo       string `json:"reports_to"`
			OrgUnit         string `json:"org_unit"`
			EscalationLevel int    `json:"escalation_level"`
			NameAR          string `json:"name_ar"`
			Code            string `json:"code"`
		}
		_ = json.Unmarshal(metaJSON, &meta)

		snap := model.RoleMatrixRoleSnapshot{
			Slug:            slug,
			Code:            meta.Code,
			NameEN:          name,
			NameAR:          meta.NameAR,
			Description:     description,
			Tier:            meta.Tier,
			OrgUnit:         meta.OrgUnit,
			ReportsTo:       meta.ReportsTo,
			EscalationLevel: meta.EscalationLevel,
			IsSystem:        isSystem,
			Active:          active,
			Permissions:     perms,
		}
		enforced := source == "import" && active && matrixVersion != nil
		if base, ok := current[slug]; ok && !enforced {
			// Seeded/manual row for a baseline slug: the CODE MAP stays the
			// enforced grant source; keep the def permissions but adopt any
			// richer DB metadata for display.
			base.Snapshot.NameEN = firstNonEmpty(name, base.Snapshot.NameEN)
			base.Snapshot.NameAR = firstNonEmpty(meta.NameAR, base.Snapshot.NameAR)
			base.Snapshot.Description = firstNonEmpty(description, base.Snapshot.Description)
			base.Snapshot.Tier = firstNonEmpty(meta.Tier, base.Snapshot.Tier)
			base.Snapshot.OrgUnit = firstNonEmpty(meta.OrgUnit, base.Snapshot.OrgUnit)
			base.Snapshot.ReportsTo = firstNonEmpty(meta.ReportsTo, base.Snapshot.ReportsTo)
			current[slug] = base
			continue
		}
		current[slug] = roleMatrixCurrentRole{Snapshot: snap, Enforced: enforced}
	}
	return current, rows.Err()
}

/* ------------------------------------------------------------------------- *
 * Template
 * ------------------------------------------------------------------------- */

// roleMatrixDomainOrder keeps the grants grid in the same authoritative order
// as the access-control matrix documentation.
var roleMatrixDomainOrder = []string{
	"request", "case", "investigation", "settlement", "contract", "consultation",
	"document", "report", "workforce", "notification", "sla", "escalation", "catalog",
	"role", "audit", "integration", "security",
}

// RoleMatrixTemplate is the exportable grants grid: one header row of role
// slugs and one row per importable permission with X marks for the tenant's
// CURRENT matrix (prefilled=true) or blanks (prefilled=false).
type RoleMatrixTemplate struct {
	Headers []string   `json:"headers"`
	Rows    [][]string `json:"rows"`
	// Slugs are the role columns in order (headers minus the two label columns).
	Slugs []string `json:"slugs"`
}

func (s *RoleMatrixService) Template(ctx context.Context, tenantID uuid.UUID, prefilled bool) (*RoleMatrixTemplate, error) {
	current, err := s.loadCurrent(ctx, tenantID)
	if err != nil {
		return nil, internalError("load current role matrix", err)
	}

	// Column order: baseline defs first, then customs alphabetically; parked
	// (inactive) roles are excluded from the grid.
	slugs := make([]string, 0, len(current))
	seen := make(map[string]struct{})
	for _, def := range auth.LegalAffairsRoleDefs {
		if cur, ok := current[def.Slug]; ok && cur.Snapshot.Active {
			slugs = append(slugs, def.Slug)
			seen[def.Slug] = struct{}{}
		}
	}
	rest := make([]string, 0)
	for slug, cur := range current {
		if _, ok := seen[slug]; ok || !cur.Snapshot.Active {
			continue
		}
		rest = append(rest, slug)
	}
	sort.Strings(rest)
	slugs = append(slugs, rest...)

	granted := make(map[string]map[string]struct{}, len(slugs))
	for _, slug := range slugs {
		set := make(map[string]struct{})
		for _, perm := range current[slug].Snapshot.Permissions {
			set[perm] = struct{}{}
		}
		granted[slug] = set
	}

	headers := append([]string{"domain", "permission"}, slugs...)
	catalog := auth.LexDomainVerbCatalog()
	rows := make([][]string, 0, 64)
	appendRow := func(domain, perm string) {
		row := make([]string, 0, len(headers))
		row = append(row, domain, perm)
		for _, slug := range slugs {
			mark := ""
			if prefilled {
				if _, ok := granted[slug][perm]; ok {
					mark = "X"
				}
			}
			row = append(row, mark)
		}
		rows = append(rows, row)
	}
	importable := make(map[string]struct{})
	for _, key := range auth.LexMatrixImportableKeys() {
		importable[key] = struct{}{}
	}
	for _, domain := range roleMatrixDomainOrder {
		for _, verb := range catalog[domain] {
			key := "lex:" + domain + ":" + verb
			if _, ok := importable[key]; ok {
				appendRow(domain, key)
			}
		}
	}
	// Coarse / cross-cutting block, in catalog order.
	for _, key := range auth.LexMatrixImportableKeys() {
		parts := strings.Split(key, ":")
		if len(parts) == 3 && parts[0] == "lex" {
			if _, isDomain := catalog[parts[1]]; isDomain {
				continue // already emitted in the domain block
			}
		}
		appendRow("coarse", key)
	}

	return &RoleMatrixTemplate{Headers: headers, Rows: rows, Slugs: slugs}, nil
}

/* ------------------------------------------------------------------------- *
 * Import (dry-run + commit)
 * ------------------------------------------------------------------------- */

// Import validates (dry-run) or commits a draft role-matrix version.
// importerRoles is the caller's assigned role slugs (from their JWT), used ONLY
// by the §7.4 self-escalation guard — pass nil to disable it (dry-run/internal
// callers with no actor context).
func (s *RoleMatrixService) Import(ctx context.Context, tenantID, userID uuid.UUID, importerRoles []string, req dto.RoleMatrixImportRequest) (*model.RoleMatrixImportJob, error) {
	req.Normalize()
	current, err := s.loadCurrent(ctx, tenantID)
	if err != nil {
		return nil, internalError("load current role matrix", err)
	}

	importer := roleMatrixImporter{}
	if len(importerRoles) > 0 {
		held := make(map[string]bool, len(importerRoles))
		for _, role := range importerRoles {
			held[normalizePersonaSlug(role)] = true
		}
		heldRoles := append([]string(nil), importerRoles...)
		importer.HeldSlugs = held
		// Effective, tenant-aware check against the PRE-import overlay: "a
		// permission the importer already holds today".
		importer.Has = func(perm string) bool {
			return auth.HasPermissionForTenant(ctx, tenantID.String(), heldRoles, perm)
		}
	}
	plan := planRoleMatrixImport(req, current, importer)

	job := &model.RoleMatrixImportJob{
		ID: uuid.New(), TenantID: tenantID, Mode: req.Mode, DryRun: req.DryRun,
		SourceFilename: req.SourceFilename,
		RoleCount:      plan.RoleCount, GrantCount: plan.GrantCount,
		ErrorCount: len(plan.Errors), WarningCount: len(plan.Warnings),
		Errors: plan.Errors, Warnings: plan.Warnings, Diff: plan.Diff,
		CreatedBy: userID,
	}

	switch {
	case len(plan.Errors) > 0:
		job.Status = model.RoleMatrixImportFailed
	case req.DryRun:
		job.Status = model.RoleMatrixImportValidated
	case len(plan.Warnings) > 0 && !req.ConfirmWarnings:
		job.Status = model.RoleMatrixImportFailed
		job.Errors = append(job.Errors, model.RoleMatrixIssue{
			Field: "confirm_warnings", CodeKey: "warnings_unconfirmed",
			Message: "the matrix raised warnings; re-submit with confirm_warnings=true to commit",
		})
		job.ErrorCount = len(job.Errors)
	default:
		job.Status = model.RoleMatrixImportCommitted
	}

	// Commit path: create the draft version inside the same transaction as the
	// job row so a failed insert never records a phantom commit.
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError("start role-matrix import transaction", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Per-tenant advisory lock: concurrent commits would otherwise race on
	// MAX(version)+1 and surface as raw unique-violation 500s.
	if err := acquireRoleMatrixLock(ctx, tx, tenantID); err != nil {
		return nil, internalError("acquire role-matrix lock", err)
	}

	if job.Status == model.RoleMatrixImportCommitted {
		// Only the newest draft is activatable in practice: supersede any prior
		// unactivated drafts so they cannot accumulate (nor be activated stale).
		if _, err := tx.Exec(ctx, `
UPDATE legal_role_matrix_versions SET status = 'superseded'
WHERE tenant_id = $1 AND status = 'draft'`, tenantID); err != nil {
			return nil, internalError("supersede prior draft versions", err)
		}
		version, err := s.createVersionTx(ctx, tx, tenantID, userID, req, plan)
		if err != nil {
			return nil, err
		}
		job.VersionID = &version.ID
	}
	if err := s.insertJobTx(ctx, tx, job); err != nil {
		return nil, err
	}
	// Retention: keep the newest 200 job rows per tenant (append-only log with
	// a bound so a scripted client cannot grow it without limit).
	if _, err := tx.Exec(ctx, `
DELETE FROM legal_role_matrix_imports
WHERE tenant_id = $1 AND id NOT IN (
    SELECT id FROM legal_role_matrix_imports
    WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 200
)`, tenantID); err != nil {
		return nil, internalError("prune role-matrix import log", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit role-matrix import", err)
	}
	return job, nil
}

// acquireRoleMatrixLock serializes matrix writes per tenant for the duration of
// the transaction (advisory xact lock — released automatically on commit/rollback).
func acquireRoleMatrixLock(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('lex_role_matrix'), hashtext($1::text))`, tenantID)
	return err
}

func (s *RoleMatrixService) createVersionTx(ctx context.Context, tx pgx.Tx, tenantID, userID uuid.UUID, req dto.RoleMatrixImportRequest, plan roleMatrixPlan) (*model.RoleMatrixVersion, error) {
	snapshotJSON, err := json.Marshal(plan.Snapshot)
	if err != nil {
		return nil, internalError("marshal role-matrix snapshot", err)
	}
	version := &model.RoleMatrixVersion{
		ID: uuid.New(), TenantID: tenantID,
		Status:         model.RoleMatrixVersionDraft,
		SourceFilename: req.SourceFilename,
		Checksum:       roleMatrixChecksum(plan.Snapshot),
		ChangeReason:   req.ChangeReason,
		Snapshot:       plan.Snapshot,
		CreatedBy:      userID,
	}
	err = tx.QueryRow(ctx, `
INSERT INTO legal_role_matrix_versions
    (id, tenant_id, version, status, source_filename, checksum, change_reason, snapshot, created_by)
VALUES ($1, $2,
        (SELECT COALESCE(MAX(version), 0) + 1 FROM legal_role_matrix_versions WHERE tenant_id = $2),
        $3, $4, $5, $6, $7, $8)
RETURNING version, created_at`,
		version.ID, tenantID, version.Status, version.SourceFilename,
		version.Checksum, version.ChangeReason, snapshotJSON, userID,
	).Scan(&version.Version, &version.CreatedAt)
	if err != nil {
		return nil, internalError("create role-matrix version", err)
	}
	return version, nil
}

func (s *RoleMatrixService) insertJobTx(ctx context.Context, tx pgx.Tx, job *model.RoleMatrixImportJob) error {
	errorsJSON, _ := json.Marshal(orEmptyIssues(job.Errors))
	warningsJSON, _ := json.Marshal(orEmptyIssues(job.Warnings))
	diffJSON, _ := json.Marshal(job.Diff)
	err := tx.QueryRow(ctx, `
INSERT INTO legal_role_matrix_imports
    (id, tenant_id, version_id, mode, dry_run, status, source_filename,
     role_count, grant_count, error_count, warning_count, errors, warnings, diff, created_by)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
RETURNING created_at`,
		job.ID, job.TenantID, job.VersionID, job.Mode, job.DryRun, job.Status, job.SourceFilename,
		job.RoleCount, job.GrantCount, job.ErrorCount, job.WarningCount,
		errorsJSON, warningsJSON, diffJSON, job.CreatedBy,
	).Scan(&job.CreatedAt)
	if err != nil {
		return internalError("record role-matrix import", err)
	}
	return nil
}

func orEmptyIssues(issues []model.RoleMatrixIssue) []model.RoleMatrixIssue {
	if issues == nil {
		return []model.RoleMatrixIssue{}
	}
	return issues
}

/* ------------------------------------------------------------------------- *
 * Jobs + versions
 * ------------------------------------------------------------------------- */

func (s *RoleMatrixService) ListImports(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.RoleMatrixImportJob, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, tenant_id, version_id, mode, dry_run, status, source_filename,
       role_count, grant_count, error_count, warning_count, errors, warnings, diff, created_by, created_at
FROM legal_role_matrix_imports
WHERE tenant_id = $1
ORDER BY created_at DESC
LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, internalError("list role-matrix imports", err)
	}
	defer rows.Close()
	jobs := make([]model.RoleMatrixImportJob, 0, limit)
	for rows.Next() {
		job, err := scanRoleMatrixJob(rows)
		if err != nil {
			return nil, internalError("scan role-matrix import", err)
		}
		jobs = append(jobs, *job)
	}
	return jobs, rows.Err()
}

func (s *RoleMatrixService) GetImport(ctx context.Context, tenantID, id uuid.UUID) (*model.RoleMatrixImportJob, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, tenant_id, version_id, mode, dry_run, status, source_filename,
       role_count, grant_count, error_count, warning_count, errors, warnings, diff, created_by, created_at
FROM legal_role_matrix_imports
WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	job, err := scanRoleMatrixJob(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("role-matrix import not found")
		}
		return nil, internalError("get role-matrix import", err)
	}
	return job, nil
}

type pgxRowScanner interface{ Scan(dest ...any) error }

func scanRoleMatrixJob(row pgxRowScanner) (*model.RoleMatrixImportJob, error) {
	var job model.RoleMatrixImportJob
	var errorsJSON, warningsJSON, diffJSON []byte
	if err := row.Scan(&job.ID, &job.TenantID, &job.VersionID, &job.Mode, &job.DryRun, &job.Status,
		&job.SourceFilename, &job.RoleCount, &job.GrantCount, &job.ErrorCount, &job.WarningCount,
		&errorsJSON, &warningsJSON, &diffJSON, &job.CreatedBy, &job.CreatedAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal(errorsJSON, &job.Errors)
	_ = json.Unmarshal(warningsJSON, &job.Warnings)
	_ = json.Unmarshal(diffJSON, &job.Diff)
	return &job, nil
}

func (s *RoleMatrixService) ListVersions(ctx context.Context, tenantID uuid.UUID, limit int) ([]model.RoleMatrixVersion, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	rows, err := s.pool.Query(ctx, `
SELECT id, tenant_id, version, status, source_filename, checksum, change_reason, snapshot,
       created_by, created_at, activated_by, activated_at
FROM legal_role_matrix_versions
WHERE tenant_id = $1
ORDER BY version DESC
LIMIT $2`, tenantID, limit)
	if err != nil {
		return nil, internalError("list role-matrix versions", err)
	}
	defer rows.Close()
	versions := make([]model.RoleMatrixVersion, 0, limit)
	for rows.Next() {
		v, err := scanRoleMatrixVersion(rows)
		if err != nil {
			return nil, internalError("scan role-matrix version", err)
		}
		versions = append(versions, *v)
	}
	return versions, rows.Err()
}

func (s *RoleMatrixService) GetVersion(ctx context.Context, tenantID, id uuid.UUID) (*model.RoleMatrixVersion, error) {
	row := s.pool.QueryRow(ctx, `
SELECT id, tenant_id, version, status, source_filename, checksum, change_reason, snapshot,
       created_by, created_at, activated_by, activated_at
FROM legal_role_matrix_versions
WHERE tenant_id = $1 AND id = $2`, tenantID, id)
	v, err := scanRoleMatrixVersion(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("role-matrix version not found")
		}
		return nil, internalError("get role-matrix version", err)
	}
	return v, nil
}

func scanRoleMatrixVersion(row pgxRowScanner) (*model.RoleMatrixVersion, error) {
	var v model.RoleMatrixVersion
	var snapshotJSON []byte
	if err := row.Scan(&v.ID, &v.TenantID, &v.Version, &v.Status, &v.SourceFilename, &v.Checksum,
		&v.ChangeReason, &snapshotJSON, &v.CreatedBy, &v.CreatedAt, &v.ActivatedBy, &v.ActivatedAt); err != nil {
		return nil, err
	}
	_ = json.Unmarshal(snapshotJSON, &v.Snapshot)
	return &v, nil
}

/* ------------------------------------------------------------------------- *
 * Activation (four-eyes) + rollback (re-activation of a prior version)
 * ------------------------------------------------------------------------- */

// Activate applies a version's snapshot to platform_core.roles and makes it the
// tenant's single ACTIVE matrix. The route additionally wraps this in
// RequireDistinctActor; the service re-asserts importer ≠ activator as defence
// in depth. On success the tenant's overlay cache is invalidated so the new
// matrix is enforced immediately in this process (other replicas converge
// within the overlay TTL).
func (s *RoleMatrixService) Activate(ctx context.Context, tenantID, activatorID, versionID uuid.UUID) (*model.RoleMatrixVersion, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, internalError("start role-matrix activation", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := acquireRoleMatrixLock(ctx, tx, tenantID); err != nil {
		return nil, internalError("acquire role-matrix lock", err)
	}

	row := tx.QueryRow(ctx, `
SELECT id, tenant_id, version, status, source_filename, checksum, change_reason, snapshot,
       created_by, created_at, activated_by, activated_at
FROM legal_role_matrix_versions
WHERE tenant_id = $1 AND id = $2
FOR UPDATE`, tenantID, versionID)
	version, err := scanRoleMatrixVersion(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("role-matrix version not found")
		}
		return nil, internalError("load role-matrix version", err)
	}
	if version.Status == model.RoleMatrixVersionActive {
		return nil, validationError("this version is already active", map[string]string{"status": "already_active"})
	}
	// Defence in depth behind RequireDistinctActor: the author of the version
	// may never activate it (four-eyes), even if the route guard is mis-wired.
	if version.CreatedBy == activatorID {
		return nil, forbiddenError("separation of duties: the importer cannot activate their own version")
	}
	if len(version.Snapshot) == 0 {
		return nil, validationError("version snapshot is empty", map[string]string{"snapshot": "empty"})
	}

	// Supersede whatever is active now.
	if _, err := tx.Exec(ctx, `
UPDATE legal_role_matrix_versions
SET status = 'superseded'
WHERE tenant_id = $1 AND status = 'active'`, tenantID); err != nil {
		return nil, internalError("supersede active role-matrix version", err)
	}

	// Apply the snapshot: every role becomes an import-provenance row. Metadata
	// mirrors the seeder's shape so the role UI keeps rendering tier/org data.
	const upsert = `
INSERT INTO roles (id, tenant_id, name, slug, description, is_system_role, permissions, metadata,
                   source, active, matrix_version)
VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'import', $8, $9)
ON CONFLICT (tenant_id, slug) DO UPDATE SET
    name           = EXCLUDED.name,
    description    = EXCLUDED.description,
    permissions    = EXCLUDED.permissions,
    metadata       = EXCLUDED.metadata,
    source         = 'import',
    active         = EXCLUDED.active,
    matrix_version = EXCLUDED.matrix_version,
    updated_at     = NOW()`
	for _, snap := range version.Snapshot {
		permsJSON, err := json.Marshal(snap.Permissions)
		if err != nil {
			return nil, internalError("marshal role permissions", err)
		}
		metaJSON, err := json.Marshal(map[string]any{
			"source":           "legal-role-matrix-import",
			"tier":             snap.Tier,
			"reports_to":       snap.ReportsTo,
			"org_unit":         snap.OrgUnit,
			"escalation_level": snap.EscalationLevel,
			"name_ar":          snap.NameAR,
			"code":             snap.Code,
		})
		if err != nil {
			return nil, internalError("marshal role metadata", err)
		}
		name := snap.NameEN
		if name == "" {
			name = snap.Slug
		}
		if _, err := tx.Exec(ctx, upsert,
			tenantID, name, snap.Slug, snap.Description, snap.IsSystem, permsJSON, metaJSON,
			snap.Active, version.Version,
		); err != nil {
			return nil, internalError(fmt.Sprintf("apply role %q", snap.Slug), err)
		}
	}

	// Reconcile phantoms: any import-provenance role NOT in the snapshot being
	// applied (e.g. a custom role introduced by a LATER version during a
	// rollback) is deactivated, so its enforcement tombstone strips it —
	// activation always converges the tenant onto EXACTLY the snapshot.
	snapshotSlugs := make([]string, 0, len(version.Snapshot))
	for _, snap := range version.Snapshot {
		snapshotSlugs = append(snapshotSlugs, snap.Slug)
	}
	if _, err := tx.Exec(ctx, `
UPDATE roles SET active = false, matrix_version = $3, updated_at = NOW()
WHERE tenant_id = $1 AND source = 'import' AND active = true AND NOT (slug = ANY($2))`,
		tenantID, snapshotSlugs, version.Version); err != nil {
		return nil, internalError("reconcile phantom imported roles", err)
	}

	if err := tx.QueryRow(ctx, `
UPDATE legal_role_matrix_versions
SET status = 'active', activated_by = $3, activated_at = NOW()
WHERE tenant_id = $1 AND id = $2
RETURNING activated_at`, tenantID, versionID, activatorID).Scan(&version.ActivatedAt); err != nil {
		return nil, internalError("mark role-matrix version active", err)
	}
	version.Status = model.RoleMatrixVersionActive
	version.ActivatedBy = &activatorID

	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit role-matrix activation", err)
	}

	// Enforcement flips NOW in this process; replicas converge within the TTL.
	auth.InvalidateTenantOverlay(tenantID.String())

	s.logger.Info().
		Str("tenant_id", tenantID.String()).
		Int("version", version.Version).
		Str("activated_by", activatorID.String()).
		Int("roles", len(version.Snapshot)).
		Msg("role-matrix version activated; tenant permission overlay invalidated")
	return version, nil
}

// VersionActorRecord resolves a version's author for the distinct-actor guard.
func (s *RoleMatrixService) VersionActorRecord(ctx context.Context, tenantID, versionID uuid.UUID) (createdBy uuid.UUID, found bool, err error) {
	err = s.pool.QueryRow(ctx, `
SELECT created_by FROM legal_role_matrix_versions WHERE tenant_id = $1 AND id = $2`,
		tenantID, versionID).Scan(&createdBy)
	if err == pgx.ErrNoRows {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, err
	}
	return createdBy, true, nil
}
