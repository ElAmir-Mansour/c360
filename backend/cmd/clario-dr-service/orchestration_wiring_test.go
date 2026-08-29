package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/bootgraph"
	"github.com/clario360/platform/internal/dr/drillsched"
	"github.com/clario360/platform/internal/dr/gameday"
	"github.com/clario360/platform/internal/dr/rehearsalproof"
	"github.com/clario360/platform/internal/dr/runbookstudio"
)

// buildOrchestrationRouter composes the orchestration routers exactly like
// configureOrchestrationPlane.mount: route-walking onto the already Auth+Tenant
// protected /api/v1/dr group. Services are nil because these assertions stop at
// the route permission gate. The coverage-breadth packages (vmcapture / iacdr /
// storageoffload) are mounted by the coverage plane and asserted in
// coverage_wiring_test.go.
func buildOrchestrationRouter(t *testing.T) chi.Router {
	t.Helper()
	logger := zerolog.Nop()

	studioRouter := runbookstudio.NewRouter(nil, logger)
	drillRouter := drillsched.NewRouter(nil, logger)
	bootRouter := bootgraph.NewRouter(nil, logger)
	gamedayRouter := gameday.NewRouter(nil, logger)
	rehearsalProofRouter := rehearsalproof.NewRouter(nil, logger)

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
			mountRoutes(protected, studioRouter.Routes())
			mountRoutes(protected, drillRouter.Routes())
			mountRoutes(protected, bootRouter.Routes())
			mountRoutes(protected, gamedayRouter.Routes())
			mountRoutes(protected, rehearsalProofRouter.Routes())
		})
	})
	return root
}

func TestOrchestrationPlaneRoutesComposeWithoutPanic(t *testing.T) {
	router := buildOrchestrationRouter(t)

	cases := []struct {
		method     string
		path       string
		blockRole  string
		wantStatus int
	}{
		// runbook studio: read views, write authoring, failover live-run actions.
		{http.MethodGet, "/api/v1/dr/studio/runbooks/00000000-0000-0000-0000-000000000101", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/studio/runs/00000000-0000-0000-0000-000000000102", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/studio/runbooks", "viewer", http.StatusForbidden},
		{http.MethodPut, "/api/v1/dr/studio/runbooks/00000000-0000-0000-0000-000000000101", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/studio/runbooks/00000000-0000-0000-0000-000000000101/tasks", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/studio/runbooks/00000000-0000-0000-0000-000000000101/runs", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/studio/runs/00000000-0000-0000-0000-000000000102/tasks/00000000-0000-0000-0000-000000000103:complete", "viewer", http.StatusForbidden},
		// scheduled drills: read schedules/results, write schedules.
		{http.MethodGet, "/api/v1/dr/drill-schedules", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/drill-schedules/00000000-0000-0000-0000-000000000201/next-runs", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/groups/00000000-0000-0000-0000-000000000202/drill-results", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/drill-results/00000000-0000-0000-0000-000000000203/diff", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/drill-schedules", "viewer", http.StatusForbidden},
		// boot graph: read plan/run, write DAG definition, failover boot run.
		{http.MethodGet, "/api/v1/dr/groups/00000000-0000-0000-0000-000000000301/boot-plan", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/boot-runs/00000000-0000-0000-0000-000000000302", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/groups/00000000-0000-0000-0000-000000000301/boot-services", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/groups/00000000-0000-0000-0000-000000000301/boot-runs", "viewer", http.StatusForbidden},
		// game-day: read scenarios/scorecards, write scenario, failover execute.
		{http.MethodGet, "/api/v1/dr/gameday/scenarios", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/gameday/runs/00000000-0000-0000-0000-000000000402", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/gameday/scenarios", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/gameday/scenarios/00000000-0000-0000-0000-000000000401/runs", "viewer", http.StatusForbidden},
		// rehearsal proof: read-only procurement proof envelopes over real rehearsal records.
		{http.MethodGet, "/api/v1/dr/rehearsal-proofs/gameday/00000000-0000-0000-0000-000000000501", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/rehearsal-proofs/runbook-runs/00000000-0000-0000-0000-000000000502", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/rehearsal-proofs/failover-runs/00000000-0000-0000-0000-000000000503", "", http.StatusUnauthorized},
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
