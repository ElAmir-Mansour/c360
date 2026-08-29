package handler

import (
	"context"
	"net/http"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/require"
)

// newMRT returns a miniredis instance closed at test end.
func newMRT(t *testing.T) *miniredis.Miniredis {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)
	return mr
}

// chiCtx returns or creates the chi RouteContext on r.
func chiCtx(r *http.Request) *chi.Context {
	if rctx := chi.RouteContext(r.Context()); rctx != nil {
		return rctx
	}
	rctx := chi.NewRouteContext()
	*r = *r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
	return rctx
}
