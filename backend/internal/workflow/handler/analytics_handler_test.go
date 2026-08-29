package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/dto"
)

// fakeAnalyticsService records the tenant + params the handler forwarded so the
// tests assert the URL wiring (path param, ?definition_key, ?interval,
// ?window_days) reaches the service, and returns canned reports.
type fakeAnalyticsService struct {
	gotTenant   string
	gotKey      string
	gotInterval string
	gotWindow   int
}

func (f *fakeAnalyticsService) CycleTime(_ context.Context, tenantID, definitionKey string, windowDays int) (*dto.CycleTimeReport, error) {
	f.gotTenant, f.gotKey, f.gotWindow = tenantID, definitionKey, windowDays
	return &dto.CycleTimeReport{DefinitionKey: definitionKey, WindowDays: windowDays, Versions: []dto.CycleTimeStats{{Version: 1}}}, nil
}

func (f *fakeAnalyticsService) Bottlenecks(_ context.Context, tenantID, definitionKey string, windowDays int) (*dto.BottleneckReport, error) {
	f.gotTenant, f.gotKey, f.gotWindow = tenantID, definitionKey, windowDays
	return &dto.BottleneckReport{DefinitionKey: definitionKey, WindowDays: windowDays, Steps: []dto.StepBottleneck{{StepID: "review"}}}, nil
}

func (f *fakeAnalyticsService) Rework(_ context.Context, tenantID string, windowDays int) (*dto.ReworkReport, error) {
	f.gotTenant, f.gotWindow = tenantID, windowDays
	return &dto.ReworkReport{WindowDays: windowDays, PerDefinition: []dto.ReworkStat{{DefinitionKey: "k"}}}, nil
}

func (f *fakeAnalyticsService) Throughput(_ context.Context, tenantID, interval string, windowDays int) (*dto.ThroughputReport, error) {
	f.gotTenant, f.gotInterval, f.gotWindow = tenantID, interval, windowDays
	return &dto.ThroughputReport{Interval: interval, WindowDays: windowDays, ActiveCount: 2}, nil
}

func analyticsReq(target string) *http.Request {
	r := httptest.NewRequest(http.MethodGet, target, nil)
	return r.WithContext(auth.WithUser(r.Context(), &auth.ContextUser{ID: "actor-1", TenantID: "tenant-1"}))
}

func TestAnalyticsHandler_CycleTimePassesPathKeyAndWindow(t *testing.T) {
	svc := &fakeAnalyticsService{}
	h := NewAnalyticsHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, analyticsReq("/def-key-1/cycle-time?window_days=30"))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "tenant-1", svc.gotTenant)
	require.Equal(t, "def-key-1", svc.gotKey)
	require.Equal(t, 30, svc.gotWindow)

	var body struct {
		Data dto.CycleTimeReport `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Equal(t, "def-key-1", body.Data.DefinitionKey)
	require.Len(t, body.Data.Versions, 1)
}

func TestAnalyticsHandler_BottlenecksOptionalDefinitionKey(t *testing.T) {
	svc := &fakeAnalyticsService{}
	h := NewAnalyticsHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, analyticsReq("/bottlenecks?definition_key=abc"))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "abc", svc.gotKey)
	require.Contains(t, rec.Body.String(), "review")
}

func TestAnalyticsHandler_Rework(t *testing.T) {
	svc := &fakeAnalyticsService{}
	h := NewAnalyticsHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, analyticsReq("/rework"))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "tenant-1", svc.gotTenant)
	require.Contains(t, rec.Body.String(), "per_definition")
}

func TestAnalyticsHandler_ThroughputInterval(t *testing.T) {
	svc := &fakeAnalyticsService{}
	h := NewAnalyticsHandler(svc, zerolog.Nop())

	rec := httptest.NewRecorder()
	h.Routes().ServeHTTP(rec, analyticsReq("/throughput?interval=week&window_days=14"))
	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "week", svc.gotInterval)
	require.Equal(t, 14, svc.gotWindow)
	require.Contains(t, rec.Body.String(), "active_count")
}

// TestAnalyticsHandler_Unauthenticated proves the routes 401 without an
// authenticated user (defence in depth beneath the RBAC gate).
func TestAnalyticsHandler_Unauthenticated(t *testing.T) {
	h := NewAnalyticsHandler(&fakeAnalyticsService{}, zerolog.Nop())
	rec := httptest.NewRecorder()
	// No auth context on the request.
	h.Routes().ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/throughput", nil))
	require.Equal(t, http.StatusUnauthorized, rec.Code)
}
