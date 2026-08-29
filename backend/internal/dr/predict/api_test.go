package predict

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/repository"
)

const (
	apiTenant    = "aaaaaaaa-0000-0000-0000-000000000001"
	apiStreamID  = "11111111-1111-1111-1111-111111111111"
	apiUnknownID = "22222222-2222-2222-2222-222222222222"
)

// fakeAPIStore is an in-memory APIStore.
type fakeAPIStore struct {
	predictions []*Prediction
	byStream    map[string]*Prediction
	samples     map[string][]Sample
}

func (f *fakeAPIStore) ListPredictions(_ context.Context, _ repository.DBTX, _ string) ([]*Prediction, error) {
	return f.predictions, nil
}

func (f *fakeAPIStore) GetPrediction(_ context.Context, _ repository.DBTX, _, streamID string) (*Prediction, error) {
	p, ok := f.byStream[streamID]
	if !ok {
		return nil, ErrNotFound
	}
	return p, nil
}

func (f *fakeAPIStore) ListSamples(_ context.Context, _ repository.DBTX, _, streamID string, _ int) ([]Sample, error) {
	return f.samples[streamID], nil
}

// directTenantRunner runs fn with a nil DBTX (the fake store ignores it) so the
// API's tenant-scoping plumbing is exercised without PostgreSQL.
type directTenantRunner struct{ seenTenant uuid.UUID }

func (d *directTenantRunner) RunReadWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	d.seenTenant = tenantID
	return fn(nil)
}

func newAPIRequest(t *testing.T, method, target string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(method, target, nil)
	// Inject the tenant the way the Tenant middleware would in production.
	req = req.WithContext(auth.WithTenantID(req.Context(), apiTenant))
	return req
}

func TestAPI_ListPredictions(t *testing.T) {
	t.Parallel()
	h := 90.0
	store := &fakeAPIStore{predictions: []*Prediction{
		{ID: "p1", TenantID: apiTenant, StreamID: "s1", GroupLabel: "g1", BreachForecast: true, PredictedBreachSeconds: &h},
		{ID: "p2", TenantID: apiTenant, StreamID: "s2", GroupLabel: "g2"},
	}}
	runner := &directTenantRunner{}
	api := NewAPI(store, runner)

	rec := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec, newAPIRequest(t, http.MethodGet, "/predictions"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []*Prediction `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data) != 2 {
		t.Fatalf("expected 2 predictions, got %d", len(env.Data))
	}
	if runner.seenTenant.String() != apiTenant {
		t.Fatalf("query must be scoped to the request tenant, got %s", runner.seenTenant)
	}
}

func TestAPI_StreamForecast_Found(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	h := 45.0
	store := &fakeAPIStore{
		byStream: map[string]*Prediction{
			apiStreamID: {ID: "p1", TenantID: apiTenant, StreamID: apiStreamID, BreachForecast: true, PredictedBreachSeconds: &h},
		},
		samples: map[string][]Sample{
			apiStreamID: {{ID: "smp1", StreamID: apiStreamID, ObservedAt: now, LagSeconds: 200}},
		},
	}
	api := NewAPI(store, &directTenantRunner{})

	rec := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec, newAPIRequest(t, http.MethodGet, "/streams/"+apiStreamID+"/forecast"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data StreamForecastResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.Prediction == nil || env.Data.Prediction.StreamID != apiStreamID {
		t.Fatalf("prediction not returned: %+v", env.Data.Prediction)
	}
	if len(env.Data.Samples) != 1 || env.Data.Samples[0].LagSeconds != 200 {
		t.Fatalf("samples not returned: %+v", env.Data.Samples)
	}
}

func TestAPI_StreamForecast_NotFound(t *testing.T) {
	t.Parallel()
	store := &fakeAPIStore{byStream: map[string]*Prediction{}}
	api := NewAPI(store, &directTenantRunner{})

	rec := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec, newAPIRequest(t, http.MethodGet, "/streams/"+apiUnknownID+"/forecast"))

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
}

func TestAPI_StreamForecast_InvalidUUID(t *testing.T) {
	t.Parallel()
	api := NewAPI(&fakeAPIStore{byStream: map[string]*Prediction{}}, &directTenantRunner{})
	rec := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec, newAPIRequest(t, http.MethodGet, "/streams/not-a-uuid/forecast"))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a non-UUID stream id", rec.Code)
	}
}

func TestAPI_MissingTenantIsUnauthorized(t *testing.T) {
	t.Parallel()
	api := NewAPI(&fakeAPIStore{}, &directTenantRunner{})
	rec := httptest.NewRecorder()
	// No tenant in context.
	req := httptest.NewRequest(http.MethodGet, "/predictions", nil)
	api.Routes().ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestAPI_EmptyPredictionsReturnsArrayNotNull(t *testing.T) {
	t.Parallel()
	api := NewAPI(&fakeAPIStore{predictions: nil}, &directTenantRunner{})
	rec := httptest.NewRecorder()
	api.Routes().ServeHTTP(rec, newAPIRequest(t, http.MethodGet, "/predictions"))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var env struct {
		Data []*Prediction `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data == nil {
		t.Fatal("empty predictions must serialize as [] not null")
	}
}
