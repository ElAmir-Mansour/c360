package entitlement

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	server := miniredis.RunT(t)
	t.Cleanup(server.Close)
	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })
	return client
}

func TestHTTPChecker_AllowedDecision(t *testing.T) {
	var gotKey, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotKey = r.URL.Query().Get("key")
		gotAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"data":{"allowed":true,"reason":""}}`))
	}))
	defer srv.Close()

	checker := NewHTTPChecker(srv.URL, time.Second)
	decision, err := checker.Check(context.Background(), "tenant-1", "Bearer tok", "app.watheeq")
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if !decision.Allowed {
		t.Fatal("decision = denied, want allowed")
	}
	if gotKey != "app.watheeq" {
		t.Errorf("forwarded key = %q, want app.watheeq", gotKey)
	}
	if gotAuth != "Bearer tok" {
		t.Errorf("forwarded authorization = %q, want 'Bearer tok'", gotAuth)
	}
}

func TestHTTPChecker_DeniedDecision(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"data":{"allowed":false,"reason":"not included in plan"}}`))
	}))
	defer srv.Close()

	checker := NewHTTPChecker(srv.URL, time.Second)
	decision, err := checker.Check(context.Background(), "tenant-1", "Bearer tok", "app.watheeq")
	if err != nil {
		t.Fatalf("Check() error = %v", err)
	}
	if decision.Allowed {
		t.Fatal("decision = allowed, want denied")
	}
	if decision.Reason != "not included in plan" {
		t.Errorf("reason = %q, want 'not included in plan'", decision.Reason)
	}
}

func TestHTTPChecker_Non200IsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	checker := NewHTTPChecker(srv.URL, time.Second)
	if _, err := checker.Check(context.Background(), "tenant-1", "Bearer tok", "app.watheeq"); err == nil {
		t.Fatal("expected error on 500 response so the middleware can fail-open/closed")
	}
}

func TestHTTPChecker_UnreachableIsError(t *testing.T) {
	checker := NewHTTPChecker("http://127.0.0.1:1", 200*time.Millisecond)
	if _, err := checker.Check(context.Background(), "tenant-1", "Bearer tok", "app.watheeq"); err == nil {
		t.Fatal("expected error when licensing service is unreachable")
	}
}

// countingChecker records calls so cache behaviour is observable.
type countingChecker struct {
	calls    int
	decision Decision
	err      error
}

func (c *countingChecker) Check(_ context.Context, _, _, _ string) (Decision, error) {
	c.calls++
	return c.decision, c.err
}

func TestCachedChecker_CacheMissThenHit(t *testing.T) {
	upstream := &countingChecker{decision: Decision{Allowed: true}}
	cached := NewCachedChecker(upstream, newTestRedis(t), time.Minute)
	ctx := context.Background()

	first, err := cached.Check(ctx, "tenant-1", "Bearer tok", "app.watheeq")
	if err != nil {
		t.Fatalf("first Check() error = %v", err)
	}
	if first.Cached {
		t.Fatal("first call must be a cache miss")
	}
	if !first.Allowed {
		t.Fatal("first decision = denied, want allowed")
	}

	second, err := cached.Check(ctx, "tenant-1", "Bearer tok", "app.watheeq")
	if err != nil {
		t.Fatalf("second Check() error = %v", err)
	}
	if !second.Cached {
		t.Fatal("second call must be a cache hit")
	}
	if !second.Allowed {
		t.Fatal("cached decision = denied, want allowed")
	}
	if upstream.calls != 1 {
		t.Fatalf("upstream calls = %d, want 1 (second served from cache)", upstream.calls)
	}
}

func TestCachedChecker_CachesDenials(t *testing.T) {
	upstream := &countingChecker{decision: Decision{Allowed: false, Reason: "not in plan"}}
	cached := NewCachedChecker(upstream, newTestRedis(t), time.Minute)
	ctx := context.Background()

	if _, err := cached.Check(ctx, "tenant-1", "Bearer tok", "app.watheeq"); err != nil {
		t.Fatalf("first Check() error = %v", err)
	}
	second, err := cached.Check(ctx, "tenant-1", "Bearer tok", "app.watheeq")
	if err != nil {
		t.Fatalf("second Check() error = %v", err)
	}
	if !second.Cached || second.Allowed {
		t.Fatalf("second decision = %+v, want cached denial", second)
	}
	if upstream.calls != 1 {
		t.Fatalf("upstream calls = %d, want 1 (denial also cached)", upstream.calls)
	}
}

func TestCachedChecker_SeparateKeysAndTenants(t *testing.T) {
	upstream := &countingChecker{decision: Decision{Allowed: true}}
	cached := NewCachedChecker(upstream, newTestRedis(t), time.Minute)
	ctx := context.Background()

	_, _ = cached.Check(ctx, "tenant-1", "tok", "app.watheeq")
	_, _ = cached.Check(ctx, "tenant-1", "tok", "app.mahamatech") // different key
	_, _ = cached.Check(ctx, "tenant-2", "tok", "app.watheeq")    // different tenant

	if upstream.calls != 3 {
		t.Fatalf("upstream calls = %d, want 3 (cache keyed by tenant+entitlement)", upstream.calls)
	}
}

func TestCachedChecker_UpstreamErrorNotCached(t *testing.T) {
	upstream := &countingChecker{err: context.DeadlineExceeded}
	cached := NewCachedChecker(upstream, newTestRedis(t), time.Minute)
	ctx := context.Background()

	if _, err := cached.Check(ctx, "tenant-1", "tok", "app.watheeq"); err == nil {
		t.Fatal("expected upstream error to propagate")
	}
	// A second call must reach upstream again — errors are never cached.
	if _, err := cached.Check(ctx, "tenant-1", "tok", "app.watheeq"); err == nil {
		t.Fatal("expected upstream error to propagate on retry")
	}
	if upstream.calls != 2 {
		t.Fatalf("upstream calls = %d, want 2 (errors not cached)", upstream.calls)
	}
}

func TestCachedChecker_NilRedisPassthrough(t *testing.T) {
	upstream := &countingChecker{decision: Decision{Allowed: true}}
	cached := NewCachedChecker(upstream, nil, time.Minute)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		d, err := cached.Check(ctx, "tenant-1", "tok", "app.watheeq")
		if err != nil {
			t.Fatalf("Check() error = %v", err)
		}
		if d.Cached {
			t.Fatal("nil-redis checker must never report a cache hit")
		}
	}
	if upstream.calls != 3 {
		t.Fatalf("upstream calls = %d, want 3 (no cache without redis)", upstream.calls)
	}
}
