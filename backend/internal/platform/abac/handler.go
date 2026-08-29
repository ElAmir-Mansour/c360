// Package abac exposes the platform ABAC policy-management HTTP API (gap G22).
//
// It provides full CRUD over tenant-scoped attribute policies plus a "simulate"
// endpoint that evaluates a hypothetical request against the tenant's live
// policy set without persisting anything. All routes are tenant-scoped via the
// JWT (auth.TenantFromContext); reads are gated by platform:abac:read and
// writes by platform:abac:write.
//
// Routes (mounted by the caller under /api/v1/abac):
//
//	GET    /policies?action=&resource_type=&enabled=   list (read)
//	GET    /policies/{id}                              get one (read)
//	POST   /policies                                   create (write)
//	PUT    /policies/{id}                              replace (write)
//	PATCH  /policies/{id}   {enabled}                  toggle enabled (write)
//	DELETE /policies/{id}                              delete (write)
//	POST   /policies/simulate {subject,resource,action,env?}  evaluate (read)
package abac

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/authz"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// Permissions gating the ABAC management surface.
const (
	PermissionRead  = "platform:abac:read"
	PermissionWrite = "platform:abac:write"
)

// Handler wires the ABAC repository and engine to HTTP.
type Handler struct {
	repo   *authz.Repository
	engine *authz.Engine
	logger zerolog.Logger
}

// New constructs the handler. repo provides policy persistence (and cache
// invalidation on writes); engine evaluates simulate requests against the
// tenant's live policy set.
func New(repo *authz.Repository, engine *authz.Engine, logger zerolog.Logger) *Handler {
	return &Handler{repo: repo, engine: engine, logger: logger}
}

// Routes returns the ABAC router, to be mounted under an authenticated route
// group (middleware.Auth + middleware.Tenant applied by the caller).
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermissionRead))
		r.Get("/policies", h.list)
		r.Get("/policies/{id}", h.get)
		r.Post("/policies/simulate", h.simulate)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(PermissionWrite))
		r.Post("/policies", h.create)
		r.Put("/policies/{id}", h.update)
		r.Patch("/policies/{id}", h.patch)
		r.Delete("/policies/{id}", h.delete)
	})

	return r
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}

	q := r.URL.Query()
	action := strings.TrimSpace(q.Get("action"))
	resourceType := strings.TrimSpace(q.Get("resource_type"))

	var enabled *bool
	if raw := strings.TrimSpace(q.Get("enabled")); raw != "" {
		v, err := strconv.ParseBool(raw)
		if err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "'enabled' must be a boolean", nil)
			return
		}
		enabled = &v
	}

	policies, err := h.repo.ListForManagement(r.Context(), tenantID, action, resourceType, enabled)
	if err != nil {
		h.writeRepoError(w, r, err)
		return
	}
	if policies == nil {
		policies = []authz.Policy{}
	}
	suiteapi.WriteData(w, http.StatusOK, policies)
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	policy, err := h.repo.GetByID(r.Context(), tenantID, id)
	if err != nil {
		h.writeRepoError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, policy)
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}

	var req policyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if msg, ok := req.validate(); !ok {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_error", msg, nil)
		return
	}

	policy := req.toPolicy()
	policy.TenantID = tenantID
	policy.ID = "" // server-assigned

	created, err := h.repo.Create(r.Context(), policy)
	if err != nil {
		h.writeRepoError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, created)
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	var req policyRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if msg, ok := req.validate(); !ok {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_error", msg, nil)
		return
	}

	policy := req.toPolicy()
	policy.TenantID = tenantID
	policy.ID = id

	updated, err := h.repo.Update(r.Context(), policy)
	if err != nil {
		h.writeRepoError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, updated)
}

func (h *Handler) patch(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	var req struct {
		Enabled *bool `json:"enabled"`
	}
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if req.Enabled == nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_error", "'enabled' is required", nil)
		return
	}

	updated, err := h.repo.SetEnabled(r.Context(), tenantID, id, *req.Enabled)
	if err != nil {
		h.writeRepoError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, updated)
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id := chi.URLParam(r, "id")

	if err := h.repo.Delete(r.Context(), tenantID, id); err != nil {
		h.writeRepoError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) simulate(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}

	var req simulateRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if strings.TrimSpace(req.Action) == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_error", "'action' is required", nil)
		return
	}

	subject := req.Subject.toSubject()
	// The simulation is always evaluated within the caller's tenant so it
	// reflects the same policy set the engine would load at request time.
	subject.TenantID = tenantID

	resource := req.Resource.toResource()
	env := req.Env.toEnvironment()

	decision, err := h.engine.EvaluateWithEnv(r.Context(), subject, resource, env, req.Action)
	if err != nil {
		h.logger.Error().Err(err).Str("tenant_id", tenantID).Msg("abac simulate failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "simulation failed", nil)
		return
	}

	suiteapi.WriteData(w, http.StatusOK, simulateResponse{
		Allowed:         decision.Allowed,
		Reason:          decision.Reason,
		MatchedPolicyID: decision.MatchedPolicyID,
	})
}

// tenant resolves the JWT tenant, writing a 401 and returning ok=false when
// absent.
func (h *Handler) tenant(w http.ResponseWriter, r *http.Request) (string, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return "", false
	}
	return tenantID.String(), true
}

// writeRepoError maps repository errors to HTTP responses using the platform
// error envelope.
func (h *Handler) writeRepoError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, authz.ErrPolicyNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", "abac policy not found", nil)
	case errors.Is(err, authz.ErrInvalidTenant):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_tenant", "invalid tenant context", nil)
	default:
		h.logger.Error().Err(err).Msg("abac repository error")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
