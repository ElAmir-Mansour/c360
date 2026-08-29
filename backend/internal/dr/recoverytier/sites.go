package recoverytier

import (
	"context"
	"errors"

	"github.com/google/uuid"
)

var (
	// ErrSiteNotFound is returned when a protected site does not exist in the
	// tenant's scope.
	ErrSiteNotFound = errors.New("recoverytier: protected site not found")
	// ErrSiteSourceNotConfigured is returned by the site-linked operations when
	// the service was constructed without a SiteSource (catalog-only mode).
	ErrSiteSourceNotConfigured = errors.New("recoverytier: site source not configured")
)

// SiteObjectives is a protected site's configured recovery objectives, the input
// to a per-site tier recommendation. RTO/RPO are read from
// protected_site.rto_objective_seconds / rpo_objective_seconds. The criticality
// flags are part of the recommendation model but are NOT yet persisted on
// protected_site, so a DB-backed SiteSource leaves them false; the recommendation
// is therefore driven by the configured RTO/RPO. When criticality columns land,
// populate them here and the existing recommender honours them.
type SiteObjectives struct {
	SiteID              uuid.UUID `json:"site_id"`
	Name                string    `json:"name"`
	RTOSeconds          int       `json:"rto_seconds"`
	RPOSeconds          int       `json:"rpo_seconds"`
	BusinessCritical    bool      `json:"business_critical"`
	MissionCritical     bool      `json:"mission_critical"`
	RegulatedData       bool      `json:"regulated_data"`
	RansomwareSensitive bool      `json:"ransomware_sensitive"`
}

// toRequest converts a site's configured objectives into a recommendation
// request. It reuses the same validation the HTTP recommend path uses, so a site
// with a non-positive objective is reported as a gap rather than crashing.
func (s SiteObjectives) toRequest() (RecommendationRequest, error) {
	rto, err := durationFromSeconds("rto_objective_seconds", int64(s.RTOSeconds))
	if err != nil {
		return RecommendationRequest{}, err
	}
	rpo, err := durationFromSeconds("rpo_objective_seconds", int64(s.RPOSeconds))
	if err != nil {
		return RecommendationRequest{}, err
	}
	return RecommendationRequest{
		RTO:                 rto,
		RPO:                 rpo,
		BusinessCritical:    s.BusinessCritical,
		MissionCritical:     s.MissionCritical,
		RegulatedData:       s.RegulatedData,
		RansomwareSensitive: s.RansomwareSensitive,
	}, nil
}

// SiteSource reads protected-site recovery objectives within a tenant scope. The
// PGX implementation is the production source; tests substitute an in-memory fake.
type SiteSource interface {
	// Site returns one site's objectives, or ErrSiteNotFound.
	Site(ctx context.Context, tenantID, siteID uuid.UUID) (SiteObjectives, error)
	// Sites returns every protected site's objectives in the tenant's scope.
	Sites(ctx context.Context, tenantID uuid.UUID) ([]SiteObjectives, error)
}

// SiteRecommendation pairs a site's configured objectives with the tier the
// recommender selected. Fits is false when no built-in tier can satisfy the
// configured objectives — a real BCM signal that a site's objectives are tighter
// than any recovery tier provides (or are otherwise unsatisfiable); Reason then
// carries the explanation.
type SiteRecommendation struct {
	Site    SiteObjectives
	Profile *TierProfile
	Fits    bool
	Reason  string
}

// CoverageReport is the per-tenant recovery-tier coverage scan: a recommendation
// for every protected site, surfacing those whose objectives fit no tier.
type CoverageReport struct {
	Recommendations []SiteRecommendation
}

// SiteRecommendationResponse is the HTTP representation of a per-site tier
// recommendation. Recommended is omitted when no tier fits; Reason then explains
// the gap.
type SiteRecommendationResponse struct {
	SiteID      string           `json:"site_id"`
	SiteName    string           `json:"site_name"`
	RTOSeconds  int              `json:"rto_seconds"`
	RPOSeconds  int              `json:"rpo_seconds"`
	Fits        bool             `json:"fits"`
	Recommended *ProfileResponse `json:"recommended,omitempty"`
	Reason      string           `json:"reason,omitempty"`
}

// NewSiteRecommendationResponse converts a domain recommendation to its HTTP form.
func NewSiteRecommendationResponse(rec SiteRecommendation) SiteRecommendationResponse {
	resp := SiteRecommendationResponse{
		SiteID:     rec.Site.SiteID.String(),
		SiteName:   rec.Site.Name,
		RTOSeconds: rec.Site.RTOSeconds,
		RPOSeconds: rec.Site.RPOSeconds,
		Fits:       rec.Fits,
		Reason:     rec.Reason,
	}
	if rec.Profile != nil {
		profile := NewProfileResponse(*rec.Profile)
		resp.Recommended = &profile
	}
	return resp
}

// CoverageResponse is the HTTP representation of a tenant coverage scan: the
// per-site recommendations plus the total and unmet-site counts (the headline BCM
// signal — how many sites have no fitting tier).
type CoverageResponse struct {
	TotalSites int                          `json:"total_sites"`
	UnmetSites int                          `json:"unmet_sites"`
	Sites      []SiteRecommendationResponse `json:"sites"`
}

// NewCoverageResponse converts a domain coverage report to its HTTP form.
func NewCoverageResponse(report CoverageReport) CoverageResponse {
	resp := CoverageResponse{
		Sites: make([]SiteRecommendationResponse, 0, len(report.Recommendations)),
	}
	for _, rec := range report.Recommendations {
		resp.TotalSites++
		if !rec.Fits {
			resp.UnmetSites++
		}
		resp.Sites = append(resp.Sites, NewSiteRecommendationResponse(rec))
	}
	return resp
}

// recommendForSite recommends a tier for a site's configured objectives. It never
// errors: an unsatisfiable site yields Fits=false with a Reason, which the
// coverage scan aggregates as the BCM gap signal.
func recommendForSite(site SiteObjectives) SiteRecommendation {
	rec := SiteRecommendation{Site: site}
	req, err := site.toRequest()
	if err != nil {
		rec.Reason = err.Error()
		return rec
	}
	profile, err := Recommend(req)
	if err != nil {
		rec.Reason = err.Error()
		return rec
	}
	rec.Profile = &profile
	rec.Fits = true
	return rec
}

// RecommendForSite reads a protected site's configured objectives and recommends
// a recovery tier. Returns ErrSiteSourceNotConfigured when the service is
// catalog-only, or ErrSiteNotFound when the site is not in the tenant's scope. A
// site whose objectives fit no tier is NOT an error — it is returned with
// Fits=false and a Reason.
func (s *Service) RecommendForSite(ctx context.Context, tenantID, siteID uuid.UUID) (SiteRecommendation, error) {
	if s.siteSource == nil {
		return SiteRecommendation{}, ErrSiteSourceNotConfigured
	}
	site, err := s.siteSource.Site(ctx, tenantID, siteID)
	if err != nil {
		return SiteRecommendation{}, err
	}
	return recommendForSite(site), nil
}

// SiteCoverage recommends a tier for every protected site in the tenant's scope,
// surfacing the sites whose configured objectives fit no tier. Returns
// ErrSiteSourceNotConfigured when the service is catalog-only.
func (s *Service) SiteCoverage(ctx context.Context, tenantID uuid.UUID) (CoverageReport, error) {
	if s.siteSource == nil {
		return CoverageReport{}, ErrSiteSourceNotConfigured
	}
	sites, err := s.siteSource.Sites(ctx, tenantID)
	if err != nil {
		return CoverageReport{}, err
	}
	report := CoverageReport{Recommendations: make([]SiteRecommendation, 0, len(sites))}
	for _, site := range sites {
		report.Recommendations = append(report.Recommendations, recommendForSite(site))
	}
	return report, nil
}
