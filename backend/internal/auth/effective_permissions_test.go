package auth

import "testing"

func contains(set []string, want string) bool {
	for _, p := range set {
		if p == want {
			return true
		}
	}
	return false
}

// TestEffectivePermissions_ExpandsActiveRole proves EffectivePermissions returns
// the SAME expanded set HasPermission evaluates: it applies expandGrants, so the
// implied :view keys are present and elevated verbs are NOT cross-implied.
func TestEffectivePermissions_ExpandsActiveRole(t *testing.T) {
	// legal-director carries the granular case verbs incl. approve/assign/close.
	perms := EffectivePermissions([]string{"legal-director"})
	for _, want := range []string{
		PermLexCaseApprove, PermLexCaseAssign, PermLexCaseClose,
		PermLexCaseView, // implied by the operational verbs via expandGrants.
		PermLexContractDistribute, PermLexCatalogManage,
		PermLexCatalogView, // implied by manage on a config domain.
	} {
		if !contains(perms, want) {
			t.Errorf("legal-director effective perms must include %s", want)
		}
	}

	// legal-officer drafts but cannot approve/assign/close cases.
	officer := EffectivePermissions([]string{"legal-officer"})
	if !contains(officer, PermLexCaseEdit) || !contains(officer, PermLexCaseView) ||
		!contains(officer, PermLexConsultationView) {
		t.Fatalf("legal-officer must have case view+edit and consultation view")
	}
	for _, deny := range []string{PermLexCaseApprove, PermLexCaseAssign, PermLexCaseClose} {
		if contains(officer, deny) {
			t.Errorf("legal-officer effective perms must NOT include %s (no cross-verb implication)", deny)
		}
	}

	// Hyphen/underscore normalization parity with HasPermission.
	if a, b := EffectivePermissions([]string{"legal-director"}), EffectivePermissions([]string{"legal_director"}); len(a) != len(b) {
		t.Fatalf("slug normalization must produce identical sets: %d vs %d", len(a), len(b))
	}

	// Unknown slug contributes nothing.
	if got := EffectivePermissions([]string{"not-a-role"}); len(got) != 0 {
		t.Errorf("unknown slug must yield empty set, got %v", got)
	}
}

// TestEffectivePermissions_MatchesHasPermission asserts that for every permission
// in the returned set, HasPermission([role], perm) is also true — i.e. the helper
// never returns a permission the authoritative checker would deny.
func TestEffectivePermissions_MatchesHasPermission(t *testing.T) {
	for _, role := range []string{"legal-director", "legal-officer", "legal-auditor", "legal-system-admin"} {
		for _, p := range EffectivePermissions([]string{role}) {
			if !HasPermission([]string{role}, p) {
				t.Errorf("role %s: EffectivePermissions returned %s but HasPermission denies it", role, p)
			}
		}
	}
}

func TestEffectivePermissions_LegalRolesCarryWorkflowBaseline(t *testing.T) {
	for _, def := range LegalAffairsRoleDefs {
		perms := EffectivePermissions([]string{def.Slug})
		for _, want := range []string{PermWorkflowRead, PermWorkflowTask} {
			if !contains(perms, want) {
				t.Errorf("%s effective perms must include %s", def.Slug, want)
			}
		}
	}
}

// TestLegalRoleDefBySlug resolves both slug forms and rejects non-legal slugs.
func TestLegalRoleDefBySlug(t *testing.T) {
	if d := LegalRoleDefBySlug("legal-cases-manager"); d == nil || d.Slug != "legal-cases-manager" {
		t.Fatal("expected to resolve legal-cases-manager")
	}
	if d := LegalRoleDefBySlug("legal_cases_manager"); d == nil || d.Slug != "legal-cases-manager" {
		t.Fatal("expected underscore form to resolve to the same def")
	}
	if d := LegalRoleDefBySlug("tenant_admin"); d != nil {
		t.Fatal("tenant_admin is not a legal-affairs role")
	}
}
