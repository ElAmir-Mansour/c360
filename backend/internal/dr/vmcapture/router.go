package vmcapture

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

// API is the HTTP-facing contract for workload capture, satisfied by *Service.
// Defining it as an interface keeps the router testable with a stub.
type API interface {
	RegisterSource(ctx context.Context, tenantID uuid.UUID, in RegisterInput) (*Source, error)
	ListSources(ctx context.Context, tenantID uuid.UUID) ([]Source, error)
	RunCapture(ctx context.Context, tenantID, sourceID uuid.UUID) (*Epoch, error)
	ListEpochs(ctx context.Context, tenantID, sourceID uuid.UUID) ([]Epoch, error)
}

// Handler maps HTTP to the workload-capture service.
type Handler struct {
	svc    API
	logger zerolog.Logger
}

// NewHandler constructs the workload-capture HTTP handler.
func NewHandler(svc API, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr-vmcapture").Logger()}
}

// Routes returns a chi.Router the integration phase mounts under the DR API.
// RBAC scoped:
//
//	POST /workload-captures               (dr:write) register a VM or K8s source
//	GET  /workload-captures               (dr:read)  list sources
//	POST /workload-captures/{id}/run      (dr:write) trigger a capture pass
//	GET  /workload-captures/{id}/epochs   (dr:read)  list a source's capture passes
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/workload-captures", h.listSources)
		r.Get("/workload-captures/{id}/epochs", h.listEpochs)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/workload-captures", h.registerSource)
		r.Post("/workload-captures/{id}/run", h.runCapture)
	})

	return r
}

func (h *Handler) registerSource(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var in RegisterInput
	if err := suiteapi.DecodeJSON(r, &in); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	src, err := h.svc.RegisterSource(r.Context(), tenantID, in)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, src)
}

func (h *Handler) listSources(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	sources, err := h.svc.ListSources(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if sources == nil {
		sources = []Source{}
	}
	suiteapi.WriteData(w, http.StatusOK, sources)
}

func (h *Handler) runCapture(w http.ResponseWriter, r *http.Request) {
	tenantID, sourceID, ok := h.scope(w, r)
	if !ok {
		return
	}
	epoch, err := h.svc.RunCapture(r.Context(), tenantID, sourceID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, epoch)
}

func (h *Handler) listEpochs(w http.ResponseWriter, r *http.Request) {
	tenantID, sourceID, ok := h.scope(w, r)
	if !ok {
		return
	}
	epochs, err := h.svc.ListEpochs(r.Context(), tenantID, sourceID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if epochs == nil {
		epochs = []Epoch{}
	}
	suiteapi.WriteData(w, http.StatusOK, epochs)
}

func (h *Handler) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return uuid.Nil, uuid.Nil, false
	}
	sourceID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, sourceID, true
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "conflict", err.Error(), nil)
	case errors.Is(err, ErrInvalid):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrDisabled):
		suiteapi.WriteError(w, r, http.StatusConflict, "disabled", err.Error(), nil)
	case errors.Is(err, ErrNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "not_configured", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("workload capture request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
