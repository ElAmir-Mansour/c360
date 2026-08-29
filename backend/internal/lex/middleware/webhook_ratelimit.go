package middleware

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// WebhookRateLimitConfig configures the per-source-IP limiter that guards the
// PUBLIC, UNAUTHENTICATED lex/watheeq email webhook routes (WS5). Those routes
// carry no JWT and no tenant context, so the only abuse key available is the
// source IP. This is a SECOND, dedicated limiter that wraps ONLY the webhook
// routes; it is independent of the per-tenant RateLimiter applied to the
// JWT-gated API so a webhook flood cannot consume a tenant's API budget (and
// vice-versa).
type WebhookRateLimitConfig struct {
	// RequestsPerWindow is the maximum number of webhook calls a single source IP
	// may make within Window. <= 0 disables the limiter (pass-through).
	RequestsPerWindow int
	// Window is the fixed counting window.
	Window time.Duration
	// KeyPrefix namespaces the Redis counters. Defaults to "lex:webhook:ratelimit".
	KeyPrefix string
	// TrustForwardedFor controls whether the X-Forwarded-For header is honoured to
	// derive the client IP. This MUST only be enabled when the service sits behind
	// a trusted proxy/ingress that overwrites the header; otherwise a caller can
	// spoof the limiter key. Defaults to false (use the transport RemoteAddr),
	// which is the safe default for a directly-exposed webhook.
	TrustForwardedFor bool
}

// WebhookRateLimitDefaults returns conservative defaults for the public webhook
// limiter: 60 calls / minute / source IP. The webhook is a legitimately
// low-rate ingress (one inbound email at a time per provider), so a tight bound
// blunts brute-force HMAC probing / mailbox enumeration without impacting a
// well-behaved upstream mail provider.
func WebhookRateLimitDefaults() WebhookRateLimitConfig {
	return WebhookRateLimitConfig{
		RequestsPerWindow: 60,
		Window:            time.Minute,
		KeyPrefix:         "lex:webhook:ratelimit",
	}
}

// WebhookRateLimiter returns middleware that enforces a per-source-IP fixed
// window token budget over the public webhook routes.
//
// Backing store: when rdb is non-nil the counter is a Redis fixed-window
// INCR+EXPIRE (shared across replicas); on ANY Redis error it FAILS OPEN to the
// in-process limiter rather than dropping legitimate traffic. When rdb is nil it
// uses the in-process limiter directly. The in-process limiter is a sharded
// token bucket safe for concurrent use and self-pruning, so a long-lived process
// does not leak per-IP entries.
//
// The limiter NEVER inspects the body and runs BEFORE the handler reads it, so a
// flood is rejected cheaply. The source IP is SHA-256 hashed before it is used
// as a Redis key so raw client IPs are not persisted.
func WebhookRateLimiter(rdb *redis.Client, cfg WebhookRateLimitConfig) func(http.Handler) http.Handler {
	if cfg.RequestsPerWindow <= 0 || cfg.Window <= 0 {
		// Disabled: transparent pass-through (preserves prior behavior when a
		// deployment explicitly opts out by setting a non-positive limit).
		return func(next http.Handler) http.Handler { return next }
	}
	if cfg.KeyPrefix == "" {
		cfg.KeyPrefix = "lex:webhook:ratelimit"
	}
	local := newIPTokenBucket(cfg.RequestsPerWindow, cfg.Window)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := webhookClientIP(r, cfg.TrustForwardedFor)
			allowed := true
			if rdb != nil {
				ok, err := redisFixedWindowAllow(r.Context(), rdb, cfg, ip)
				if err != nil {
					// Fail open to the in-process limiter on Redis trouble so a
					// transient store outage does not stop legitimate ingestion,
					// while still bounding a flood from a single IP locally.
					allowed = local.allow(ip)
				} else {
					allowed = ok
				}
			} else {
				allowed = local.allow(ip)
			}

			if !allowed {
				w.Header().Set("Content-Type", "application/json")
				w.Header().Set("Retry-After", strconv.Itoa(int(cfg.Window.Seconds())))
				w.WriteHeader(http.StatusTooManyRequests)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status":  http.StatusTooManyRequests,
					"code":    "RATE_LIMITED",
					"message": "too many requests, please try again later",
				})
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// redisFixedWindowAllow increments a per-(IP,window) counter and reports whether
// the call is within budget. The window is derived from wall-clock time so all
// replicas share the same bucket boundary without coordination.
func redisFixedWindowAllow(ctx context.Context, rdb *redis.Client, cfg WebhookRateLimitConfig, ip string) (bool, error) {
	bucket := time.Now().UnixNano() / int64(cfg.Window)
	sum := sha256.Sum256([]byte(ip))
	key := cfg.KeyPrefix + ":" + hex.EncodeToString(sum[:]) + ":" + strconv.FormatInt(bucket, 10)

	pipe := rdb.Pipeline()
	incr := pipe.Incr(ctx, key)
	// Expire slightly beyond the window so the bucket key self-reaps.
	pipe.Expire(ctx, key, cfg.Window+time.Second)
	if _, err := pipe.Exec(ctx); err != nil {
		return false, err
	}
	return incr.Val() <= int64(cfg.RequestsPerWindow), nil
}

// webhookClientIP derives the best-effort source IP. By default it uses the
// transport-level RemoteAddr (host portion), which cannot be spoofed by the
// caller. X-Forwarded-For is only honoured when explicitly trusted, in which
// case the LEFT-MOST (original client) entry is used.
func webhookClientIP(r *http.Request, trustForwardedFor bool) string {
	if trustForwardedFor {
		if fwd := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); fwd != "" {
			first := fwd
			if i := strings.IndexByte(fwd, ','); i >= 0 {
				first = strings.TrimSpace(fwd[:i])
			}
			if first != "" {
				return first
			}
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

// ipTokenBucket is a sharded, self-pruning per-IP fixed-window counter used as
// the in-process limiter (and as the Redis fail-open fallback). It is safe for
// concurrent use. Entries are reset lazily when their window rolls over, so the
// map size is bounded by the number of distinct active IPs within one window.
type ipTokenBucket struct {
	limit  int
	window time.Duration
	mu     sync.Mutex
	counts map[string]*ipWindowCount
	// lastSweep gates periodic pruning of stale entries.
	lastSweep time.Time
}

type ipWindowCount struct {
	windowStart time.Time
	count       int
}

func newIPTokenBucket(limit int, window time.Duration) *ipTokenBucket {
	return &ipTokenBucket{
		limit:     limit,
		window:    window,
		counts:    make(map[string]*ipWindowCount),
		lastSweep: time.Now(),
	}
}

// allow records one hit for ip and reports whether it is within budget.
func (b *ipTokenBucket) allow(ip string) bool {
	now := time.Now()
	b.mu.Lock()
	defer b.mu.Unlock()

	b.sweepLocked(now)

	entry, ok := b.counts[ip]
	if !ok || now.Sub(entry.windowStart) >= b.window {
		b.counts[ip] = &ipWindowCount{windowStart: now, count: 1}
		return 1 <= b.limit
	}
	entry.count++
	return entry.count <= b.limit
}

// sweepLocked drops entries whose window has fully elapsed. It runs at most once
// per window to keep allow() O(1) amortized. Caller must hold b.mu.
func (b *ipTokenBucket) sweepLocked(now time.Time) {
	if now.Sub(b.lastSweep) < b.window {
		return
	}
	for ip, entry := range b.counts {
		if now.Sub(entry.windowStart) >= b.window {
			delete(b.counts, ip)
		}
	}
	b.lastSweep = now
}
