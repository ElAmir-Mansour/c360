package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/appconsistent"
	"github.com/clario360/platform/internal/dr/failback"
	"github.com/clario360/platform/internal/dr/instant"
	"github.com/clario360/platform/internal/dr/journal"
	"github.com/clario360/platform/internal/dr/topology"
)

// buildResilienceRouter composes the five resilience packages' routers onto one
// Auth+Tenant group exactly as configureResiliencePlane.mount does — via
// mountRoutes (route-walking) rather than repeated Mount("/", ...). The package
// services are nil: every assertion in this file targets the per-route
// permission GATE, which runs before any handler, so the nil services are never
// invoked. This both proves the composition does not panic (the latent
// double-Mount bug) and that each route's RequirePermission gate is active.
func buildResilienceRouter(t *testing.T) chi.Router {
	t.Helper()
	logger := zerolog.Nop()

	journalHandler := journal.NewHandler(nil, logger)
	appconsistentHandler := appconsistent.NewHandler(nil, logger)
	instantRouter := instant.NewRouter(nil, logger)
	failbackHandler := failback.NewHandler(nil, logger)
	topologyRouter := topology.NewRouter(nil, logger)

	root := chi.NewRouter()
	root.Route("/api/v1/dr", func(r chi.Router) {
		r.Group(func(protected chi.Router) {
			// Inject the test user into the request context the same place the real
			// Auth middleware would, so RequirePermission can read its roles.
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
			mountRoutes(protected, journalHandler.Routes())
			mountRoutes(protected, appconsistentHandler.Routes())
			mountRoutes(protected, instantRouter.Routes())
			mountRoutes(protected, failbackHandler.Routes())
			mountRoutes(protected, topologyRouter.Routes())
		})
	})
	return root
}

// userFromHeader builds a test ContextUser from the X-Test-Role header so a test
// request can carry a specific RBAC role (viewer => dr:read only; tenant-admin =>
// all DR perms). No header means an unauthenticated request.
func userFromHeader(r *http.Request) (*auth.ContextUser, bool) {
	role := r.Header.Get("X-Test-Role")
	if role == "" {
		return nil, false
	}
	return &auth.ContextUser{
		ID:       "00000000-0000-0000-0000-000000000001",
		TenantID: "00000000-0000-0000-0000-0000000000aa",
		Roles:    []string{role},
	}, true
}

// TestResiliencePlaneRoutesComposeWithoutPanic proves the five resilience routers
// merge onto one group without the chi double-Mount("/") panic, and that each
// route is reachable (routed) rather than 404 — exercised via the permission gate.
func TestResiliencePlaneRoutesComposeWithoutPanic(t *testing.T) {
	router := buildResilienceRouter(t) // panics here if composition is broken

	// Each route, the permission it is gated by, and a role that LACKS it. The
	// gate runs before the (nil) handler, so a 403/401 proves the route is wired
	// with the expected gate without ever invoking the service.
	cases := []struct {
		method     string
		path       string
		blockRole  string // a role lacking the required permission
		wantStatus int
	}{
		// journal: dr:read views, dr:write bookmark mutations.
		{http.MethodGet, "/api/v1/dr/streams/00000000-0000-0000-0000-0000000000b1/journal/timeline", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/streams/00000000-0000-0000-0000-0000000000b1/journal/bookmarks", "viewer", http.StatusForbidden},
		// appconsistent: dr:read history, dr:failover trigger.
		{http.MethodGet, "/api/v1/dr/groups/00000000-0000-0000-0000-0000000000c1/consistency-barriers", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/groups/00000000-0000-0000-0000-0000000000c1/app-consistent-point", "viewer", http.StatusForbidden},
		// instant: dr:read view, dr:failover start + finalize.
		{http.MethodGet, "/api/v1/dr/instant-sessions/00000000-0000-0000-0000-0000000000d1", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/instant-sessions/00000000-0000-0000-0000-0000000000d1/chunks/0", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/recovery-points/00000000-0000-0000-0000-0000000000d2/instant-recovery", "viewer", http.StatusForbidden},
		{http.MethodPut, "/api/v1/dr/instant-sessions/00000000-0000-0000-0000-0000000000d1/chunks/0", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/instant-sessions/00000000-0000-0000-0000-0000000000d1/finalize", "viewer", http.StatusForbidden},
		// failback: dr:read runs/steps, dr:failover plan/approve/advance.
		{http.MethodGet, "/api/v1/dr/failback-runs", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/failback-runs", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/failback-runs/00000000-0000-0000-0000-0000000000e1/approve-cutback", "viewer", http.StatusForbidden},
		{http.MethodPost, "/api/v1/dr/failback-runs/00000000-0000-0000-0000-0000000000e1/advance", "viewer", http.StatusForbidden},
		// topology: dr:read views, dr:write add-edge.
		{http.MethodGet, "/api/v1/dr/groups/00000000-0000-0000-0000-0000000000c1/topology", "", http.StatusUnauthorized},
		{http.MethodGet, "/api/v1/dr/groups/00000000-0000-0000-0000-0000000000c1/topology/failover-target", "", http.StatusUnauthorized},
		{http.MethodPost, "/api/v1/dr/groups/00000000-0000-0000-0000-0000000000c1/topology/edges", "viewer", http.StatusForbidden},
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

// TestResiliencePlaneReadRoutesPassWithDRRead proves the dr:read views are
// reachable past the gate with a viewer role (which carries dr:read): the gate
// passes and routing reaches the nil handler, so the request panics inside the
// handler — recovered here — confirming the gate let it through. This isolates
// "gate authorises" from "handler logic", which is covered by each package's own
// unit tests.
func TestResiliencePlaneReadRoutesPassWithDRRead(t *testing.T) {
	router := buildResilienceRouter(t)

	readPaths := []struct{ method, path string }{
		{http.MethodGet, "/api/v1/dr/groups/00000000-0000-0000-0000-0000000000c1/topology"},
		{http.MethodGet, "/api/v1/dr/failback-runs"},
	}
	for _, rp := range readPaths {
		t.Run(rp.path, func(t *testing.T) {
			reached := false
			func() {
				defer func() {
					if r := recover(); r != nil {
						// The nil service was invoked => the dr:read gate authorised
						// the request and routing reached the handler.
						reached = true
					}
				}()
				rec := httptest.NewRecorder()
				req := httptest.NewRequest(rp.method, rp.path, nil)
				req.Header.Set("X-Test-Role", "viewer")
				router.ServeHTTP(rec, req)
				// If no panic, the route still resolved past the gate (e.g. handler
				// returned an error response) — also acceptable evidence the gate
				// authorised it; a 401/403 would mean it did not.
				require.NotEqual(t, http.StatusUnauthorized, rec.Code)
				require.NotEqual(t, http.StatusForbidden, rec.Code)
				reached = true
			}()
			require.True(t, reached, "dr:read route %s should pass the gate for a viewer", rp.path)
		})
	}
}
