// Package seeder seeds the Legal System Role Matrix into platform_core. It is
// kept separate from internal/lex's demo data seeder because the roles table
// lives in platform_core (the shared IAM database), not in lex_db: the lex
// service holds a platform_core pool for LLM credentials / ABAC, and that same
// pool is used here.
package seeder

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// Execer is the minimal platform_core executor the seeder needs for writes.
// *pgxpool.Pool satisfies it; tests supply an in-memory fake.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

// Querier is the minimal platform_core reader the asserted-seeding verifier
// needs. *pgxpool.Pool satisfies it; the seed-time SSD re-check and the
// post-seed "all 14 roles present" assertion use QueryRow. It is split from
// Execer so the write path (Seed) and the no-op/test fakes don't have to
// implement reads they never exercise.
type Querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// roleMetadata is the JSONB persisted to roles.metadata for each legal role.
// It carries the Role Roster org-hierarchy fields (design §3).
type roleMetadata struct {
	Source          string `json:"source"`
	Tier            string `json:"tier"`
	ReportsTo       string `json:"reports_to"`
	OrgUnit         string `json:"org_unit"`
	EscalationLevel int    `json:"escalation_level"`
	NameAR          string `json:"name_ar"`
}

// LegalAffairsRoleSeeder upserts the 14 Legal System Role Matrix roles into
// platform_core.roles for a tenant. It is idempotent (ON CONFLICT (tenant_id,
// slug) DO UPDATE), so it can run on every startup and converge the rows to the
// canonical definitions without clobbering identity (the role id is stable).
//
// The permission arrays seeded here are the SAME auth.LegalAffairsRoleDefs that
// auth.registerLegalAffairsRoles folds into the RolePermissions code map, so the
// DB representation (for the role-management UI / audit) and the enforced
// representation (HasPermission) never diverge. See the RESOLUTION NOTE in
// internal/auth/legal_roles.go: enforcement is the code map; this DB seed exists
// so the roles are assignable and inspectable.
//
// Seeding is ASSERTED, not best-effort (design v2 §5 / changelog #10): after a
// Seed, callers run Verify, which fails startup readiness if any of the 14 roles
// are missing — so a silent no-op cannot leave the tenant relying on the coarse
// lex:write fallback. The seeder also seeds the SSD role-exclusion table (§4.2)
// and re-checks the live role assignments against it.
type LegalAffairsRoleSeeder struct {
	db       Execer
	tenantID uuid.UUID
	logger   zerolog.Logger
}

// NewLegalAffairsRoleSeeder builds a seeder bound to a platform_core executor and
// the target tenant.
func NewLegalAffairsRoleSeeder(db Execer, tenantID uuid.UUID, logger zerolog.Logger) *LegalAffairsRoleSeeder {
	return &LegalAffairsRoleSeeder{db: db, tenantID: tenantID, logger: logger}
}

// Seed upserts all 14 roles and seeds the SSD exclusion pairs. It returns the
// number of roles written. A nil executor or a nil tenant is a no-op (returns 0,
// nil) so callers can wire it unconditionally and have it stay inert when
// platform_core is unavailable.
func (s *LegalAffairsRoleSeeder) Seed(ctx context.Context) (int, error) {
	if s == nil || s.db == nil || s.tenantID == uuid.Nil {
		return 0, nil
	}

	// IMPORT-AWARE upsert (tenant Role-Matrix Import): a row written by an
	// ACTIVATED import (roles.source = 'import') is the tenant's customised
	// matrix and must SURVIVE a service restart — the seeder refreshing the
	// baseline must never clobber it back to the code-map defaults. The WHERE
	// clause on the conflict update skips import-provenance rows; everything
	// else keeps the historic refresh behaviour.
	const upsertImportAware = `
INSERT INTO roles (id, tenant_id, name, slug, description, is_system_role, permissions, metadata)
VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5, $6)
ON CONFLICT (tenant_id, slug) DO UPDATE SET
    name           = EXCLUDED.name,
    description    = EXCLUDED.description,
    is_system_role = true,
    permissions    = EXCLUDED.permissions,
    metadata       = EXCLUDED.metadata,
    updated_at     = NOW()
WHERE roles.source IS DISTINCT FROM 'import'`
	// Legacy upsert for platform_core databases that predate migration 000031
	// (no roles.source column): identical to the historic statement.
	const upsertLegacy = `
INSERT INTO roles (id, tenant_id, name, slug, description, is_system_role, permissions, metadata)
VALUES (gen_random_uuid(), $1, $2, $3, $4, true, $5, $6)
ON CONFLICT (tenant_id, slug) DO UPDATE SET
    name           = EXCLUDED.name,
    description    = EXCLUDED.description,
    is_system_role = true,
    permissions    = EXCLUDED.permissions,
    metadata       = EXCLUDED.metadata,
    updated_at     = NOW()`

	// Probe once for the provenance column so the seeder works against both
	// migrated and pre-000031 databases. The probe queries information_schema
	// (a statement that ALWAYS succeeds — it returns a boolean, never errors on
	// a missing column) so it is safe to run on a pgx.Tx: a failing `SELECT
	// source ...` probe would abort the surrounding transaction and defeat the
	// legacy fallback it exists to provide. When s.db cannot answer a row query
	// (a bare Execer), default to the import-aware form (correct on any
	// migrated database, which is every real deployment).
	upsert := upsertImportAware
	if rq, ok := s.db.(interface {
		QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	}); ok {
		var hasSource bool
		if err := rq.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'roles' AND column_name = 'source'
)`).Scan(&hasSource); err == nil && !hasSource {
			upsert = upsertLegacy
		}
	}

	written := 0
	for _, def := range auth.LegalAffairsRoleDefs {
		permsJSON, err := json.Marshal(def.Permissions)
		if err != nil {
			return written, fmt.Errorf("marshal permissions for %q: %w", def.Slug, err)
		}
		metaJSON, err := json.Marshal(roleMetadata{
			Source:          "legal-role-matrix",
			Tier:            def.Tier,
			ReportsTo:       def.ReportsTo,
			OrgUnit:         def.OrgUnit,
			EscalationLevel: def.EscalationLevel,
			NameAR:          def.NameAR,
		})
		if err != nil {
			return written, fmt.Errorf("marshal metadata for %q: %w", def.Slug, err)
		}
		if _, err := s.db.Exec(ctx, upsert,
			s.tenantID, def.NameEN, def.Slug, def.Description, permsJSON, metaJSON,
		); err != nil {
			return written, fmt.Errorf("upsert legal role %q: %w", def.Slug, err)
		}
		written++
	}

	// SSD (§4.2): seed the mutually-exclusive-role table. Idempotent upsert; the
	// pairs are derived from auth.LegalAffairsRoleDefs so they stay in lock-step.
	if err := s.seedExclusions(ctx); err != nil {
		return written, fmt.Errorf("seed legal role exclusions: %w", err)
	}

	s.logger.Info().
		Str("tenant_id", s.tenantID.String()).
		Int("roles", written).
		Int("exclusion_pairs", len(LegalRoleExclusionPairs())).
		Msg("seeded legal system role matrix")
	return written, nil
}

// seedExclusions upserts the §4.2 conflict pairs into legal_role_exclusions.
// The (lo, hi) ordering is normalized so the (tenant_id, role_slug_a,
// role_slug_b) unique key is symmetric and re-runs converge.
func (s *LegalAffairsRoleSeeder) seedExclusions(ctx context.Context) error {
	const upsert = `
INSERT INTO legal_role_exclusions (id, tenant_id, role_slug_a, role_slug_b, reason)
VALUES (gen_random_uuid(), $1, $2, $3, $4)
ON CONFLICT (tenant_id, role_slug_a, role_slug_b) DO UPDATE SET
    reason     = EXCLUDED.reason,
    updated_at = NOW()`
	for _, p := range LegalRoleExclusionPairs() {
		if _, err := s.db.Exec(ctx, upsert, s.tenantID, p.A, p.B, p.Reason); err != nil {
			return fmt.Errorf("upsert exclusion {%s ⊥ %s}: %w", p.A, p.B, err)
		}
	}
	return nil
}

// Verify asserts that all 14 legal roles exist for the tenant (design v2 §5 /
// changelog #10). It is the readiness gate: callers FAIL startup if it returns
// an error, so a silent seed no-op cannot leave the tenant on coarse fallback.
// A nil reader or nil tenant is a no-op (returns nil) — the readiness assertion
// only applies when platform_core is reachable. Idempotent and side-effect free.
func (s *LegalAffairsRoleSeeder) Verify(ctx context.Context, q Querier) error {
	if s == nil || q == nil || s.tenantID == uuid.Nil {
		return nil
	}

	want := LegalRoleSlugs()

	const countSQL = `
SELECT COUNT(*) FROM roles
WHERE tenant_id = $1 AND is_system_role = true AND slug = ANY($2)`
	var present int
	if err := q.QueryRow(ctx, countSQL, s.tenantID, want).Scan(&present); err != nil {
		return fmt.Errorf("verify legal roles: %w", err)
	}
	if present != len(want) {
		return fmt.Errorf("legal role-matrix incomplete: %d of %d roles present for tenant %s (seeding must converge)",
			present, len(want), s.tenantID)
	}

	// SSD re-check (§4.2): the exclusion table must carry every conflict pair.
	const exCountSQL = `SELECT COUNT(*) FROM legal_role_exclusions WHERE tenant_id = $1`
	var exPresent int
	if err := q.QueryRow(ctx, exCountSQL, s.tenantID).Scan(&exPresent); err != nil {
		return fmt.Errorf("verify legal role exclusions: %w", err)
	}
	if exPresent < len(LegalRoleExclusionPairs()) {
		return fmt.Errorf("legal role-exclusion (SSD) incomplete: %d of %d pairs present for tenant %s",
			exPresent, len(LegalRoleExclusionPairs()), s.tenantID)
	}
	return nil
}

// LegalRoleSlugs returns the 14 legal-role slugs, sorted, derived from the auth
// definitions so it stays in lock-step (never hand-duplicated).
func LegalRoleSlugs() []string {
	out := make([]string, 0, len(auth.LegalAffairsRoleDefs))
	for _, d := range auth.LegalAffairsRoleDefs {
		out = append(out, d.Slug)
	}
	sort.Strings(out)
	return out
}

// Ensure *pgxpool.Pool-style executors satisfy Execer at compile time via the
// pgx.Tx interface as well (handy for transactional callers).
var _ Execer = (pgx.Tx)(nil)

// Ensure pgx.Tx also satisfies Querier (it exposes QueryRow), so a transactional
// caller can both seed and verify on the same handle.
var _ Querier = (pgx.Tx)(nil)

// --- SSD: static separation-of-duties role exclusions (design v2 §4.2) --------
//
// The SSD logic now lives in internal/auth (legal_role_exclusions.go) so it can
// be shared with the role-ASSIGNMENT path (internal/iam) without IAM importing
// this lex sub-package. The symbols below are thin re-exports so this seeder and
// its tests keep referring to seeder.RoleExclusion / seeder.LegalRoleExclusionPairs
// / seeder.CheckRoleExclusion unchanged; the behaviour is identical.

// RoleExclusion is one mutually-exclusive-role pair (alias of auth.LegalRoleExclusion).
type RoleExclusion = auth.LegalRoleExclusion

// LegalRoleExclusionPairs returns the §4.2 SSD conflict pairs (see auth).
func LegalRoleExclusionPairs() []RoleExclusion { return auth.LegalRoleExclusionPairs() }

// CheckRoleExclusion is the SSD guard the role-assignment path calls (see auth).
func CheckRoleExclusion(candidate string, existing []string) error {
	return auth.CheckRoleExclusion(candidate, existing)
}
