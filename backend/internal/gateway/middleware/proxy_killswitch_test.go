package middleware

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	gwconfig "github.com/clario360/platform/internal/gateway/config"
)

// stubKillSwitch is a fake KillSwitchEvaluator. It returns a fixed decision and
// records the match input it was asked to evaluate so tests can assert the
// per-request facets the middleware forwards.
type stubKillSwitch struct {
	tripped bool
	reason  KillSwitchReason
	calls   int
	lastIn  KillSwitchMatch
}

func (s *stubKillSwitch) IsTripped(_ context.Context, in KillSwitchMatch) (bool, KillSwitchReason) {
	s.calls++
	s.lastIn = in
	return s.tripped, s.reason
}

func testRoute() gwconfig.RouteConfig {
	return gwconfig.RouteConfig{
		Prefix:      "/api/v1/lex",
		Service:     "lex-service",
		Entitlement: "app.watheeq",
	}
}

func TestProxyKillSwitch_TrippedShortCircuits(t *testing.T) {
	eval := &stubKillSwitch{
		tripped: true,
		reason:  KillSwitchReason{Scope: "service", Target: "lex-service", Reason: "incident-42"},
	}
	var reached bool
	h := ProxyKillSwitch(eval, testRoute(), zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil).
		WithContext(auth.WithTenantID(context.Background(), "tenant-1"))
	h.ServeHTTP(rr, req)

	if reached {
		t.Fatal("tripped kill switch must NOT reach the backend")
	}
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
	assertErrorCode(t, rr.Body.Bytes(), "KILL_SWITCH_ACTIVE")
	if body := rr.Body.String(); !contains(body, "incident-42") {
		t.Fatalf("body = %s, want kill-switch reason included", body)
	}
	// The middleware must forward the route + tenant facets to the evaluator.
	if eval.lastIn.RoutePrefix != "/api/v1/lex" || eval.lastIn.Service != "lex-service" ||
		eval.lastIn.TenantID != "tenant-1" || eval.lastIn.Entitlement != "app.watheeq" {
		t.Fatalf("evaluator match input = %+v, want route+tenant facets populated", eval.lastIn)
	}
}

func TestProxyKillSwitch_NotTrippedPasses(t *testing.T) {
	eval := &stubKillSwitch{tripped: false}
	var reached bool
	h := ProxyKillSwitch(eval, testRoute(), zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/lex/contracts", nil).
		WithContext(auth.WithTenantID(context.Background(), "tenant-1"))
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("non-matching request must pass through to the backend")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if eval.calls != 1 {
		t.Fatalf("evaluator calls = %d, want 1", eval.calls)
	}
}

// TestProxyKillSwitch_NilEvaluatorIsNoOp verifies the fail-open behaviour when
// Redis is unconfigured (nil evaluator): every request passes untouched.
func TestProxyKillSwitch_NilEvaluatorIsNoOp(t *testing.T) {
	var reached bool
	h := ProxyKillSwitch(nil, testRoute(), zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/lex/contracts/1", nil)
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("nil evaluator must be a no-op and pass the request through")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
}

// TestProxyKillSwitch_FailOpenOnStoreError mirrors the store contract: the
// evaluator fails open by returning (false, _) on any backing-store error so an
// infrastructure problem never blocks all traffic. A fake that reports
// not-tripped therefore must pass through.
func TestProxyKillSwitch_FailOpenOnStoreError(t *testing.T) {
	// A real store returns (false, _) when it cannot reach Redis. The fake
	// reproduces that contract.
	eval := &stubKillSwitch{tripped: false}
	var reached bool
	h := ProxyKillSwitch(eval, testRoute(), zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPut, "/api/v1/lex/contracts/1", nil)
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("fail-open: store error (modelled as not-tripped) must allow the request")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
}

// TestProxyKillSwitch_NoTenantStillEvaluates ensures the middleware evaluates
// the switch even when no tenant is in context (global/route-scoped switches),
// forwarding an empty tenant.
func TestProxyKillSwitch_NoTenantStillEvaluates(t *testing.T) {
	eval := &stubKillSwitch{tripped: true, reason: KillSwitchReason{Scope: "global"}}
	var reached bool
	h := ProxyKillSwitch(eval, testRoute(), zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil)
	h.ServeHTTP(rr, req)

	if reached {
		t.Fatal("global kill switch must block even without a tenant in context")
	}
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
	if eval.calls != 1 {
		t.Fatalf("evaluator calls = %d, want 1", eval.calls)
	}
	if eval.lastIn.TenantID != "" {
		t.Fatalf("tenant = %q, want empty when no tenant in context", eval.lastIn.TenantID)
	}
}
