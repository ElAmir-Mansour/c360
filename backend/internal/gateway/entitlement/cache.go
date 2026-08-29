package entitlement

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// CachedChecker wraps a Checker with a short-lived Redis cache keyed by
// tenant + entitlement key. Gateway entitlement gates resolve boolean
// plan-access ("does this tenant have the Watheeq app?"), which changes only
// on a license edit, so a few-seconds cache cuts upstream calls to roughly one
// per tenant+key per TTL without making revocation meaningfully slower.
//
// A nil Redis client degrades to a passthrough: every call hits the upstream
// checker. Redis errors never fail a request — they fall through to the
// upstream, and the upstream's own error is what the middleware acts on.
type CachedChecker struct {
	upstream Checker
	rdb      *redis.Client
	ttl      time.Duration
}

// NewCachedChecker wraps upstream with a Redis cache. A ttl <= 0 defaults to
// 30 seconds.
func NewCachedChecker(upstream Checker, rdb *redis.Client, ttl time.Duration) *CachedChecker {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &CachedChecker{upstream: upstream, rdb: rdb, ttl: ttl}
}

func cacheKey(tenantID, key string) string {
	return fmt.Sprintf("gw:entitlement:%s:%s", tenantID, key)
}

// tenantKeyPattern matches every cached entitlement entry for one tenant. Used
// by InvalidateTenant to SCAN+DEL the whole tenant namespace on a license edit
// that may affect any key (e.g. a plan re-assign with invalidate_all).
func tenantKeyPattern(tenantID string) string {
	return fmt.Sprintf("gw:entitlement:%s:*", tenantID)
}

// InvalidateTenant deletes every cached entitlement decision for tenantID. It
// is the cache-bust for a license.entitlements_changed{invalidate_all:true}
// event: after a plan re-assign the whole tenant scope may have changed, so all
// per-key decisions are dropped and re-resolved on the next request.
//
// Best-effort: a nil Redis client or any Redis error is swallowed (returned to
// the caller for logging) — the short TTL remains the correctness backstop, so
// a failed invalidation only delays visibility, never breaks it. Deletion uses
// a cursor-based SCAN so a large tenant namespace never blocks Redis the way a
// KEYS sweep would.
func (c *CachedChecker) InvalidateTenant(ctx context.Context, tenantID string) error {
	if c == nil || c.rdb == nil || tenantID == "" {
		return nil
	}
	pattern := tenantKeyPattern(tenantID)
	var cursor uint64
	for {
		keys, next, err := c.rdb.Scan(ctx, cursor, pattern, 256).Result()
		if err != nil {
			return fmt.Errorf("scan %s: %w", pattern, err)
		}
		if len(keys) > 0 {
			if err := c.rdb.Del(ctx, keys...).Err(); err != nil {
				return fmt.Errorf("del entitlement keys: %w", err)
			}
		}
		cursor = next
		if cursor == 0 {
			return nil
		}
	}
}

// InvalidateKey deletes the single cached decision for tenantID+key. It is the
// cache-bust for a license.entitlements_changed event that names one
// entitlement_key (an override set/remove). Best-effort, same as
// InvalidateTenant: a nil client / empty arg / Redis error never breaks
// correctness because the TTL still expires the stale entry.
func (c *CachedChecker) InvalidateKey(ctx context.Context, tenantID, key string) error {
	if c == nil || c.rdb == nil || tenantID == "" || key == "" {
		return nil
	}
	if err := c.rdb.Del(ctx, cacheKey(tenantID, key)).Err(); err != nil {
		return fmt.Errorf("del %s: %w", cacheKey(tenantID, key), err)
	}
	return nil
}

// Check returns the cached decision when present (Decision.Cached = true),
// otherwise resolves upstream and caches the result. The struct holds no
// per-request state, so one CachedChecker is safe to share across concurrent
// requests.
func (c *CachedChecker) Check(ctx context.Context, tenantID, authorization, key string) (Decision, error) {
	if c.rdb != nil {
		if v, err := c.rdb.Get(ctx, cacheKey(tenantID, key)).Result(); err == nil {
			return Decision{Allowed: v == "1", Cached: true}, nil
		}
	}

	decision, err := c.upstream.Check(ctx, tenantID, authorization, key)
	if err != nil {
		return Decision{}, err
	}

	if c.rdb != nil {
		val := "0"
		if decision.Allowed {
			val = "1"
		}
		// Best-effort: a failed write just means the next call re-resolves.
		_ = c.rdb.Set(ctx, cacheKey(tenantID, key), val, c.ttl).Err()
	}
	return decision, nil
}
