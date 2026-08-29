package fleet

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/rs/zerolog"
)

// roundTripFunc adapts a function to an http.RoundTripper so we can fake the
// per-service scrape without a live network. This is the test seam: Service.get
// uses s.client, whose Transport we replace.
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// fakeResp is a canned response for a given URL (health or readyz).
type fakeResp struct {
	code int
	body string
	err  error // when set, the request fails (network/transport error)
}

// newFakeService builds a fleet Service whose HTTP client is driven by the
// supplied URL->response map. Any URL not in the map yields a transport error.
func newFakeService(reg []ServiceDescriptor, responses map[string]fakeResp) *Service {
	s := New(Config{Registry: reg, BaseHost: "127.0.0.1", ScrapeTimeout: time.Second, CacheTTL: time.Hour}, zerolog.Nop())
	s.client = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			r, ok := responses[req.URL.String()]
			if !ok {
				return nil, errors.New("no fake response for " + req.URL.String())
			}
			if r.err != nil {
				return nil, r.err
			}
			return &http.Response{
				StatusCode: r.code,
				Body:       io.NopCloser(bytes.NewBufferString(r.body)),
				Header:     make(http.Header),
			}, nil
		}),
	}
	return s
}

// desc is a tiny helper to build a one-service registry with a known port so the
// scrape URLs are deterministic.
func desc(name string, mainPort, adminPort int) ServiceDescriptor {
	return ServiceDescriptor{
		Name:       name,
		Role:       RolePlatform,
		MainPort:   mainPort,
		AdminPort:  adminPort,
		HealthPath: "/health",
		ReadyPath:  "/readyz",
	}
}

func TestRollupServiceStatus(t *testing.T) {
	tests := []struct {
		name      string
		liveness  string
		readiness string
		want      string
	}{
		{"dead liveness overrides all", StatusUnhealthy, StatusHealthy, StatusUnhealthy},
		{"dead liveness with unhealthy readiness", StatusUnhealthy, StatusUnhealthy, StatusUnhealthy},
		{"alive and ready", StatusHealthy, StatusHealthy, StatusHealthy},
		{"alive but degraded readiness", StatusHealthy, StatusDegraded, StatusDegraded},
		{"alive but unhealthy readiness", StatusHealthy, StatusUnhealthy, StatusUnhealthy},
		{"alive readiness unknown -> degraded", StatusHealthy, StatusUnknown, StatusDegraded},
		{"unknown liveness unknown readiness -> unknown", StatusUnknown, StatusUnknown, StatusUnknown},
		{"unknown liveness but ready -> healthy", StatusUnknown, StatusHealthy, StatusHealthy},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rollupServiceStatus(tt.liveness, tt.readiness); got != tt.want {
				t.Fatalf("rollupServiceStatus(%q,%q) = %q, want %q", tt.liveness, tt.readiness, got, tt.want)
			}
		})
	}
}

func TestOverallStatus(t *testing.T) {
	tests := []struct {
		name string
		in   Summary
		want string
	}{
		{"empty fleet -> unknown", Summary{Total: 0}, StatusUnknown},
		{"all healthy", Summary{Total: 3, Healthy: 3}, StatusHealthy},
		{"all unhealthy", Summary{Total: 3, Unhealthy: 3}, StatusUnhealthy},
		{"some unhealthy -> degraded", Summary{Total: 3, Healthy: 2, Unhealthy: 1}, StatusDegraded},
		{"some degraded -> degraded", Summary{Total: 3, Healthy: 2, Degraded: 1}, StatusDegraded},
		{"healthy mixed with unknown -> degraded", Summary{Total: 3, Healthy: 2, Unknown: 1}, StatusDegraded},
		{"all unknown -> degraded (not all-healthy, none unhealthy/degraded)", Summary{Total: 3, Unknown: 3}, StatusDegraded},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := overallStatus(tt.in); got != tt.want {
				t.Fatalf("overallStatus(%+v) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestNormalizeStatus(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{StatusHealthy, StatusHealthy},
		{StatusDegraded, StatusDegraded},
		{StatusUnhealthy, StatusUnhealthy},
		{"alive", StatusHealthy},
		{"ok", StatusHealthy},
		{"up", StatusHealthy},
		{"weird", StatusUnknown},
		{"", StatusUnknown},
	}
	for _, tt := range tests {
		t.Run(tt.in, func(t *testing.T) {
			if got := normalizeStatus(tt.in); got != tt.want {
				t.Fatalf("normalizeStatus(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestSummaryOf(t *testing.T) {
	fh := FleetHealth{Summary: Summary{Total: 5, Healthy: 2, Degraded: 1, Unhealthy: 1, Unknown: 1}}
	got := SummaryOf(fh)
	if got.Summary != fh.Summary {
		t.Fatalf("SummaryOf summary = %+v, want %+v", got.Summary, fh.Summary)
	}
	if got.Unhealthy != fh.Summary.Unhealthy {
		t.Fatalf("SummaryOf flat unhealthy = %d, want %d", got.Unhealthy, fh.Summary.Unhealthy)
	}
}

// TestHealthAggregation drives a full fan-out over a fixed registry, faking each
// service into a known state, and asserts the summary counts, overall status,
// per-service rollups, and surfaced scrape error.
func TestHealthAggregation(t *testing.T) {
	reg := []ServiceDescriptor{
		desc("svc-healthy", 8001, 9001),
		desc("svc-degraded", 8002, 9002),
		desc("svc-unhealthy-ready503", 8003, 9003),
		desc("svc-unknown", 8004, 9004),
		desc("svc-scrape-error", 8005, 9005),
	}

	const okHealth = `{"status":"healthy","version":"1.2.3","uptime":"5m","checks":{"postgres":{"status":"healthy"}}}`
	const degradedHealth = `{"status":"degraded","checks":{"redis":{"status":"degraded"}}}`
	// unknown: /health returns 200 but with an unparseable/empty status and
	// /readyz returns 200 too -> readiness becomes healthy actually; to force
	// unknown we make /health 200 with status "" and /readyz a transport error
	// so readiness stays unknown -> liveness healthy -> degraded. To get a TRUE
	// unknown status we need liveness unknown which only happens on a health err
	// path... so model "unknown" as a service whose /health body has no status
	// and /readyz errors: liveness=healthy, readiness=unknown => degraded.
	// Instead, exercise unknown via the summary default bucket using a status
	// the switch doesn't recognise is impossible, so we craft readiness unknown
	// + liveness unknown by erroring health (covered by scrape-error case).

	responses := map[string]fakeResp{
		// healthy: health 200 healthy, readyz 200
		"http://127.0.0.1:9001/health": {code: 200, body: okHealth},
		"http://127.0.0.1:9001/readyz": {code: 200, body: ""},
		// degraded: health 200 degraded, readyz 200
		"http://127.0.0.1:9002/health": {code: 200, body: degradedHealth},
		"http://127.0.0.1:9002/readyz": {code: 200, body: ""},
		// unhealthy: health 200 (alive) but readyz 503
		"http://127.0.0.1:9003/health": {code: 200, body: `{"status":"unhealthy"}`},
		"http://127.0.0.1:9003/readyz": {code: 503, body: ""},
		// "unknown" modeled: health 200 no status, readyz transport error =>
		// liveness healthy, readiness unknown => degraded (documented below).
		"http://127.0.0.1:9004/health": {code: 200, body: `{}`},
		"http://127.0.0.1:9004/readyz": {err: errors.New("conn refused")},
		// scrape error: /health itself errors => unhealthy + scrape_error set.
		"http://127.0.0.1:9005/health": {err: errors.New("dial tcp: connection refused")},
		"http://127.0.0.1:9005/readyz": {err: errors.New("dial tcp: connection refused")},
	}

	s := newFakeService(reg, responses)
	fh := s.Health(context.Background())

	if fh.Summary.Total != 5 {
		t.Fatalf("total = %d, want 5", fh.Summary.Total)
	}

	byName := map[string]ServiceHealth{}
	for _, sh := range fh.Services {
		byName[sh.Name] = sh
	}

	// Per-service rollups.
	if got := byName["svc-healthy"].Status; got != StatusHealthy {
		t.Errorf("svc-healthy status = %q, want healthy", got)
	}
	if got := byName["svc-healthy"].Version; got != "1.2.3" {
		t.Errorf("svc-healthy version = %q, want 1.2.3", got)
	}
	if got := byName["svc-healthy"].Checks["postgres"]; got != "healthy" {
		t.Errorf("svc-healthy postgres check = %q, want healthy", got)
	}
	if got := byName["svc-degraded"].Status; got != StatusDegraded {
		t.Errorf("svc-degraded status = %q, want degraded", got)
	}
	if got := byName["svc-unhealthy-ready503"].Status; got != StatusUnhealthy {
		t.Errorf("svc-unhealthy-ready503 status = %q, want unhealthy", got)
	}
	if got := byName["svc-unknown"].Status; got != StatusDegraded {
		t.Errorf("svc-unknown status = %q, want degraded (alive, readiness unknown)", got)
	}

	// Scrape error surfaced + treated as unhealthy.
	se := byName["svc-scrape-error"]
	if se.Status != StatusUnhealthy {
		t.Errorf("svc-scrape-error status = %q, want unhealthy", se.Status)
	}
	if se.ScrapeError == "" {
		t.Errorf("svc-scrape-error scrape_error empty, want surfaced error")
	}
	if se.Liveness != StatusUnhealthy {
		t.Errorf("svc-scrape-error liveness = %q, want unhealthy", se.Liveness)
	}

	// Summary counts: 1 healthy, 2 degraded, 2 unhealthy, 0 unknown.
	want := Summary{Total: 5, Healthy: 1, Degraded: 2, Unhealthy: 2, Unknown: 0}
	if fh.Summary != want {
		t.Fatalf("summary = %+v, want %+v", fh.Summary, want)
	}

	// Overall: has unhealthy+degraded -> degraded.
	if fh.OverallStatus != StatusDegraded {
		t.Fatalf("overall = %q, want degraded", fh.OverallStatus)
	}

	// generated_at is populated.
	if fh.GeneratedAt.IsZero() {
		t.Fatalf("generated_at not set")
	}
}

// TestHealthAllUnhealthy: every service errors -> overall unhealthy, no panic.
func TestHealthAllUnhealthy(t *testing.T) {
	reg := []ServiceDescriptor{desc("a", 8001, 9001), desc("b", 8002, 9002)}
	responses := map[string]fakeResp{
		"http://127.0.0.1:9001/health": {err: errors.New("down")},
		"http://127.0.0.1:9001/readyz": {err: errors.New("down")},
		"http://127.0.0.1:9002/health": {err: errors.New("down")},
		"http://127.0.0.1:9002/readyz": {err: errors.New("down")},
	}
	s := newFakeService(reg, responses)
	fh := s.Health(context.Background())

	if fh.Summary.Unhealthy != 2 || fh.Summary.Total != 2 {
		t.Fatalf("summary = %+v, want all unhealthy", fh.Summary)
	}
	if fh.OverallStatus != StatusUnhealthy {
		t.Fatalf("overall = %q, want unhealthy", fh.OverallStatus)
	}
}

// TestHealthAllHealthy: clean fleet -> overall healthy.
func TestHealthAllHealthy(t *testing.T) {
	reg := []ServiceDescriptor{desc("a", 8001, 9001), desc("b", 8002, 9002)}
	responses := map[string]fakeResp{
		"http://127.0.0.1:9001/health": {code: 200, body: `{"status":"healthy"}`},
		"http://127.0.0.1:9001/readyz": {code: 200, body: ""},
		"http://127.0.0.1:9002/health": {code: 200, body: `{"status":"healthy"}`},
		"http://127.0.0.1:9002/readyz": {code: 200, body: ""},
	}
	s := newFakeService(reg, responses)
	fh := s.Health(context.Background())

	if fh.Summary.Healthy != 2 {
		t.Fatalf("healthy = %d, want 2", fh.Summary.Healthy)
	}
	if fh.OverallStatus != StatusHealthy {
		t.Fatalf("overall = %q, want healthy", fh.OverallStatus)
	}
}

// TestHealthNeverPanicsOnPartialFailure ensures Health() always returns even when
// scrapes fail mid-fanout (some error, some succeed).
func TestHealthNeverPanicsOnPartialFailure(t *testing.T) {
	reg := DefaultRegistry() // exercise the real 15-service table
	responses := map[string]fakeResp{}
	// Only answer a handful; the rest hit the "no fake response" transport error
	// path, which must be handled gracefully (unhealthy + scrape_error).
	responses["http://127.0.0.1:9085/health"] = fakeResp{code: 200, body: `{"status":"healthy"}`}
	responses["http://127.0.0.1:9085/readyz"] = fakeResp{code: 200, body: ""}

	s := newFakeService(reg, responses)

	var fh FleetHealth
	done := make(chan struct{})
	go func() {
		defer close(done)
		fh = s.Health(context.Background())
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Health() did not return within 5s")
	}

	if fh.Summary.Total != len(reg) {
		t.Fatalf("total = %d, want %d", fh.Summary.Total, len(reg))
	}
	// cyber-service (9085) was answered healthy.
	var foundHealthy bool
	for _, sh := range fh.Services {
		if sh.Name == "cyber-service" && sh.Status == StatusHealthy {
			foundHealthy = true
		}
	}
	if !foundHealthy {
		t.Fatalf("expected cyber-service healthy in mixed fleet")
	}
	// The unanswered services are unhealthy with a scrape error.
	if fh.Summary.Unhealthy == 0 {
		t.Fatalf("expected some unhealthy services from unanswered scrapes")
	}
}

// TestHealthCaching verifies the second call inside CacheTTL is served from cache
// (the fake transport would change answers, but cache returns the first result).
func TestHealthCaching(t *testing.T) {
	reg := []ServiceDescriptor{desc("a", 8001, 9001)}
	calls := 0
	s := New(Config{Registry: reg, BaseHost: "127.0.0.1", ScrapeTimeout: time.Second, CacheTTL: time.Hour}, zerolog.Nop())
	s.client = &http.Client{
		Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewBufferString(`{"status":"healthy"}`)), Header: make(http.Header)}, nil
		}),
	}

	first := s.Health(context.Background())
	callsAfterFirst := calls
	second := s.Health(context.Background())

	if calls != callsAfterFirst {
		t.Fatalf("expected cache hit (no new scrape calls); got %d new", calls-callsAfterFirst)
	}
	if first.GeneratedAt != second.GeneratedAt {
		t.Fatalf("cached result generated_at should match first call")
	}
}
