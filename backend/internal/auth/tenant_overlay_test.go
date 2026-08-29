package auth

import (
	"context"
	"errors"
	"reflect"
	"sort"
	"testing"
)

// resetOverlay guarantees no cross-test pollution of the process-global store.
func resetOverlay(t *testing.T) {
	t.Helper()
	t.Cleanup(func() { SetTenantOverlayLoader(nil) })
	SetTenantOverlayLoader(nil)
}

func TestHasPermissionForTenant_NoLoaderMatchesHasPermission(t *testing.T) {
	resetOverlay(t)
	ctx := context.Background()
	cases := []struct {
		roles    []string
		required string
	}{
		{[]string{"legal-officer"}, PermLexCaseEdit},
		{[]string{"legal-officer"}, PermLexCaseApprove},
		{[]string{"legal-system-admin"}, PermLexCatalogView}, // manage-implied view
		{[]string{"legal-auditor"}, PermLexCaseView},
		{[]string{"unknown-role"}, PermLexCaseView},
	}
	for _, tc := range cases {
		want := HasPermission(tc.roles, tc.required)
		got := HasPermissionForTenant(ctx, "tenant-a", tc.roles, tc.required)
		if got != want {
			t.Errorf("no-loader parity broken for roles=%v required=%s: got %v want %v", tc.roles, tc.required, got, want)
		}
	}
}

func TestHasPermissionForTenant_OverlayShadowsCodeMap(t *testing.T) {
	resetOverlay(t)
	ctx := context.Background()
	// Tenant A's import REVOKES case:edit from the officer and GRANTS a custom
	// paralegal role. Tenant B has no overlay.
	SetTenantOverlayLoader(func(_ context.Context, tenantID string) (map[string][]string, error) {
		if tenantID != "tenant-a" {
			return nil, nil
		}
		return map[string][]string{
			"legal_officer":   {PermLexCaseView}, // edit revoked
			"legal_paralegal": {PermLexDocumentView, PermLexDocumentAdd},
		}, nil
	})

	// Revocation bites for tenant A…
	if HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, PermLexCaseEdit) {
		t.Fatal("tenant-a officer should have case:edit REVOKED by the overlay")
	}
	if !HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, PermLexCaseView) {
		t.Fatal("tenant-a officer should keep case:view from the overlay")
	}
	// …while tenant B still resolves from the code map.
	if !HasPermissionForTenant(ctx, "tenant-b", []string{"legal-officer"}, PermLexCaseEdit) {
		t.Fatal("tenant-b officer must keep the code-map default case:edit")
	}
	// Custom role exists only through the overlay.
	if !HasPermissionForTenant(ctx, "tenant-a", []string{"legal-paralegal"}, PermLexDocumentAdd) {
		t.Fatal("tenant-a custom role grant must be honoured")
	}
	if HasPermissionForTenant(ctx, "tenant-b", []string{"legal-paralegal"}, PermLexDocumentAdd) {
		t.Fatal("custom role must NOT leak to another tenant")
	}
	// Roles absent from the overlay fall back to the code map for the SAME tenant.
	if !HasPermissionForTenant(ctx, "tenant-a", []string{"legal-director"}, PermLexCaseApprove) {
		t.Fatal("overlay-absent role must fall back to the code map")
	}
}

func TestHasPermissionForTenant_OverlayGrantsExpandAndWildcard(t *testing.T) {
	resetOverlay(t)
	ctx := context.Background()
	SetTenantOverlayLoader(func(_ context.Context, _ string) (map[string][]string, error) {
		return map[string][]string{
			"custom_config": {PermLexSLAManage},    // config manage ⇒ implies sla:view
			"custom_wild":   {"lex:integration:*"}, // domain wildcard
			"custom_super":  {PermAdminAll},        // admin:* satisfies anything
			"custom_case":   {PermLexCaseApprove},  // operational verb ⇒ implies case:view
		}, nil
	})
	if !HasPermissionForTenant(ctx, "t", []string{"custom-config"}, PermLexSLAView) {
		t.Fatal("expandGrants (manage⇒view) must apply to overlay grants")
	}
	if !HasPermissionForTenant(ctx, "t", []string{"custom-wild"}, PermLexIntegrationManage) {
		t.Fatal("domain wildcard must apply to overlay grants")
	}
	if !HasPermissionForTenant(ctx, "t", []string{"custom-super"}, PermLexCaseClose) {
		t.Fatal("admin:* must apply to overlay grants")
	}
	if !HasPermissionForTenant(ctx, "t", []string{"custom-case"}, PermLexCaseView) {
		t.Fatal("operational-verb⇒view implication must apply to overlay grants")
	}
	if HasPermissionForTenant(ctx, "t", []string{"custom-case"}, PermLexCaseEdit) {
		t.Fatal("no reverse implication: approve must not grant edit")
	}
}

func TestHasPermissionForTenant_LoaderErrorFailsOpenToDefaults(t *testing.T) {
	resetOverlay(t)
	ctx := context.Background()
	SetTenantOverlayLoader(func(_ context.Context, _ string) (map[string][]string, error) {
		return nil, errors.New("platform_core unreachable")
	})
	if !HasPermissionForTenant(ctx, "t", []string{"legal-officer"}, PermLexCaseEdit) {
		t.Fatal("loader failure must fall back to code-map defaults, not deny")
	}
	if HasPermissionForTenant(ctx, "t", []string{"legal-officer"}, PermLexCaseApprove) {
		t.Fatal("loader failure must not widen grants either")
	}
}

func TestInvalidateTenantOverlay_ReloadsNextCheck(t *testing.T) {
	resetOverlay(t)
	ctx := context.Background()
	calls := 0
	grant := []string{PermLexCaseView}
	SetTenantOverlayLoader(func(_ context.Context, _ string) (map[string][]string, error) {
		calls++
		return map[string][]string{"legal_officer": grant}, nil
	})
	if HasPermissionForTenant(ctx, "t", []string{"legal-officer"}, PermLexCaseEdit) {
		t.Fatal("first load: edit must be revoked")
	}
	if calls != 1 {
		t.Fatalf("expected 1 loader call, got %d", calls)
	}
	// Cached: another check must not reload.
	_ = HasPermissionForTenant(ctx, "t", []string{"legal-officer"}, PermLexCaseView)
	if calls != 1 {
		t.Fatalf("expected cached overlay (1 call), got %d", calls)
	}
	// Simulate a new activation restoring edit, then invalidate.
	grant = []string{PermLexCaseView, PermLexCaseEdit}
	InvalidateTenantOverlay("t")
	if !HasPermissionForTenant(ctx, "t", []string{"legal-officer"}, PermLexCaseEdit) {
		t.Fatal("post-invalidation check must see the reloaded overlay")
	}
	if calls != 2 {
		t.Fatalf("expected reload after invalidation (2 calls), got %d", calls)
	}
}

func TestEffectivePermissionsForTenant_MatchesChecker(t *testing.T) {
	resetOverlay(t)
	ctx := context.Background()
	SetTenantOverlayLoader(func(_ context.Context, tenantID string) (map[string][]string, error) {
		if tenantID != "tenant-a" {
			return nil, nil
		}
		return map[string][]string{
			"legal_officer": ApplyLegalRoleBaselines("legal-officer", []string{PermLexCaseView, PermLexSLAManage}),
		}, nil
	})
	perms := EffectivePermissionsForTenant(ctx, "tenant-a", []string{"legal-officer"})
	// The reported set must contain exactly what the checker enforces.
	for _, key := range perms {
		if !HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, key) {
			t.Errorf("effective set reports %s but the checker denies it", key)
		}
	}
	// And the manage-implied view must be present (expansion parity).
	found := false
	for _, key := range perms {
		if key == PermLexSLAView {
			found = true
		}
	}
	if !found {
		t.Fatal("effective set must include the manage-implied lex:sla:view")
	}
	// No-overlay tenant matches the legacy helper exactly.
	legacy := EffectivePermissions([]string{"legal-officer"})
	viaTenant := EffectivePermissionsForTenant(ctx, "tenant-b", []string{"legal-officer"})
	if !reflect.DeepEqual(legacy, viaTenant) {
		t.Fatal("no-overlay tenant must match EffectivePermissions verbatim")
	}
}

func TestApplyLegalRoleBaselines(t *testing.T) {
	// Universal baselines + author/reader fold-ins + dedupe.
	perms := ApplyLegalRoleBaselines("legal-director", []string{PermLexCaseView, PermWorkflowRead})
	set := map[string]bool{}
	for _, p := range perms {
		if set[p] {
			t.Fatalf("duplicate key %s in baseline fold-in", p)
		}
		set[p] = true
	}
	for _, want := range []string{PermWorkflowRead, PermWorkflowTask, PermLexReferenceView, PermWorkflowWrite, PermAuditRead} {
		if !set[want] {
			t.Errorf("director baselines must include %s", want)
		}
	}
	requester := ApplyLegalRoleBaselines("legal-requester", []string{PermLexRequestView})
	rset := map[string]bool{}
	for _, p := range requester {
		rset[p] = true
	}
	if rset[PermWorkflowWrite] || rset[PermAuditRead] {
		t.Fatal("requester must not receive author/reader fold-ins")
	}
}

func TestLexMatrixCatalogs(t *testing.T) {
	keys := LexMatrixImportableKeys()
	if !sort.StringsAreSorted(keys) {
		t.Fatal("importable keys must be sorted")
	}
	set := map[string]bool{}
	for _, k := range keys {
		set[k] = true
	}
	for _, want := range []string{PermLexCaseView, PermLexContractDistribute, PermLexWorkforceRead, PermLexSupportView, PermLexSupportCreate, PermLexSupportRespond, PermLexSupportOversee, PermLexRead, PermLexWrite, PermLexApprovalAdmin, PermWorkflowWrite, PermAuditRead} {
		if !set[want] {
			t.Errorf("importable catalog missing %s", want)
		}
	}
	for _, auto := range LexMatrixAutoGrantedKeys() {
		if set[auto] {
			t.Errorf("auto-granted key %s must not be importable", auto)
		}
	}
	if !IsLexViewOnlyPermission(PermLexCaseView) || !IsLexViewOnlyPermission(PermLexAuditRead) || !IsLexViewOnlyPermission(PermLexRead) {
		t.Fatal("view-only classifier must accept view/read keys")
	}
	if IsLexViewOnlyPermission(PermLexCaseEdit) || IsLexViewOnlyPermission(PermLexSLAManage) || IsLexViewOnlyPermission(PermLexWrite) {
		t.Fatal("view-only classifier must reject write/manage keys")
	}
}

// ── Post-review hardening tests ──────────────────────────────────────────────

// A tombstone (empty slice) for a slug present in the overlay must GRANT
// NOTHING — a deactivated baseline role can never fall back to the code map.
func TestHasPermissionForTenant_TombstoneRevokesBaseline(t *testing.T) {
	resetOverlay(t)
	// Sanity: the code map grants the officer case:view by default.
	if !HasPermission([]string{"legal-officer"}, PermLexCaseView) {
		t.Fatal("precondition: code map should grant the officer case:view")
	}
	SetTenantOverlayLoader(func(_ context.Context, tenantID string) (map[string][]string, error) {
		if tenantID != "tenant-a" {
			return nil, nil
		}
		return map[string][]string{"legal_officer": {}}, nil // tombstone
	})
	ctx := context.Background()
	if HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, PermLexCaseView) {
		t.Fatal("a tombstoned role must grant nothing, not fall back to the code map")
	}
	// A different tenant with no overlay still resolves from the code map.
	if !HasPermissionForTenant(ctx, "tenant-b", []string{"legal-officer"}, PermLexCaseView) {
		t.Fatal("tenant isolation: an un-imported tenant keeps the code-map default")
	}
}

// On a loader error AFTER a successful load, the overlay must serve the
// last-known-good map — never silently widen a narrowed role back to the code
// map default.
func TestHasPermissionForTenant_DegradeToLastKnownGood(t *testing.T) {
	resetOverlay(t)
	var fail bool
	SetTenantOverlayLoader(func(_ context.Context, tenantID string) (map[string][]string, error) {
		if fail {
			return nil, errors.New("platform_core unreachable")
		}
		// Narrow the officer: strip case:edit (grant only case:view).
		return map[string][]string{"legal_officer": {PermLexCaseView}}, nil
	})
	ctx := context.Background()
	// First load succeeds and narrows.
	if HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, PermLexCaseEdit) {
		t.Fatal("precondition: the narrowed overlay must remove case:edit")
	}
	// Force expiry + error: must degrade to last-known-good (still narrowed),
	// NOT re-grant case:edit from the code map.
	InvalidateTenantOverlay("tenant-a")
	fail = true
	if HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, PermLexCaseEdit) {
		t.Fatal("loader error must not resurrect a grant the active matrix removed")
	}
	if !HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, PermLexCaseView) {
		t.Fatal("last-known-good must retain the grants the matrix kept")
	}
}

// A never-successfully-loaded tenant that errors falls back to the code map
// (availability floor) — it can hide customisation but never mint permissions.
func TestHasPermissionForTenant_FirstLoadErrorFailsToDefaults(t *testing.T) {
	resetOverlay(t)
	SetTenantOverlayLoader(func(_ context.Context, _ string) (map[string][]string, error) {
		return nil, errors.New("down")
	})
	ctx := context.Background()
	if !HasPermissionForTenant(ctx, "tenant-a", []string{"legal-officer"}, PermLexCaseView) {
		t.Fatal("a first-load error must fall back to the code-map default")
	}
}

// Reserved platform slugs are never importable or matrix-scoped.
func TestReservedAndLegalSlugClassifiers(t *testing.T) {
	for _, slug := range []string{"super-admin", "tenant-admin", "viewer", "analyst"} {
		if !IsReservedRoleSlug(slug) {
			t.Errorf("%q must be classified as a reserved platform slug", slug)
		}
		if IsLegalMatrixRoleSlug(slug) {
			t.Errorf("%q must not be a legal-matrix slug", slug)
		}
	}
	for _, slug := range []string{"legal-officer", "legal-system-admin", "legal-director"} {
		if IsReservedRoleSlug(slug) {
			t.Errorf("%q is a legal role, must NOT be reserved", slug)
		}
		if !IsLegalMatrixRoleSlug(slug) {
			t.Errorf("%q must be a legal-matrix slug", slug)
		}
	}
	// An unknown custom slug is neither reserved nor a baseline legal role.
	if IsReservedRoleSlug("legal-paralegal") || IsLegalMatrixRoleSlug("legal-paralegal") {
		t.Fatal("an unregistered custom slug must be neither reserved nor baseline")
	}
}
