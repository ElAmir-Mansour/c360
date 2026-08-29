package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/recoverytier"
)

// buildRecoveryTierRouter composes the recovery tier router the same way the DR
// planes mount package routers: route-walking onto the already Auth+Tenant
// protected /api/v1/dr group. The service is nil because these assertions stop
// at the route permission gate before handler logic is invoked.
func buildRecoveryTierRouter(t *testing.T) chi.Router {
	t.Helper()
	logger := zerolog.Nop()
	tierRouter := recoverytier.NewRouter(nil, logger)

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
			mountRoutes(protected, tierRouter.Routes())
		})
	})
	return root
}

func TestRecoveryTierRoutesComposeWithoutPanic(t *testing.T) {
	router := buildRecoveryTierRouter(t)

	cases := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/dr/recovery-tiers"},
		{http.MethodGet, "/api/v1/dr/recovery-tiers/gold"},
		{http.MethodPost, "/api/v1/dr/recovery-tiers/recommend"},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("X-Test-Role", "no-dr")

			router.ServeHTTP(rec, req)

			require.NotEqual(t, http.StatusNotFound, rec.Code,
				"route must be registered (got 404): %s %s", tc.method, tc.path)
			require.Equal(t, http.StatusForbidden, rec.Code,
				"route %s %s must require dr:read", tc.method, tc.path)
		})
	}
}
