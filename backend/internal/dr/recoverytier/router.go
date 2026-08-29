package recoverytier

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

// recoveryTierService is the surface the HTTP router needs. *Service satisfies
// it; an interface keeps the router unit-testable without database or catalog
// setup.
type recoveryTierService interface {
	ListProfiles() []TierProfile
	GetProfile(tier Tier) (TierProfile, error)
	Recommend(req RecommendationRequest) (TierProfile, error)
	RecommendForSite(ctx context.Context, tenantID, siteID uuid.UUID) (SiteRecommendation, error)
	SiteCoverage(ctx context.Context, tenantID uuid.UUID) (CoverageReport, error)
}

// Router serves the recovery tier catalog and recommendation HTTP surface.
type Router struct {
	svc    recoveryTierService
	logger zerolog.Logger
}

// NewRouter constructs the recovery tier HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-recoverytier").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc recoveryTierService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the recovery tier endpoints. All routes are
// read-only catalog/recommendation operations and require dr:read.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/recovery-tiers", h.listProfiles)
		// Static sub-paths are registered alongside the {tier} param; chi matches
		// the static segment first, so "coverage"/"recommend"/"sites" never resolve
		// to getProfile.
		r.Get("/recovery-tiers/coverage", h.coverage)
		r.Get("/recovery-tiers/sites/{site}/recommend", h.recommendForSite)
		r.Post("/recovery-tiers/recommend", h.recommend)
		r.Get("/recovery-tiers/{tier}", h.getProfile)
	})

	return r
}

// listProfiles returns the full built-in recovery tier catalog.
func (h *Router) listProfiles(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.tenant(w, r); !ok {
		return
	}
	suiteapi.WriteData(w, http.StatusOK, NewProfileResponses(h.svc.ListProfiles()))
}

// getProfile returns one built-in recovery tier profile.
func (h *Router) getProfile(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.tenant(w, r); !ok {
		return
	}
	profile, err := h.svc.GetProfile(Tier(chi.URLParam(r, "tier")))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, NewProfileResponse(profile))
}

// recommend returns the lowest tier that satisfies a second-based RTO/RPO
// recommendation request.
func (h *Router) recommend(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.tenant(w, r); !ok {
		return
	}
	var body RecommendationRequestJSON
	if err := suiteapi.DecodeJSON(r, &body); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	req, err := body.ToRecommendationRequest()
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	profile, err := h.svc.Recommend(req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, NewProfileResponse(profile))
}

// recommendForSite recommends a recovery tier for one registered protected
// site's configured RTO/RPO objectives. A site whose objectives fit no tier is a
// 200 response with fits=false and a reason (a BCM gap), not an error.
func (h *Router) recommendForSite(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	siteID, err := suiteapi.UUIDParam(r, "site")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	rec, err := h.svc.RecommendForSite(r.Context(), tenantID, siteID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, NewSiteRecommendationResponse(rec))
}

// coverage scans every registered protected site in the tenant and reports the
// recommended tier per site, flagging the sites whose objectives fit no tier.
func (h *Router) coverage(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	report, err := h.svc.SiteCoverage(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, NewCoverageResponse(report))
}

// tenant extracts the tenant from the request context. Recovery tiers are
// static, but DR APIs consistently require a tenant context.
func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

// writeError maps recovery tier sentinel errors to HTTP statuses.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidRequest):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrNoRecommendation):
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "no_recommendation", err.Error(), nil)
	case errors.Is(err, ErrTierNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrSiteNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "site_not_found", err.Error(), nil)
	case errors.Is(err, ErrSiteSourceNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "site_source_unavailable", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr recovery tier request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ recoveryTierService = (*Service)(nil)
