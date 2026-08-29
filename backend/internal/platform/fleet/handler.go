package fleet

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/clario360/platform/internal/middleware"
)

// PermFleetRead is the granular permission gating fleet reads. Per §G/§B.4 it is
// matched by the super_admin wildcards (admin:* / *). P0 callers may also wrap
// the mount in an admin:* gate; this package gates on the granular string.
const PermFleetRead = "platform:fleet:read"

// Handler exposes the fleet aggregator over HTTP (chi).
type Handler struct {
	svc *Service
}

// NewHandler builds an HTTP handler around a fleet Service.
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Routes returns a chi router with the fleet endpoints mounted at the root of
// the returned router, each gated by RequirePermission(platform:fleet:read).
// Mount it under /api/v1/platform so paths resolve to /api/v1/platform/fleet/*.
func (h *Handler) Routes() http.Handler {
	r := chi.NewRouter()
	h.Mount(r)
	return r
}

// Mount attaches the fleet routes to an existing chi.Router. The routes are
// grouped behind RequirePermission so the gate cannot leak to sibling routes.
func (h *Handler) Mount(r chi.Router) {
	r.Group(func(gr chi.Router) {
		gr.Use(middleware.RequirePermission(PermFleetRead))
		gr.Get("/fleet/health", h.handleHealth)
		gr.Get("/fleet/summary", h.handleSummary)
	})
}

// handleHealth serves GET /fleet/health. Always HTTP 200 so the console renders
// even when members are degraded (§E.1, §H). generated_at is set inside Health().
func (h *Handler) handleHealth(w http.ResponseWriter, r *http.Request) {
	fh := h.svc.Health(r.Context())
	writeJSON(w, http.StatusOK, fh)
}

// handleSummary serves GET /fleet/summary (the summary block + unhealthy:int).
func (h *Handler) handleSummary(w http.ResponseWriter, r *http.Request) {
	fh := h.svc.Health(r.Context())
	writeJSON(w, http.StatusOK, SummaryOf(fh))
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
