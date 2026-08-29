package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/dto"
)

// fakeMiningService records the tenant + params the handler forwarded so the
// tests assert the URL wiring (path param, ?window_days, ?top_n, POST body)
// reaches the service, and returns canned reports.
type fakeMiningService struct {
	gotTenant string
	gotKey    string
	gotWindow int
	gotTopN   int
	gotReq    dto.SimulationRequest
}

func (f *fakeMiningService) Variants(_ context.Context, tenantID, key string, window, topN int) (*dto.VariantReport, error) {
	f.gotTenant, f.gotKey, f.gotWindow, f.gotTopN = tenantID, key, window, topN
	return &dto.VariantReport{DefinitionKey: key, WindowDays: window, TotalInstances: 3, Variants: []dto.Variant{{Rank: 1, Sequence: []string{"start"}, Count: 3, FrequencyPct: 100}}}, nil
}

func (f *fakeMiningService) Conformance(_ context.Context, tenantID, key string, window int) (*dto.ConformanceReport, error) {
	f.gotTenant, f.gotKey, f.gotWindow = tenantID, key, window
	return &dto.ConformanceReport{DefinitionKey: key, WindowDays: window, ConformanceScore: 0.8}, nil
}

func (f *fakeMiningService) Heatmap(_ context.Context, tenantID, key string, window int) (*dto.HeatmapReport, error) {
	f.gotTenant, f.gotKey, f.gotWindow = tenantID, key, window
	return &dto.HeatmapReport{DefinitionKey: key, WindowDays: window, Nodes: []dto.HeatNode{{StepID: "start", Visits: 3}}, Edges: []dto.HeatEdge{}}, nil
}

func (f *fakeMiningService) Simulate(_ context.Context, tenantID, key string, req dto.SimulationRequest) (*dto.SimulationReport, error) {
	f.gotTenant, f.gotKey, f.gotReq = tenantID, key, req
	return &dto.SimulationReport{DefinitionKey: key, WindowDays: req.WindowDays, Estimate: true, Method: "monte_carlo_over_observed_variants", Iterations: 2000, P50Ms: 5000}, nil
}

// miningRouter builds a chi router with the mining routes registered, mirroring
// the /analytics mount in cmd/workflow-engine/main.go.
func miningRouter(svc miningService) chi.Router {
	h := NewMiningHandler(svc, zerolog.Nop())
	r := chi.NewRouter()
	h.RegisterRoutes(r)
	return r
}

func miningReq(method, target, body string) *http.Request {
	var r *http.Request
	if body != "" {
		r = httptest.NewRequest(method, target, strings.NewReader(body))
	} else {
		r = httptest.NewRequest(method, target, nil)
	}
	return r.WithContext(auth.WithUser(r.Context(), &auth.ContextUser{ID: "actor-1", TenantID: "tenant-1"}))
}

func TestMiningHandler_VariantsPassesPathKeyWindowTopN(t *testing.T) {
	svc := &fakeMiningService{}
	rec := httptest.NewRecorder()
	miningRouter(svc).ServeHTTP(rec, miningReq(http.MethodGet, "/def-key-1/variants?window_days=30&top_n=5", ""))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "tenant-1", svc.gotTenant)
	require.Equal(t, "def-key-1", svc.gotKey)
	require.Equal(t, 30, svc.gotWindow)
	require.Equal(t, 5, svc.gotTopN)

	var body struct {
		Data dto.VariantReport `json:"data"`
	}
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	require.Equal(t, "def-key-1", body.Data.DefinitionKey)
	require.Len(t, body.Data.Variants, 1)
}

func TestMiningHandler_Conformance(t *testing.T) {
	svc := &fakeMiningService{}
	rec := httptest.NewRecorder()
	miningRouter(svc).ServeHTTP(rec, miningReq(http.MethodGet, "/abc/conformance?window_days=14", ""))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "abc", svc.gotKey)
	require.Equal(t, 14, svc.gotWindow)
	require.Contains(t, rec.Body.String(), "conformance_score")
}

func TestMiningHandler_Map(t *testing.T) {
	svc := &fakeMiningService{}
	rec := httptest.NewRecorder()
	miningRouter(svc).ServeHTTP(rec, miningReq(http.MethodGet, "/abc/map", ""))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "abc", svc.gotKey)
	require.Contains(t, rec.Body.String(), "nodes")
	require.Contains(t, rec.Body.String(), "edges")
}

func TestMiningHandler_SimulateWithBody(t *testing.T) {
	svc := &fakeMiningService{}
	rec := httptest.NewRecorder()
	body := `{"window_days":30,"iterations":5000,"seed":42,"override":{"remove_steps":["review"]}}`
	miningRouter(svc).ServeHTTP(rec, miningReq(http.MethodPost, "/abc/simulate", body))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "abc", svc.gotKey)
	require.Equal(t, 30, svc.gotReq.WindowDays)
	require.Equal(t, 5000, svc.gotReq.Iterations)
	require.Equal(t, int64(42), svc.gotReq.Seed)
	require.NotNil(t, svc.gotReq.Override)
	require.Equal(t, []string{"review"}, svc.gotReq.Override.RemoveSteps)
	// Response labelled as an estimate.
	require.Contains(t, rec.Body.String(), `"estimate":true`)
}

func TestMiningHandler_SimulateEmptyBodyIsAsObserved(t *testing.T) {
	svc := &fakeMiningService{}
	rec := httptest.NewRecorder()
	// No body -> as-observed simulation, still 200.
	miningRouter(svc).ServeHTTP(rec, miningReq(http.MethodPost, "/abc/simulate", ""))

	require.Equal(t, http.StatusOK, rec.Code)
	require.Equal(t, "abc", svc.gotKey)
	require.Nil(t, svc.gotReq.Override)
}

func TestMiningHandler_SimulateMalformedBody400(t *testing.T) {
	svc := &fakeMiningService{}
	rec := httptest.NewRecorder()
	miningRouter(svc).ServeHTTP(rec, miningReq(http.MethodPost, "/abc/simulate", `{"iterations":"not-a-number"`))
	require.Equal(t, http.StatusBadRequest, rec.Code)
}

// TestMiningHandler_Unauthenticated proves the routes 401 without an
// authenticated user (defence in depth beneath the RBAC gate).
func TestMiningHandler_Unauthenticated(t *testing.T) {
	svc := &fakeMiningService{}
	r := miningRouter(svc)

	for _, tc := range []struct {
		method, target string
	}{
		{http.MethodGet, "/abc/variants"},
		{http.MethodGet, "/abc/conformance"},
		{http.MethodGet, "/abc/map"},
		{http.MethodPost, "/abc/simulate"},
	} {
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, httptest.NewRequest(tc.method, tc.target, nil))
		require.Equalf(t, http.StatusUnauthorized, rec.Code, "%s %s", tc.method, tc.target)
	}
}
