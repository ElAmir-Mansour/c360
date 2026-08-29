package middleware

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/redis/go-redis/v9"
)

// Idempotency provides 24h Redis-backed replay protection on POST.
//
// Behaviour:
//   - On first request with key K: the handler runs, the response
//     status + body are captured and stored under
//     `idemp:siem:sources:{tenant}:{key}` with the configured TTL.
//   - On a replay with the same K + same body hash: the stored
//     response is returned verbatim, with a `X-Idempotent-Replay: true`
//     header.
//   - On a replay with the same K but DIFFERENT body hash: 409 with
//     code=`idempotency_conflict`.
type Idempotency struct {
	rdb    *redis.Client
	ttl    time.Duration
	prefix string
	// TenantExtractor returns the tenant ID for a request. We don't
	// depend on internal/auth here to keep the package import surface
	// lean.
	TenantExtractor func(r *http.Request) string
}

// NewIdempotency constructs the middleware factory.
func NewIdempotency(rdb *redis.Client, ttl time.Duration) *Idempotency {
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	return &Idempotency{rdb: rdb, ttl: ttl, prefix: "idemp:siem:sources"}
}

// Middleware returns the chi-compatible middleware.
func (i *Idempotency) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		if key == "" || i.rdb == nil {
			next.ServeHTTP(w, r)
			return
		}
		tenant := ""
		if i.TenantExtractor != nil {
			tenant = i.TenantExtractor(r)
		}
		bodyBytes, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, "body_read", "failed to read request body")
			return
		}
		_ = r.Body.Close()
		r.Body = io.NopCloser(bytes.NewReader(bodyBytes))

		bodyHash := sha256Hex(bodyBytes)
		redisKey := i.redisKey(tenant, key)

		// Try to read existing entry.
		ctx := r.Context()
		raw, err := i.rdb.Get(ctx, redisKey).Bytes()
		if err == nil {
			var stored storedResponse
			if jerr := json.Unmarshal(raw, &stored); jerr == nil {
				if stored.BodyHash != bodyHash {
					writeError(w, http.StatusConflict, "idempotency_conflict",
						"Idempotency-Key reused with different request body")
					return
				}
				// Replay the original response.
				for k, vs := range stored.Headers {
					for _, v := range vs {
						w.Header().Add(k, v)
					}
				}
				w.Header().Set("X-Idempotent-Replay", "true")
				w.WriteHeader(stored.Status)
				_, _ = w.Write(stored.Body)
				return
			}
		} else if !errors.Is(err, redis.Nil) {
			// Redis is degraded — fail open rather than block writes.
			next.ServeHTTP(w, r)
			return
		}

		rec := &recordingWriter{ResponseWriter: w, body: &bytes.Buffer{}, status: 200, hdrs: http.Header{}}
		next.ServeHTTP(rec, r)

		// Only store successful + client-error responses; never 5xx
		// (we don't want to lock in a transient failure).
		if rec.status >= 200 && rec.status < 500 {
			stored := storedResponse{
				Status:   rec.status,
				Body:     rec.body.Bytes(),
				Headers:  rec.headersCaptured(),
				BodyHash: bodyHash,
			}
			payload, _ := json.Marshal(stored)
			_ = i.rdb.Set(ctx, redisKey, payload, i.ttl).Err()
		}
	})
}

func (i *Idempotency) redisKey(tenant, key string) string {
	if tenant == "" {
		return fmt.Sprintf("%s:_:%s", i.prefix, key)
	}
	return fmt.Sprintf("%s:%s:%s", i.prefix, tenant, key)
}

// storedResponse is the Redis-persisted shape.
type storedResponse struct {
	Status   int                 `json:"status"`
	Body     []byte              `json:"body"`
	Headers  map[string][]string `json:"headers"`
	BodyHash string              `json:"body_hash"`
}

type recordingWriter struct {
	http.ResponseWriter
	body        *bytes.Buffer
	status      int
	wroteHeader bool
	hdrs        http.Header
	headersOnce bool
}

func (r *recordingWriter) WriteHeader(status int) {
	if r.wroteHeader {
		return
	}
	r.status = status
	r.wroteHeader = true
	// Snapshot headers at the moment we commit.
	r.hdrs = cloneHeader(r.ResponseWriter.Header())
	r.headersOnce = true
	r.ResponseWriter.WriteHeader(status)
}

func (r *recordingWriter) Write(b []byte) (int, error) {
	if !r.wroteHeader {
		r.WriteHeader(http.StatusOK)
	}
	r.body.Write(b)
	return r.ResponseWriter.Write(b)
}

func (r *recordingWriter) headersCaptured() map[string][]string {
	if !r.headersOnce {
		return cloneHeader(r.ResponseWriter.Header())
	}
	return r.hdrs
}

func cloneHeader(h http.Header) http.Header {
	out := make(http.Header, len(h))
	for k, v := range h {
		cp := make([]string, len(v))
		copy(cp, v)
		out[k] = cp
	}
	return out
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// PutForTest is a test-only helper to seed a stored response (avoids
// having to round-trip through the middleware).
func (i *Idempotency) PutForTest(ctx context.Context, tenant, key string, body []byte, status int, response []byte) error {
	stored := storedResponse{Status: status, Body: response, BodyHash: sha256Hex(body), Headers: http.Header{}}
	payload, _ := json.Marshal(stored)
	return i.rdb.Set(ctx, i.redisKey(tenant, key), payload, i.ttl).Err()
}
