package storageoffload

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

// offloadService is the Service surface the HTTP router needs. *Service
// satisfies it; an interface keeps the router unit-testable without a database.
type offloadService interface {
	RegisterVolume(ctx context.Context, v *Volume) (*Volume, error)
	GetVolume(ctx context.Context, tenantID, id uuid.UUID) (*Volume, error)
	ListVolumes(ctx context.Context, tenantID uuid.UUID) ([]*Volume, error)
	RequestSnapshot(ctx context.Context, tenantID, volumeID uuid.UUID) (*Snapshot, error)
	GetSnapshot(ctx context.Context, tenantID, id uuid.UUID) (*Snapshot, error)
	ListSnapshots(ctx context.Context, tenantID, volumeID uuid.UUID) ([]*Snapshot, error)
	RequestReplication(ctx context.Context, tenantID, snapshotID uuid.UUID, toTarget string) (*Snapshot, error)
}

// Router serves the storage-offload HTTP surface. The integration phase mounts
// it under /api/v1/dr (alongside the main DR handler), giving:
//
//	POST /api/v1/dr/storage-volumes                          (dr:admin) register a volume
//	GET  /api/v1/dr/storage-volumes                          (dr:read)  list volumes
//	GET  /api/v1/dr/storage-volumes/{id}                     (dr:read)  one volume
//	POST /api/v1/dr/storage-volumes/{id}/snapshots           (dr:write) offload a snapshot
//	GET  /api/v1/dr/storage-volumes/{id}/snapshots           (dr:read)  list snapshots
//	GET  /api/v1/dr/storage-snapshots/{id}                   (dr:read)  one snapshot
//	POST /api/v1/dr/storage-snapshots/{id}/replicate         (dr:write) replicate to a DR target
//
// Registering a volume is an administrative action (dr:admin); offloading and
// replicating are operational writes (dr:write); reads require dr:read.
type Router struct {
	svc    offloadService
	logger zerolog.Logger
}

// NewRouter constructs the storage-offload HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-storageoffload").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc offloadService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the storage-offload endpoints, permission-gated.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/storage-volumes", h.listVolumes)
		r.Get("/storage-volumes/{id}", h.getVolume)
		r.Get("/storage-volumes/{id}/snapshots", h.listSnapshots)
		r.Get("/storage-snapshots/{id}", h.getSnapshot)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRAdmin))
		r.Post("/storage-volumes", h.registerVolume)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/storage-volumes/{id}/snapshots", h.requestSnapshot)
		r.Post("/storage-snapshots/{id}/replicate", h.requestReplication)
	})

	return r
}

// registerVolumeRequest is the body for POST /storage-volumes.
type registerVolumeRequest struct {
	Name                   string `json:"name"`
	Provider               string `json:"provider"`
	ArrayEndpoint          string `json:"array_endpoint"`
	SourceLocation         string `json:"source_location"`
	SiteID                 string `json:"site_id"`
	RetentionMaxSnapshots  int    `json:"retention_max_snapshots"`
	RetentionMaxAgeSeconds int64  `json:"retention_max_age_seconds"`
}

func (h *Router) registerVolume(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	var req registerVolumeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if req.Name == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "name is required", nil)
		return
	}
	vol := &Volume{
		TenantID:               tenantID,
		Name:                   req.Name,
		Provider:               req.Provider,
		ArrayEndpoint:          req.ArrayEndpoint,
		SourceLocation:         req.SourceLocation,
		RetentionMaxSnapshots:  req.RetentionMaxSnapshots,
		RetentionMaxAgeSeconds: req.RetentionMaxAgeSeconds,
	}
	if req.SiteID != "" {
		siteID, perr := uuid.Parse(req.SiteID)
		if perr != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid site_id", nil)
			return
		}
		vol.SiteID = &siteID
	}
	out, err := h.svc.RegisterVolume(r.Context(), vol)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

func (h *Router) listVolumes(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	out, err := h.svc.ListVolumes(r.Context(), tenantID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) getVolume(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.GetVolume(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) requestSnapshot(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	volumeID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	snap, err := h.svc.RequestSnapshot(r.Context(), tenantID, volumeID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, snap)
}

func (h *Router) listSnapshots(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	volumeID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.ListSnapshots(r.Context(), tenantID, volumeID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Router) getSnapshot(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.GetSnapshot(r.Context(), tenantID, id)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

// replicateRequest is the body for POST /storage-snapshots/{id}/replicate.
type replicateRequest struct {
	Target string `json:"target"`
}

func (h *Router) requestReplication(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	id, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var req replicateRequest
	if derr := suiteapi.DecodeJSON(r, &req); derr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", derr.Error(), nil)
		return
	}
	if req.Target == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "target is required", nil)
		return
	}
	snap, err := h.svc.RequestReplication(r.Context(), tenantID, id, req.Target)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, snap)
}

func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

// writeError maps storage-offload sentinel errors to HTTP statuses.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "already_exists", err.Error(), nil)
	case errors.Is(err, ErrInvalidState):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_state", err.Error(), nil)
	case errors.Is(err, ErrValidation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "validation_error", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr storage offload request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ offloadService = (*Service)(nil)
