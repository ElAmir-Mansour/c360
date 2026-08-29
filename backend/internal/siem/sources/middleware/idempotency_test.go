package middleware

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
)

func newRDB(t *testing.T) *redis.Client {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	return redis.NewClient(&redis.Options{Addr: mr.Addr()})
}

func TestIdempotency_NoKey_PassesThrough(t *testing.T) {
	rdb := newRDB(t)
	im := NewIdempotency(rdb, time.Hour)
	var called int32
	h := im.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&called, 1)
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/x", bytes.NewBufferString(`{}`))
	h.ServeHTTP(rec, req)
	require.Equal(t, int32(1), atomic.LoadInt32(&called))
	require.Equal(t, 201, rec.Code)
}

func TestIdempotency_Replay_ReturnsCachedBody(t *testing.T) {
	rdb := newRDB(t)
	im := NewIdempotency(rdb, time.Hour)
	im.TenantExtractor = func(*http.Request) string { return "t1" }

	var called int32
	h := im.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&called, 1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{"v":1}`))
	}))

	// First request — handler runs.
	rec1 := httptest.NewRecorder()
	req1 := httptest.NewRequest("POST", "/x", bytes.NewBufferString(`{"a":1}`))
	req1.Header.Set("Idempotency-Key", "K1")
	h.ServeHTTP(rec1, req1)
	require.Equal(t, int32(1), called)
	require.Equal(t, 201, rec1.Code)

	// Replay with same key + body — handler must NOT run again.
	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("POST", "/x", bytes.NewBufferString(`{"a":1}`))
	req2.Header.Set("Idempotency-Key", "K1")
	h.ServeHTTP(rec2, req2)
	require.Equal(t, int32(1), atomic.LoadInt32(&called))
	require.Equal(t, 201, rec2.Code)
	require.Equal(t, "true", rec2.Header().Get("X-Idempotent-Replay"))
	require.Contains(t, rec2.Body.String(), `"v":1`)
}

func TestIdempotency_ReplayDifferentBody_409(t *testing.T) {
	rdb := newRDB(t)
	im := NewIdempotency(rdb, time.Hour)
	im.TenantExtractor = func(*http.Request) string { return "t" }
	h := im.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(201)
		_, _ = w.Write([]byte(`{}`))
	}))

	rec1 := httptest.NewRecorder()
	req1 := httptest.NewRequest("POST", "/x", bytes.NewBufferString(`{"a":1}`))
	req1.Header.Set("Idempotency-Key", "K2")
	h.ServeHTTP(rec1, req1)

	rec2 := httptest.NewRecorder()
	req2 := httptest.NewRequest("POST", "/x", bytes.NewBufferString(`{"a":2}`))
	req2.Header.Set("Idempotency-Key", "K2")
	h.ServeHTTP(rec2, req2)
	require.Equal(t, http.StatusConflict, rec2.Code)
}

func TestIdempotency_5xx_NotCached(t *testing.T) {
	rdb := newRDB(t)
	im := NewIdempotency(rdb, time.Hour)
	im.TenantExtractor = func(*http.Request) string { return "t" }

	var called int32
	h := im.Middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&called, 1)
		w.WriteHeader(500)
	}))

	for i := 0; i < 2; i++ {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("POST", "/x", bytes.NewBufferString(`{}`))
		req.Header.Set("Idempotency-Key", "K3")
		h.ServeHTTP(rec, req)
	}
	require.Equal(t, int32(2), atomic.LoadInt32(&called))
}
