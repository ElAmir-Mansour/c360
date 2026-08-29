package predict

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/suiteapi"
)

// APIStore is the read surface the HTTP API needs. The real *Store satisfies
// it; tests substitute an in-memory implementation.
type APIStore interface {
	ListPredictions(ctx context.Context, db repository.DBTX, tenantID string) ([]*Prediction, error)
	GetPrediction(ctx context.Context, db repository.DBTX, tenantID, streamID string) (*Prediction, error)
	ListSamples(ctx context.Context, db repository.DBTX, tenantID, streamID string, limit int) ([]Sample, error)
}

// TenantRunner runs a read inside a tenant-scoped transaction that sets
// app.current_tenant_id so PostgreSQL RLS scopes every query. Production wires
// PGXTenantRunner; tests pass a direct runner over a fake DBTX.
type TenantRunner interface {
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// PGXTenantRunner adapts a pgx pool to TenantRunner using the platform's
// tenant-context helper (SET LOCAL app.current_tenant_id + read-only tx).
type PGXTenantRunner struct{ Pool *pgxpool.Pool }

// RunReadWithTenant runs fn in a read transaction scoped to tenantID.
func (r PGXTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.Pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// API is the chi.Router adapter for the predictive-failure read endpoints:
//
//	GET /predictions               — all current per-stream forecasts (tenant)
//	GET /streams/{streamID}/forecast — one stream's forecast + recent samples
type API struct {
	store  APIStore
	runner TenantRunner
}

// NewAPI builds the read API over the store and tenant runner.
func NewAPI(store APIStore, runner TenantRunner) *API {
	return &API{store: store, runner: runner}
}

// Routes returns the chi router for the prediction read endpoints. Mount it
// under the DR API group (Auth + Tenant + dr:read) in main.go.
func (a *API) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/predictions", a.listPredictions)
	r.Get("/streams/{streamID}/forecast", a.streamForecast)
	return r
}

func (a *API) listPredictions(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing tenant context", nil)
		return
	}

	var predictions []*Prediction
	runErr := a.runner.RunReadWithTenant(r.Context(), tenantID, func(db repository.DBTX) error {
		var listErr error
		predictions, listErr = a.store.ListPredictions(r.Context(), db, tenantID.String())
		return listErr
	})
	if runErr != nil {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to list predictions", nil)
		return
	}
	if predictions == nil {
		predictions = []*Prediction{}
	}
	suiteapi.WriteData(w, http.StatusOK, predictions)
}

// StreamForecastResponse is the GET /streams/{id}/forecast body: the latest
// prediction plus the most recent samples that fed it, so a dashboard can plot
// the lag trend behind the forecast.
type StreamForecastResponse struct {
	Prediction *Prediction `json:"prediction"`
	Samples    []Sample    `json:"samples"`
}

func (a *API) streamForecast(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", "missing tenant context", nil)
		return
	}
	streamID, err := suiteapi.UUIDParam(r, "streamID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "invalid_request", "invalid stream id", nil)
		return
	}

	resp := StreamForecastResponse{Samples: []Sample{}}
	notFound := false
	runErr := a.runner.RunReadWithTenant(r.Context(), tenantID, func(db repository.DBTX) error {
		pred, getErr := a.store.GetPrediction(r.Context(), db, tenantID.String(), streamID.String())
		if getErr != nil {
			if errors.Is(getErr, ErrNotFound) {
				notFound = true
				return nil
			}
			return getErr
		}
		resp.Prediction = pred

		samples, listErr := a.store.ListSamples(r.Context(), db, tenantID.String(), streamID.String(), 256)
		if listErr != nil {
			return listErr
		}
		if samples != nil {
			resp.Samples = samples
		}
		return nil
	})
	if runErr != nil {
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal_error", "failed to load forecast", nil)
		return
	}
	if notFound {
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", "no forecast for stream", nil)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, resp)
}
