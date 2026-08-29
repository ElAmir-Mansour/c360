package recover

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// cloudDRService is the surface the Cloud DR router needs; *CloudDRService
// satisfies it. The interface keeps the router unit-testable without the
// composed dr/* services or a database.
type cloudDRService interface {
	Overview(ctx context.Context, tenantID uuid.UUID) (*CloudDROverview, error)
	Regions(ctx context.Context, tenantID uuid.UUID) ([]RegionBootStatus, error)
	RegionBootPlan(ctx context.Context, tenantID uuid.UUID, groupID string) (*RegionFailoverPlan, error)
}

// CloudDRRouter serves the Cloud DR sub-solution HTTP surface. It is mounted by
// the Recover product router under /api/recover/cloud-dr, behind the same
// Auth+Tenant middleware, and self-gates each route with RequirePermission:
//
//	GET /api/recover/cloud-dr/overview                       (dr:read)
//	GET /api/recover/cloud-dr/regions                        (dr:read)
//	GET /api/recover/cloud-dr/regions/{groupID}/boot-plan    (dr:read)
//
// Every route is read-only — it composes the existing dr/* read surfaces. The
// failover EXECUTION paths are the existing dr:failover-gated endpoints under
// /api/v1/dr (bootgraph boot-runs, the failover FSM); Cloud DR does not
// re-expose them.
type CloudDRRouter struct {
	svc    cloudDRService
	logger zerolog.Logger
}

// NewCloudDRRouter constructs the Cloud DR HTTP router over a CloudDRService.
func NewCloudDRRouter(svc *CloudDRService, logger zerolog.Logger) *CloudDRRouter {
	return &CloudDRRouter{svc: svc, logger: logger.With().Str("handler", "recover-cloud-dr").Logger()}
}

// newCloudDRRouter is the internal constructor accepting the service interface
// (tests).
func newCloudDRRouter(svc cloudDRService, logger zerolog.Logger) *CloudDRRouter {
	return &CloudDRRouter{svc: svc, logger: logger}
}

// Routes returns the chi.Router for the Cloud DR sub-solution. All routes are
// reads, gated to dr:read to match the rest of the DR API's query surface.
func (h *CloudDRRouter) Routes() chi.Router {
	r := chi.NewRouter()
	r.Use(middleware.RequirePermission(auth.PermDRRead))
	r.Get("/overview", h.getOverview)
	r.Get("/regions", h.getRegions)
	r.Get("/regions/{groupID}/boot-plan", h.getRegionBootPlan)
	return r
}

// getOverview returns the Cloud DR overview (workloads, last failover test,
// boot-graph status) for the calling tenant.
func (h *CloudDRRouter) getOverview(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	view, err := h.svc.Overview(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, view)
}

// getRegions returns each recovery scope's boot-graph status for the region/AZ
// failover view.
func (h *CloudDRRouter) getRegions(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	regions, err := h.svc.Regions(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"regions": regions})
}

// getRegionBootPlan returns the real, dependency-ordered boot plan for one
// recovery scope so the failover view can visualise it before execution.
func (h *CloudDRRouter) getRegionBootPlan(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	groupID := chi.URLParam(r, "groupID")
	if groupID == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group id is required", nil)
		return
	}
	plan, err := h.svc.RegionBootPlan(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, plan)
}

// writeError maps Cloud DR sentinel errors to HTTP statuses; an unexpected error
// is logged and returned as a generic 500 with no stack trace leaked.
func (h *CloudDRRouter) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrUnknownRegion):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", "recovery scope not found", nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("recover cloud-dr request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// compile-time check.
var _ cloudDRService = (*CloudDRService)(nil)
