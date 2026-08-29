package recover

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// analyticsService is the surface the analytics handler needs; *AnalyticsService
// satisfies it. The interface keeps the handler unit-testable without a database,
// the Metastore seam, or a live licensing engine.
type analyticsService interface {
	Analytics(ctx context.Context, tenantID uuid.UUID, authorization string) (*AnalyticsView, error)
}

// AnalyticsHandler serves the cross-sub-solution RTO/RTA & recovery analytics
// surface. It is mounted under /api/recover/analytics behind the same Auth+Tenant
// middleware as the rest of the Recover product, self-gates on dr:read, and the
// service additionally enforces a Recover entitlement (any of the three
// sub-solution keys) before returning any data:
//
//	GET /api/recover/analytics   (dr:read + any recover.* entitlement)
//
// It composes the Metastore seam (the RTO target source) and the EXISTING
// execution records (the captured RTA) into the portfolio analytics the landing
// page (Prompt 3) and every sub-solution overview consume. It owns no recovery
// logic; the only state behind it is the append-only readiness-trend snapshot.
type AnalyticsHandler struct {
	svc    analyticsService
	logger zerolog.Logger
}

// NewAnalyticsHandler constructs the analytics handler over an AnalyticsService.
func NewAnalyticsHandler(svc *AnalyticsService, logger zerolog.Logger) *AnalyticsHandler {
	return &AnalyticsHandler{svc: svc, logger: logger.With().Str("handler", "recover-analytics").Logger()}
}

// newAnalyticsHandler is the internal constructor accepting the service interface
// (tests).
func newAnalyticsHandler(svc analyticsService, logger zerolog.Logger) *AnalyticsHandler {
	return &AnalyticsHandler{svc: svc, logger: logger}
}

// Routes returns the chi.Router for the analytics surface as a standalone router
// (used by the handler's own tests). In the running service the recover Router
// registers GetAnalytics directly onto its existing Auth+Tenant group (see
// router.go) so chi never double-mounts at "/".
func (h *AnalyticsHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/analytics", h.GetAnalytics)
	})
	return r
}

// GetAnalytics returns the cross-sub-solution analytics for the calling tenant:
// per-application RTO-vs-RTA, the portfolio readiness score, multi-application
// recovery progress, the readiness trend, and the top flagged bottlenecks — all
// computed from real persisted execution records and the Metastore RTO seam.
func (h *AnalyticsHandler) GetAnalytics(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}

	view, err := h.svc.Analytics(r.Context(), tenantID, r.Header.Get("Authorization"))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, view)
}

// writeError maps analytics sentinel errors to HTTP statuses; an unexpected error
// is logged and returned as a generic 500 with no stack trace leaked.
func (h *AnalyticsHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrAnalyticsNotEntitled):
		suiteapi.WriteError(w, r, http.StatusPaymentRequired, "not_entitled",
			"Clario Recover is not enabled for this tenant", map[string]string{
				"upgrade_url": "/register?suites=recover&plan=trial",
			})
	case errors.Is(err, ErrEntitlementUnavailable):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "entitlement_unavailable",
			"unable to verify license entitlement", nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("recover analytics request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
