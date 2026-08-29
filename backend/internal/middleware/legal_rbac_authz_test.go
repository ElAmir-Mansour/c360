package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
)

// serveWith runs handler through mw with a context user carrying the given role
// slugs, returning the HTTP status. This mirrors the real lex route chain: the
// Auth middleware would have populated the context user from the JWT role claim;
// here we inject it directly so the test exercises the permission gate in
// isolation (the RESOLUTION path: role slug -> RolePermissions -> HasPermission).
func serveWith(mw func(http.Handler) http.Handler, roles []string) int {
	final := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := mw(final)
	req := httptest.NewRequest(http.MethodPost, "/", nil)
	ctx := auth.WithUser(req.Context(), &auth.ContextUser{
		ID:       "11111111-0000-0000-0000-000000000001",
		TenantID: "aaaaaaaa-0000-0000-0000-000000000001",
		Roles:    roles,
	})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req.WithContext(ctx))
	return rec.Code
}

// caseApproveGate replicates the lex route gate for the case-approve control
// point. design v2 §4.4 / changelog #5: the elevated verbs (approve/close/assign/
// distribute/manage) accept NO coarse fallback at all — not lex:write AND not the
// granular cross-cutting lex:approve/lex:close — so a legacy lex:write or lex:approve
// holder is DENIED. The gate is the bare RequirePermission(lex:case:approve); only
// the exact key (or a wildcard prefix-match like lex:case:* / lex:* / admin:*) passes.
// See routes.go domainElevated/domainApprove.
func caseApproveGate() func(http.Handler) http.Handler {
	return RequirePermission(auth.PermLexCaseApprove)
}

// caseAddGate is a view/add/edit route — design v2 §4.4 RETAINS the coarse
// lex:write fallback there for migration compat.
func caseAddGate() func(http.Handler) http.Handler {
	return RequireAnyPermission(auth.PermLexCaseAdd, auth.PermLexWrite)
}

func contractApproveGate() func(http.Handler) http.Handler {
	return RequirePermission(auth.PermLexContractApprove)
}

// catalogManageGate is a manage-class config route — elevated, NO coarse fallback.
func catalogManageGate() func(http.Handler) http.Handler {
	return RequirePermission(auth.PermLexCatalogManage)
}

// TestOfficerDeniedCaseApproveAllowedCaseAdd is the headline authz-denied test:
// through the SAME middleware the router uses, a legal-officer is forbidden from
// the case-approve route but permitted on case-add.
func TestOfficerDeniedCaseApproveAllowedCaseAdd(t *testing.T) {
	roles := []string{"legal-officer"}
	if got := serveWith(caseApproveGate(), roles); got != http.StatusForbidden {
		t.Errorf("officer on case-approve: got %d, want 403", got)
	}
	if got := serveWith(caseAddGate(), roles); got != http.StatusOK {
		t.Errorf("officer on case-add: got %d, want 200", got)
	}
}

// TestManagerAllowedCaseApprove confirms the counterpart authority.
func TestManagerAllowedCaseApprove(t *testing.T) {
	if got := serveWith(caseApproveGate(), []string{"legal-cases-manager"}); got != http.StatusOK {
		t.Errorf("cases-manager on case-approve: got %d, want 200", got)
	}
}

// TestRequesterDeniedAllApprovals walks every approve/close gate and asserts the
// Requester is forbidden everywhere (SoD: initiator never approves).
func TestRequesterDeniedAllApprovals(t *testing.T) {
	roles := []string{"legal-requester"}
	gates := map[string]func(http.Handler) http.Handler{
		"case-approve":     caseApproveGate(),
		"contract-approve": contractApproveGate(),
		"catalog-manage":   catalogManageGate(),
		"request-approve":  RequirePermission(auth.PermLexRequestApprove),
	}
	for name, g := range gates {
		if got := serveWith(g, roles); got != http.StatusForbidden {
			t.Errorf("requester on %s: got %d, want 403", name, got)
		}
	}
	// But the requester CAN add a request / case-domain is denied add too (no case:add).
	if got := serveWith(RequireAnyPermission(auth.PermLexRequestAdd, auth.PermLexWrite), roles); got != http.StatusOK {
		t.Errorf("requester on request-add: got %d, want 200", got)
	}
	if got := serveWith(caseAddGate(), roles); got != http.StatusForbidden {
		t.Errorf("requester on case-add: got %d, want 403 (requester has no case authority)", got)
	}
}

// TestAuditorViewOnlyThroughMiddleware: the Auditor passes view gates and is
// denied every mutating gate via the live middleware.
func TestAuditorViewOnlyThroughMiddleware(t *testing.T) {
	roles := []string{"legal-auditor"}
	if got := serveWith(RequireAnyPermission(auth.PermLexCaseView, auth.PermLexRead), roles); got != http.StatusOK {
		t.Errorf("auditor on case-view: got %d, want 200", got)
	}
	if got := serveWith(RequirePermission(auth.PermLexAuditRead), roles); got != http.StatusOK {
		t.Errorf("auditor on audit-read: got %d, want 200", got)
	}
	denied := map[string]func(http.Handler) http.Handler{
		"case-add":       caseAddGate(),
		"case-approve":   caseApproveGate(),
		"catalog-manage": catalogManageGate(),
		"case-edit":      RequireAnyPermission(auth.PermLexCaseEdit, auth.PermLexWrite),
	}
	for name, g := range denied {
		if got := serveWith(g, roles); got != http.StatusForbidden {
			t.Errorf("auditor on %s: got %d, want 403", name, got)
		}
	}
}

// TestAdminDeniedCaseApproveAllowedCatalogManage: ADM configures but cannot
// approve a case.
func TestAdminDeniedCaseApproveAllowedCatalogManage(t *testing.T) {
	roles := []string{"legal-system-admin"}
	if got := serveWith(catalogManageGate(), roles); got != http.StatusOK {
		t.Errorf("admin on catalog-manage: got %d, want 200", got)
	}
	if got := serveWith(caseApproveGate(), roles); got != http.StatusForbidden {
		t.Errorf("admin on case-approve: got %d, want 403", got)
	}
	if got := serveWith(contractApproveGate(), roles); got != http.StatusForbidden {
		t.Errorf("admin on contract-approve: got %d, want 403", got)
	}
}

// TestUnknownRoleDeniedEverywhere: a slug not in the code map resolves to zero
// permissions (the RESOLUTION finding) — proving DB-only roles enforce nothing
// unless registered.
func TestUnknownRoleDeniedEverywhere(t *testing.T) {
	roles := []string{"some-unmapped-role"}
	if got := serveWith(caseAddGate(), roles); got != http.StatusForbidden {
		t.Errorf("unmapped role on case-add: got %d, want 403", got)
	}
}

// TestCoarseLexWriteStillWorks: backward-compat for the view/add/edit routes ONLY —
// a legacy role carrying the coarse lex:write passes the add gate via the fallback.
// design v2 §4.4 / changelog #5 explicitly REVERSES this on the elevated verbs:
// the coarse lex:write / lex:approve no longer pass an approve/close/assign/
// distribute/manage gate, so a tenant_admin (which carries lex:write + lex:approve
// but NOT lex:case:* / admin:*) is now DENIED on case-approve. Only the wildcard
// admin:* (super_admin) still passes everywhere.
func TestCoarseLexWriteStillWorks(t *testing.T) {
	// add gate (view/add/edit family) keeps the coarse lex:write fallback.
	if got := serveWith(caseAddGate(), []string{"tenant_admin"}); got != http.StatusOK {
		t.Errorf("tenant_admin on case-add (lex:write fallback): got %d, want 200", got)
	}
	// super_admin (admin:* wildcard) passes both the add gate AND the no-fallback
	// elevated approve gate.
	if got := serveWith(caseAddGate(), []string{"super_admin"}); got != http.StatusOK {
		t.Errorf("super_admin on case-add (admin:* wildcard): got %d, want 200", got)
	}
	if got := serveWith(caseApproveGate(), []string{"super_admin"}); got != http.StatusOK {
		t.Errorf("super_admin on case-approve (admin:* wildcard): got %d, want 200", got)
	}
}

// TestNoCoarseFallbackOnElevatedVerbs is the v2 changelog #5 acceptance proof: a
// holder of ONLY the coarse lex:write (or the cross-cutting lex:approve / lex:close)
// is DENIED on every elevated route. We exercise it through a synthetic role that
// carries exactly those coarse grants — proving the gate rejects the legacy bypass.
func TestNoCoarseFallbackOnElevatedVerbs(t *testing.T) {
	// Use an intentionally coarse-only role so this regression test stays focused
	// on fallback behaviour rather than the tenant administrator's independent
	// configuration grants.
	auth.RolePermissions["coarse_lex_writer_probe"] = []string{
		auth.PermLexWrite, auth.PermLexApprove, auth.PermLexClose,
	}
	defer delete(auth.RolePermissions, "coarse_lex_writer_probe")
	roles := []string{"coarse_lex_writer_probe"}
	elevated := map[string]func(http.Handler) http.Handler{
		"case-approve":        caseApproveGate(),
		"contract-approve":    contractApproveGate(),
		"catalog-manage":      catalogManageGate(),
		"case-assign":         RequirePermission(auth.PermLexCaseAssign),
		"contract-distribute": RequirePermission(auth.PermLexContractDistribute),
		"case-close":          RequirePermission(auth.PermLexCaseClose),
		"contract-close":      RequirePermission(auth.PermLexContractClose),
	}
	for name, g := range elevated {
		if got := serveWith(g, roles); got != http.StatusForbidden {
			t.Errorf("coarse-only role on %s: got %d, want 403 (no coarse fallback on elevated verbs)", name, got)
		}
	}
	// Sanity: the same coarse role still passes a view/add/edit route via lex:write.
	if got := serveWith(caseAddGate(), roles); got != http.StatusOK {
		t.Errorf("coarse-only role on case-add (view/add/edit fallback retained): got %d, want 200", got)
	}
}
