package entitlement

import (
	"context"
	"testing"
	"time"
)

// seedAllowed primes the Redis cache with an allow decision so we can observe
// whether an Invalidate* call drops it (next Check is a miss → upstream).
func seedAllowed(t *testing.T, c *CachedChecker, up *countingChecker, tenant, key string) {
	t.Helper()
	d, err := c.Check(context.Background(), tenant, "tok", key)
	if err != nil {
		t.Fatalf("seed Check() error = %v", err)
	}
	if d.Cached {
		t.Fatalf("seed Check() for %s/%s reported cached; expected a miss", tenant, key)
	}
	_ = up
}

func TestInvalidateTenant_ClearsAllTenantEntries(t *testing.T) {
	up := &countingChecker{decision: Decision{Allowed: true}}
	c := NewCachedChecker(up, newTestRedis(t), time.Hour)
	ctx := context.Background()

	// Seed three entries for tenant-1 and one for tenant-2.
	seedAllowed(t, c, up, "tenant-1", "app.watheeq")
	seedAllowed(t, c, up, "tenant-1", "app.acta")
	seedAllowed(t, c, up, "tenant-1", "suite.cyber")
	seedAllowed(t, c, up, "tenant-2", "app.watheeq")
	if up.calls != 4 {
		t.Fatalf("after seeding upstream calls = %d, want 4", up.calls)
	}

	// All four are now cached hits.
	for _, k := range []string{"app.watheeq", "app.acta", "suite.cyber"} {
		if d, _ := c.Check(ctx, "tenant-1", "tok", k); !d.Cached {
			t.Fatalf("tenant-1/%s should be a cache hit before invalidation", k)
		}
	}
	if up.calls != 4 {
		t.Fatalf("cache hits should not reach upstream; calls = %d, want 4", up.calls)
	}

	// Bust the whole tenant-1 namespace.
	if err := c.InvalidateTenant(ctx, "tenant-1"); err != nil {
		t.Fatalf("InvalidateTenant() error = %v", err)
	}

	// Every tenant-1 key is now a miss → re-resolves upstream (+3 calls).
	for _, k := range []string{"app.watheeq", "app.acta", "suite.cyber"} {
		if d, _ := c.Check(ctx, "tenant-1", "tok", k); d.Cached {
			t.Fatalf("tenant-1/%s should be a cache miss after InvalidateTenant", k)
		}
	}
	if up.calls != 7 {
		t.Fatalf("after invalidation+reload upstream calls = %d, want 7", up.calls)
	}

	// tenant-2 is untouched — still a cache hit, no extra upstream call.
	if d, _ := c.Check(ctx, "tenant-2", "tok", "app.watheeq"); !d.Cached {
		t.Fatal("tenant-2 entry must survive a tenant-1 invalidation")
	}
	if up.calls != 7 {
		t.Fatalf("tenant-2 hit must not reach upstream; calls = %d, want 7", up.calls)
	}
}

func TestInvalidateKey_ClearsExactlyOne(t *testing.T) {
	up := &countingChecker{decision: Decision{Allowed: true}}
	c := NewCachedChecker(up, newTestRedis(t), time.Hour)
	ctx := context.Background()

	seedAllowed(t, c, up, "tenant-1", "app.watheeq")
	seedAllowed(t, c, up, "tenant-1", "app.acta")
	if up.calls != 2 {
		t.Fatalf("after seeding upstream calls = %d, want 2", up.calls)
	}

	// Bust only app.watheeq.
	if err := c.InvalidateKey(ctx, "tenant-1", "app.watheeq"); err != nil {
		t.Fatalf("InvalidateKey() error = %v", err)
	}

	// app.watheeq is now a miss → upstream (+1).
	if d, _ := c.Check(ctx, "tenant-1", "tok", "app.watheeq"); d.Cached {
		t.Fatal("app.watheeq should be a cache miss after InvalidateKey")
	}
	// app.acta is untouched → still a hit (no upstream).
	if d, _ := c.Check(ctx, "tenant-1", "tok", "app.acta"); !d.Cached {
		t.Fatal("app.acta must survive an app.watheeq key invalidation")
	}
	if up.calls != 3 {
		t.Fatalf("exactly one entry should reload; calls = %d, want 3", up.calls)
	}
}

func TestInvalidate_NilRedisAndEmptyArgsAreNoOps(t *testing.T) {
	// nil Redis: passthrough cache, invalidation is a harmless no-op.
	nilCache := NewCachedChecker(&countingChecker{}, nil, time.Minute)
	if err := nilCache.InvalidateTenant(context.Background(), "tenant-1"); err != nil {
		t.Fatalf("InvalidateTenant(nil redis) error = %v", err)
	}
	if err := nilCache.InvalidateKey(context.Background(), "tenant-1", "app.watheeq"); err != nil {
		t.Fatalf("InvalidateKey(nil redis) error = %v", err)
	}

	// Real Redis but empty args: no-op, no error.
	c := NewCachedChecker(&countingChecker{}, newTestRedis(t), time.Minute)
	if err := c.InvalidateTenant(context.Background(), ""); err != nil {
		t.Fatalf("InvalidateTenant(empty tenant) error = %v", err)
	}
	if err := c.InvalidateKey(context.Background(), "tenant-1", ""); err != nil {
		t.Fatalf("InvalidateKey(empty key) error = %v", err)
	}
}
