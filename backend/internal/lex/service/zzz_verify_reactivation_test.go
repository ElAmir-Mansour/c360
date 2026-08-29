package service

import (
	"testing"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

// Scenario: a custom role the importer HOLDS exists as an inactive import row
// with a STALE non-empty permissions column (overlay tombstone => importer
// effectively holds nothing). A merge that reactivates that same role with the
// same perms must be caught as self_escalation, because the importer gains
// enforced authority they do not currently hold.
func TestVerify_ReactivationSelfEscalationBypass(t *testing.T) {
	current := baselineCurrent()
	// Inactive, non-enforced custom role held by the importer, with a stale
	// non-empty permissions column (as reconcile-phantoms leaves it).
	current["legal-special"] = roleMatrixCurrentRole{
		Snapshot: model.RoleMatrixRoleSnapshot{
			Slug:        "legal-special",
			NameEN:      "Special",
			Active:      false,
			Permissions: []string{auth.PermLexContractApprove},
		},
		Enforced: false,
	}

	held := map[string]bool{"legal-special": true}
	// Overlay tombstone: importer effectively holds only case:view, NOT approve.
	has := func(perm string) bool { return perm == auth.PermLexCaseView }
	importer := roleMatrixImporter{HeldSlugs: held, Has: has}

	grants := baselineGrants()
	grants["legal-special"] = []string{auth.PermLexContractApprove}
	roles := []dto.RoleMatrixImportRole{{Slug: "legal-special", NameEN: "Special", Active: boolPtr(true)}}
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants, Roles: roles}
	req.Normalize()

	plan := planRoleMatrixImport(req, current, importer)

	// Show the diff for legal-special.
	for _, rc := range plan.Diff.RolesChanged {
		if rc.RoleSlug == "legal-special" {
			t.Logf("RolesChanged legal-special Added=%v Removed=%v", rc.Added, rc.Removed)
		}
	}
	t.Logf("RolesAdded=%v", plan.Diff.RolesAdded)
	t.Logf("self_escalation flagged=%v", issueCodes(plan.Errors)["self_escalation"])

	if !issueCodes(plan.Errors)["self_escalation"] {
		t.Fatalf("BYPASS CONFIRMED: reactivating held role with unheld perm was NOT flagged; errors=%+v", plan.Errors)
	}
}
