package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/authz"
	sharedmw "github.com/clario360/platform/internal/middleware"
)

func okHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
}

func authedLexRequest(method, path string, user *auth.ContextUser) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, user.TenantID)
	return req.WithContext(ctx)
}

func TestABACResourceExtractor_ActionAndType(t *testing.T) {
	res, action := ABACResourceExtractor(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts/abc", nil))
	if action != "lex:read" || res.Type != "contracts" {
		t.Fatalf("GET contracts -> action=%q type=%q", action, res.Type)
	}
	res, action = ABACResourceExtractor(httptest.NewRequest(http.MethodPost, "/api/v1/watheeq/drafting/clauses", nil))
	if action != "lex:write" || res.Type != "drafting" {
		t.Fatalf("POST watheeq drafting -> action=%q type=%q", action, res.Type)
	}
}

// TestABACGatesLexWrite_DenyReturns403 is the SEC-01 acceptance: with the lex
// chain's ABAC layer wired, a tenant deny policy on the write action blocks a
// lex write while leaving reads (a different action) allowed.
func TestABACGatesLexWrite_DenyReturns403(t *testing.T) {
	deny := authz.Policy{
		ID: "deny-lex-writes", TenantID: "t1", Effect: authz.EffectDeny,
		Action: "lex:write", ResourceType: "*", Enabled: true,
	}
	engine := authz.NewEngine(&authz.StaticPolicyProvider{Policies: []authz.Policy{deny}})
	mw := sharedmw.EnforceABAC(engine, ABACResourceExtractor)
	user := &auth.ContextUser{ID: "u1", TenantID: "t1", Roles: []string{"legal_editor"}}

	// Write is denied by the policy.
	recW := httptest.NewRecorder()
	mw(okHandler()).ServeHTTP(recW, authedLexRequest(http.MethodPost, "/api/v1/lex/contracts", user))
	if recW.Code != http.StatusForbidden {
		t.Fatalf("lex write under deny policy = %d, want 403", recW.Code)
	}

	// Read is a different action (lex:read) and is unaffected.
	recR := httptest.NewRecorder()
	mw(okHandler()).ServeHTTP(recR, authedLexRequest(http.MethodGet, "/api/v1/lex/contracts", user))
	if recR.Code != http.StatusOK {
		t.Fatalf("lex read under write-deny policy = %d, want 200", recR.Code)
	}

	// A different tenant has no policy -> allowed.
	recOther := httptest.NewRecorder()
	mw(okHandler()).ServeHTTP(recOther, authedLexRequest(http.MethodPost, "/api/v1/lex/contracts", &auth.ContextUser{ID: "u2", TenantID: "t2"}))
	if recOther.Code != http.StatusOK {
		t.Fatalf("other-tenant write (no policy) = %d, want 200", recOther.Code)
	}
}

// TestABACNilEngine_PassThrough proves the chain stays RBAC-only when ABAC is
// not configured.
func TestABACNilEngine_PassThrough(t *testing.T) {
	rec := httptest.NewRecorder()
	sharedmw.EnforceABAC(nil, ABACResourceExtractor)(okHandler()).
		ServeHTTP(rec, authedLexRequest(http.MethodPost, "/api/v1/lex/contracts", &auth.ContextUser{ID: "u1", TenantID: "t1"}))
	if rec.Code != http.StatusOK {
		t.Fatalf("nil engine should pass through, got %d", rec.Code)
	}
}
