package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestIfMatch_Missing(t *testing.T) {
	h := IfMatchRequired(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("should not reach")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/x", nil)
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestIfMatch_Malformed(t *testing.T) {
	h := IfMatchRequired(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("should not reach")
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/x", nil)
	req.Header.Set("If-Match", "abc")
	h.ServeHTTP(rec, req)
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

func TestIfMatch_OK(t *testing.T) {
	called := false
	h := IfMatchRequired(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		v, ok := IfMatchFromContext(r.Context())
		require.True(t, ok)
		require.Equal(t, int64(42), v)
		called = true
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/x", nil)
	req.Header.Set("If-Match", `"42"`)
	h.ServeHTTP(rec, req)
	require.True(t, called)
}

func TestIfMatch_WeakPrefix(t *testing.T) {
	called := false
	h := IfMatchRequired(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		v, _ := IfMatchFromContext(r.Context())
		require.Equal(t, int64(7), v)
		called = true
	}))
	rec := httptest.NewRecorder()
	req := httptest.NewRequest("PATCH", "/x", nil)
	req.Header.Set("If-Match", `W/"7"`)
	h.ServeHTTP(rec, req)
	require.True(t, called)
}
