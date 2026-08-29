package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/assurance"
)

// buildAssuranceRouter composes the assurance router the same way main wires
// sovereign routes: route-walking onto the already Auth+Tenant protected
// /api/v1/dr group. The service is nil because these assertions stop at the
// permission gate before handler logic is invoked.
func buildAssuranceRouter(t *testing.T) chi.Router {
	t.Helper()
	logger := zerolog.Nop()
	assuranceRouter := assurance.NewRouter(nil, logger)

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
			mountRoutes(protected, assuranceRouter.Routes())
		})
	})
	return root
}

func TestAssuranceRoutesMountUnderDRWithPermissions(t *testing.T) {
	router := buildAssuranceRouter(t)

	cases := []struct {
		method     string
		path       string
		blockRole  string
		wantStatus int
	}{
		{http.MethodGet, "/api/v1/dr/assurance/controls", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/assurance/assessments/00000000-0000-0000-0000-000000000805", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/assurance/groups/00000000-0000-0000-0000-000000000806/latest", "no-dr", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/assurance/groups/00000000-0000-0000-0000-000000000806/evaluate", "viewer", http.StatusForbidden},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("X-Test-Role", tc.blockRole)

			router.ServeHTTP(rec, req)

			require.NotEqual(t, http.StatusNotFound, rec.Code,
				"route must be registered under /api/v1/dr (got 404): %s %s", tc.method, tc.path)
			require.Equal(t, tc.wantStatus, rec.Code,
				"route %s %s must be gated as expected", tc.method, tc.path)
		})
	}
}
