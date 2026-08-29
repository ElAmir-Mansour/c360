package recoverytier

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

type fakeRecoveryTierService struct {
	profiles []TierProfile
	profile  TierProfile
	getErr   error
	rec      TierProfile
	recErr   error
	siteRec  SiteRecommendation
	cover    CoverageReport
	siteErr  error

	listCalls int
	getCalls  int
	recCalls  int
	siteCalls int
	covCalls  int
	lastTier  Tier
	lastReq   RecommendationRequest
	lastSite  uuid.UUID
}

func (f *fakeRecoveryTierService) ListProfiles() []TierProfile {
	f.listCalls++
	return f.profiles
}

func (f *fakeRecoveryTierService) GetProfile(tier Tier) (TierProfile, error) {
	f.getCalls++
	f.lastTier = tier
	return f.profile, f.getErr
}

func (f *fakeRecoveryTierService) Recommend(req RecommendationRequest) (TierProfile, error) {
	f.recCalls++
	f.lastReq = req
	return f.rec, f.recErr
}

func (f *fakeRecoveryTierService) RecommendForSite(_ context.Context, _ uuid.UUID, siteID uuid.UUID) (SiteRecommendation, error) {
	f.siteCalls++
	f.lastSite = siteID
	return f.siteRec, f.siteErr
}

func (f *fakeRecoveryTierService) SiteCoverage(context.Context, uuid.UUID) (CoverageReport, error) {
	f.covCalls++
	return f.cover, f.siteErr
}

func withRecoveryTierUser(req *http.Request, tenantID uuid.UUID, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: tenantID.String(), Roles: roles}
	ctx := auth.WithUser(req.Context(), user)
	ctx = auth.WithTenantID(ctx, tenantID.String())
	return req.WithContext(ctx)
}

func withRecoveryTierUserNoTenant(req *http.Request, roles ...string) *http.Request {
	user := &auth.ContextUser{ID: uuid.NewString(), TenantID: uuid.NewString(), Roles: roles}
	return req.WithContext(auth.WithUser(req.Context(), user))
}

func TestRouterListProfiles(t *testing.T) {
	bronze := mustProfile(t, TierBronze)
	gold := mustProfile(t, TierGold)
	svc := &fakeRecoveryTierService{profiles: []TierProfile{bronze, gold}}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.listCalls != 1 {
		t.Fatalf("list calls = %d, want 1", svc.listCalls)
	}
	var body struct {
		Data []ProfileResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Data) != 2 {
		t.Fatalf("profiles = %d, want 2", len(body.Data))
	}
	if body.Data[0].Tier != TierBronze || body.Data[1].RTOSeconds != 3600 {
		t.Fatalf("unexpected profile data: %+v", body.Data)
	}
}

func TestRouterGetProfile(t *testing.T) {
	gold := mustProfile(t, TierGold)
	svc := &fakeRecoveryTierService{profile: gold}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/gold", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "viewer"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.lastTier != TierGold {
		t.Fatalf("tier = %s, want %s", svc.lastTier, TierGold)
	}
	var body struct {
		Data ProfileResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Data.Tier != TierGold || body.Data.RPOSeconds != 900 {
		t.Fatalf("unexpected profile: %+v", body.Data)
	}
}

func TestRouterRecommend(t *testing.T) {
	gold := mustProfile(t, TierGold)
	svc := &fakeRecoveryTierService{rec: gold}
	router := newRouter(svc, zerolog.Nop()).Routes()

	payload := `{"rto_seconds":3600,"rpo_seconds":900,"business_critical":true,"mission_critical":true,"regulated_data":true,"ransomware_sensitive":true}`
	req := httptest.NewRequest(http.MethodPost, "/recovery-tiers/recommend", strings.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if svc.recCalls != 1 {
		t.Fatalf("recommend calls = %d, want 1", svc.recCalls)
	}
	if svc.lastReq.RTO != time.Hour || svc.lastReq.RPO != 15*time.Minute {
		t.Fatalf("request durations = %s/%s, want 1h/15m", svc.lastReq.RTO, svc.lastReq.RPO)
	}
	if !svc.lastReq.BusinessCritical || !svc.lastReq.MissionCritical ||
		!svc.lastReq.RegulatedData || !svc.lastReq.RansomwareSensitive {
		t.Fatalf("flags not propagated: %+v", svc.lastReq)
	}
	var body struct {
		Data ProfileResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if body.Data.Tier != TierGold || body.Data.RTOSeconds != 3600 {
		t.Fatalf("unexpected recommendation: %+v", body.Data)
	}
}

func TestRouterRequiresDRRead(t *testing.T) {
	svc := &fakeRecoveryTierService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "no_access"))

	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want 403; body=%s", rec.Code, rec.Body.String())
	}
	if svc.listCalls != 0 {
		t.Fatalf("service reached despite permission denial")
	}
}

func TestRouterRecommendBadInput(t *testing.T) {
	svc := &fakeRecoveryTierService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/recovery-tiers/recommend", strings.NewReader(`{"rto_seconds":0,"rpo_seconds":60}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if svc.recCalls != 0 {
		t.Fatalf("service reached for invalid input")
	}
}

func TestRouterRecommendNoRecommendation(t *testing.T) {
	svc := &fakeRecoveryTierService{recErr: ErrNoRecommendation}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodPost, "/recovery-tiers/recommend", strings.NewReader(`{"rto_seconds":30,"rpo_seconds":30}`))
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouterGetProfileUnknownTier(t *testing.T) {
	router := NewRouter(NewService(), zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/diamond", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "viewer"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestRouterRequiresTenantContext(t *testing.T) {
	svc := &fakeRecoveryTierService{}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUserNoTenant(req, "analyst"))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401; body=%s", rec.Code, rec.Body.String())
	}
	if svc.listCalls != 0 {
		t.Fatalf("service reached without tenant context")
	}
}

func TestRouterUnexpectedError(t *testing.T) {
	svc := &fakeRecoveryTierService{getErr: errors.New("store is unavailable")}
	router := newRouter(svc, zerolog.Nop()).Routes()

	req := httptest.NewRequest(http.MethodGet, "/recovery-tiers/gold", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, withRecoveryTierUser(req, uuid.New(), "analyst"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func mustProfile(t *testing.T, tier Tier) TierProfile {
	t.Helper()
	profile, ok := Lookup(tier)
	if !ok {
		t.Fatalf("missing test profile %s", tier)
	}
	return profile
}

var _ recoveryTierService = (*fakeRecoveryTierService)(nil)
