package topology

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

// topologyService is the surface the HTTP router needs. *Service satisfies it;
// an interface keeps the router unit-testable without a database.
type topologyService interface {
	GetTopology(ctx context.Context, tenantID uuid.UUID, groupID string) (Topology, []string, error)
	AddEdge(ctx context.Context, tenantID uuid.UUID, groupID string, in AddEdgeInput) (*Edge, error)
	SelectFailoverTarget(ctx context.Context, tenantID uuid.UUID, groupID string) (FailoverSelection, error)
}

// Router serves the replication-topology HTTP surface. It is mounted by the
// integration phase under /api/v1/dr (alongside the main DR handler) so the
// three endpoints become:
//
//	GET  /api/v1/dr/groups/{groupID}/topology                 (dr:read)
//	POST /api/v1/dr/groups/{groupID}/topology/edges           (dr:write) — 409 on cycle
//	GET  /api/v1/dr/groups/{groupID}/topology/failover-target (dr:read)
type Router struct {
	svc    topologyService
	logger zerolog.Logger
}

// NewRouter constructs the topology HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-topology").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc topologyService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the topology endpoints, permission-gated to
// match the rest of the DR API: reads require dr:read, adding an edge (a
// topology mutation) requires dr:write.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/groups/{groupID}/topology", h.getTopology)
		r.Get("/groups/{groupID}/topology/failover-target", h.failoverTarget)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/groups/{groupID}/topology/edges", h.addEdge)
	})

	return r
}

// getTopology returns the group's full directed graph plus the deterministic
// topological (apply/boot) order.
func (h *Router) getTopology(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.params(w, r)
	if !ok {
		return
	}
	t, order, err := h.svc.GetTopology(r.Context(), tenantID, groupID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{
		"group_id":   t.GroupID,
		"nodes":      t.Nodes,
		"edges":      t.Edges,
		"topo_order": order,
	})
}

// addEdgeRequest is the POST body for adding a directed replication edge.
type addEdgeRequest struct {
	FromSiteID string `json:"from_site_id"`
	ToSiteID   string `json:"to_site_id"`
	FromRole   string `json:"from_role,omitempty"`
	ToRole     string `json:"to_role,omitempty"`
	StreamID   string `json:"stream_id"`
	Mode       string `json:"mode,omitempty"`
	Priority   int    `json:"priority,omitempty"`
}

// addEdge adds a directed replication edge to the group's topology. It returns
// 201 with the stored edge, or 409 when the edge would create a cycle (the core
// guarantee that the topology stays a DAG).
func (h *Router) addEdge(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.params(w, r)
	if !ok {
		return
	}
	var req addEdgeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if req.FromSiteID == "" || req.ToSiteID == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "from_site_id and to_site_id are required", nil)
		return
	}

	edge, err := h.svc.AddEdge(r.Context(), tenantID, groupID.String(), AddEdgeInput{
		FromSiteID: req.FromSiteID,
		ToSiteID:   req.ToSiteID,
		FromRole:   req.FromRole,
		ToRole:     req.ToRole,
		StreamID:   req.StreamID,
		Mode:       req.Mode,
		Priority:   req.Priority,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, edge)
}

// failoverTarget returns the topology-aware failover target selection: the
// chosen standby (or null when none is eligible) plus the full ranking
// rationale, so an operator sees exactly why a target was chosen.
func (h *Router) failoverTarget(w http.ResponseWriter, r *http.Request) {
	tenantID, groupID, ok := h.params(w, r)
	if !ok {
		return
	}
	sel, err := h.svc.SelectFailoverTarget(r.Context(), tenantID, groupID.String())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, sel)
}

// params extracts the tenant from context and the group ID from the path.
func (h *Router) params(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	groupID, err := suiteapi.UUIDParam(r, "groupID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, groupID, true
}

// writeError maps topology sentinel errors to HTTP statuses. A cycle is the
// load-bearing one: it must be 409 Conflict so a client distinguishes "this edge
// is rejected because it loops" from a generic bad request.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrCycle):
		suiteapi.WriteError(w, r, http.StatusConflict, "cycle", err.Error(), nil)
	case errors.Is(err, ErrEdgeExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "edge_exists", err.Error(), nil)
	case errors.Is(err, ErrGroupNotFound), errors.Is(err, ErrNodeNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrSelfEdge), errors.Is(err, ErrInvalidMode), errors.Is(err, ErrInvalidRole):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr topology request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

// compile-time check.
var _ topologyService = (*Service)(nil)
