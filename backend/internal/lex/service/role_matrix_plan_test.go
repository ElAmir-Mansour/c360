package service

import (
	"testing"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
)

func boolPtr(b bool) *bool { return &b }

// baselineCurrent materializes the 14 code-map roles as the tenant's current
// state — the exact composition the service uses for a never-imported tenant.
func baselineCurrent() map[string]roleMatrixCurrentRole {
	out := make(map[string]roleMatrixCurrentRole)
	for slug, snap := range legalBaselineDefs() {
		out[slug] = roleMatrixCurrentRole{Snapshot: snap, Enforced: true}
	}
	return out
}

// baselineGrants converts the code-map defs into a full import payload — the
// "round-trip the template unchanged" case, which MUST validate cleanly.
func baselineGrants() map[string][]string {
	grants := make(map[string][]string)
	for _, def := range auth.LegalAffairsRoleDefs {
		grants[def.Slug] = append([]string(nil), def.Permissions...)
	}
	return grants
}

func issueCodes(issues []model.RoleMatrixIssue) map[string]bool {
	out := make(map[string]bool, len(issues))
	for _, issue := range issues {
		out[issue.CodeKey] = true
	}
	return out
}

func TestPlanRoleMatrix_BaselineRoundTripIsClean(t *testing.T) {
	req := dto.RoleMatrixImportRequest{Mode: "merge", DryRun: true, Grants: baselineGrants()}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if len(plan.Errors) != 0 {
		t.Fatalf("baseline round-trip must validate cleanly; got errors: %+v", plan.Errors)
	}
	if len(plan.Warnings) != 0 {
		t.Fatalf("baseline round-trip must raise no warnings; got: %+v", plan.Warnings)
	}
	if plan.Diff.GrantsAdded != 0 || plan.Diff.GrantsRemoved != 0 || len(plan.Diff.RolesChanged) != 0 {
		t.Fatalf("baseline round-trip must be a no-op diff; got %+v", plan.Diff)
	}
	if plan.RoleCount != 14 {
		t.Fatalf("expected 14 roles in the snapshot, got %d", plan.RoleCount)
	}
}

func TestPlanRoleMatrix_UnknownPermissionRejected(t *testing.T) {
	grants := baselineGrants()
	grants["legal-officer"] = append(grants["legal-officer"], "lex:case:supersede")
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Errors)["unknown_permission"] {
		t.Fatalf("unknown permission must be rejected; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_UnknownRoleRejected(t *testing.T) {
	grants := baselineGrants()
	grants["legal-phantom"] = []string{"lex:case:view"}
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Errors)["unknown_role"] {
		t.Fatalf("granting an un-rostered role must be rejected; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_CustomRoleNeedsRosterAndName(t *testing.T) {
	grants := baselineGrants()
	grants["legal-paralegal"] = []string{"lex:document:view", "lex:document:add"}
	req := dto.RoleMatrixImportRequest{
		Mode:   "merge",
		Roles:  []dto.RoleMatrixImportRole{{Slug: "legal-paralegal", Active: boolPtr(true)}}, // no name
		Grants: grants,
	}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Errors)["missing_name"] {
		t.Fatalf("nameless custom role must be rejected; errors: %+v", plan.Errors)
	}

	req.Roles[0].NameEN = "Paralegal"
	plan = planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if len(plan.Errors) != 0 {
		t.Fatalf("named custom role must validate; errors: %+v", plan.Errors)
	}
	found := false
	for _, snap := range plan.Snapshot {
		if snap.Slug == "legal-paralegal" {
			found = true
			if snap.IsSystem {
				t.Fatal("custom role must not be marked system")
			}
			if len(snap.Permissions) != 2 {
				t.Fatalf("custom role grants wrong: %v", snap.Permissions)
			}
		}
	}
	if !found {
		t.Fatal("custom role missing from the snapshot")
	}
	// Diff must report the addition.
	if len(plan.Diff.RolesAdded) != 1 || plan.Diff.RolesAdded[0] != "legal-paralegal" {
		t.Fatalf("diff must report the added role; got %+v", plan.Diff)
	}
}

func TestPlanRoleMatrix_AuditorStaysReadOnly(t *testing.T) {
	grants := baselineGrants()
	grants["legal-auditor"] = append(grants["legal-auditor"], "lex:case:edit")
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Errors)["auditor_readonly_violation"] {
		t.Fatalf("auditor write grant must be rejected; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_LockoutGuard(t *testing.T) {
	// Strip role:manage from the only role that has it (the system admin).
	grants := baselineGrants()
	stripped := make([]string, 0)
	for _, perm := range grants["legal-system-admin"] {
		if perm != auth.PermLexRoleManage {
			stripped = append(stripped, perm)
		}
	}
	grants["legal-system-admin"] = stripped
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Errors)["lockout_role_manage"] {
		t.Fatalf("removing the last role:manage must be blocked; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_ElevatedGrantWarnings(t *testing.T) {
	grants := baselineGrants()
	grants["legal-officer"] = append(grants["legal-officer"], auth.PermLexRoleManage, auth.PermWorkflowWrite, auth.PermAuditRead)
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if len(plan.Errors) != 0 {
		t.Fatalf("warnings must not be errors on dry-run; errors: %+v", plan.Errors)
	}
	codes := issueCodes(plan.Warnings)
	for _, want := range []string{"warning_role_admin_grant", "warning_workflow_write_grant", "warning_audit_read_grant"} {
		if !codes[want] {
			t.Errorf("expected warning %s; warnings: %+v", want, plan.Warnings)
		}
	}
	// Supervisor is an authoring-tier slug: workflow:write must NOT warn there.
	grants2 := baselineGrants()
	grants2["legal-case-supervisor"] = append(grants2["legal-case-supervisor"], auth.PermWorkflowWrite)
	req2 := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants2}
	req2.Normalize()
	plan2 := planRoleMatrixImport(req2, baselineCurrent(), roleMatrixImporter{})
	if issueCodes(plan2.Warnings)["warning_workflow_write_grant"] {
		t.Fatal("workflow:write on an authoring-tier role must not warn")
	}
}

func TestPlanRoleMatrix_ReplaceModeDeactivatesUnmentioned(t *testing.T) {
	grants := baselineGrants()
	delete(grants, "legal-bu-ceo") // drop one baseline role from the payload
	req := dto.RoleMatrixImportRequest{Mode: "replace", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if len(plan.Errors) != 0 {
		t.Fatalf("replace with a kept role:manage must validate; errors: %+v", plan.Errors)
	}
	deactivated := false
	for _, snap := range plan.Snapshot {
		if snap.Slug == "legal-bu-ceo" {
			if snap.Active {
				t.Fatal("replace mode must deactivate unmentioned roles")
			}
			deactivated = true
		}
	}
	if !deactivated {
		t.Fatal("unmentioned role must remain in the snapshot as inactive")
	}
	found := false
	for _, slug := range plan.Diff.RolesDeactivated {
		if slug == "legal-bu-ceo" {
			found = true
		}
	}
	if !found {
		t.Fatalf("diff must report the deactivation; got %+v", plan.Diff)
	}
}

func TestPlanRoleMatrix_MergeModeKeepsUnmentioned(t *testing.T) {
	req := dto.RoleMatrixImportRequest{
		Mode:   "merge",
		Grants: map[string][]string{"legal-officer": {"lex:case:view", "lex:document:view"}},
	}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if len(plan.Errors) != 0 {
		t.Fatalf("merge of one role must validate; errors: %+v", plan.Errors)
	}
	if plan.RoleCount != 14 {
		t.Fatalf("merge must keep all current roles in the snapshot; got %d", plan.RoleCount)
	}
	for _, snap := range plan.Snapshot {
		switch snap.Slug {
		case "legal-officer":
			if len(snap.Permissions) != 2 {
				t.Fatalf("merged role grants wrong: %v", snap.Permissions)
			}
		case "legal-director":
			if len(snap.Permissions) == 0 || !snap.Active {
				t.Fatal("unmentioned roles must keep their current grants in merge mode")
			}
		}
	}
}

func TestPlanRoleMatrix_AutoGrantedKeysIgnoredSilently(t *testing.T) {
	grants := baselineGrants()
	grants["legal-officer"] = append(grants["legal-officer"], "workflow:read", "workflow:task", "lex:reference:view")
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if len(plan.Errors) != 0 {
		t.Fatalf("auto-granted keys must be ignored, not rejected; errors: %+v", plan.Errors)
	}
	for _, snap := range plan.Snapshot {
		if snap.Slug != "legal-officer" {
			continue
		}
		for _, perm := range snap.Permissions {
			if perm == "workflow:read" || perm == "workflow:task" || perm == "lex:reference:view" {
				t.Fatalf("auto-granted key %s must be stripped from the snapshot", perm)
			}
		}
	}
	// And the no-op diff must hold (stripping restores the baseline exactly).
	if plan.Diff.GrantsAdded != 0 || plan.Diff.GrantsRemoved != 0 {
		t.Fatalf("expected no-op diff after stripping; got %+v", plan.Diff)
	}
}

func TestPlanRoleMatrix_InvalidModeAndEmpty(t *testing.T) {
	req := dto.RoleMatrixImportRequest{Mode: "overwrite", Grants: baselineGrants()}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Errors)["invalid_mode"] {
		t.Fatalf("invalid mode must be rejected; errors: %+v", plan.Errors)
	}
	empty := dto.RoleMatrixImportRequest{Mode: "merge", Grants: map[string][]string{}}
	empty.Normalize()
	plan = planRoleMatrixImport(empty, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Errors)["empty_matrix"] {
		t.Fatalf("empty matrix must be rejected; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_MergeEmptyColumnIsNoStatement(t *testing.T) {
	// A blank column in merge mode must NOT wipe the role — it means "no
	// change", so the role keeps its current grants and the diff is a no-op.
	req := dto.RoleMatrixImportRequest{
		Mode: "merge",
		Grants: map[string][]string{
			"legal-officer":  {}, // blank column
			"legal-director": {"lex:case:view"},
		},
	}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if len(plan.Errors) != 0 {
		t.Fatalf("merge with a blank column must validate; errors: %+v", plan.Errors)
	}
	for _, snap := range plan.Snapshot {
		if snap.Slug == "legal-officer" {
			if len(snap.Permissions) == 0 || !snap.Active {
				t.Fatal("a blank merge column must leave the role's current grants intact")
			}
		}
	}
}

func TestPlanRoleMatrix_ReservedSlugRejected(t *testing.T) {
	for _, slug := range []string{"super-admin", "tenant-admin", "viewer"} {
		grants := baselineGrants()
		grants[slug] = []string{"lex:case:view"}
		req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
		req.Normalize()
		plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
		if !issueCodes(plan.Errors)["reserved_role_slug"] {
			t.Fatalf("platform slug %q must be rejected as reserved; errors: %+v", slug, plan.Errors)
		}
	}
}

func TestPlanRoleMatrix_ReplaceStripWarnsAndDeactivateWarns(t *testing.T) {
	// Replace mode dropping a role entirely raises the deactivation warning.
	grants := baselineGrants()
	delete(grants, "legal-bu-ceo")
	req := dto.RoleMatrixImportRequest{Mode: "replace", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if !issueCodes(plan.Warnings)["warning_role_deactivated"] {
		t.Fatalf("dropping a role in replace mode must warn about deactivation; warnings: %+v", plan.Warnings)
	}
}

func TestPlanRoleMatrix_SelfEscalationBlocked(t *testing.T) {
	// The importer holds legal-officer but NOT lex:contract:approve. An import
	// that grants legal-officer (their own role) lex:contract:approve must be
	// blocked as self-escalation.
	held := map[string]bool{"legal-officer": true}
	// Realistic effective-permission oracle: the importer effectively holds
	// exactly what legal-officer grants in the code map (they do NOT hold
	// contract:approve).
	has := func(perm string) bool { return auth.HasPermission([]string{"legal-officer"}, perm) }
	importer := roleMatrixImporter{HeldSlugs: held, Has: has}

	grants := baselineGrants()
	grants["legal-officer"] = append(grants["legal-officer"], auth.PermLexContractApprove)
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), importer)
	if !issueCodes(plan.Errors)["self_escalation"] {
		t.Fatalf("granting your OWN role a permission you lack must be blocked; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_ConfiguringOtherRolesIsAllowed(t *testing.T) {
	// The importer holds ONLY legal-system-admin (config-only: role:manage, no
	// operational grants). Granting an OPERATIONAL permission to a DIFFERENT
	// role (legal-officer) must be allowed — that is the feature, gated by
	// four-eyes activation, not by per-permission anti-escalation.
	held := map[string]bool{"legal-system-admin": true}
	// Realistic oracle: the importer effectively holds exactly what
	// legal-system-admin grants (config keys, no operational grants).
	has := func(perm string) bool { return auth.HasPermission([]string{"legal-system-admin"}, perm) }
	importer := roleMatrixImporter{HeldSlugs: held, Has: has}

	grants := baselineGrants()
	grants["legal-officer"] = append(grants["legal-officer"], auth.PermLexContractApprove)
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), importer)
	if issueCodes(plan.Errors)["self_escalation"] {
		t.Fatalf("configuring a role the importer does NOT hold must not be self-escalation; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_SelfConfigWithHeldPermIsAllowed(t *testing.T) {
	// The importer holds legal-director AND already effectively holds the
	// permission being granted to their own role — no escalation, so allowed
	// (e.g. re-affirming a grant, or reordering). Adding only perms they already
	// have must not trip the guard.
	held := map[string]bool{"legal-director": true}
	has := func(perm string) bool { return true } // holds everything they'd grant
	importer := roleMatrixImporter{HeldSlugs: held, Has: has}

	grants := baselineGrants()
	grants["legal-director"] = append(grants["legal-director"], auth.PermLexContractApprove)
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants}
	req.Normalize()
	plan := planRoleMatrixImport(req, baselineCurrent(), importer)
	if issueCodes(plan.Errors)["self_escalation"] {
		t.Fatalf("granting your own role a permission you ALREADY hold must be allowed; errors: %+v", plan.Errors)
	}
}

func TestPlanRoleMatrix_ReactivationRestoresNothingUnchecked(t *testing.T) {
	// General form of the reactivation bypass: a held role that is currently
	// INACTIVE (tombstoned → grants nothing) but whose stored grants are
	// non-empty. Reactivating it with unchanged grants must be flagged for every
	// grant the importer does not effectively hold — the guard must NOT trust
	// the diff's Added set (which is empty here).
	current := baselineCurrent()
	current["legal-special"] = roleMatrixCurrentRole{
		Snapshot: model.RoleMatrixRoleSnapshot{
			Slug: "legal-special", NameEN: "Special", Active: false,
			Permissions: []string{auth.PermLexContractApprove, auth.PermLexCaseView},
		},
		Enforced: false,
	}
	held := map[string]bool{"legal-special": true}
	// Tombstoned ⇒ importer effectively holds nothing from legal-special.
	has := func(string) bool { return false }
	importer := roleMatrixImporter{HeldSlugs: held, Has: has}

	grants := baselineGrants()
	grants["legal-special"] = []string{auth.PermLexContractApprove, auth.PermLexCaseView}
	roles := []dto.RoleMatrixImportRole{{Slug: "legal-special", NameEN: "Special", Active: boolPtr(true)}}
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: grants, Roles: roles}
	req.Normalize()
	plan := planRoleMatrixImport(req, current, importer)

	if !issueCodes(plan.Errors)["self_escalation"] {
		t.Fatalf("reactivating a tombstoned held role must be flagged; errors=%+v", plan.Errors)
	}
	// BOTH retained grants must be flagged (not just a diff-Added subset).
	flagged := 0
	for _, e := range plan.Errors {
		if e.CodeKey == "self_escalation" && e.RoleSlug == "legal-special" {
			flagged++
		}
	}
	if flagged != 2 {
		t.Fatalf("both retained grants must be flagged, got %d", flagged)
	}
}

func TestRoleMatrixChecksum_Deterministic(t *testing.T) {
	req := dto.RoleMatrixImportRequest{Mode: "merge", Grants: baselineGrants()}
	req.Normalize()
	planA := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	planB := planRoleMatrixImport(req, baselineCurrent(), roleMatrixImporter{})
	if roleMatrixChecksum(planA.Snapshot) == "" {
		t.Fatal("checksum must not be empty")
	}
	if roleMatrixChecksum(planA.Snapshot) != roleMatrixChecksum(planB.Snapshot) {
		t.Fatal("identical imports must produce identical checksums")
	}
}
