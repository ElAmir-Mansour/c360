package seeder

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// fakeExecer records every Exec call so the test can assert the upserted rows.
type fakeExecer struct {
	calls  []fakeCall
	failOn int // 1-based index to fail on; 0 = never fail
	n      int
}

type fakeCall struct {
	sql  string
	args []any
}

func (f *fakeExecer) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	f.n++
	if f.failOn != 0 && f.n == f.failOn {
		return pgconn.CommandTag{}, errors.New("simulated db failure")
	}
	f.calls = append(f.calls, fakeCall{sql: sql, args: args})
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

// fakeBoolRow models the information_schema provenance-column probe result.
type fakeBoolRow struct {
	hasSource bool
	err       error
}

func (r fakeBoolRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) > 0 {
		if p, ok := dest[0].(*bool); ok {
			*p = r.hasSource
		}
	}
	return nil
}

// fakeSchemaDB is a fakeExecer that ALSO answers the provenance probe (mirroring
// *pgxpool.Pool / pgx.Tx). hasSource=true models a migrated schema (import-aware
// upsert), false a pre-000031 schema (legacy upsert). The probe uses a
// tx-safe information_schema query that never aborts a transaction.
type fakeSchemaDB struct {
	fakeExecer
	hasSource bool
	queryErr  error
}

func (f *fakeSchemaDB) QueryRow(_ context.Context, _ string, _ ...any) pgx.Row {
	return fakeBoolRow{hasSource: f.hasSource, err: f.queryErr}
}

func newSeeder(db Execer) *LegalAffairsRoleSeeder {
	return NewLegalAffairsRoleSeeder(db, uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001"), zerolog.Nop())
}

// roleCalls returns only the role-upsert Exec calls (Seed also emits SSD
// exclusion-table upserts, which these role assertions must ignore).
func roleCalls(calls []fakeCall) []fakeCall {
	var out []fakeCall
	for _, c := range calls {
		if strings.Contains(c.sql, "INTO roles") {
			out = append(out, c)
		}
	}
	return out
}

func TestSeedWritesAllFourteenRoles(t *testing.T) {
	fe := &fakeExecer{}
	n, err := newSeeder(fe).Seed(context.Background())
	if err != nil {
		t.Fatalf("Seed: %v", err)
	}
	rc := roleCalls(fe.calls)
	if n != 14 || len(rc) != 14 {
		t.Fatalf("expected 14 role upserts, got n=%d role-calls=%d", n, len(rc))
	}
	// The statement must be an idempotent upsert.
	for _, c := range rc {
		if !strings.Contains(c.sql, "ON CONFLICT (tenant_id, slug) DO UPDATE") {
			t.Fatalf("seed statement is not an idempotent upsert: %q", c.sql)
		}
		if !strings.Contains(c.sql, "is_system_role = true") {
			t.Errorf("seeded roles must be system roles: %q", c.sql)
		}
	}
}

func TestSeedArgsMatchDefinitions(t *testing.T) {
	fe := &fakeExecer{}
	if _, err := newSeeder(fe).Seed(context.Background()); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	// Build slug -> args map. Args order: tenant, name, slug, desc, permsJSON, metaJSON.
	bySlug := map[string]fakeCall{}
	for _, c := range roleCalls(fe.calls) {
		slug, _ := c.args[2].(string)
		bySlug[slug] = c
	}
	for _, def := range auth.LegalAffairsRoleDefs {
		c, ok := bySlug[def.Slug]
		if !ok {
			t.Errorf("role %q not seeded", def.Slug)
			continue
		}
		if name, _ := c.args[1].(string); name != def.NameEN {
			t.Errorf("role %q name arg = %q, want %q", def.Slug, name, def.NameEN)
		}
		// Permissions arg must round-trip to the exact definition set.
		permsRaw, _ := c.args[4].([]byte)
		var perms []string
		if err := json.Unmarshal(permsRaw, &perms); err != nil {
			t.Errorf("role %q perms not valid JSON: %v", def.Slug, err)
			continue
		}
		if len(perms) != len(def.Permissions) {
			t.Errorf("role %q seeded %d perms, def has %d", def.Slug, len(perms), len(def.Permissions))
		}
		// Metadata arg must carry the org-hierarchy fields.
		metaRaw, _ := c.args[5].([]byte)
		var meta map[string]any
		if err := json.Unmarshal(metaRaw, &meta); err != nil {
			t.Errorf("role %q metadata not valid JSON: %v", def.Slug, err)
			continue
		}
		if meta["tier"] != def.Tier {
			t.Errorf("role %q metadata tier = %v, want %q", def.Slug, meta["tier"], def.Tier)
		}
		if meta["name_ar"] != def.NameAR {
			t.Errorf("role %q metadata name_ar = %v, want %q", def.Slug, meta["name_ar"], def.NameAR)
		}
	}
}

func TestSeedIsNoOpWithNilExecer(t *testing.T) {
	n, err := NewLegalAffairsRoleSeeder(nil, uuid.New(), zerolog.Nop()).Seed(context.Background())
	if err != nil || n != 0 {
		t.Fatalf("nil executor should be a no-op, got n=%d err=%v", n, err)
	}
	n, err = NewLegalAffairsRoleSeeder(&fakeExecer{}, uuid.Nil, zerolog.Nop()).Seed(context.Background())
	if err != nil || n != 0 {
		t.Fatalf("nil tenant should be a no-op, got n=%d err=%v", n, err)
	}
}

func TestSeedPropagatesDBError(t *testing.T) {
	// A bare Execer cannot answer the (tx-safe) probe, so no probe Exec runs;
	// role upserts start at call #1. Failing call #2 means exactly one role
	// wrote successfully.
	fe := &fakeExecer{failOn: 2}
	n, err := newSeeder(fe).Seed(context.Background())
	if err == nil {
		t.Fatal("expected error from failing Exec")
	}
	if n != 1 {
		t.Fatalf("expected 1 successful write before failure, got %d", n)
	}
}

func TestSeedIsImportAware(t *testing.T) {
	// Probe reports the column present (migrated schema) ⇒ the upsert must skip
	// rows owned by an activated role-matrix import so a service restart never
	// clobbers a tenant's customised matrix.
	fq := &fakeSchemaDB{hasSource: true}
	if _, err := newSeeder(fq).Seed(context.Background()); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	for _, c := range roleCalls(fq.calls) {
		if !strings.Contains(c.sql, `WHERE roles.source IS DISTINCT FROM 'import'`) {
			t.Fatalf("role upsert must be import-aware; got %q", c.sql)
		}
	}
}

func TestSeedDefaultsToImportAwareWhenProbeUnavailable(t *testing.T) {
	// A bare Execer (no QueryRow) cannot probe; the seeder must default to the
	// import-aware upsert — correct on any migrated database (every real
	// deployment) and, critically, it never issues a tx-poisoning probe.
	fe := &fakeExecer{}
	if _, err := newSeeder(fe).Seed(context.Background()); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	for _, c := range roleCalls(fe.calls) {
		if !strings.Contains(c.sql, `WHERE roles.source IS DISTINCT FROM 'import'`) {
			t.Fatalf("bare-Execer path must default to import-aware; got %q", c.sql)
		}
	}
}

func TestSeedFallsBackToLegacyUpsertWithoutSourceColumn(t *testing.T) {
	// Probe reports the column absent (pre-000031 schema) ⇒ the seeder falls
	// back to the historic unconditional upsert instead of referencing a column
	// that does not exist. The probe is a non-aborting information_schema query,
	// so this path is safe even on a transaction.
	fq := &fakeSchemaDB{hasSource: false}
	n, err := newSeeder(fq).Seed(context.Background())
	if err != nil {
		t.Fatalf("Seed must survive a pre-000031 schema: %v", err)
	}
	if n != 14 {
		t.Fatalf("expected 14 role upserts on the legacy path, got %d", n)
	}
	for _, c := range roleCalls(fq.calls) {
		if strings.Contains(c.sql, "roles.source") {
			t.Fatalf("legacy path must not reference roles.source: %q", c.sql)
		}
	}
}

func TestSeedAlsoSeedsExclusions(t *testing.T) {
	fe := &fakeExecer{}
	if _, err := newSeeder(fe).Seed(context.Background()); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	wantExclusions := len(LegalRoleExclusionPairs())
	if wantExclusions == 0 {
		t.Fatal("expected a non-empty SSD exclusion set")
	}
	exCalls := 0
	for _, c := range fe.calls {
		if strings.Contains(c.sql, "legal_role_exclusions") {
			exCalls++
			if !strings.Contains(c.sql, "ON CONFLICT (tenant_id, role_slug_a, role_slug_b) DO UPDATE") {
				t.Errorf("exclusion seed is not an idempotent upsert: %q", c.sql)
			}
		}
	}
	if exCalls != wantExclusions {
		t.Fatalf("expected %d exclusion upserts, got %d", wantExclusions, exCalls)
	}
}

// --- SSD checker (design v2 §4.2) -------------------------------------------

func TestExclusionPairsNormalizedAndSymmetric(t *testing.T) {
	pairs := LegalRoleExclusionPairs()
	for _, p := range pairs {
		if p.A >= p.B {
			t.Errorf("pair not normalized (A < B): {%s, %s}", p.A, p.B)
		}
		if p.Reason == "" {
			t.Errorf("pair {%s, %s} missing reason", p.A, p.B)
		}
	}
	// The three canonical §4.2 conflicts must be present.
	mustHave := [][2]string{
		{"legal-cases-manager", "legal-officer"},     // normalized a<b
		{"legal-advisor", "legal-contracts-manager"}, // normalized a<b
		{"legal-auditor", "legal-cases-manager"},     // a representative any-operational ⊥ auditor pair
	}
	has := func(a, b string) bool {
		if a > b {
			a, b = b, a
		}
		for _, p := range pairs {
			if p.A == a && p.B == b {
				return true
			}
		}
		return false
	}
	for _, m := range mustHave {
		if !has(m[0], m[1]) {
			t.Errorf("missing expected exclusion pair {%s, %s}", m[0], m[1])
		}
	}
}

func TestCheckRoleExclusion(t *testing.T) {
	tests := []struct {
		name      string
		candidate string
		existing  []string
		wantErr   bool
	}{
		{
			name:      "officer + cases-manager rejected",
			candidate: "legal-cases-manager",
			existing:  []string{"legal-officer"},
			wantErr:   true,
		},
		{
			name:      "officer + cases-manager rejected (other direction)",
			candidate: "legal-officer",
			existing:  []string{"legal-cases-manager"},
			wantErr:   true,
		},
		{
			name:      "advisor + contracts-manager rejected",
			candidate: "legal-contracts-manager",
			existing:  []string{"legal-advisor"},
			wantErr:   true,
		},
		{
			name:      "auditor + any operational role rejected",
			candidate: "legal-auditor",
			existing:  []string{"legal-officer"},
			wantErr:   true,
		},
		{
			name:      "operational role + auditor rejected (other direction)",
			candidate: "legal-cases-manager",
			existing:  []string{"legal-auditor"},
			wantErr:   true,
		},
		{
			name:      "non-conflicting pair allowed",
			candidate: "legal-contracts-manager",
			existing:  []string{"legal-officer"}, // officer/contracts-manager is not a declared conflict
			wantErr:   false,
		},
		{
			name:      "oversight read-only pair allowed (auditor + shared-services manager)",
			candidate: "legal-auditor",
			existing:  []string{"legal-shared-services-manager"},
			wantErr:   false,
		},
		{
			name:      "config-only admin + auditor allowed (admin is not operational)",
			candidate: "legal-auditor",
			existing:  []string{"legal-system-admin"},
			wantErr:   false,
		},
		{
			name:      "no existing roles is allowed",
			candidate: "legal-cases-manager",
			existing:  nil,
			wantErr:   false,
		},
		{
			name:      "re-assigning the same role is allowed",
			candidate: "legal-officer",
			existing:  []string{"legal-officer"},
			wantErr:   false,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := CheckRoleExclusion(tc.candidate, tc.existing)
			if tc.wantErr && err == nil {
				t.Fatalf("expected SSD rejection for candidate=%q existing=%v", tc.candidate, tc.existing)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected allow for candidate=%q existing=%v, got %v", tc.candidate, tc.existing, err)
			}
		})
	}
}

func TestLegalRoleSlugsCoversAllDefs(t *testing.T) {
	if got := len(LegalRoleSlugs()); got != len(auth.LegalAffairsRoleDefs) {
		t.Fatalf("LegalRoleSlugs returned %d, want %d", got, len(auth.LegalAffairsRoleDefs))
	}
}

// --- Asserted verify (design v2 §5 / changelog #10) -------------------------

// fakeQuerier returns canned scalar results for the two COUNT(*) queries Verify
// runs (roles present, exclusions present).
type fakeQuerier struct {
	roleCount int
	exCount   int
}

type fakeRow struct{ v int }

func (r fakeRow) Scan(dest ...any) error {
	if len(dest) > 0 {
		if p, ok := dest[0].(*int); ok {
			*p = r.v
		}
	}
	return nil
}

func (q *fakeQuerier) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	if strings.Contains(sql, "legal_role_exclusions") {
		return fakeRow{v: q.exCount}
	}
	return fakeRow{v: q.roleCount}
}

func TestVerifyPassesWhenAllPresent(t *testing.T) {
	q := &fakeQuerier{roleCount: len(LegalRoleSlugs()), exCount: len(LegalRoleExclusionPairs())}
	if err := newSeeder(&fakeExecer{}).Verify(context.Background(), q); err != nil {
		t.Fatalf("Verify should pass when all roles + exclusions present: %v", err)
	}
}

func TestVerifyFailsWhenRolesMissing(t *testing.T) {
	q := &fakeQuerier{roleCount: len(LegalRoleSlugs()) - 1, exCount: len(LegalRoleExclusionPairs())}
	if err := newSeeder(&fakeExecer{}).Verify(context.Background(), q); err == nil {
		t.Fatal("Verify must fail readiness when a legal role is missing")
	}
}

func TestVerifyFailsWhenExclusionsMissing(t *testing.T) {
	q := &fakeQuerier{roleCount: len(LegalRoleSlugs()), exCount: 0}
	if err := newSeeder(&fakeExecer{}).Verify(context.Background(), q); err == nil {
		t.Fatal("Verify must fail readiness when SSD exclusions are missing")
	}
}

func TestVerifyNilQuerierIsNoOp(t *testing.T) {
	if err := newSeeder(&fakeExecer{}).Verify(context.Background(), nil); err != nil {
		t.Fatalf("nil querier should be a no-op: %v", err)
	}
}
