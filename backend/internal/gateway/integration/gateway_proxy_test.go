package integration

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/config"
	gwconfig "github.com/clario360/platform/internal/gateway/config"
	"github.com/clario360/platform/internal/gateway/entitlement"
	gwmetrics "github.com/clario360/platform/internal/gateway/metrics"
	gwmw "github.com/clario360/platform/internal/gateway/middleware"
	"github.com/clario360/platform/internal/gateway/proxy"
	"github.com/clario360/platform/internal/gateway/ratelimit"
	"github.com/clario360/platform/internal/middleware"
)

// buildTestGateway creates a complete gateway router wired against httptest backend servers.
func buildTestGateway(t *testing.T, backendURLs map[string]string) (*chi.Mux, *auth.JWTManager) {
	t.Helper()

	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	pubBytes, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})

	jwtMgr, err := auth.NewJWTManager(config.AuthConfig{
		RSAPrivateKeyPEM: string(privPEM),
		RSAPublicKeyPEM:  string(pubPEM),
		JWTIssuer:        "clario360-iam",
		AccessTokenTTL:   15 * time.Minute,
		RefreshTokenTTL:  7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}

	// Build service configs from provided backend URLs.
	var svcConfigs []gwconfig.ServiceConfig
	for name, url := range backendURLs {
		svcConfigs = append(svcConfigs, gwconfig.ServiceConfig{
			Name:    name,
			URL:     url,
			Timeout: 5 * time.Second,
		})
	}

	registry, err := proxy.NewServiceRegistry(svcConfigs)
	if err != nil {
		t.Fatalf("NewServiceRegistry: %v", err)
	}

	routes := []gwconfig.RouteConfig{
		{Prefix: "/api/v1/auth", Service: "iam-service", Public: true, EndpointGroup: gwconfig.EndpointGroupAuth},
		{Prefix: "/api/v1/users", Service: "iam-service", Public: false, EndpointGroup: gwconfig.EndpointGroupWrite},
		{Prefix: "/api/v1/audit", Service: "audit-service", Public: false, EndpointGroup: gwconfig.EndpointGroupRead},
	}

	proxyRouter, err := proxy.NewRouter(routes, registry, proxy.DefaultCircuitBreakerConfig(), zerolog.Nop())
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}

	gwMetrics := gwmetrics.NewGatewayMetrics()

	// Use a no-op rate limiter (no Redis in integration tests unless injected).
	noopLimiter := ratelimit.NewLimiter(nil, ratelimit.DefaultConfig())

	r := chi.NewRouter()
	r.Use(middleware.RequestID)

	for _, route := range routes {
		route := route
		match := proxyRouter.Match(route.Prefix)
		if !match.Matched {
			continue
		}
		rp := match.Proxy

		r.Route(route.Prefix, func(sub chi.Router) {
			if !route.Public {
				sub.Use(gwmw.ProxyAuth(jwtMgr, gwMetrics, zerolog.Nop()))
			}
			sub.Use(gwmw.ProxyHeaders)
			sub.Use(gwmw.ProxyRateLimit(noopLimiter, route.EndpointGroup, gwMetrics, zerolog.Nop()))
			sub.HandleFunc("/*", rp.ServeHTTP)
			sub.HandleFunc("/", rp.ServeHTTP)
		})
	}

	return r, jwtMgr
}

func makeToken(t *testing.T, mgr *auth.JWTManager, tenantID string) string {
	t.Helper()
	pair, err := mgr.GenerateTokenPair("user-1", tenantID, "user@test.com", []string{"viewer"}, "")
	if err != nil {
		t.Fatalf("GenerateTokenPair: %v", err)
	}
	return pair.AccessToken
}

type routeEntitlementStub struct {
	decision entitlement.Decision
	err      error
	calls    int
}

func (s *routeEntitlementStub) Check(_ context.Context, _, _, _ string) (entitlement.Decision, error) {
	s.calls++
	return s.decision, s.err
}

func buildEntitlementGateway(t *testing.T, backendURL string, checker entitlement.Checker, failOpen bool) (*chi.Mux, *auth.JWTManager) {
	t.Helper()

	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	pubBytes, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})

	jwtMgr, err := auth.NewJWTManager(config.AuthConfig{
		RSAPrivateKeyPEM: string(privPEM),
		RSAPublicKeyPEM:  string(pubPEM),
		JWTIssuer:        "clario360-iam",
		AccessTokenTTL:   15 * time.Minute,
		RefreshTokenTTL:  7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatalf("NewJWTManager: %v", err)
	}

	routes := []gwconfig.RouteConfig{
		{
			Prefix:        "/api/v1/lex",
			Service:       "lex-service",
			Public:        false,
			EndpointGroup: gwconfig.EndpointGroupWrite,
			Entitlement:   "app.watheeq",
		},
	}
	registry, err := proxy.NewServiceRegistry([]gwconfig.ServiceConfig{
		{Name: "lex-service", URL: backendURL, Timeout: 5 * time.Second},
	})
	if err != nil {
		t.Fatalf("NewServiceRegistry: %v", err)
	}
	proxyRouter, err := proxy.NewRouter(routes, registry, proxy.DefaultCircuitBreakerConfig(), zerolog.Nop())
	if err != nil {
		t.Fatalf("NewRouter: %v", err)
	}

	gwMetrics := gwmetrics.NewGatewayMetrics()
	noopLimiter := ratelimit.NewLimiter(nil, ratelimit.DefaultConfig())
	r := chi.NewRouter()
	r.Use(middleware.RequestID)

	route := routes[0]
	match := proxyRouter.Match(route.Prefix)
	if !match.Matched {
		t.Fatal("expected test route to match proxy")
	}
	r.Route(route.Prefix, func(sub chi.Router) {
		sub.Use(gwmw.ProxyAuth(jwtMgr, gwMetrics, zerolog.Nop()))
		sub.Use(gwmw.ProxyHeaders)
		sub.Use(gwmw.ProxyRateLimit(noopLimiter, route.EndpointGroup, gwMetrics, zerolog.Nop()))
		sub.Use(gwmw.ProxyEntitlement(checker, route.Entitlement, failOpen, gwMetrics, zerolog.Nop()))
		sub.HandleFunc("/*", match.Proxy.ServeHTTP)
		sub.HandleFunc("/", match.Proxy.ServeHTTP)
	})

	return r, jwtMgr
}

// TestProxy_RoutesToCorrectBackend — requests reach the correct backend based on prefix.
func TestProxy_RoutesToCorrectBackend(t *testing.T) {
	iamCalled := false
	auditCalled := false

	iamBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		iamCalled = true
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"service": "iam"})
	}))
	defer iamBackend.Close()

	auditBackend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auditCalled = true
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]string{"service": "audit"})
	}))
	defer auditBackend.Close()

	gw, jwtMgr := buildTestGateway(t, map[string]string{
		"iam-service":   iamBackend.URL,
		"audit-service": auditBackend.URL,
	})

	token := makeToken(t, jwtMgr, "tenant-1")

	// Request to /api/v1/users should reach IAM backend.
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	gw.ServeHTTP(rr, req)

	if !iamCalled {
		t.Error("expected IAM backend to be called for /api/v1/users")
	}
	if auditCalled {
		t.Error("audit backend should not have been called for /api/v1/users")
	}

	// Reset and test audit route.
	iamCalled = false
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/audit/logs", nil)
	req2.Header.Set("Authorization", "Bearer "+token)
	rr2 := httptest.NewRecorder()
	gw.ServeHTTP(rr2, req2)

	if !auditCalled {
		t.Error("expected audit backend to be called for /api/v1/audit")
	}
}

func TestProxy_GatedSuiteRouteFailClosedWhenLicensingUnavailable(t *testing.T) {
	backendCalled := false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backendCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	checker := &routeEntitlementStub{err: errors.New("license-service unavailable")}
	gw, jwtMgr := buildEntitlementGateway(t, backend.URL, checker, false)
	token := makeToken(t, jwtMgr, "tenant-1")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	gw.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rr.Code)
	}
	if backendCalled {
		t.Fatal("fail-closed entitlement error must not reach the protected suite backend")
	}
	if checker.calls != 1 {
		t.Fatalf("checker calls = %d, want 1", checker.calls)
	}
}

func TestProxy_GatedSuiteRouteFailOpenAllowsLocalOverride(t *testing.T) {
	backendCalled := false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backendCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	checker := &routeEntitlementStub{err: errors.New("license-service unavailable")}
	gw, jwtMgr := buildEntitlementGateway(t, backend.URL, checker, true)
	token := makeToken(t, jwtMgr, "tenant-1")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	gw.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	if !backendCalled {
		t.Fatal("fail-open local override should allow the protected suite backend")
	}
	if checker.calls != 1 {
		t.Fatalf("checker calls = %d, want 1", checker.calls)
	}
}

// TestProxy_InjectsInternalHeaders — backend receives X-Tenant-ID, X-User-ID, X-Request-ID.
func TestProxy_InjectsInternalHeaders(t *testing.T) {
	var capturedTenant, capturedUser, capturedReqID string

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTenant = r.Header.Get("X-Tenant-ID")
		capturedUser = r.Header.Get("X-User-ID")
		capturedReqID = r.Header.Get("X-Request-ID")
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	gw, jwtMgr := buildTestGateway(t, map[string]string{
		"iam-service":   backend.URL,
		"audit-service": backend.URL,
	})

	token := makeToken(t, jwtMgr, "tenant-abc")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/profile", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	gw.ServeHTTP(rr, req)

	if capturedTenant != "tenant-abc" {
		t.Errorf("expected X-Tenant-ID=tenant-abc, got %q", capturedTenant)
	}
	if capturedUser != "user-1" {
		t.Errorf("expected X-User-ID=user-1, got %q", capturedUser)
	}
	if capturedReqID == "" {
		t.Error("expected X-Request-ID to be set")
	}
}

// TestProxy_StripsClientInternalHeaders — client-injected X-Tenant-ID is overwritten.
func TestProxy_StripsClientInternalHeaders(t *testing.T) {
	var capturedTenant string

	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedTenant = r.Header.Get("X-Tenant-ID")
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	gw, jwtMgr := buildTestGateway(t, map[string]string{
		"iam-service":   backend.URL,
		"audit-service": backend.URL,
	})

	token := makeToken(t, jwtMgr, "real-tenant")

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/profile", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	// Client tries to inject a fake tenant.
	req.Header.Set("X-Tenant-ID", "evil-tenant")
	rr := httptest.NewRecorder()
	gw.ServeHTTP(rr, req)

	if capturedTenant == "evil-tenant" {
		t.Error("evil-tenant must be stripped and replaced with real-tenant from JWT")
	}
	if capturedTenant != "real-tenant" {
		t.Errorf("expected X-Tenant-ID=real-tenant from JWT, got %q", capturedTenant)
	}
}

// TestProxy_CircuitBreakerOpens — 5 consecutive 500s open the circuit breaker → 503.
func TestProxy_CircuitBreakerOpens(t *testing.T) {
	failCount := 0
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		failCount++
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer backend.Close()

	key, _ := rsa.GenerateKey(rand.Reader, 2048)
	privPEM := pem.EncodeToMemory(&pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)})
	pubBytes, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubBytes})
	jwtMgr, _ := auth.NewJWTManager(config.AuthConfig{
		RSAPrivateKeyPEM: string(privPEM),
		RSAPublicKeyPEM:  string(pubPEM),
		JWTIssuer:        "clario360-iam",
		AccessTokenTTL:   15 * time.Minute,
		RefreshTokenTTL:  7 * 24 * time.Hour,
	})

	registry, _ := proxy.NewServiceRegistry([]gwconfig.ServiceConfig{
		{Name: "iam-service", URL: backend.URL, Timeout: 5 * time.Second},
	})

	cbCfg := proxy.DefaultCircuitBreakerConfig()
	cbCfg.FailureThreshold = 5
	cbCfg.OpenTimeout = 60 * time.Second

	routes := []gwconfig.RouteConfig{
		{Prefix: "/api/v1/users", Service: "iam-service", Public: false, EndpointGroup: gwconfig.EndpointGroupWrite},
	}

	proxyRouter, _ := proxy.NewRouter(routes, registry, cbCfg, zerolog.Nop())
	gwMetrics := gwmetrics.NewGatewayMetrics()
	noopLimiter := ratelimit.NewLimiter(nil, ratelimit.DefaultConfig())

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	match := proxyRouter.Match("/api/v1/users")
	rp := match.Proxy

	r.Route("/api/v1/users", func(sub chi.Router) {
		sub.Use(gwmw.ProxyAuth(jwtMgr, gwMetrics, zerolog.Nop()))
		sub.Use(gwmw.ProxyHeaders)
		sub.Use(gwmw.ProxyRateLimit(noopLimiter, gwconfig.EndpointGroupWrite, gwMetrics, zerolog.Nop()))
		sub.HandleFunc("/*", rp.ServeHTTP)
		sub.HandleFunc("/", rp.ServeHTTP)
	})

	token := makeToken(t, jwtMgr, "tenant-1")

	// Send 5 requests that all fail.
	for i := 0; i < 5; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
		req.Header.Set("Authorization", "Bearer "+token)
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, req)
	}

	// 6th request should return 503 (circuit open).
	req := httptest.NewRequest(http.MethodGet, "/api/v1/users/me", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusServiceUnavailable {
		t.Errorf("expected 503 when circuit is open, got %d (fail count: %d)", rr.Code, failCount)
	}
}

// TestProxy_PublicRouteNoAuth — public routes pass through without a JWT.
func TestProxy_PublicRouteNoAuth(t *testing.T) {
	loginCalled := false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		loginCalled = true
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, `{"access_token":"token"}`)
	}))
	defer backend.Close()

	gw, _ := buildTestGateway(t, map[string]string{
		"iam-service":   backend.URL,
		"audit-service": backend.URL,
	})

	// No Authorization header — but this is a public route.
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil)
	rr := httptest.NewRecorder()
	gw.ServeHTTP(rr, req)

	if !loginCalled {
		t.Error("expected auth backend to be called for public /api/v1/auth route")
	}
	if rr.Code == http.StatusUnauthorized {
		t.Error("public route must not require authentication")
	}
}

// TestProxy_ProtectedRouteNoAuth — protected routes return 401 without JWT.
func TestProxy_ProtectedRouteNoAuth(t *testing.T) {
	backendCalled := false
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backendCalled = true
		w.WriteHeader(http.StatusOK)
	}))
	defer backend.Close()

	gw, _ := buildTestGateway(t, map[string]string{
		"iam-service":   backend.URL,
		"audit-service": backend.URL,
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/users", nil)
	// No Authorization header.
	rr := httptest.NewRecorder()
	gw.ServeHTTP(rr, req)

	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
	if backendCalled {
		t.Error("backend must NOT be called for unauthenticated request to protected route")
	}
}
