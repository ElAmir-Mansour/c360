package repository

import (
	"fmt"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// TestContractListWhere_NoOrgFilter proves the base filter surface is untouched
// when org_entity_id is absent (back-compat: existing list calls emit the exact
// same conditions and arg count as before feature #11).
func TestContractListWhere_NoOrgFilter(t *testing.T) {
	tenantID := uuid.New()
	conditions, args := contractListWhere(tenantID, model.ContractListFilters{})
	where := strings.Join(conditions, " AND ")
	if where != "c.tenant_id = $1 AND c.deleted_at IS NULL AND COALESCE(c.archive_status, 'active') = 'active'" {
		t.Fatalf("base where = %q", where)
	}
	if len(args) != 1 || args[0] != tenantID {
		t.Fatalf("base args = %v, want [tenantID]", args)
	}
	if strings.Contains(where, "org_entity_id") {
		t.Fatalf("org_entity_id leaked into unfiltered where: %q", where)
	}
}

// TestContractListWhere_OrgEntityFilter proves the org filter lands with the
// correct placeholder and appended arg.
func TestContractListWhere_OrgEntityFilter(t *testing.T) {
	tenantID := uuid.New()
	entityID := uuid.New()
	conditions, args := contractListWhere(tenantID, model.ContractListFilters{OrgEntityID: &entityID})
	where := strings.Join(conditions, " AND ")
	if !strings.Contains(where, "c.org_entity_id = $2") {
		t.Fatalf("where missing org filter at $2: %q", where)
	}
	if len(args) != 2 || args[1] != entityID {
		t.Fatalf("args = %v, want [tenantID entityID]", args)
	}
}

// TestContractListWhere_PlaceholderNumbering proves placeholder numbers stay in
// lockstep with the args slice when the org filter is combined with other
// filters (the classic off-by-one class of query-builder bug).
func TestContractListWhere_PlaceholderNumbering(t *testing.T) {
	tenantID := uuid.New()
	entityID := uuid.New()
	status := model.ContractStatusActive
	days := 30
	filters := model.ContractListFilters{
		Search:         "cloud",
		Status:         &status,
		Department:     "legal",
		OrgEntityID:    &entityID,
		ExpiringInDays: &days,
	}
	conditions, args := contractListWhere(tenantID, filters)
	where := strings.Join(conditions, " AND ")

	// tenant=$1, search=$2, status=$3, department=$4, org=$5, expiring=$6
	wantArgs := []any{tenantID, "cloud", status, "legal", entityID, days}
	if len(args) != len(wantArgs) {
		t.Fatalf("args len = %d, want %d (%v)", len(args), len(wantArgs), args)
	}
	for i, want := range wantArgs {
		if args[i] != want {
			t.Fatalf("args[%d] = %v, want %v", i, args[i], want)
		}
	}
	for _, fragment := range []string{
		"c.status = $3",
		"COALESCE(NULLIF(c.department, ''), 'unspecified') = $4",
		"c.org_entity_id = $5",
		"c.expiry_date <= CURRENT_DATE + $6::int",
	} {
		if !strings.Contains(where, fragment) {
			t.Fatalf("where missing %q: %q", fragment, where)
		}
	}
	// Every referenced placeholder must exist ($1..$6) and none beyond.
	if strings.Contains(where, "$7") {
		t.Fatalf("where references $7 beyond args: %q", where)
	}
	for i := 1; i <= len(wantArgs); i++ {
		if !strings.Contains(where, fmt.Sprintf("$%d", i)) {
			t.Fatalf("where never references $%d: %q", i, where)
		}
	}
}

// TestContractJSONSelect_ResolvesOrgEntityName proves the read side LEFT JOINs
// the org registry (tenant-scoped, soft-delete aware) and projects both the raw
// link and the resolved bilingual name, while keeping the free-text party
// columns untouched.
func TestContractJSONSelect_ResolvesOrgEntityName(t *testing.T) {
	query := contractJSONSelect("c.tenant_id = $1 AND c.deleted_at IS NULL")
	for _, fragment := range []string{
		"c.org_entity_id",
		"oe.name AS org_entity_name",
		"LEFT JOIN legal_org_entities oe",
		"oe.id = c.org_entity_id",
		"oe.tenant_id = c.tenant_id",
		"oe.deleted_at IS NULL",
		// party free-text stays (back-compat)
		"c.party_a_name", "c.party_b_name", "c.party_b_entity",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("contractJSONSelect missing %q:\n%s", fragment, query)
		}
	}
	// LEFT JOIN (never INNER): unlinked contracts must not drop from lists.
	if strings.Contains(query, "JOIN legal_org_entities") && !strings.Contains(query, "LEFT JOIN legal_org_entities") {
		t.Fatalf("org entity join must be LEFT JOIN:\n%s", query)
	}
}

// TestContractEntityRollupSelect_Shape proves the roll-up SQL embeds the shared
// filter WHERE, groups per entity, aggregates value PER CURRENCY (never summing
// across currencies), and keeps NULL-linked contracts as an "unassigned" bucket
// via LEFT JOIN + grouping on the nullable link column.
func TestContractEntityRollupSelect_Shape(t *testing.T) {
	tenantID := uuid.New()
	entityID := uuid.New()
	conditions, args := contractListWhere(tenantID, model.ContractListFilters{OrgEntityID: &entityID})
	where := strings.Join(conditions, " AND ")
	query := contractEntityRollupSelect(where)

	if !strings.Contains(query, where) {
		t.Fatalf("rollup SQL does not embed the shared filter where %q:\n%s", where, query)
	}
	if len(args) != 2 {
		t.Fatalf("rollup args = %v, want tenant + entity", args)
	}
	for _, fragment := range []string{
		"GROUP BY tenant_id, org_entity_id, currency",
		"COALESCE(SUM(total_value), 0)::float8",
		"jsonb_object_agg(p.currency, p.total_value)",
		"p.org_entity_id AS entity_id",
		"oe.name AS entity_name",
		"oe.code AS entity_code",
		"SUM(p.contract_count)::int AS count",
		"AS total_value_by_currency",
		"LEFT JOIN legal_org_entities oe",
		"oe.tenant_id = p.tenant_id",
		"oe.deleted_at IS NULL",
		"GROUP BY p.org_entity_id, oe.code, oe.name",
	} {
		if !strings.Contains(query, fragment) {
			t.Fatalf("rollup SQL missing %q:\n%s", fragment, query)
		}
	}
	// Placeholder/arg lockstep: the embedded where references $1/$2 only.
	if strings.Contains(query, "$3") {
		t.Fatalf("rollup SQL references $3 beyond args:\n%s", query)
	}
}
