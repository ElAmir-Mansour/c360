package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/workflow/dto"
)

// analyticsService is the read-only process-analytics surface the handler
// drives. It mirrors the AnalyticsService methods so the handler can be
// unit-tested against a double. Every method is tenant-scoped downstream (RLS).
type analyticsService interface {
	CycleTime(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.CycleTimeReport, error)
	Bottlenecks(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.BottleneckReport, error)
	Rework(ctx context.Context, tenantID string, windowDays int) (*dto.ReworkReport, error)
	Throughput(ctx context.Context, tenantID, interval string, windowDays int) (*dto.ThroughputReport, error)
}

// AnalyticsHandler exposes the READ-ONLY process-intelligence reports under
// /api/v1/workflows/analytics. All routes are GET and gated on the existing
// workflow:read RBAC verb (see analyticsRBAC in cmd/workflow-engine/rbac.go).
type AnalyticsHandler struct {
	service analyticsService
	logger  zerolog.Logger
}

// NewAnalyticsHandler creates a new AnalyticsHandler.
func NewAnalyticsHandler(service analyticsService, logger zerolog.Logger) *AnalyticsHandler {
	return &AnalyticsHandler{
		service: service,
		logger:  logger.With().Str("handler", "workflow_analytics").Logger(),
	}
}

// Routes mounts the analytics routes.
//
//	GET /{definitionKey}/cycle-time  -> per-version cycle-time distribution
//	GET /bottlenecks                 -> per-step bottleneck ranking (optional ?definition_key=)
//	GET /rework                      -> per-definition + per-step rework rates
//	GET /throughput                  -> started/completed/failed series + active/failure rate
func (h *AnalyticsHandler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Get("/bottlenecks", h.Bottlenecks)
	r.Get("/rework", h.Rework)
	r.Get("/throughput", h.Throughput)
	// The {definitionKey} route is registered last so the static segments above
	// (bottlenecks/rework/throughput) take precedence over the wildcard.
	r.Get("/{definitionKey}/cycle-time", h.CycleTime)

	return r
}

// windowDays reads the optional ?window_days= query parameter (0 when absent or
// invalid — the service applies the default and clamps the bound).
func windowDays(r *http.Request) int {
	if v := r.URL.Query().Get("window_days"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 0
}

// CycleTime handles GET /{definitionKey}/cycle-time.
func (h *AnalyticsHandler) CycleTime(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	key := urlParam(r, "definitionKey")
	if key == "" {
		writeError(w, http.StatusBadRequest, "INVALID_ID", "definition key is required")
		return
	}
	report, err := h.service.CycleTime(r.Context(), user.TenantID, key, windowDays(r))
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}

// Bottlenecks handles GET /bottlenecks. Optional ?definition_key= narrows the
// report to a single definition lineage.
func (h *AnalyticsHandler) Bottlenecks(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	definitionKey := r.URL.Query().Get("definition_key")
	report, err := h.service.Bottlenecks(r.Context(), user.TenantID, definitionKey, windowDays(r))
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}

// Rework handles GET /rework.
func (h *AnalyticsHandler) Rework(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	report, err := h.service.Rework(r.Context(), user.TenantID, windowDays(r))
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}

// Throughput handles GET /throughput. Optional ?interval=day|week (default day).
func (h *AnalyticsHandler) Throughput(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "authentication required")
		return
	}
	interval := r.URL.Query().Get("interval")
	report, err := h.service.Throughput(r.Context(), user.TenantID, interval, windowDays(r))
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}
