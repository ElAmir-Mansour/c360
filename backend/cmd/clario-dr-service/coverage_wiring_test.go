package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/iacdr"
	"github.com/clario360/platform/internal/dr/storageoffload"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

// buildCoverageRouter composes the coverage routers exactly like
// configureCoveragePlane.mount: route-walking onto the already Auth+Tenant
// protected /api/v1/dr group. Services are nil because these assertions stop at
// the route permission gate — they prove every coverage route is registered (not
// 404) and gated by the expected permission (dr:read / dr:write / dr:admin).
func buildCoverageRouter(t *testing.T) chi.Router {
	t.Helper()
	logger := zerolog.Nop()

	workloadHandler := vmcapture.NewHandler(nil, logger)
	iacRouter := iacdr.NewRouter(nil, logger)
	offloadRouter := storageoffload.NewRouter(nil, logger)

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
			mountRoutes(protected, workloadHandler.Routes())
			mountRoutes(protected, iacRouter.Routes())
			mountRoutes(protected, offloadRouter.Routes())
		})
	})
	return root
}

func TestCoveragePlaneRoutesComposeWithoutPanic(t *testing.T) {
	router := buildCoverageRouter(t)

	cases := []struct {
		method     string
		path       string
		blockRole  string
		wantStatus int
	}{
		// workload capture: read sources/epochs, write registration and capture runs.
		{http.MethodGet, "/api/v1/dr/workload-captures", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/workload-captures/00000000-0000-0000-0000-000000000701/epochs", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/workload-captures", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/workload-captures/00000000-0000-0000-0000-000000000701/run", "viewer", http.StatusForbidden},
		// IaC DR: read snapshots/diff/plans, write ingests.
		{http.MethodGet, "/api/v1/dr/iac-snapshots", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/iac-snapshots/00000000-0000-0000-0000-000000000501", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/iac-snapshots/00000000-0000-0000-0000-000000000501/diff?against=00000000-0000-0000-0000-000000000502", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/iac-snapshots/00000000-0000-0000-0000-000000000501/reconstitution-plan", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/iac-snapshots", "viewer", http.StatusForbidden},
		// storage offload: read catalogs, admin registers volumes, write requests work.
		{http.MethodGet, "/api/v1/dr/storage-volumes", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/storage-volumes/00000000-0000-0000-0000-000000000601", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/storage-volumes/00000000-0000-0000-0000-000000000601/snapshots", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/storage-snapshots/00000000-0000-0000-0000-000000000602", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/storage-volumes", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/storage-volumes/00000000-0000-0000-0000-000000000601/snapshots", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/storage-snapshots/00000000-0000-0000-0000-000000000602/replicate", "viewer", http.StatusForbidden},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			if tc.blockRole != "" {
				req.Header.Set("X-Test-Role", tc.blockRole)
			}
			router.ServeHTTP(rec, req)
			require.NotEqual(t, http.StatusNotFound, rec.Code,
				"route must be registered (got 404): %s %s", tc.method, tc.path)
			require.Equal(t, tc.wantStatus, rec.Code,
				"route %s %s must be gated as expected", tc.method, tc.path)
		})
	}
}
