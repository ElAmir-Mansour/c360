package auth

import "testing"

// TestSuperAdminRolePermissions_PlatformAdminConsole asserts the super_admin
// role's documented permission set now lists the platform-admin-console and
// audit-hardening permissions, and that HasPermission resolves the
// high-sensitivity impersonate scope for super_admin while a tenant_admin is
// denied it.
func TestSuperAdminRolePermissions_PlatformAdminConsole(t *testing.T) {
	perms := RolePermissions["super_admin"]
	want := []string{
		PermAdminConsole,               // "admin:console"
		PermPlatformTenantsImpersonate, // "platform:tenants:impersonate"
		PermPlatformFleetRead,          // "platform:fleet:read"
		PermAuditReadAll,               // "audit:read:all"
	}
	for _, w := range want {
		found := false
		for _, p := range perms {
			if p == w {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("super_admin permission set must contain %q", w)
		}
	}
}

// TestHasPermission_ImpersonateScope verifies super_admin satisfies the
// impersonate scope (via admin:* wildcard) while tenant_admin does not.
func TestHasPermission_ImpersonateScope(t *testing.T) {
	if !HasPermission([]string{"super_admin"}, PermPlatformTenantsImpersonate) {
		t.Errorf("super_admin must satisfy %s", PermPlatformTenantsImpersonate)
	}
	if HasPermission([]string{"tenant_admin"}, PermPlatformTenantsImpersonate) {
		t.Errorf("tenant_admin must NOT satisfy %s", PermPlatformTenantsImpersonate)
	}
	// Sanity: the new fleet-read + cross-tenant audit perms also resolve for super_admin.
	for _, p := range []string{PermAdminConsole, PermPlatformFleetRead, PermAuditReadAll} {
		if !HasPermission([]string{"super_admin"}, p) {
			t.Errorf("super_admin must satisfy %s", p)
		}
	}
}
