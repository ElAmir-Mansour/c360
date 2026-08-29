package recoverytier

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// fakeSiteSource is an in-memory SiteSource for the service-level site tests.
type fakeSiteSource struct {
	site       SiteObjectives
	siteErr    error
	sites      []SiteObjectives
	sitesErr   error
	lastSiteID uuid.UUID
}

func (f *fakeSiteSource) Site(_ context.Context, _, siteID uuid.UUID) (SiteObjectives, error) {
	f.lastSiteID = siteID
	return f.site, f.siteErr
}

func (f *fakeSiteSource) Sites(context.Context, uuid.UUID) ([]SiteObjectives, error) {
	return f.sites, f.sitesErr
}

func decodeRecoveryTierData(t *testing.T, body []byte, dst any) {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("unmarshal envelope: %v (body=%s)", err, body)
	}
	if err := json.Unmarshal(env.Data, dst); err != nil {
		t.Fatalf("unmarshal data: %v (data=%s)", err, env.Data)
	}
}

// ---- service-level site recommendation logic -----------------------------

func TestServiceRecommendForSite_RecommendsForLooseObjectives(t *testing.T) {
	// Day-scale objectives are satisfied by the lowest tier.
	src := &fakeSiteSource{site: SiteObjectives{
		SiteID: uuid.New(), Name: "archive", RTOSeconds: 86400, RPOSeconds: 86400,
	}}
	svc := NewServiceWithSites(src)

	rec, err := svc.RecommendForSite(context.Background(), uuid.New(), src.site.SiteID)
	if err != nil {
		t.Fatalf("RecommendForSite: %v", err)
	}
	if !rec.Fits || rec.Profile == nil || rec.Profile.Tier != TierBronze {
		t.Errorf("rec = %+v, want bronze fit for day-scale objectives", rec)
	}
	if src.lastSiteID != src.site.SiteID {
		t.Errorf("source queried site %s, want %s", src.lastSiteID, src.site.SiteID)
	}
}

func TestServiceRecommendForSite_FlagsObjectivesTighterThanAnyTier(t *testing.T) {
	// Sub-platinum objectives (RTO < 5m, RPO < 1m) fit no tier — the BCM gap.
	src := &fakeSiteSource{site: SiteObjectives{
		SiteID: uuid.New(), Name: "trading", RTOSeconds: 30, RPOSeconds: 5,
	}}
	svc := NewServiceWithSites(src)

	rec, err := svc.RecommendForSite(context.Background(), uuid.New(), src.site.SiteID)
	if err != nil {
		t.Fatalf("RecommendForSite: %v", err)
	}
	if rec.Fits || rec.Profile != nil {
		t.Errorf("rec = %+v, want no fit for objectives tighter than platinum", rec)
	}
	if rec.Reason == "" {
		t.Error("expected a reason explaining why no tier fits")
	}
}

func TestServiceRecommendForSite_DefaultObjectivesRequirePlatinum(t *testing.T) {
	// The GA default site objectives (15m RTO / 5m RPO) require the top tier.
	src := &fakeSiteSource{site: SiteObjectives{
		SiteID: uuid.New(), Name: "db", RTOSeconds: 900, RPOSeconds: 300,
	}}
	svc := NewServiceWithSites(src)

	rec, err := svc.RecommendForSite(context.Background(), uuid.New(), src.site.SiteID)
	if err != nil {
		t.Fatalf("RecommendForSite: %v", err)
	}
	if !rec.Fits || rec.Profile == nil || rec.Profile.Tier != TierPlatinum {
		t.Errorf("rec = %+v, want platinum for default 15m/5m objectives", rec)
	}
}

func TestServiceRecommendForSite_NotConfigured(t *testing.T) {
	svc := NewService() // catalog-only
	_, err := svc.RecommendForSite(context.Background(), uuid.New(), uuid.New())
	if err != ErrSiteSourceNotConfigured {
		t.Fatalf("err = %v, want ErrSiteSourceNotConfigured", err)
	}
}

func TestServiceRecommendForSite_SiteNotFound(t *testing.T) {
	svc := NewServiceWithSites(&fakeSiteSource{siteErr: ErrSiteNotFound})
	_, err := svc.RecommendForSite(context.Background(), uuid.New(), uuid.New())
	if err != ErrSiteNotFound {
		t.Fatalf("err = %v, want ErrSiteNotFound", err)
	}
}

func TestServiceSiteCoverage_CountsUnmetSites(t *testing.T) {
	src := &fakeSiteSource{sites: []SiteObjectives{
		{SiteID: uuid.New(), Name: "archive", RTOSeconds: 86400, RPOSeconds: 86400}, // bronze
		{SiteID: uuid.New(), Name: "trading", RTOSeconds: 30, RPOSeconds: 5},        // no fit
		{SiteID: uuid.New(), Name: "db", RTOSeconds: 900, RPOSeconds: 300},          // platinum
	}}
	svc := NewServiceWithSites(src)

	report, err := svc.SiteCoverage(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("SiteCoverage: %v", err)
	}
	resp := NewCoverageResponse(report)
	if resp.TotalSites != 3 || resp.UnmetSites != 1 {
		t.Errorf("coverage = total %d / unmet %d, want 3 / 1", resp.TotalSites, resp.UnmetSites)
	}
}

func TestServiceSiteCoverage_NotConfigured(t *testing.T) {
	_, err := NewService().SiteCoverage(context.Background(), uuid.New())
	if err != ErrSiteSourceNotConfigured {
		t.Fatalf("err = %v, want ErrSiteSourceNotConfigured", err)
	}
}

// ---- router-level site endpoints -----------------------------------------

func TestRouterRecommendForSite(t *testing.T) {
	gold := mustProfile(t, TierGold)
	siteID := uuid.New()
	svc := &fakeRecoveryTierService{siteRec: SiteRecommendation{
		Site:    SiteObjectives{SiteID: siteID, Name: "db", RTOSeconds: 3600, RPOSeconds: 900},
		Profile: &gold,
		Fits:    true,
	}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/sites/"+siteID.String()+"/recommend", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	if svc.siteCalls != 1 || svc.lastSite != siteID {
		t.Errorf("RecommendForSite called %d times for %s, want 1 for %s", svc.siteCalls, svc.lastSite, siteID)
	}
	var resp SiteRecommendationResponse
	decodeRecoveryTierData(t, rec.Body.Bytes(), &resp)
	if !resp.Fits || resp.Recommended == nil || resp.Recommended.Tier != TierGold || resp.SiteID != siteID.String() {
		t.Errorf("resp = %+v, want gold fit for site %s", resp, siteID)
	}
}

func TestRouterRecommendForSiteNotFound(t *testing.T) {
	svc := &fakeRecoveryTierService{siteErr: ErrSiteNotFound}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/sites/"+uuid.New().String()+"/recommend", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", rec.Code)
	}
}

func TestRouterRecommendForSiteSourceUnavailable(t *testing.T) {
	svc := &fakeRecoveryTierService{siteErr: ErrSiteSourceNotConfigured}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/sites/"+uuid.New().String()+"/recommend", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503", rec.Code)
	}
}

func TestRouterRecommendForSiteBadUUID(t *testing.T) {
	svc := &fakeRecoveryTierService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/sites/not-a-uuid/recommend", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 for a non-UUID site", rec.Code)
	}
	if svc.siteCalls != 0 {
		t.Error("service must not be called for an invalid site id")
	}
}

func TestRouterCoverage(t *testing.T) {
	gold := mustProfile(t, TierGold)
	svc := &fakeRecoveryTierService{cover: CoverageReport{Recommendations: []SiteRecommendation{
		{Site: SiteObjectives{SiteID: uuid.New(), Name: "a"}, Profile: &gold, Fits: true},
		{Site: SiteObjectives{SiteID: uuid.New(), Name: "b"}, Fits: false, Reason: "no tier satisfies request"},
	}}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/coverage", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	// The static "coverage" path must route to the coverage handler, NOT to
	// getProfile via {tier}.
	if svc.covCalls != 1 || svc.getCalls != 0 {
		t.Errorf("coverage routed to covCalls=%d getCalls=%d, want 1/0 (static beats {tier})", svc.covCalls, svc.getCalls)
	}
	var resp CoverageResponse
	decodeRecoveryTierData(t, rec.Body.Bytes(), &resp)
	if resp.TotalSites != 2 || resp.UnmetSites != 1 || len(resp.Sites) != 2 {
		t.Errorf("resp = %+v, want 2 sites / 1 unmet", resp)
	}
}

// TestRouterTierParamStillResolves guards that adding the static sub-paths did not
// break the {tier} param route.
func TestRouterTierParamStillResolves(t *testing.T) {
	svc := &fakeRecoveryTierService{profile: mustProfile(t, TierSilver)}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/silver", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if svc.getCalls != 1 || svc.lastTier != TierSilver {
		t.Errorf("getProfile called %d times for %q, want 1 for silver", svc.getCalls, svc.lastTier)
	}
}
