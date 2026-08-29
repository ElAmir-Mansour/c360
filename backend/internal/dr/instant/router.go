package instant

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// instantService is the Service surface the HTTP router needs. *Service
// satisfies it; an interface keeps the router unit-testable without a database.
type instantService interface {
	StartSession(ctx context.Context, tenantID, recoveryPointID uuid.UUID, groupID *uuid.UUID) (*Session, error)
	GetProgress(ctx context.Context, tenantID, sessionID uuid.UUID) (*Progress, error)
	ReadChunk(ctx context.Context, tenantID, sessionID uuid.UUID, i int) ([]byte, error)
	WriteChunk(ctx context.Context, tenantID, sessionID uuid.UUID, i int, data []byte) error
	BeginFinalize(ctx context.Context, tenantID, sessionID uuid.UUID) (*Session, error)
}

// Router serves the instant-recovery HTTP surface. The integration phase mounts
// it under /api/v1/dr (alongside the main DR handler), giving:
//
//	POST /api/v1/dr/recovery-points/{id}/instant-recovery  (dr:failover) start a session
//	GET  /api/v1/dr/instant-sessions/{id}                  (dr:read)     state + progress
//	GET  /api/v1/dr/instant-sessions/{id}/chunks/{index}   (dr:read)     raw COW chunk bytes
//	PUT  /api/v1/dr/instant-sessions/{id}/chunks/{index}   (dr:failover) redirect-on-write chunk
//	POST /api/v1/dr/instant-sessions/{id}/finalize         (dr:failover) begin finalize
//
// Starting and finalizing an instant recovery are gated actions (they stand up a
// recovered workload), so they require dr:failover — the same step-up permission
// the failover FSM uses; status reads require dr:read.
type Router struct {
	svc    instantService
	logger zerolog.Logger
}

const maxChunkWriteBytes = 64 << 20

// NewRouter constructs the instant-recovery HTTP router over a Service.
func NewRouter(svc *Service, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-instant").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc instantService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the instant-recovery endpoints, permission-gated.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/instant-sessions/{id}", h.getSession)
		r.Get("/instant-sessions/{id}/chunks/{index}", h.readChunk)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRFailover))
		r.Post("/recovery-points/{id}/instant-recovery", h.start)
		r.Put("/instant-sessions/{id}/chunks/{index}", h.writeChunk)
		r.Post("/instant-sessions/{id}/finalize", h.finalize)
	})

	return r
}

// startRequest optionally carries the consistency group the recovery point
// belongs to so the session can be listed/grouped; it is otherwise derivable.
type startRequest struct {
	GroupID string `json:"group_id"`
}

// start opens an instant-recovery session over the recovery point in the path.
func (h *Router) start(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	pointID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}

	var req startRequest
	// A body is optional; only reject a malformed non-empty body.
	if r.ContentLength != 0 {
		if derr := suiteapi.DecodeJSON(r, &req); derr != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", derr.Error(), nil)
			return
		}
	}
	var groupID *uuid.UUID
	if req.GroupID != "" {
		g, perr := uuid.Parse(req.GroupID)
		if perr != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid group_id", nil)
			return
		}
		groupID = &g
	}

	sess, err := h.svc.StartSession(r.Context(), tenantID, pointID, groupID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, sess)
}

// getSession returns a session's state and hydration progress.
func (h *Router) getSession(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	sessionID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	prog, err := h.svc.GetProgress(r.Context(), tenantID, sessionID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, prog)
}

// readChunk serves raw bytes from the COW view: overlay first, immutable base on
// a miss. It is intentionally not JSON so a block-device or mount adapter can
// stream chunk payloads without an encoding tax.
func (h *Router) readChunk(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	sessionID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	index, err := chunkIndexParam(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	data, err := h.svc.ReadChunk(r.Context(), tenantID, sessionID, index)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("X-Clario-DR-Session-ID", sessionID.String())
	w.Header().Set("X-Clario-DR-Chunk-Index", strconv.Itoa(index))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// writeChunk records a redirect-on-write overlay chunk. The request body is the
// chunk payload; the immutable sealed recovery point is never mutated.
func (h *Router) writeChunk(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	sessionID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	index, err := chunkIndexParam(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	body := http.MaxBytesReader(w, r.Body, maxChunkWriteBytes)
	data, err := io.ReadAll(body)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusRequestEntityTooLarge, "chunk_too_large", "chunk payload exceeds limit", nil)
		return
	}
	if err := h.svc.WriteChunk(r.Context(), tenantID, sessionID, index, data); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// finalize begins finalization of a READY session (READY -> FINALIZING); the
// standalone copy assembly then completes on the background loop.
func (h *Router) finalize(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	sessionID, err := suiteapi.UUIDParam(r, "id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	sess, err := h.svc.BeginFinalize(r.Context(), tenantID, sessionID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusAccepted, sess)
}

// tenant extracts the tenant from context, writing 401 and returning false on
// failure.
func (h *Router) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return uuid.Nil, false
	}
	return tenantID, true
}

func chunkIndexParam(r *http.Request) (int, error) {
	raw := chi.URLParam(r, "index")
	i, err := strconv.Atoi(raw)
	if err != nil || i < 0 {
		return 0, ErrChunkOutOfRange
	}
	return i, nil
}

// writeError maps instant-recovery sentinel errors to HTTP statuses.
func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrNoBaseChunks):
		suiteapi.WriteError(w, r, http.StatusUnprocessableEntity, "no_base_chunks", err.Error(), nil)
	case errors.Is(err, ErrNotReady):
		suiteapi.WriteError(w, r, http.StatusConflict, "not_ready", err.Error(), nil)
	case errors.Is(err, ErrChunkOutOfRange):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "chunk_out_of_range", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr instant request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

var _ instantService = (*Service)(nil)
