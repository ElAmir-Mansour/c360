package handler

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/siem/service"
	"github.com/clario360/platform/internal/siem/store"
)

// Deps bundles the dependencies the SIEM HTTP router needs. Passing a
// struct keeps the call site honest as we add more services in later
// prompts.
type Deps struct {
	Meta            *service.MetaService
	JWT             *auth.JWTManager
	NotReady        func() bool  // optional: if not nil and returns true, /_meta will 503
	Store           *store.Store // optional: nil disables the self-test route
	SelfTestEnabled bool         // mounts /_meta/self-test when true
	// SourcesRouter mounts under /sources when non-nil.
	SourcesRouter chi.Router
	// ParsersRouter and SettingsRouter mount admin APIs when non-nil.
	// Nil preserves the explicit 501 fallback for incomplete deployments.
	ParsersRouter  chi.Router
	SettingsRouter chi.Router
}

// NewRouter assembles the chi sub-router for /api/v1/siem. The caller
// is expected to mount it under that exact prefix; the router itself
// is prefix-agnostic so it can be unit-tested directly.
func NewRouter(d Deps) chi.Router {
	r := chi.NewRouter()

	// Public-to-router-but-still-gated endpoints live here. Auth must
	// run before tenant so the tenant middleware can read the JWT
	// claim from context.
	r.Group(func(r chi.Router) {
		if d.JWT != nil {
			r.Use(middleware.Auth(d.JWT))
		}
		r.Use(middleware.Tenant)

		r.Get("/_meta", NewMetaHandler(d.Meta, d.NotReady).ServeHTTP)

		// Dev-only self-test: only mounted when explicitly enabled AND the
		// Store dependency is wired. In production we keep the route
		// hidden so it returns chi's default 404.
		if d.SelfTestEnabled && d.Store != nil {
			r.With(middleware.RequirePermission("siem:admin")).
				Post("/_meta/self-test", storeSelfTestHandler(d.Store))
		}

		// Admin-only sub-paths. Missing dependencies still return explicit
		// 501s gated by SIEM admin so startup misconfiguration is visible.
		if d.SourcesRouter != nil {
			r.Mount("/sources", d.SourcesRouter)
		} else {
			r.Route("/sources", func(r chi.Router) {
				r.Use(middleware.RequirePermission("siem:admin"))
				r.Mount("/", notImplemented("/sources"))
			})
		}
		if d.ParsersRouter != nil {
			r.Route("/parsers", func(r chi.Router) {
				r.Use(middleware.RequirePermission("siem:admin"))
				r.Mount("/", d.ParsersRouter)
			})
		} else {
			r.Route("/parsers", func(r chi.Router) {
				r.Use(middleware.RequirePermission("siem:admin"))
				r.Mount("/", notImplemented("/parsers"))
			})
		}
		if d.SettingsRouter != nil {
			r.Route("/settings", func(r chi.Router) {
				r.Use(middleware.RequirePermission("siem:admin"))
				r.Mount("/", d.SettingsRouter)
			})
		} else {
			r.Route("/settings", func(r chi.Router) {
				r.Use(middleware.RequirePermission("siem:admin"))
				r.Mount("/", notImplemented("/settings"))
			})
		}
	})

	return r
}

// notImplemented returns a stable JSON body when optional SIEM admin
// dependencies are not wired in a given deployment.
func notImplemented(scope string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotImplemented)
		_, _ = w.Write([]byte(`{"status":501,"code":"NOT_IMPLEMENTED","scope":"` + scope + `","message":"handler dependency is not configured"}`))
	})
}

// storeSelfTestHandler returns a chi handler that runs Store.SelfTest and
// returns its JSON. Errors map to HTTP 503 so callers can distinguish a
// transport failure (4xx) from a self-test failure (5xx).
func storeSelfTestHandler(s *store.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		res, err := s.SelfTest(r.Context())
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":           503,
				"code":             "SELF_TEST_FAILED",
				"message":          err.Error(),
				"is_self_test_err": errors.Is(err, store.ErrSelfTestFailed),
				"result":           res,
			})
			return
		}
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": 200,
			"result": res,
		})
	}
}
