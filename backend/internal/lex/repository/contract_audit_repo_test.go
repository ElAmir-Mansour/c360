package repository

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

func TestContractAuditScopeClausesBaseline(t *testing.T) {
	tenantID := uuid.New()
	conditions, args, next := contractAuditScopeClauses(tenantID, model.ContractAuditFilters{})
	if len(args) != 1 || args[0] != tenantID {
		t.Fatalf("baseline args = %v, want [tenantID]", args)
	}
	if next != 2 {
		t.Fatalf("baseline next arg = %d, want 2", next)
	}
	where := strings.Join(conditions, " AND ")
	for _, want := range []string{"c.tenant_id = $1", "c.deleted_at IS NULL"} {
		if !strings.Contains(where, want) {
			t.Fatalf("baseline WHERE missing %q: %s", want, where)
		}
	}
	assertPlaceholdersCoverArgs(t, where, args)
}

func TestContractAuditScopeClausesAllFilters(t *testing.T) {
	tenantID := uuid.New()
	status := model.ContractStatusActive
	contractType := model.ContractTypeVendor
	risk := model.RiskLevel("high")
	owner := uuid.New()
	orgEntity := uuid.New()
	expiringInDays := 30
	conditions, args, next := contractAuditScopeClauses(tenantID, model.ContractAuditFilters{
		ContractListFilters: model.ContractListFilters{
			Search:         "msa",
			Status:         &status,
			Statuses:       []model.ContractStatus{model.ContractStatusDraft, model.ContractStatusActive},
			Type:           &contractType,
			OwnerUserID:    &owner,
			RiskLevel:      &risk,
			Department:     "Legal",
			Tag:            "Strategic",
			OrgEntityID:    &orgEntity,
			ExpiringInDays: &expiringInDays,
		},
	})
	// tenant + search + status + statuses + type + owner + risk + department +
	// tag + org_entity + expiring_in_days = 11 args.
	if len(args) != 11 {
		t.Fatalf("args = %d, want 11 (%v)", len(args), args)
	}
	if next != 12 {
		t.Fatalf("next arg = %d, want 12", next)
	}
	where := strings.Join(conditions, " AND ")
	for _, want := range []string{
		"c.status = $", "c.status = ANY($", "c.type = $", "c.owner_user_id = $",
		"c.risk_level = $", "c.department = $", " = ANY(c.tags)",
		"c.org_entity_id = $", "c.expiry_date IS NOT NULL AND c.expiry_date <= CURRENT_DATE + $",
	} {
		if !strings.Contains(where, want) {
			t.Fatalf("WHERE missing %q: %s", want, where)
		}
	}
	// Tag filter is lowercased to match ContractRepository.List semantics.
	found := false
	for _, arg := range args {
		if arg == "strategic" {
			found = true
		}
	}
	if !found {
		t.Fatalf("tag arg not lowercased: %v", args)
	}
	assertPlaceholdersCoverArgs(t, where, args)
}

func TestContractAuditWindowClauses(t *testing.T) {
	from := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 7, 1, 0, 0, 0, 0, time.UTC)
	conditions, args, next := contractAuditWindowClauses(model.ContractAuditFilters{From: &from, To: &to}, 3)
	if len(conditions) != 2 || len(args) != 2 {
		t.Fatalf("conditions/args = %v / %v, want 2 each", conditions, args)
	}
	if next != 5 {
		t.Fatalf("next arg = %d, want 5", next)
	}
	if conditions[0] != "e.occurred_at >= $3" {
		t.Fatalf("from condition = %q (inclusive lower bound expected)", conditions[0])
	}
	if conditions[1] != "e.occurred_at < $4" {
		t.Fatalf("to condition = %q (exclusive upper bound expected)", conditions[1])
	}

	// No window → no conditions, arg index unchanged.
	conditions, args, next = contractAuditWindowClauses(model.ContractAuditFilters{}, 3)
	if len(conditions) != 0 || len(args) != 0 || next != 3 {
		t.Fatalf("empty window produced %v / %v / %d", conditions, args, next)
	}
}

// TestContractAuditEventsCTEPlaceholderFree pins the projection CTE as
// parameter-free: every $N in the final query must come from the two clause
// builders, so the CTE itself must never introduce positional placeholders.
func TestContractAuditEventsCTEPlaceholderFree(t *testing.T) {
	if placeholderRe.MatchString(contractAuditEventsCTE) {
		t.Fatalf("contractAuditEventsCTE must not contain positional placeholders")
	}
	// Each UNION branch selects the same 12-column tuple; a drifted branch
	// breaks row_to_json field names. Count SELECTs as a cheap structural pin.
	if got := strings.Count(contractAuditEventsCTE, "UNION ALL"); got != 5 {
		t.Fatalf("expected 5 UNION ALL branches (6 event sources), got %d", got)
	}
}
