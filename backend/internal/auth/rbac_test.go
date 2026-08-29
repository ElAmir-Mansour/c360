package auth

import "testing"

func TestHasPermission_NormalizesHyphenatedRoleSlugs(t *testing.T) {
	if !HasPermission([]string{"tenant-admin"}, PermUserWrite) {
		t.Fatal("expected tenant-admin slug to grant tenant_admin permissions")
	}
	if !HasPermission([]string{"super-admin"}, PermAdminAll) {
		t.Fatal("expected super-admin slug to grant super_admin permissions")
	}
}

// Tenant Admin is the tenant-scoped full-administration role. The database
// seeder advertises its suite wildcards, while service authorization resolves
// only the role slug through RolePermissions. Keep the two representations
// aligned so a tenant admin can manage users and all Watheeq configuration
// without becoming a cross-tenant super admin.
func TestTenantAdminHasFullTenantAndWatheeqAdministration(t *testing.T) {
	for _, permission := range []string{
		"users:create",
		"users:*",
		"roles:manage",
		PermLexSecurityManage,
		PermLexRoleManage,
		PermLexNotificationManage,
		PermLexIntegrationManage,
		PermLexCatalogManage,
		PermLexSLAManage,
	} {
		if !HasPermission([]string{"tenant-admin"}, permission) {
			t.Fatalf("tenant-admin must satisfy %q", permission)
		}
	}

	for _, platformPermission := range []string{
		PermPlatformTenantsRead,
		PermPlatformTenantsImpersonate,
	} {
		if HasPermission([]string{"tenant-admin"}, platformPermission) {
			t.Fatalf("tenant-admin must not satisfy cross-tenant %q", platformPermission)
		}
	}

	for _, operationalDecision := range []string{
		PermLexApprove,
		PermLexClose,
		PermLexCaseAssign,
		PermLexCaseApprove,
		PermLexCaseClose,
		PermLexContractDistribute,
		PermLexContractApprove,
		PermLexContractClose,
	} {
		if HasPermission([]string{"tenant-admin"}, operationalDecision) {
			t.Fatalf("tenant-admin must not satisfy legal decision permission %q", operationalDecision)
		}
	}
}

// TestLexApprovalGranularPermissions asserts the new lex:approval:* permissions
// are satisfied by the super_admin wildcard, tenant_admin's explicit grants, and
// the read variants for analyst/viewer — and that destructive admin scope is NOT
// granted to read-only roles.
func TestLexApprovalGranularPermissions(t *testing.T) {
	// super_admin (admin:*) satisfies all granular approval permissions.
	for _, p := range []string{PermLexApprovalRead, PermLexApprovalWrite, PermLexApprovalAdmin} {
		if !HasPermission([]string{"super-admin"}, p) {
			t.Fatalf("super_admin must satisfy %s", p)
		}
	}
	// tenant_admin carries all three explicitly.
	for _, p := range []string{PermLexApprovalRead, PermLexApprovalWrite, PermLexApprovalAdmin} {
		if !HasPermission([]string{"tenant_admin"}, p) {
			t.Fatalf("tenant_admin must satisfy %s", p)
		}
	}
	// analyst/viewer get read only.
	for _, role := range []string{"analyst", "viewer"} {
		if !HasPermission([]string{role}, PermLexApprovalRead) {
			t.Fatalf("%s must satisfy %s", role, PermLexApprovalRead)
		}
		if HasPermission([]string{role}, PermLexApprovalAdmin) {
			t.Fatalf("%s must NOT satisfy %s", role, PermLexApprovalAdmin)
		}
		if HasPermission([]string{role}, PermLexApprovalWrite) {
			t.Fatalf("%s must NOT satisfy %s", role, PermLexApprovalWrite)
		}
	}
}

// TestLexIntegrationGranularPermissions verifies the Integration Platform RBAC:
// super_admin (admin:*) and tenant_admin satisfy both verbs, analyst/viewer get
// read only, and a coarse lex:* wildcard satisfies both via the wildcard match
// (so existing IAM-seeded legal roles keep working under the route fallbacks).
func TestLexIntegrationGranularPermissions(t *testing.T) {
	for _, p := range []string{PermLexIntegrationRead, PermLexIntegrationManage} {
		if !HasPermission([]string{"super-admin"}, p) {
			t.Fatalf("super_admin must satisfy %s", p)
		}
		if !HasPermission([]string{"tenant_admin"}, p) {
			t.Fatalf("tenant_admin must satisfy %s", p)
		}
	}
	for _, role := range []string{"analyst", "viewer"} {
		if !HasPermission([]string{role}, PermLexIntegrationRead) {
			t.Fatalf("%s must satisfy %s", role, PermLexIntegrationRead)
		}
		if HasPermission([]string{role}, PermLexIntegrationManage) {
			t.Fatalf("%s must NOT satisfy %s", role, PermLexIntegrationManage)
		}
	}
	RolePermissions["lex_integration_wildcard_test_role"] = []string{"lex:*"}
	defer delete(RolePermissions, "lex_integration_wildcard_test_role")
	for _, p := range []string{PermLexIntegrationRead, PermLexIntegrationManage} {
		if !HasPermission([]string{"lex_integration_wildcard_test_role"}, p) {
			t.Fatalf("lex:* wildcard must satisfy %s", p)
		}
	}
}

func TestServiceVisusRoleReadOnlySuiteAccess(t *testing.T) {
	for _, p := range []string{PermCyberRead, PermDataRead, PermActaRead, PermLexRead} {
		if !HasPermission([]string{"service:visus"}, p) {
			t.Fatalf("service:visus should have %s", p)
		}
	}
	for _, p := range []string{PermCyberWrite, PermDataWrite, PermActaWrite, PermLexWrite, PermVisusWrite} {
		if HasPermission([]string{"service:visus"}, p) {
			t.Fatalf("service:visus should not have %s", p)
		}
	}
}

// TestLexWildcardSatisfiesGranularApproval guards the route-gating assumption
// that a coarse lex:* wildcard (carried by IAM-seeded legal roles) grants the
// granular approval permissions via the wildcard match.
func TestLexWildcardSatisfiesGranularApproval(t *testing.T) {
	// Inject a synthetic role with a lex:* wildcard to mirror the IAM seed.
	RolePermissions["lex_wildcard_test_role"] = []string{"lex:*"}
	defer delete(RolePermissions, "lex_wildcard_test_role")
	for _, p := range []string{PermLexApprovalRead, PermLexApprovalWrite, PermLexApprovalAdmin} {
		if !HasPermission([]string{"lex_wildcard_test_role"}, p) {
			t.Fatalf("lex:* wildcard must satisfy %s", p)
		}
	}
}
