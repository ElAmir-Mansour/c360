package seeder

// Demo legal-role ASSIGNMENTS (Lex_Codebase_RBAC_Map.md §16). Seeding the 14
// role DEFINITIONS (legal_roles.go) makes the personas assignable; this seeder
// makes the demo tenant actually EXERCISE them by binding the existing Apex demo
// users to specific legal personas, so the persona-aware login / landing /
// nav-filtering story works end-to-end in the demo.
//
// Scope boundary (§17.4): this is a UX-enablement seed, not a new security
// boundary. Backend authorization stays the authoritative code map
// (auth.RolePermissions, expanded from the same LegalAffairsRoleDefs). All this
// does is create platform_core.user_roles rows so a demo login resolves to a
// real legal persona.
//
// Safety:
//   - Idempotent: ON CONFLICT (user_id, role_id) DO NOTHING, and the role-id
//     lookup is keyed on the stable (tenant_id, slug). Re-running converges.
//   - SoD-safe: every candidate assignment is checked with auth.CheckRoleExclusion
//     against the user's already-held legal roles BEFORE the upsert; a forbidden
//     pair is refused (skipped + logged), never written.
//   - Non-fatal on a missing optional user: the user_roles.user_id FK to
//     platform_core.users means assigning to an absent demo user errors; that is
//     downgraded to a skip+warn so a lean demo DB (which may not have provisioned
//     every Apex user) still starts.

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// AssignExecQuerier is the platform_core handle the assignment seeder needs: it
// both reads (role-id lookup by slug, the user's existing legal roles) and
// writes (the user_roles upsert). *pgxpool.Pool and pgx.Tx satisfy it.
type AssignExecQuerier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Apex demo user ids (Lex_Codebase_RBAC_Map.md §16; the same ids the lex demo
// data seeder uses, and the same 7 users the platform system-seeder provisions
// into platform_core.users). Kept here, local to the assignment seeder, so the
// §16 mapping is readable in one place; the values mirror internal/lex/seed.go.
var (
	apexUserAda    = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000001") // Ada Okafor (admin@apexbank.demo)
	apexUserMusa   = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000002") // Musa Adebayo
	apexUserIfeoma = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000003") // Ifeoma Nwosu
	apexUserLara   = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000004") // Lara Bamidele
	apexUserTade   = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000005") // Tade Akinola
	apexUserChika  = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000006") // Chika Nwachukwu
	apexUserEmeka  = uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000007") // Emeka Daniels
)

// LegalRoleAssignment is one demo user -> legal-role binding (§16). Person is a
// human label for logs/readiness only; the binding is (UserID, RoleSlug).
type LegalRoleAssignment struct {
	UserID    uuid.UUID
	Person    string
	RoleSlug  string
	OrgEntity uuid.UUID // SoD scope; uuid.Nil = tenant-wide (matches user_roles, which is not org-scoped)
}

// DemoLegalRoleAssignments is the §16 mapping for the Watheeq demo tenant. Each
// demo user gets EXACTLY ONE legal persona, which is the SaaS persona model
// (§2.5 active-persona, not a union of roles) AND is what keeps every assignment
// trivially SoD-clean — a single legal role can never conflict with itself. The
// CheckRoleExclusion guard in Seed still runs as defence-in-depth.
//
// Personas covered by a real demo user (7 of 14):
//
//	legal-director           Ada    (..01, the admin@apexbank.demo login)
//	legal-cases-manager      Lara   (..04)
//	legal-auditor            Emeka  (..07)
//	legal-system-admin       Musa   (..02)
//	legal-advisor            Ifeoma (..03)
//	legal-contracts-manager  Tade   (..05)
//	legal-requester          Chika  (..06)
//
// The other 7 personas (legal-officer, legal-contracts-supervisor,
// legal-case-supervisor, legal-dept-manager, legal-bu-ceo, legal-ceo,
// legal-shared-services-manager) are intentionally NOT bound to a dedicated
// demo user here (kept lean per the task): they remain assignable via the role
// matrix and reachable via the future persona-preview switcher. Note also that
// pairing some of them with the seven above on ONE user would trip SoD — e.g.
// adding legal-officer to Lara (legal-cases-manager) is a forbidden pair — so a
// one-user-one-persona demo is both lean and SoD-correct.
var DemoLegalRoleAssignments = []LegalRoleAssignment{
	{UserID: apexUserAda, Person: "Ada Okafor", RoleSlug: "legal-director"},
	{UserID: apexUserLara, Person: "Lara Bamidele", RoleSlug: "legal-cases-manager"},
	{UserID: apexUserEmeka, Person: "Emeka Daniels", RoleSlug: "legal-auditor"},
	{UserID: apexUserMusa, Person: "Musa Adebayo", RoleSlug: "legal-system-admin"},
	{UserID: apexUserIfeoma, Person: "Ifeoma Nwosu", RoleSlug: "legal-advisor"},
	{UserID: apexUserTade, Person: "Tade Akinola", RoleSlug: "legal-contracts-manager"},
	{UserID: apexUserChika, Person: "Chika Nwachukwu", RoleSlug: "legal-requester"},
}

// AssignmentStatus is the outcome of one attempted assignment.
type AssignmentStatus string

const (
	AssignmentAssigned      AssignmentStatus = "assigned"        // upserted (or already present) — user holds the role
	AssignmentSkippedSoD    AssignmentStatus = "skipped_sod"     // refused: would create a forbidden SoD pair
	AssignmentSkippedNoUser AssignmentStatus = "skipped_no_user" // demo user not present in platform_core.users
	AssignmentSkippedNoRole AssignmentStatus = "skipped_no_role" // role slug not seeded for the tenant
)

// AppliedAssignment is one row of the seed report (returned by Seed and logged).
type AppliedAssignment struct {
	UserID   uuid.UUID
	Person   string
	RoleSlug string
	RoleID   uuid.UUID
	Status   AssignmentStatus
	Detail   string
}

// LegalAffairsAssignmentSeeder binds the §16 demo users to their legal personas
// in platform_core.user_roles. It MUST run AFTER LegalAffairsRoleSeeder (the 14
// role rows must exist so the slug->id lookup resolves).
type LegalAffairsAssignmentSeeder struct {
	db          AssignExecQuerier
	tenantID    uuid.UUID
	logger      zerolog.Logger
	assignments []LegalRoleAssignment
}

// NewLegalAffairsAssignmentSeeder builds an assignment seeder bound to a
// platform_core handle and the target tenant, using the canonical §16 mapping.
func NewLegalAffairsAssignmentSeeder(db AssignExecQuerier, tenantID uuid.UUID, logger zerolog.Logger) *LegalAffairsAssignmentSeeder {
	return &LegalAffairsAssignmentSeeder{
		db:          db,
		tenantID:    tenantID,
		logger:      logger,
		assignments: DemoLegalRoleAssignments,
	}
}

// withAssignments overrides the mapping (tests use this to drive SoD / idempotency
// scenarios without depending on the production §16 list).
func (s *LegalAffairsAssignmentSeeder) withAssignments(a []LegalRoleAssignment) *LegalAffairsAssignmentSeeder {
	s.assignments = a
	return s
}

// Seed applies the demo legal-role assignments idempotently and SoD-safely. A
// nil handle or nil tenant is a no-op (returns nil, nil) so callers can wire it
// unconditionally and have it stay inert when platform_core is unavailable.
//
// It is NOT fatal on a missing optional user or an unseeded role — those are
// reported as skips. The only hard error is an unexpected DB failure (so a
// caller may decide whether to treat it as fatal; per §16 readiness this is a
// best-effort demo enrichment, not a security gate, so the lex-service wiring
// logs rather than aborts).
func (s *LegalAffairsAssignmentSeeder) Seed(ctx context.Context) ([]AppliedAssignment, error) {
	if s == nil || s.db == nil || s.tenantID == uuid.Nil {
		return nil, nil
	}

	out := make([]AppliedAssignment, 0, len(s.assignments))
	for _, a := range s.assignments {
		applied := AppliedAssignment{UserID: a.UserID, Person: a.Person, RoleSlug: a.RoleSlug}

		// 1) Resolve the role id by (tenant, slug). A missing role means the
		//    role-matrix seeder did not run / did not converge; skip (not fatal)
		//    — the caller's role-matrix Verify is the readiness gate for that.
		roleID, err := s.lookupRoleID(ctx, a.RoleSlug)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				applied.Status = AssignmentSkippedNoRole
				applied.Detail = fmt.Sprintf("role %q not seeded for tenant", a.RoleSlug)
				out = append(out, applied)
				continue
			}
			return out, fmt.Errorf("lookup role id for %q: %w", a.RoleSlug, err)
		}
		applied.RoleID = roleID

		// 2) SoD guard (§4.2): never seed a forbidden pair. Gather the legal
		//    roles the user ALREADY holds for this tenant and run the same
		//    auth.CheckRoleExclusion the assignment path uses. (Each demo user
		//    gets one role, so in the canonical mapping `existing` is empty and
		//    this always passes — but the guard is authoritative, not the data.)
		existing, err := s.existingLegalRoles(ctx, a.UserID)
		if err != nil {
			return out, fmt.Errorf("load existing legal roles for %s: %w", a.UserID, err)
		}
		if exErr := auth.CheckRoleExclusion(a.RoleSlug, existing); exErr != nil {
			applied.Status = AssignmentSkippedSoD
			applied.Detail = exErr.Error()
			s.logger.Warn().
				Str("user_id", a.UserID.String()).
				Str("role_slug", a.RoleSlug).
				Strs("existing_legal_roles", existing).
				Err(exErr).
				Msg("demo legal-role assignment skipped (SoD-forbidden pair)")
			out = append(out, applied)
			continue
		}

		// 3) Idempotent upsert. assigned_by is left NULL (system seed) to avoid
		//    coupling to any actor user. A missing user (FK violation on
		//    user_id) is downgraded to a skip+warn, not fatal.
		assigned, err := s.upsertAssignment(ctx, a.UserID, roleID)
		if err != nil {
			if isMissingUserFK(err) {
				applied.Status = AssignmentSkippedNoUser
				applied.Detail = "demo user not present in platform_core.users"
				s.logger.Warn().
					Str("user_id", a.UserID.String()).
					Str("role_slug", a.RoleSlug).
					Msg("demo legal-role assignment skipped (user absent)")
				out = append(out, applied)
				continue
			}
			return out, fmt.Errorf("assign role %q to %s: %w", a.RoleSlug, a.UserID, err)
		}
		applied.Status = AssignmentAssigned
		if assigned {
			applied.Detail = "inserted"
		} else {
			applied.Detail = "already present"
		}
		out = append(out, applied)
	}

	s.logReport(out)
	return out, nil
}

// lookupRoleID resolves a legal-role slug to its platform_core.roles id for the
// tenant. Returns pgx.ErrNoRows when the role has not been seeded.
func (s *LegalAffairsAssignmentSeeder) lookupRoleID(ctx context.Context, slug string) (uuid.UUID, error) {
	const sql = `SELECT id FROM roles WHERE tenant_id = $1 AND slug = $2`
	var id uuid.UUID
	if err := s.db.QueryRow(ctx, sql, s.tenantID, slug).Scan(&id); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}

// existingLegalRoles returns the legal-* role slugs the user already holds for
// the tenant (the SoD `existing` set). Non-legal roles (tenant_admin, analyst,
// …) are filtered out — SoD §4.2 only constrains legal-role pairs, so keeping a
// user's platform roles never trips the guard.
func (s *LegalAffairsAssignmentSeeder) existingLegalRoles(ctx context.Context, userID uuid.UUID) ([]string, error) {
	const sql = `
SELECT r.slug
FROM user_roles ur
JOIN roles r ON r.id = ur.role_id
WHERE ur.tenant_id = $1 AND ur.user_id = $2 AND r.slug LIKE 'legal-%'`
	rows, err := s.db.Query(ctx, sql, s.tenantID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			return nil, err
		}
		out = append(out, slug)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.Strings(out)
	return out, nil
}

// upsertAssignment idempotently inserts the (user, role) binding. Returns true
// when a row was inserted, false when it already existed (ON CONFLICT no-op).
func (s *LegalAffairsAssignmentSeeder) upsertAssignment(ctx context.Context, userID, roleID uuid.UUID) (bool, error) {
	const sql = `
INSERT INTO user_roles (user_id, role_id, tenant_id, assigned_by)
VALUES ($1, $2, $3, NULL)
ON CONFLICT (user_id, role_id) DO NOTHING`
	tag, err := s.db.Exec(ctx, sql, userID, roleID, s.tenantID)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

// logReport emits one structured readiness line per assignment plus a summary,
// so startup logs show exactly which demo user holds which legal persona (§16).
func (s *LegalAffairsAssignmentSeeder) logReport(applied []AppliedAssignment) {
	assigned := 0
	for _, a := range applied {
		ev := s.logger.Info()
		if a.Status != AssignmentAssigned {
			ev = s.logger.Warn()
		} else {
			assigned++
		}
		ev.
			Str("user_id", a.UserID.String()).
			Str("person", a.Person).
			Str("role_slug", a.RoleSlug).
			Str("status", string(a.Status)).
			Str("detail", a.Detail).
			Msg("demo legal-role assignment")
	}
	s.logger.Info().
		Str("tenant_id", s.tenantID.String()).
		Int("assigned", assigned).
		Int("total", len(applied)).
		Msg("seeded demo legal-role assignments (persona enablement, §16)")
}

// isMissingUserFK reports whether err is the user_roles.user_id foreign-key
// violation raised when the target demo user is absent from platform_core.users
// — the one condition the seeder downgrades from fatal to skip.
func isMissingUserFK(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return false
	}
	// 23503 = foreign_key_violation. Match the user_roles FK on user_id.
	return pgErr.Code == "23503" &&
		(pgErr.ConstraintName == "user_roles_user_id_fkey" || pgErr.TableName == "user_roles")
}

// Ensure *pgxpool.Pool-style handles (and pgx.Tx) satisfy AssignExecQuerier at
// compile time — pgx.Tx exposes Exec/Query/QueryRow.
var _ AssignExecQuerier = (pgx.Tx)(nil)
