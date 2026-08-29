package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/authz"
)

// authedRequest builds a request with an authenticated user in its context,
// simulating what middleware.Auth populates upstream.
func authedRequest(user *auth.ContextUser) *http.Request {
	req := httptest.NewRequest(http.MethodGet, "/documents/123", nil)
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, user.TenantID)
	return req.WithContext(ctx)
}

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
}

// TestEnforceABAC_NilEngine_PassThrough proves that when no engine is wired the
// middleware is transparent.
func TestEnforceABAC_NilEngine_PassThrough(t *testing.T) {
	rec := httptest.NewRecorder()
	h := EnforceABAC(nil, nil)(okHandler())
	h.ServeHTTP(rec, authedRequest(&auth.ContextUser{ID: "u1", TenantID: "t1"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 with nil engine, got %d", rec.Code)
	}
}

// TestEnforceABAC_NoPolicies_BackwardCompatible is the key backward-compat test:
// with no policies, an authenticated request that passed RBAC is allowed
// through unchanged.
func TestEnforceABAC_NoPolicies_BackwardCompatible(t *testing.T) {
	engine := authz.NewEngine(&authz.StaticPolicyProvider{}) // empty policy set
	rec := httptest.NewRecorder()

	extract := func(r *http.Request) (authz.Resource, string) {
		return authz.Resource{Type: "document", Owner: "other"}, "data:read"
	}
	h := EnforceABAC(engine, extract)(okHandler())
	h.ServeHTTP(rec, authedRequest(&auth.ContextUser{ID: "u1", TenantID: "t1", Roles: []string{"analyst"}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (no policy ⇒ RBAC stands), got %d", rec.Code)
	}
}

// TestEnforceABAC_DenyPolicy_Returns403 proves a matching deny policy yields 403.
func TestEnforceABAC_DenyPolicy_Returns403(t *testing.T) {
	deny := authz.Policy{
		ID: "p-owner-only", TenantID: "t1", Effect: authz.EffectDeny,
		Action: "data:read", ResourceType: "document", Enabled: true,
		Conditions: []authz.Condition{
			{Attribute: "resource.owner", Operator: authz.OpAttrNotEquals, Value: "subject.id"},
		},
	}
	engine := authz.NewEngine(&authz.StaticPolicyProvider{Policies: []authz.Policy{deny}})

	extract := func(r *http.Request) (authz.Resource, string) {
		return authz.Resource{Type: "document", Owner: "someone-else"}, "data:read"
	}
	rec := httptest.NewRecorder()
	h := EnforceABAC(engine, extract)(okHandler())
	h.ServeHTTP(rec, authedRequest(&auth.ContextUser{ID: "u1", TenantID: "t1", Roles: []string{"analyst"}}))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 from deny policy, got %d", rec.Code)
	}
}

// TestEnforceABAC_AllowPolicy_Passes proves a matching allow policy permits access.
func TestEnforceABAC_AllowPolicy_Passes(t *testing.T) {
	deny := authz.Policy{
		ID: "p-owner-only", TenantID: "t1", Effect: authz.EffectDeny,
		Action: "data:read", ResourceType: "document", Enabled: true,
		Conditions: []authz.Condition{
			{Attribute: "resource.owner", Operator: authz.OpAttrNotEquals, Value: "subject.id"},
		},
	}
	engine := authz.NewEngine(&authz.StaticPolicyProvider{Policies: []authz.Policy{deny}})

	extract := func(r *http.Request) (authz.Resource, string) {
		// Subject IS the owner this time → deny condition not met → allowed.
		return authz.Resource{Type: "document", Owner: "u1"}, "data:read"
	}
	rec := httptest.NewRecorder()
	h := EnforceABAC(engine, extract)(okHandler())
	h.ServeHTTP(rec, authedRequest(&auth.ContextUser{ID: "u1", TenantID: "t1", Roles: []string{"analyst"}}))

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 when subject owns resource, got %d", rec.Code)
	}
}

// TestRequirePermission_Unchanged is a guard test confirming the existing RBAC
// middleware behavior is intact (no regression from the ABAC addition).
func TestRequirePermission_Unchanged(t *testing.T) {
	// analyst has data:read but not data:write.
	allowH := RequirePermission(auth.PermDataRead)(okHandler())
	rec := httptest.NewRecorder()
	allowH.ServeHTTP(rec, authedRequest(&auth.ContextUser{ID: "u1", TenantID: "t1", Roles: []string{"analyst"}}))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected analyst to pass data:read, got %d", rec.Code)
	}

	denyH := RequirePermission(auth.PermDataWrite)(okHandler())
	rec2 := httptest.NewRecorder()
	denyH.ServeHTTP(rec2, authedRequest(&auth.ContextUser{ID: "u1", TenantID: "t1", Roles: []string{"analyst"}}))
	if rec2.Code != http.StatusForbidden {
		t.Fatalf("expected analyst to be denied data:write, got %d", rec2.Code)
	}
}
