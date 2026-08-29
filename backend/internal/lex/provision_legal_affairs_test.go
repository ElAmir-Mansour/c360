package lex

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// fakeCoreExecer is an in-memory platform_core executor that records every Exec
// so the provisioning RBAC step can be asserted without a real DB. It satisfies
// platformCoreExecer (and seeder.Execer) via Exec only.
type fakeCoreExecer struct {
	calls []fakeCoreCall
	// failAssign makes the legal-system-admin user_roles INSERT return an error,
	// exercising the NON-FATAL assignment path.
	failAssign bool
}

type fakeCoreCall struct {
	sql  string
	args []any
}

func (f *fakeCoreExecer) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if f.failAssign && strings.Contains(sql, "INTO user_roles") {
		return pgconn.CommandTag{}, errors.New("simulated assignment failure")
	}
	f.calls = append(f.calls, fakeCoreCall{sql: sql, args: args})
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (f *fakeCoreExecer) count(needle string) int {
	n := 0
	for _, c := range f.calls {
		if strings.Contains(c.sql, needle) {
			n++
		}
	}
	return n
}

func (f *fakeCoreExecer) firstWith(needle string) (fakeCoreCall, bool) {
	for _, c := range f.calls {
		if strings.Contains(c.sql, needle) {
			return c, true
		}
	}
	return fakeCoreCall{}, false
}

const provTestTenant = "aaaaaaaa-0000-0000-0000-000000000099"

// TestSeedLegalAffairsRBAC_SeedsRolesAndAssignsAdmin asserts the happy path:
// all 14 legal roles are upserted AND the supplied admin is granted the
// legal-system-admin role via an idempotent user_roles insert.
func TestSeedLegalAffairsRBAC_SeedsRolesAndAssignsAdmin(t *testing.T) {
	fe := &fakeCoreExecer{}
	tenantID := uuid.MustParse(provTestTenant)
	adminID := uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000001")

	seedLegalAffairsRBAC(context.Background(), fe, zerolog.Nop(), tenantID, adminID)

	roleUpserts := fe.count("INTO roles")
	if want := len(auth.LegalAffairsRoleDefs); roleUpserts != want {
		t.Fatalf("expected %d role upserts, got %d", want, roleUpserts)
	}

	assign, ok := fe.firstWith("INTO user_roles")
	if !ok {
		t.Fatalf("expected a legal-system-admin user_roles assignment, found none")
	}
	if !strings.Contains(assign.sql, "ON CONFLICT (user_id, role_id) DO NOTHING") {
		t.Errorf("admin assignment must be idempotent: %q", assign.sql)
	}
	if !strings.Contains(assign.sql, "slug = 'legal-system-admin'") {
		t.Errorf("admin assignment must target the legal-system-admin role: %q", assign.sql)
	}
	// Args are (adminUserID, tenantID) per the INSERT … SELECT $1, …, $2 shape.
	if len(assign.args) != 2 || assign.args[0] != adminID || assign.args[1] != tenantID {
		t.Errorf("admin assignment args = %v; want [%s %s]", assign.args, adminID, tenantID)
	}
}

// TestSeedLegalAffairsRBAC_NoAdminSkipsAssignment asserts that with uuid.Nil
// admin the roles are still seeded but NO user_roles assignment is attempted.
func TestSeedLegalAffairsRBAC_NoAdminSkipsAssignment(t *testing.T) {
	fe := &fakeCoreExecer{}
	tenantID := uuid.MustParse(provTestTenant)

	seedLegalAffairsRBAC(context.Background(), fe, zerolog.Nop(), tenantID, uuid.Nil)

	if got := fe.count("INTO roles"); got != len(auth.LegalAffairsRoleDefs) {
		t.Fatalf("expected %d role upserts, got %d", len(auth.LegalAffairsRoleDefs), got)
	}
	if got := fe.count("INTO user_roles"); got != 0 {
		t.Fatalf("expected no admin assignment when adminUserID is nil, got %d", got)
	}
}

// TestSeedLegalAffairsRBAC_AssignmentErrorIsNonFatal asserts a failing admin
// assignment does not panic and does not prevent the role seed (NON-FATAL).
func TestSeedLegalAffairsRBAC_AssignmentErrorIsNonFatal(t *testing.T) {
	fe := &fakeCoreExecer{failAssign: true}
	tenantID := uuid.MustParse(provTestTenant)
	adminID := uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000002")

	// Must not panic; the function swallows the assignment error and returns.
	seedLegalAffairsRBAC(context.Background(), fe, zerolog.Nop(), tenantID, adminID)

	if got := fe.count("INTO roles"); got != len(auth.LegalAffairsRoleDefs) {
		t.Fatalf("roles must still be seeded despite assignment failure; got %d", got)
	}
	// The failing assignment was never recorded (Exec returned an error before append).
	if got := fe.count("INTO user_roles"); got != 0 {
		t.Fatalf("failed assignment should not be recorded as applied, got %d", got)
	}
}

// TestProvisionLegalAffairsRBAC_NilPoolIsSafe asserts that the public wrapper is
// a no-op (no panic) when the application has no platform_core pool wired.
func TestProvisionLegalAffairsRBAC_NilPoolIsSafe(t *testing.T) {
	app := &Application{} // PlatformCorePool is nil
	tenantID := uuid.MustParse(provTestTenant)
	adminID := uuid.MustParse("bbbbbbbb-0000-0000-0000-000000000003")

	// Must not panic and must simply return.
	provisionLegalAffairsRBAC(context.Background(), app, zerolog.Nop(), tenantID, adminID)
}
