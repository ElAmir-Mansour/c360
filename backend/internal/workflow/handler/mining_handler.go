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

// miningService is the read-only process-MINING surface the handler drives. It
// mirrors the MiningService methods so the handler can be unit-tested against a
// double. Every method is tenant-scoped downstream (RLS).
type miningService interface {
	Variants(ctx context.Context, tenantID, definitionKey string, windowDays, topN int) (*dto.VariantReport, error)
	Conformance(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.ConformanceReport, error)
	Heatmap(ctx context.Context, tenantID, definitionKey string, windowDays int) (*dto.HeatmapReport, error)
	Simulate(ctx context.Context, tenantID, definitionKey string, req dto.SimulationRequest) (*dto.SimulationReport, error)
}

// MiningHandler exposes the READ-ONLY process-MINING reports under
// /api/v1/workflows/analytics/{definitionKey}/{variants,conformance,map} +
// POST .../simulate. Every route is gated on the existing workflow:read RBAC verb
// (analyticsRBAC in cmd/workflow-engine/rbac.go). The simulate POST is a
// read-only ESTIMATE (it takes a body but performs no state change), so it too is
// classified read by the RBAC layer.
type MiningHandler struct {
	service miningService
	logger  zerolog.Logger
}

// NewMiningHandler creates a new MiningHandler.
func NewMiningHandler(service miningService, logger zerolog.Logger) *MiningHandler {
	return &MiningHandler{
		service: service,
		logger:  logger.With().Str("handler", "workflow_mining").Logger(),
	}
}

// RegisterRoutes registers the mining routes onto the given router. It is
// registered onto the SAME /analytics chi.Router as the AnalyticsHandler so the
// {definitionKey} wildcard segment is shared cleanly (chi routes the fixed
// sub-segments variants/conformance/map/simulate under that param). Wiring it
// alongside rather than as a second Mount("/") avoids a wildcard collision.
//
//	GET  /{definitionKey}/variants     -> variant discovery (top-N + long tail)
//	GET  /{definitionKey}/conformance  -> conformance score + deviating variants
//	GET  /{definitionKey}/map          -> path-frequency heatmap {nodes,edges}
//	POST /{definitionKey}/simulate     -> what-if cycle-time estimate (Monte-Carlo)
func (h *MiningHandler) RegisterRoutes(r chi.Router) {
	r.Get("/{definitionKey}/variants", h.Variants)
	r.Get("/{definitionKey}/conformance", h.Conformance)
	r.Get("/{definitionKey}/map", h.Heatmap)
	r.Post("/{definitionKey}/simulate", h.Simulate)
}

// topN reads the optional ?top_n= query parameter (0 when absent/invalid — the
// service applies the default and caps the bound).
func topN(r *http.Request) int {
	if v := r.URL.Query().Get("top_n"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return 0
}

// Variants handles GET /{definitionKey}/variants.
func (h *MiningHandler) Variants(w http.ResponseWriter, r *http.Request) {
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
	report, err := h.service.Variants(r.Context(), user.TenantID, key, windowDays(r), topN(r))
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}

// Conformance handles GET /{definitionKey}/conformance.
func (h *MiningHandler) Conformance(w http.ResponseWriter, r *http.Request) {
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
	report, err := h.service.Conformance(r.Context(), user.TenantID, key, windowDays(r))
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}

// Heatmap handles GET /{definitionKey}/map.
func (h *MiningHandler) Heatmap(w http.ResponseWriter, r *http.Request) {
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
	report, err := h.service.Heatmap(r.Context(), user.TenantID, key, windowDays(r))
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}

// Simulate handles POST /{definitionKey}/simulate. The body is an optional
// SimulationRequest (what-if override + iterations/seed/window). An empty body is
// accepted and simulates as-observed. The response is explicitly an ESTIMATE.
func (h *MiningHandler) Simulate(w http.ResponseWriter, r *http.Request) {
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

	var req dto.SimulationRequest
	// An empty/absent body is valid (as-observed simulation). Only reject a body
	// that is present but malformed.
	if r.Body != nil && r.ContentLength != 0 {
		if err := parseBody(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_BODY", err.Error())
			return
		}
	}

	report, err := h.service.Simulate(r.Context(), user.TenantID, key, req)
	if err != nil {
		handleServiceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"data": report})
}
