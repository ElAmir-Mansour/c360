package aifleet

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	aigovrepo "github.com/clario360/platform/internal/aigovernance/repository"
	"github.com/clario360/platform/internal/suiteapi"
)

// Handler exposes the cross-tenant AI governance fleet rollup (gap G23). Every
// route is gated by the caller (RequirePermission("platform:ai:read")) when it is
// mounted — see RegisterRoutes.
type Handler struct {
	service *Service
	logger  zerolog.Logger
}

func NewHandler(service *Service, logger zerolog.Logger) *Handler {
	return &Handler{service: service, logger: logger.With().Str("handler", "ai_fleet").Logger()}
}

// RegisterRoutes mounts the fleet endpoints under the supplied router. The
// caller is expected to have already applied auth; this method applies the
// platform:ai:read permission gate to every route in the group.
//
// Mounted paths (relative to the router this is attached to, typically
// /api/v1):
//
//	GET /admin/ai/fleet/models
//	GET /admin/ai/fleet/models/{slug}
//	GET /admin/tenants/{id}/ai-summary
func (h *Handler) RegisterRoutes(r chi.Router, requirePermission func(string) func(http.Handler) http.Handler) {
	r.Group(func(r chi.Router) {
		r.Use(requirePermission("platform:ai:read"))
		r.Get("/admin/ai/fleet/models", h.Fleet)
		r.Get("/admin/ai/fleet/models/{slug}", h.Model)
		r.Get("/admin/tenants/{id}/ai-summary", h.TenantSummary)
	})
}

func (h *Handler) Fleet(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	filters := FleetFilters{
		Suite:    strings.TrimSpace(q.Get("suite")),
		Drift:    strings.TrimSpace(q.Get("drift")),
		RiskTier: strings.TrimSpace(q.Get("risk_tier")),
		Page:     parseIntDefault(q.Get("page"), 0),
		PerPage:  parseIntDefault(q.Get("per_page"), 0),
	}
	data, err := h.service.Fleet(r.Context(), filters)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, data)
}

func (h *Handler) Model(w http.ResponseWriter, r *http.Request) {
	slug := strings.TrimSpace(chi.URLParam(r, "slug"))
	if slug == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "INVALID_SLUG", "model slug is required", nil)
		return
	}
	data, err := h.service.Model(r.Context(), slug)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, data)
}

func (h *Handler) TenantSummary(w http.ResponseWriter, r *http.Request) {
	tenantID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "INVALID_TENANT_ID", "tenant id must be a valid uuid", nil)
		return
	}
	data, err := h.service.TenantSummary(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, data)
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, aigovrepo.ErrNotFound) {
		suiteapi.WriteError(w, r, http.StatusNotFound, "NOT_FOUND", err.Error(), nil)
		return
	}
	h.logger.Error().Err(err).Msg("ai fleet request failed")
	suiteapi.WriteError(w, r, http.StatusInternalServerError, "INTERNAL_ERROR", "request failed", nil)
}

func parseIntDefault(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return def
	}
	return v
}
