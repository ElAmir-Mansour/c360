package readmodel

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// ErrBadInput is returned by readmodel services when a caller supplies malformed
// input that is not already rejected by route parameter parsing.
var ErrBadInput = errors.New("readmodel: bad input")

// ReadService is the narrow service surface required by the readmodel HTTP API.
type ReadService interface {
	BuildPosture(ctx context.Context, tenantID uuid.UUID) (*Posture, error)
	BuildReplicationSummary(ctx context.Context, tenantID uuid.UUID) (*ReplicationSummary, error)
	BuildGroupSummary(ctx context.Context, tenantID, groupID uuid.UUID) (*GroupSummary, error)
}

// Router serves the DR readmodel HTTP surface.
type Router struct {
	svc    ReadService
	logger zerolog.Logger
}

// NewRouter constructs a readmodel router over the supplied service.
func NewRouter(svc ReadService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-readmodel").Logger()}
}

// newRouter is the internal constructor accepting the service interface without
// logger decoration, for unit tests.
func newRouter(svc ReadService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns the readmodel endpoints. All endpoints are read-only and require
// dr:read.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/posture", h.getPosture)
		r.Get("/replication/summary", h.getReplicationSummary)
		r.Get("/groups/{groupID}/summary", h.getGroupSummary)
	})

	return r
}

func (h *Router) getPosture(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	posture, err := h.svc.BuildPosture(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, posture)
}

func (h *Router) getReplicationSummary(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	summary, err := h.svc.BuildReplicationSummary(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, summary)
}

func (h *Router) getGroupSummary(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	groupID, err := suiteapi.UUIDParam(r, "groupID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	summary, err := h.svc.BuildGroupSummary(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, summary)
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrBadInput), errors.Is(err, model.ErrInvalidState):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr readmodel request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
