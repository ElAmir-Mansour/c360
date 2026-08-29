package integrations

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

// integrationsService is the Service surface the HTTP router needs. *Service
// satisfies it; an interface keeps the router unit-testable without a database.
type integrationsService interface {
	Create(ctx context.Context, tenantID uuid.UUID, in CreateInput) (Integration, error)
	Get(ctx context.Context, tenantID, id uuid.UUID) (Integration, error)
	List(ctx context.Context, tenantID uuid.UUID) ([]Integration, error)
	Update(ctx context.Context, tenantID, id uuid.UUID, in UpdateInput) (Integration, error)
	Delete(ctx context.Context, tenantID, id uuid.UUID) error
	TestConnection(ctx context.Context, tenantID, id uuid.UUID) (Integration, error)
}

// Router serves the integrations HTTP surface. The integration phase mounts it
// under /api/v1/dr (alongside the main DR handler), giving:
//
//	GET    /api/v1/dr/integrations            (dr:read)  list integrations
//	POST   /api/v1/dr/integrations            (dr:admin) create an integration
//	GET    /api/v1/dr/integrations/{id}       (dr:read)  one integration
//	PUT    /api/v1/dr/integrations/{id}       (dr:admin) update an integration
//	DELETE /api/v1/dr/integrations/{id}       (dr:admin) delete an integration
//	POST   /api/v1/dr/integrations/{id}/test  (dr:write) test connectivity
//
// Creating/updating/deleting an integration is an administrative action
// (dr:admin); testing it is an operational write (dr:write); reads require
// dr:read. Request bodies carry credentials; responses NEVER echo them.
type Router struct {
	svc    integrationsService
	logger zerolog.Logger
}

// NewRouter constructs the integrations HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-integrations").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc integrationsService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the integrations endpoints, permission-gated.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/integrations", h.list)
		r.Get("/integrations/{id}", h.get)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/integrations", h.create)
		r.Put("/integrations/{id}", h.update)
		r.Delete("/integrations/{id}", h.delete)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/integrations/{id}/test", h.test)
	})

	return r
}

// integrationRequest is the body for POST/PUT. Credentials are accepted but the
// response (an Integration) never echoes them.
type integrationRequest struct {
	Name        string      `json:"name"`
	Kind        Kind        `json:"kind"`
	Vendor      string      `json:"vendor"`
	Endpoint    string      `json:"endpoint"`
	Enabled     bool        `json:"enabled"`
	Credentials Credentials `json:"credentials"`
}

func (r integrationRequest) createInput() CreateInput {
	return CreateInput{
		Name:        r.Name,
		Kind:        r.Kind,
		Vendor:      r.Vendor,
		Endpoint:    r.Endpoint,
		Enabled:     r.Enabled,
		Credentials: r.Credentials,
	}
}

func (r integrationRequest) updateInput() UpdateInput {
	return UpdateInput{
		Name:        r.Name,
		Kind:        r.Kind,
		Vendor:      r.Vendor,
		Endpoint:    r.Endpoint,
		Enabled:     r.Enabled,
		Credentials: r.Credentials,
	}
}

func (h *Router) create(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req integrationRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.Create(r.Context(), tenantID, req.createInput())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

func (h *Router) list(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	out, err := h.svc.List(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) get(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.Get(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) update(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var req integrationRequest
	if derr := suiteapi.DecodeJSON(r, &req); derr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", derr.Error(), nil)
		return
	}
	out, err := h.svc.Update(r.Context(), tenantID, id, req.updateInput())
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) delete(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if derr := h.svc.Delete(r.Context(), tenantID, id); derr != nil {
		h.writeError(w, r, derr)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Router) test(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.TestConnection(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

// writeError maps integrations sentinel errors to HTTP statuses.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_exists", err.Error(), nil)
	case errors.Is(err, ErrConnectorMissing):
		suiteapi.WriteError(w, r, http.StatusConflict, "connector_missing", err.Error(), nil)
	case errors.Is(err, ErrValidation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_error", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr integrations request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ integrationsService = (*Service)(nil)
