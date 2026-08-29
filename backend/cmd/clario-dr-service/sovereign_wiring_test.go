package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/assurance"
	"github.com/clario360/platform/internal/dr/attestledger"
	"github.com/clario360/platform/internal/dr/bcm"
	"github.com/clario360/platform/internal/dr/byok"
	"github.com/clario360/platform/internal/dr/cybervault"
	"github.com/clario360/platform/internal/dr/selfdr"
)

// buildSovereignRouter composes the sovereign routers exactly like
// configureSovereignPlane.mount: route-walking onto the already Auth+Tenant
// protected /api/v1/dr group. Services are nil because these assertions stop at
// the permission gate, proving every route is registered and correctly gated.
func buildSovereignRouter(t *testing.T) chi.Router {
	t.Helper()
	logger := zerolog.Nop()
	bcmRouter := bcm.NewRouter(nil, logger)
	assuranceRouter := assurance.NewRouter(nil, logger)
	selfdrRouter := selfdr.NewRouter(nil, logger)
	appverifyRouter := appverify.NewRouter(nil, logger)
	byokRouter := byok.NewRouter(nil, logger)
	cyberVaultRouter := cybervault.NewRouter(nil, logger)
	ledgerHandler := attestledger.NewHandler(nil, logger)

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
			mountRoutes(protected, bcmRouter.Routes())
			mountRoutes(protected, assuranceRouter.Routes())
			mountRoutes(protected, selfdrRouter.Routes())
			mountRoutes(protected, cyberVaultRouter.Routes())
			mountRoutes(protected, appverifyRouter.Routes())
			mountRoutes(protected, byokRouter.Routes())
			mountRoutes(protected, ledgerHandler.Routes())
		})
	})
	return root
}

func TestSovereignPlaneRoutesComposeWithoutPanic(t *testing.T) {
	router := buildSovereignRouter(t)

	cases := []struct {
		method     string
		path       string
		blockRole  string
		wantStatus int
	}{
		{http.MethodGet, "/api/v1/dr/bcm/packs", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/bcm/packs/iso22301", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/bcm/assessments/00000000-0000-0000-0000-000000000801", "no-dr", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/bcm/packs/iso22301/assess?group=00000000-0000-0000-0000-000000000802", "viewer", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/assurance/controls", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/assurance/assessments/00000000-0000-0000-0000-000000000805", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/assurance/groups/00000000-0000-0000-0000-000000000806/latest", "no-dr", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/assurance/groups/00000000-0000-0000-0000-000000000806/evaluate", "viewer", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/selfdr/components", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/selfdr/assessments/latest", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/selfdr/assessments/00000000-0000-0000-0000-000000000807", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/selfdr/artifacts", "no-dr", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/selfdr/assess", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/selfdr/backups", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/selfdr/offline-bundle", "viewer", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/cyber-vaults?group=00000000-0000-0000-0000-000000000803", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/cyber-vaults/assessments?group=00000000-0000-0000-0000-000000000803", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/cyber-vaults/00000000-0000-0000-0000-000000000804/assessments/latest", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/app-verification?group=00000000-0000-0000-0000-000000000808", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/app-verification/00000000-0000-0000-0000-000000000809", "no-dr", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/cyber-vaults?group=00000000-0000-0000-0000-000000000803", "viewer", http.StatusForbidden},
		{http.MethodPut, "/api/v1/dr/cyber-vaults/00000000-0000-0000-0000-000000000804?group=00000000-0000-0000-0000-000000000803", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/cyber-vaults/00000000-0000-0000-0000-000000000804/evaluate?group=00000000-0000-0000-0000-000000000803", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/cyber-vaults/00000000-0000-0000-0000-000000000804/sync/plan?group=00000000-0000-0000-0000-000000000803", "viewer", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/byok/keys", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/byok/keys/custody-log", "no-dr", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/byok/keys", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/byok/keys/rotate", "viewer", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/attestation-ledger", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/attestation-ledger/verify", "no-dr", http.StatusForbidden},
		{http.MethodGet, "/api/v1/dr/attestation-ledger/42/proof", "no-dr", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/attestation-ledger/anchor", "viewer", http.StatusForbidden},
	}

	for _, tc := range cases {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("X-Test-Role", tc.blockRole)
			router.ServeHTTP(rec, req)
			require.NotEqual(t, http.StatusNotFound, rec.Code,
				"route must be registered (got 404): %s %s", tc.method, tc.path)
			require.Equal(t, tc.wantStatus, rec.Code,
				"route %s %s must be gated as expected", tc.method, tc.path)
		})
	}
}
