package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

func newOpenProxyForTest(t *testing.T, serviceName string, upstream http.Handler) (*ReverseProxy, *CircuitBreaker, *int) {
	t.Helper()

	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		upstream.ServeHTTP(w, r)
	}))
	t.Cleanup(server.Close)

	target, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("parse upstream URL: %v", err)
	}
	cfg := DefaultCircuitBreakerConfig()
	cfg.FailureThreshold = 1
	cfg.OpenTimeout = time.Hour
	breaker := NewCircuitBreaker(cfg)
	breaker.RecordFailure()
	if breaker.State() != CircuitOpen {
		t.Fatalf("breaker state = %s, want open", breaker.State())
	}
	return NewReverseProxy(serviceName, target, time.Second, breaker, zerolog.Nop()), breaker, &requests
}

func TestReverseProxy_LexMeRecoversAutomaticallyOpenCircuit(t *testing.T) {
	for _, path := range []string{"/api/v1/lex/me", "/api/v1/watheeq/me"} {
		t.Run(path, func(t *testing.T) {
			rp, breaker, requests := newOpenProxyForTest(t, "lex-service", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))

			rec := httptest.NewRecorder()
			rp.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))

			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200", rec.Code)
			}
			if *requests != 1 {
				t.Fatalf("upstream requests = %d, want 1", *requests)
			}
			if breaker.State() != CircuitClosed {
				t.Fatalf("breaker state = %s, want closed after successful probe", breaker.State())
			}
		})
	}
}

func TestReverseProxy_OpenCircuitStillRejectsOrdinaryLexRoute(t *testing.T) {
	rp, breaker, requests := newOpenProxyForTest(t, "lex-service", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	rp.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/lex/contracts", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if *requests != 0 {
		t.Fatalf("upstream requests = %d, want 0", *requests)
	}
	if breaker.State() != CircuitOpen {
		t.Fatalf("breaker state = %s, want open", breaker.State())
	}
}

func TestReverseProxy_ForceOpenStillRejectsLexMe(t *testing.T) {
	rp, breaker, requests := newOpenProxyForTest(t, "lex-service", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	breaker.ForceOpen()

	rec := httptest.NewRecorder()
	rp.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/lex/me", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if *requests != 0 {
		t.Fatalf("upstream requests = %d, want 0", *requests)
	}
	if snapshot := breaker.Snapshot(); snapshot.State != CircuitOpen || !snapshot.Forced {
		t.Fatalf("breaker snapshot = %+v, want forced open", snapshot)
	}
}

func TestReverseProxy_LexMeProbeFailureKeepsCircuitOpen(t *testing.T) {
	rp, breaker, requests := newOpenProxyForTest(t, "lex-service", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))

	rec := httptest.NewRecorder()
	rp.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/lex/me", nil))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if *requests != 1 {
		t.Fatalf("upstream requests = %d, want 1", *requests)
	}
	if breaker.State() != CircuitOpen {
		t.Fatalf("breaker state = %s, want open after failed probe", breaker.State())
	}
}

func TestReverseProxy_RecoveryProbeIsLexServiceSpecific(t *testing.T) {
	rp, breaker, requests := newOpenProxyForTest(t, "iam-service", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	rec := httptest.NewRecorder()
	rp.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/lex/me", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if *requests != 0 {
		t.Fatalf("upstream requests = %d, want 0", *requests)
	}
	if breaker.State() != CircuitOpen {
		t.Fatalf("breaker state = %s, want open", breaker.State())
	}
}
