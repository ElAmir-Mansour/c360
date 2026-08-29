package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/prometheus/client_golang/prometheus/testutil"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/gateway/entitlement"
	gwmetrics "github.com/clario360/platform/internal/gateway/metrics"
)

// stubChecker returns a fixed decision/error and records its calls.
type stubChecker struct {
	decision entitlement.Decision
	err      error
	calls    int
}

func (s *stubChecker) Check(_ context.Context, _, _, _ string) (entitlement.Decision, error) {
	s.calls++
	return s.decision, s.err
}

// withTenant attaches a tenant to the request context as ProxyAuth would.
func withTenant(r *http.Request, tenantID string) *http.Request {
	ctx := auth.WithUser(r.Context(), &auth.ContextUser{ID: "u-1", TenantID: tenantID})
	return r.WithContext(ctx)
}

// nextRecorder is a terminal handler that records whether it was reached.
func nextRecorder(reached *bool) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*reached = true
		w.WriteHeader(http.StatusOK)
	})
}

func TestProxyEntitlement_AllowedProxies(t *testing.T) {
	checker := &stubChecker{decision: entitlement.Decision{Allowed: true}}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", true, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := withTenant(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil), "tenant-1")
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("allowed request must reach the backend")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
}

func TestProxyEntitlement_DeniedReturns402(t *testing.T) {
	checker := &stubChecker{decision: entitlement.Decision{Allowed: false, Reason: "not included in plan"}}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", true, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := withTenant(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil), "tenant-1")
	h.ServeHTTP(rr, req)

	if reached {
		t.Fatal("denied request must NOT reach the backend")
	}
	if rr.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402 Payment Required", rr.Code)
	}
	if body := rr.Body.String(); !contains(body, "ENTITLEMENT_REQUIRED") {
		t.Fatalf("body = %s, want ENTITLEMENT_REQUIRED code", body)
	}

	var payload struct {
		Error struct {
			Code         string `json:"code"`
			PlanRequired string `json:"plan_required"`
			UpgradeURL   string `json:"upgrade_url"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode 402 payload: %v", err)
	}
	if payload.Error.Code != "ENTITLEMENT_REQUIRED" {
		t.Fatalf("code = %q, want ENTITLEMENT_REQUIRED", payload.Error.Code)
	}
	if payload.Error.PlanRequired != "app.watheeq" {
		t.Fatalf("plan_required = %q, want app.watheeq", payload.Error.PlanRequired)
	}
	if payload.Error.UpgradeURL != "/register?suites=lex&plan=trial" {
		t.Fatalf("upgrade_url = %q, want lex trial signup", payload.Error.UpgradeURL)
	}
}

func TestProxyEntitlement_FailOpenAllowsOnError(t *testing.T) {
	checker := &stubChecker{err: errors.New("licensing unreachable")}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", true, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := withTenant(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil), "tenant-1")
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("fail-open must allow the request when licensing errors")
	}
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
}

func TestProxyEntitlement_FailClosedDeniesOnError(t *testing.T) {
	checker := &stubChecker{err: errors.New("licensing unreachable")}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", false, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := withTenant(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil), "tenant-1")
	h.ServeHTTP(rr, req)

	if reached {
		t.Fatal("fail-closed must deny the request when licensing errors")
	}
	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
}

func TestProxyEntitlement_FailClosedRecordsFailClosedMetric(t *testing.T) {
	checker := &stubChecker{err: errors.New("licensing unreachable")}
	metrics := gwmetrics.NewGatewayMetrics()
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", false, metrics, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := withTenant(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil), "tenant-1")
	h.ServeHTTP(rr, req)

	if reached {
		t.Fatal("fail-closed must deny the request when licensing errors")
	}
	if got := testutil.ToFloat64(metrics.EntitlementChecks.WithLabelValues("app.watheeq", "fail_closed")); got != 1 {
		t.Fatalf("fail_closed metric = %v, want 1", got)
	}
	if got := testutil.ToFloat64(metrics.EntitlementChecks.WithLabelValues("app.watheeq", "fail_open")); got != 0 {
		t.Fatalf("fail_open metric = %v, want 0", got)
	}
}

func TestProxyEntitlement_NoTenantSkips(t *testing.T) {
	checker := &stubChecker{decision: entitlement.Decision{Allowed: false}}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", true, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	// No tenant in context (e.g. ProxyAuth not run).
	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil)
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("with no tenant there is nothing to gate; request must pass through")
	}
	if checker.calls != 0 {
		t.Fatalf("checker calls = %d, want 0 without a tenant", checker.calls)
	}
}

func TestProxyEntitlement_NoTenantFailClosedDenies(t *testing.T) {
	checker := &stubChecker{decision: entitlement.Decision{Allowed: true}}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", false, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil)
	h.ServeHTTP(rr, req)

	if reached {
		t.Fatal("fail-closed must deny when tenant context is missing")
	}
	if checker.calls != 0 {
		t.Fatalf("checker calls = %d, want 0 without tenant context", checker.calls)
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rr.Code)
	}
}

func TestProxyEntitlement_APIKeyBypasses(t *testing.T) {
	checker := &stubChecker{decision: entitlement.Decision{Allowed: false}}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", true, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := withTenant(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil), "tenant-1")
	req.Header.Set("X-API-Key", "k-123")
	h.ServeHTTP(rr, req)

	if !reached {
		t.Fatal("API-key requests bypass gateway entitlement; backend enforces")
	}
	if checker.calls != 0 {
		t.Fatalf("checker calls = %d, want 0 for API-key path", checker.calls)
	}
}

func TestProxyEntitlement_APIKeyFailClosedDenies(t *testing.T) {
	checker := &stubChecker{decision: entitlement.Decision{Allowed: true}}
	var reached bool
	h := ProxyEntitlement(checker, "app.watheeq", false, nil, zerolog.Nop())(nextRecorder(&reached))

	rr := httptest.NewRecorder()
	req := withTenant(httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil), "tenant-1")
	req.Header.Set("X-API-Key", "k-123")
	h.ServeHTTP(rr, req)

	if reached {
		t.Fatal("fail-closed must deny API-key requests that cannot be entitlement-checked at the gateway")
	}
	if checker.calls != 0 {
		t.Fatalf("checker calls = %d, want 0 for API-key path without gateway tenant verification", checker.calls)
	}
	if rr.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", rr.Code)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
