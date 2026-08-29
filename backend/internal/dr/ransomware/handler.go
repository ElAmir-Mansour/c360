package ransomware

import (
	"context"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// SignalReader is the read surface the HTTP handler needs. *Store satisfies it.
type SignalReader interface {
	ListSignals(ctx context.Context, db repository.DBTX, tenantID string, limit int) ([]Signal, error)
	ListSignalsByStream(ctx context.Context, db repository.DBTX, tenantID, streamID string, limit int) ([]Signal, error)
}

// TenantReader runs a tenant-scoped read transaction so PostgreSQL RLS sees the
// tenant. The DR service's pgx tenant runner (database.RunReadWithTenant)
// satisfies it; tests pass an in-memory fake over a DBTX.
type TenantReader interface {
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// Handler serves the ransomware early-warning read API.
type Handler struct {
	reader SignalReader
	tx     TenantReader
	logger zerolog.Logger
}

// NewHandler constructs the HTTP handler. reader is the signal store; tx runs
// the tenant-scoped read.
func NewHandler(reader SignalReader, tx TenantReader, logger zerolog.Logger) *Handler {
	return &Handler{
		reader: reader,
		tx:     tx,
		logger: logger.With().Str("handler", "dr-ransomware").Logger(),
	}
}

// Routes returns a chi.Router mounted by the DR service (e.g. under
// /api/v1/dr). It exposes the read endpoints behind the dr:read permission.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/ransomware/signals", h.listSignals)
		r.Get("/ransomware/streams/{streamID}/signals", h.listStreamSignals)
	})
	return r
}

// listSignals serves GET /ransomware/signals — the tenant's most recent
// ransomware early-warning signals, newest first. ?limit caps the page (default
// 100, max 1000); ?stream_id filters to one stream.
func (h *Handler) listSignals(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return
	}
	limit := parseLimit(r)
	streamFilter := r.URL.Query().Get("stream_id")

	var signals []Signal
	readErr := h.tx.RunReadWithTenant(r.Context(), tenantID, func(db repository.DBTX) error {
		var e error
		if streamFilter != "" {
			signals, e = h.reader.ListSignalsByStream(r.Context(), db, tenantID.String(), streamFilter, limit)
		} else {
			signals, e = h.reader.ListSignals(r.Context(), db, tenantID.String(), limit)
		}
		return e
	})
	if readErr != nil {
		h.logger.Error().Err(readErr).Msg("listing ransomware signals")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
		return
	}
	if signals == nil {
		signals = []Signal{}
	}
	suiteapi.WriteData(w, http.StatusOK, signals)
}

// listStreamSignals serves GET /ransomware/streams/{streamID}/signals.
func (h *Handler) listStreamSignals(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return
	}
	streamID, err := suiteapi.UUIDParam(r, "streamID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	limit := parseLimit(r)

	var signals []Signal
	readErr := h.tx.RunReadWithTenant(r.Context(), tenantID, func(db repository.DBTX) error {
		var e error
		signals, e = h.reader.ListSignalsByStream(r.Context(), db, tenantID.String(), streamID.String(), limit)
		return e
	})
	if readErr != nil {
		h.logger.Error().Err(readErr).Msg("listing ransomware signals for stream")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
		return
	}
	if signals == nil {
		signals = []Signal{}
	}
	suiteapi.WriteData(w, http.StatusOK, signals)
}

func parseLimit(r *http.Request) int {
	raw := r.URL.Query().Get("limit")
	if raw == "" {
		return 100
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return 100
	}
	if n > 1000 {
		return 1000
	}
	return n
}
