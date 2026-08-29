package repository

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestUndefinedWorkforceRosterOnlyMatchesMembershipRelation(t *testing.T) {
	membershipMissing := &pgconn.PgError{Code: "42P01", Message: `relation "legal_org_memberships" does not exist`}
	if !isUndefinedWorkforceRoster(membershipMissing) {
		t.Fatal("missing legal_org_memberships must activate the approved unscoped fallback")
	}

	for _, err := range []error{
		&pgconn.PgError{Code: "42P01", Message: `relation "legal_org_roles" does not exist`},
		&pgconn.PgError{Code: "42703", Message: `column "capacity_units" does not exist`},
		errors.New("unrelated storage failure"),
	} {
		if isUndefinedWorkforceRoster(err) {
			t.Fatalf("error %v must not fail open to unscoped workforce access", err)
		}
	}
}

func TestWorkforceAttributionStatusSemanticsStayAlignedWithApprovedContract(t *testing.T) {
	checks := map[string][]string{
		"contracts": {
			"status IN ('draft','internal_review','legal_review','negotiation','pending_signature','suspended') AS is_open",
			"status IN ('active','expired','terminated','renewed') AS is_resolved",
		},
		"cases": {
			"status IN ('intake','phase1','phase2','open','under_procedure') AS is_open",
			"status = 'closed' AS is_resolved",
		},
		"consultations": {
			"status IN ('submitted','classified','routed') AS is_open",
			"status IN ('responded','approved','archived') AS is_resolved",
		},
		"matters": {
			"status IN ('intake','open','in_review','waiting_on_business','on_hold') AS is_open",
			"status = 'closed' AS is_resolved",
		},
		"obligations": {
			"status IN ('open','in_progress','blocked') AS is_open",
			"status = 'completed' AS is_resolved",
		},
		"contract_intakes": {
			"status IN ('received','acknowledged','routed_to_legal','under_review') AS is_open",
			"status = 'completed' AS is_resolved",
		},
		"support": {
			"status IN ('open','accepted') AS is_open",
			"status = 'resolved' AS is_resolved",
		},
	}

	for domain, fragments := range checks {
		query := workforceAttributionSQL[domain]
		for _, fragment := range fragments {
			if !strings.Contains(query, fragment) {
				t.Fatalf("%s attribution query is missing approved status clause %q", domain, fragment)
			}
		}
	}
	if strings.Contains(workforceAttributionSQL["contract_intakes"], "status = 'returned' AS is_resolved") {
		t.Fatal("returned is a loop-back intake state and must not be treated as resolved")
	}
	if strings.Contains(workforceAttributionSQL["support"], "status IN ('resolved','declined','expired','cancelled') AS is_resolved") {
		t.Fatal("declined, expired, and cancelled support requests must not improve resolution metrics")
	}
	requests := workforceAttributionSQL["requests"]
	for _, fragment := range []string{
		"s.status NOT IN ('draft','delivered','closed','cancelled') AS is_open",
		"s.status IN ('delivered','closed') AS is_resolved",
	} {
		if !strings.Contains(requests, fragment) {
			t.Fatalf("request attribution query is missing reporting-aligned lifecycle clause %q", fragment)
		}
	}
}

func TestWorkforceAttributionUsesOnlyVerifiableTerminalTimestamps(t *testing.T) {
	for domain, fragments := range map[string][]string{
		"contracts": {
			"status_changed_at >= created_at",
			"status_changed_at < now()",
		},
		"matters": {
			"closed_at >= created_at",
			"closed_at < now()",
		},
		"obligations": {
			"completed_at >= created_at",
			"completed_at < now()",
		},
		"consultations": {
			"COALESCE(responded_at, approved_at, archived_at) >= created_at",
			"COALESCE(responded_at, approved_at, archived_at) < now()",
		},
	} {
		query := workforceAttributionSQL[domain]
		for _, fragment := range fragments {
			if !strings.Contains(query, fragment) {
				t.Fatalf("%s attribution query is missing terminal timestamp guard %q", domain, fragment)
			}
		}
	}

	consultations := workforceAttributionSQL["consultations"]
	if strings.Contains(consultations, "COALESCE(archived_at, approved_at, responded_at)") {
		t.Fatal("consultation completion must anchor to the earliest resolved event, responded_at first")
	}
	for domain, fragments := range map[string][]string{
		"cases": {
			"FROM legal_case_audit_log a",
			"a.tenant_id = legal_cases.tenant_id",
			"a.case_id = legal_cases.id",
			"a.to_status = 'closed'",
			"SELECT MIN(a.created_at)",
		},
		"contract_intakes": {
			"FROM lex_contract_review_desk_audit a",
			"a.tenant_id = lex_contract_intakes.tenant_id",
			"a.subject_id = lex_contract_intakes.id",
			"a.to_status = 'completed'",
			"SELECT MIN(a.created_at)",
		},
	} {
		query := workforceAttributionSQL[domain]
		for _, fragment := range fragments {
			if !strings.Contains(query, fragment) {
				t.Fatalf("%s attribution query is missing immutable terminal-event derivation %q", domain, fragment)
			}
		}
		if strings.Contains(query, "updated_at AS closed_at") {
			t.Fatalf("%s must never approximate terminal time from mutable updated_at", domain)
		}
	}
}
