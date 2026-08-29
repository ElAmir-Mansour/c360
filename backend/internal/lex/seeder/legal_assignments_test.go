package seeder

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// --- fake AssignExecQuerier -------------------------------------------------
//
// The fake models platform_core just enough for the assignment seeder:
//   - a roles table (slug -> id) so lookupRoleID resolves,
//   - per-user already-held legal roles so existingLegalRoles / the SoD guard
//     can be exercised,
//   - an inserted set keyed (user_id, role_id) so the upsert is observably
//     idempotent (ON CONFLICT DO NOTHING => RowsAffected 0 on the second run).

type fakeAssignDB struct {
	roleIDBySlug map[string]uuid.UUID   // seeded roles
	existing     map[uuid.UUID][]string // user -> already-held legal slugs
	inserted     map[string]struct{}    // "user|role" set
	failUserFK   map[uuid.UUID]struct{} // users that trigger the FK violation
	upsertCalls  []string               // captured upsert SQL (for assertions)
}

func newFakeAssignDB() *fakeAssignDB {
	return &fakeAssignDB{
		roleIDBySlug: map[string]uuid.UUID{},
		existing:     map[uuid.UUID][]string{},
		inserted:     map[string]struct{}{},
		failUserFK:   map[uuid.UUID]struct{}{},
	}
}

func (f *fakeAssignDB) seedRole(slug string) {
	f.roleIDBySlug[slug] = uuid.New()
}

func key(user, role uuid.UUID) string { return user.String() + "|" + role.String() }

func (f *fakeAssignDB) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	// Only the user_roles upsert reaches Exec.
	f.upsertCalls = append(f.upsertCalls, sql)
	userID := args[0].(uuid.UUID)
	roleID := args[1].(uuid.UUID)
	if _, bad := f.failUserFK[userID]; bad {
		return pgconn.CommandTag{}, &pgconn.PgError{Code: "23503", ConstraintName: "user_roles_user_id_fkey", TableName: "user_roles"}
	}
	k := key(userID, roleID)
	if _, exists := f.inserted[k]; exists {
		return pgconn.NewCommandTag("INSERT 0 0"), nil // ON CONFLICT no-op
	}
	f.inserted[k] = struct{}{}
	// Reflect the new assignment into `existing` so a subsequent same-user
	// lookup sees it (lets a test stack two roles on one user for SoD).
	for slug, id := range f.roleIDBySlug {
		if id == roleID && strings.HasPrefix(slug, "legal-") {
			f.existing[userID] = append(f.existing[userID], slug)
		}
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (f *fakeAssignDB) QueryRow(_ context.Context, _ string, args ...any) pgx.Row {
	// Only lookupRoleID reaches QueryRow: args = (tenant, slug).
	slug := args[1].(string)
	id, ok := f.roleIDBySlug[slug]
	if !ok {
		return errRow{err: pgx.ErrNoRows}
	}
	return uuidRow{id: id}
}

func (f *fakeAssignDB) Query(_ context.Context, _ string, args ...any) (pgx.Rows, error) {
	// Only existingLegalRoles reaches Query: args = (tenant, user_id).
	userID := args[1].(uuid.UUID)
	return &slugRows{slugs: append([]string(nil), f.existing[userID]...)}, nil
}

type uuidRow struct{ id uuid.UUID }

func (r uuidRow) Scan(dest ...any) error {
	if len(dest) > 0 {
		if p, ok := dest[0].(*uuid.UUID); ok {
			*p = r.id
		}
	}
	return nil
}

type errRow struct{ err error }

func (r errRow) Scan(_ ...any) error { return r.err }

// slugRows embeds pgx.Rows so it satisfies the full interface; only the methods
// the seeder calls (Next/Scan/Close/Err) are overridden — the rest are never
// invoked.
type slugRows struct {
	pgx.Rows
	slugs []string
	idx   int
}

func (r *slugRows) Next() bool { return r.idx < len(r.slugs) }
func (r *slugRows) Scan(dest ...any) error {
	if len(dest) > 0 {
		if p, ok := dest[0].(*string); ok {
			*p = r.slugs[r.idx]
		}
	}
	r.idx++
	return nil
}
func (r *slugRows) Close()     {}
func (r *slugRows) Err() error { return nil }

func newAssignSeeder(db AssignExecQuerier) *LegalAffairsAssignmentSeeder {
	return NewLegalAffairsAssignmentSeeder(db, uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001"), zerolog.Nop())
}

// --- tests ------------------------------------------------------------------

// TestSeedAssignsAllDemoPersonas: with all roles seeded and all users present,
// every §16 assignment lands.
func TestSeedAssignsAllDemoPersonas(t *testing.T) {
	db := newFakeAssignDB()
	for _, a := range DemoLegalRoleAssignments {
		db.seedRole(a.RoleSlug)
	}
	applied, err := newAssignSeeder(db).Seed(context.Background())
	if err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if len(applied) != len(DemoLegalRoleAssignments) {
		t.Fatalf("expected %d results, got %d", len(DemoLegalRoleAssignments), len(applied))
	}
	for _, a := range applied {
		if a.Status != AssignmentAssigned {
			t.Errorf("expected %s -> %s assigned, got %q (%s)", a.Person, a.RoleSlug, a.Status, a.Detail)
		}
		if a.RoleID == uuid.Nil {
			t.Errorf("assigned %s -> %s with nil role id", a.Person, a.RoleSlug)
		}
	}
	// The canonical mapping covers exactly one role per user — no SoD skips.
	if got := len(db.inserted); got != len(DemoLegalRoleAssignments) {
		t.Fatalf("expected %d user_roles rows inserted, got %d", len(DemoLegalRoleAssignments), got)
	}
}

// TestSeedUpsertIsIdempotent: re-running converges (no new rows; everything
// reported as already-present), and the upsert SQL is an ON CONFLICT no-op.
func TestSeedUpsertIsIdempotent(t *testing.T) {
	db := newFakeAssignDB()
	for _, a := range DemoLegalRoleAssignments {
		db.seedRole(a.RoleSlug)
	}
	s := newAssignSeeder(db)
	if _, err := s.Seed(context.Background()); err != nil {
		t.Fatalf("first Seed: %v", err)
	}
	firstCount := len(db.inserted)

	applied, err := s.Seed(context.Background())
	if err != nil {
		t.Fatalf("second Seed: %v", err)
	}
	if len(db.inserted) != firstCount {
		t.Fatalf("re-run inserted new rows: %d -> %d (not idempotent)", firstCount, len(db.inserted))
	}
	for _, a := range applied {
		if a.Status != AssignmentAssigned || a.Detail != "already present" {
			t.Errorf("re-run %s -> %s: status=%q detail=%q, want assigned/already present", a.Person, a.RoleSlug, a.Status, a.Detail)
		}
	}
	for _, sql := range db.upsertCalls {
		if !strings.Contains(sql, "ON CONFLICT (user_id, role_id) DO NOTHING") {
			t.Fatalf("upsert is not idempotent: %q", sql)
		}
	}
}

// TestSeedNeverSeedsForbiddenSoDPair: when a user already holds a conflicting
// legal role, the candidate is refused via auth.CheckRoleExclusion and never
// written.
func TestSeedNeverSeedsForbiddenSoDPair(t *testing.T) {
	db := newFakeAssignDB()
	db.seedRole("legal-cases-manager")
	user := uuid.New()
	// User already holds legal-officer; {officer ⊥ cases-manager} is a §4.2 pair.
	db.existing[user] = []string{"legal-officer"}

	s := newAssignSeeder(db).withAssignments([]LegalRoleAssignment{
		{UserID: user, Person: "Conflict User", RoleSlug: "legal-cases-manager"},
	})
	applied, err := s.Seed(context.Background())
	if err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if len(applied) != 1 || applied[0].Status != AssignmentSkippedSoD {
		t.Fatalf("expected the forbidden pair to be skipped (SoD), got %+v", applied)
	}
	if len(db.inserted) != 0 {
		t.Fatalf("a forbidden SoD pair must NOT be written; %d rows inserted", len(db.inserted))
	}
}

// TestEveryDemoAssignmentIsSoDClean asserts the canonical §16 mapping never
// pairs a user with two conflicting legal roles — the authoritative guard the
// data must satisfy, checked directly against auth.CheckRoleExclusion.
func TestEveryDemoAssignmentIsSoDClean(t *testing.T) {
	byUser := map[uuid.UUID][]string{}
	for _, a := range DemoLegalRoleAssignments {
		byUser[a.UserID] = append(byUser[a.UserID], a.RoleSlug)
	}
	for user, slugs := range byUser {
		held := []string{}
		for _, candidate := range slugs {
			if err := auth.CheckRoleExclusion(candidate, held); err != nil {
				t.Errorf("user %s: §16 mapping seeds an SoD-forbidden pair: %v", user, err)
			}
			held = append(held, candidate)
		}
	}
}

// TestSeedSkipsMissingRole: when a role slug is not seeded, the assignment is
// reported skipped_no_role and no row is written (not fatal).
func TestSeedSkipsMissingRole(t *testing.T) {
	db := newFakeAssignDB() // no roles seeded
	s := newAssignSeeder(db).withAssignments([]LegalRoleAssignment{
		{UserID: uuid.New(), Person: "X", RoleSlug: "legal-director"},
	})
	applied, err := s.Seed(context.Background())
	if err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if len(applied) != 1 || applied[0].Status != AssignmentSkippedNoRole {
		t.Fatalf("expected skipped_no_role, got %+v", applied)
	}
	if len(db.inserted) != 0 {
		t.Fatalf("no row should be written when role missing")
	}
}

// TestSeedSkipsMissingUser: a user_roles FK violation on user_id is downgraded
// to skipped_no_user (non-fatal), so a lean demo DB still starts.
func TestSeedSkipsMissingUser(t *testing.T) {
	db := newFakeAssignDB()
	db.seedRole("legal-director")
	user := uuid.New()
	db.failUserFK[user] = struct{}{}

	s := newAssignSeeder(db).withAssignments([]LegalRoleAssignment{
		{UserID: user, Person: "Absent", RoleSlug: "legal-director"},
	})
	applied, err := s.Seed(context.Background())
	if err != nil {
		t.Fatalf("Seed must not be fatal on a missing user: %v", err)
	}
	if len(applied) != 1 || applied[0].Status != AssignmentSkippedNoUser {
		t.Fatalf("expected skipped_no_user, got %+v", applied)
	}
}

// TestSeedNoOpWithNilDBOrTenant: nil handle / nil tenant is inert.
func TestSeedNoOpWithNilDBOrTenant(t *testing.T) {
	out, err := NewLegalAffairsAssignmentSeeder(nil, uuid.New(), zerolog.Nop()).Seed(context.Background())
	if err != nil || out != nil {
		t.Fatalf("nil handle should be a no-op, got out=%v err=%v", out, err)
	}
	out, err = NewLegalAffairsAssignmentSeeder(newFakeAssignDB(), uuid.Nil, zerolog.Nop()).Seed(context.Background())
	if err != nil || out != nil {
		t.Fatalf("nil tenant should be a no-op, got out=%v err=%v", out, err)
	}
}

// TestDemoAssignmentsCoverRealPersonas documents that the lean §16 set binds the
// expected seven personas to real demo users.
func TestDemoAssignmentsCoverRealPersonas(t *testing.T) {
	want := map[string]bool{
		"legal-director":          false,
		"legal-cases-manager":     false,
		"legal-auditor":           false,
		"legal-system-admin":      false,
		"legal-advisor":           false,
		"legal-contracts-manager": false,
		"legal-requester":         false,
	}
	for _, a := range DemoLegalRoleAssignments {
		if _, ok := want[a.RoleSlug]; ok {
			want[a.RoleSlug] = true
		}
	}
	for slug, covered := range want {
		if !covered {
			t.Errorf("expected demo persona %q to be covered by a real user", slug)
		}
	}
	// Every assigned slug must be a real legal role from the matrix.
	valid := map[string]struct{}{}
	for _, s := range LegalRoleSlugs() {
		valid[s] = struct{}{}
	}
	for _, a := range DemoLegalRoleAssignments {
		if _, ok := valid[a.RoleSlug]; !ok {
			t.Errorf("assignment references unknown role slug %q", a.RoleSlug)
		}
	}
}
