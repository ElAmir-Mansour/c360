package handler

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"

	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/mtls"
	"github.com/clario360/platform/internal/siem/sources/service"
)

// HeartbeatHandler hosts POST /collector/heartbeat (mTLS-only).
type HeartbeatHandler struct {
	svc       service.Service
	rdb       *redis.Client
	rateLimit int
	limiter   *inProcessLimiter
}

// NewHeartbeatHandler constructs a HeartbeatHandler. rdb may be nil
// (in dev); when nil, an in-process bucket fallback is used.
func NewHeartbeatHandler(svc service.Service, rdb *redis.Client, rateLimitPerMin int) *HeartbeatHandler {
	if rateLimitPerMin <= 0 {
		rateLimitPerMin = 6
	}
	return &HeartbeatHandler{svc: svc, rdb: rdb, rateLimit: rateLimitPerMin, limiter: newInProcessLimiter(rateLimitPerMin)}
}

type heartbeatReq struct {
	TS               time.Time `json:"ts"`
	EPS1Min          int       `json:"eps_1min"`
	EPS5Min          int       `json:"eps_5min"`
	ParserErrors1Min int       `json:"parser_errors_1min"`
	Dropped1Min      int       `json:"dropped_1min"`
	QueueDepth       int       `json:"queue_depth"`
	CollectorVersion string    `json:"collector_version"`
}

// Heartbeat POST /collector/heartbeat
func (h *HeartbeatHandler) Heartbeat(w http.ResponseWriter, r *http.Request) {
	src := mtls.SourceFromContext(r.Context())
	if src == nil {
		writeErr(w, http.StatusUnauthorized, "no_mtls", "mtls context required")
		return
	}
	// Rate limit per source.
	if !h.allow(r.Context(), src.ID) {
		writeErr(w, http.StatusTooManyRequests, "rate_limited", "heartbeat rate limit exceeded")
		return
	}

	var body heartbeatReq
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, http.StatusBadRequest, "bad_json", err.Error())
		return
	}
	if body.EPS1Min < 0 || body.EPS5Min < 0 || body.ParserErrors1Min < 0 || body.Dropped1Min < 0 || body.QueueDepth < 0 {
		writeErr(w, http.StatusBadRequest, "negative_counter", "all counters must be >= 0")
		return
	}
	if body.TS.IsZero() {
		body.TS = time.Now().UTC()
	}
	if err := h.svc.RecordHeartbeat(r.Context(), src.ID, sources.EPSSample{
		SourceID: src.ID, TS: body.TS, EPS1Min: body.EPS1Min, EPS5Min: body.EPS5Min,
		ParserErrors1Min: body.ParserErrors1Min, Dropped1Min: body.Dropped1Min,
		QueueDepth: body.QueueDepth, CollectorVersion: body.CollectorVersion,
	}); err != nil {
		writeErr(w, http.StatusInternalServerError, "record_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// allow returns true if the call is permitted. Uses Redis when
// available; in-process token bucket as fallback.
func (h *HeartbeatHandler) allow(ctx context.Context, sourceID uuid.UUID) bool {
	if h.rdb == nil {
		return h.limiter.allow(sourceID)
	}
	key := "siem:hb:rate:" + sourceID.String()
	n, err := h.rdb.Incr(ctx, key).Result()
	if err != nil {
		// fail open
		return true
	}
	if n == 1 {
		_ = h.rdb.Expire(ctx, key, time.Minute).Err()
	}
	return n <= int64(h.rateLimit)
}

// --- in-process limiter ---

type bucket struct {
	count int
	since time.Time
}

type inProcessLimiter struct {
	mu      sync.Mutex
	buckets map[uuid.UUID]*bucket
	max     int
}

func newInProcessLimiter(max int) *inProcessLimiter {
	return &inProcessLimiter{buckets: map[uuid.UUID]*bucket{}, max: max}
}

func (l *inProcessLimiter) allow(id uuid.UUID) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	b, ok := l.buckets[id]
	now := time.Now().UTC()
	if !ok || now.Sub(b.since) > time.Minute {
		l.buckets[id] = &bucket{count: 1, since: now}
		return true
	}
	if b.count >= l.max {
		return false
	}
	b.count++
	return true
}

// MountHeartbeatRouter exposes a chi router for the mTLS heartbeat
// endpoint. Wired separately from the user-JWT plane.
func MountHeartbeatRouter(svc service.Service, rdb *redis.Client, mw *mtls.Middleware, rateLimit int) http.Handler {
	hb := NewHeartbeatHandler(svc, rdb, rateLimit)
	mux := http.NewServeMux()
	mux.Handle("/collector/heartbeat", mw.Handler(http.HandlerFunc(hb.Heartbeat)))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})
	return mux
}

// guard to suppress unused-import warnings when refactoring.
var _ = errors.New
