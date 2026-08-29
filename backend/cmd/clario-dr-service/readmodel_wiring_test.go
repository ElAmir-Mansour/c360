package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/readmodel"
)

func buildReadModelRouter(t *testing.T) chi.Router {
	t.Helper()
	router := readmodel.NewRouter(nil, zerolog.Nop())

	root := chi.NewRouter()
	root.Route("/api/v1/dr", func(r chi.Router) {
		r.Group(func(protected chi.Router) {
			protected.Use(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
					if u, ok := userFromHeader(req); ok {
						ctx := auth.WithUser(req.Context(), u)
						ctx = auth.WithTenantID(ctx, u.TenantID)
						req = req.WithContext(ctx)
					}
					next.ServeHTTP(w, req)
				})
			})
			mountRoutes(protected, router.Routes())
		})
	})
	return root
}

func TestReadModelRoutesComposeWithoutPanic(t *testing.T) {
	router := buildReadModelRouter(t)

	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/dr/posture"},
		{http.MethodGet, "/api/v1/dr/replication/summary"},
		{http.MethodGet, "/api/v1/dr/groups/00000000-0000-0000-0000-000000000801/summary"},
	}
	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("X-Test-Role", "no-dr")
			router.ServeHTTP(rec, req)

			require.NotEqual(t, http.StatusNotFound, rec.Code,
				"route must be registered (got 404): %s %s", tc.method, tc.path)
			require.Equal(t, http.StatusForbidden, rec.Code)
		})
	}
}
