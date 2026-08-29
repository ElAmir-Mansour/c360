package journal

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// API is the HTTP-facing contract for the CDP journal, satisfied by *Service.
// Defining it as an interface keeps the router testable with a stub.
type API interface {
	Timeline(ctx context.Context, tenantID, streamID uuid.UUID) (*Timeline, error)
	CreateBookmark(ctx context.Context, tenantID, streamID uuid.UUID, userID *uuid.UUID, in CreateBookmarkInput) (*Bookmark, error)
	ListBookmarks(ctx context.Context, tenantID, streamID uuid.UUID) ([]Bookmark, error)
	DeleteBookmark(ctx context.Context, tenantID, streamID, id uuid.UUID) error
	Resolve(ctx context.Context, tenantID, streamID uuid.UUID, req ResolveRequest) (*Resolution, error)
}

// Handler maps HTTP to the journal service.
type Handler struct {
	svc    API
	logger zerolog.Logger
}

// NewHandler constructs the journal HTTP handler.
func NewHandler(svc API, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr-journal").Logger()}
}

// Routes returns a chi.Router the integration phase mounts under the DR stream
// API. It adds, scoped by RBAC:
//
//	GET    /streams/{streamID}/journal/timeline             (dr:read)  coverage + recoverable window
//	GET    /streams/{streamID}/journal/resolve?at=|lsn=|seq=(dr:read)  APIT resolution
//	GET    /streams/{streamID}/journal/bookmarks            (dr:read)  list restore points
//	POST   /streams/{streamID}/journal/bookmarks            (dr:write) create a restore point
//	DELETE /streams/{streamID}/journal/bookmarks/{bookmarkID}(dr:write) remove a restore point
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/streams/{streamID}/journal/timeline", h.timeline)
		r.Get("/streams/{streamID}/journal/resolve", h.resolve)
		r.Get("/streams/{streamID}/journal/bookmarks", h.listBookmarks)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/streams/{streamID}/journal/bookmarks", h.createBookmark)
		r.Delete("/streams/{streamID}/journal/bookmarks/{bookmarkID}", h.deleteBookmark)
	})

	return r
}

func (h *Handler) timeline(w http.ResponseWriter, r *http.Request) {
	tenantID, streamID, ok := h.scope(w, r)
	if !ok {
		return
	}
	tl, err := h.svc.Timeline(r.Context(), tenantID, streamID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, tl)
}

func (h *Handler) resolve(w http.ResponseWriter, r *http.Request) {
	tenantID, streamID, ok := h.scope(w, r)
	if !ok {
		return
	}
	req, err := parseResolveRequest(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	res, err := h.svc.Resolve(r.Context(), tenantID, streamID, req)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, res)
}

// parseResolveRequest reads ?at=<rfc3339> | ?lsn=<n> | ?seq=<n> and validates
// that exactly one target is given.
func parseResolveRequest(r *http.Request) (ResolveRequest, error) {
	q := r.URL.Query()
	at := q.Get("at")
	lsn := q.Get("lsn")
	seqStr := q.Get("seq")

	set := 0
	var req ResolveRequest
	if at != "" {
		ts, err := time.Parse(time.RFC3339Nano, at)
		if err != nil {
			ts, err = time.Parse(time.RFC3339, at)
			if err != nil {
				return req, errors.New("at must be an RFC3339 timestamp")
			}
		}
		tsUTC := ts.UTC()
		req.At = &tsUTC
		set++
	}
	if lsn != "" {
		req.LSN = lsn
		set++
	}
	if seqStr != "" {
		seq, err := strconv.ParseInt(seqStr, 10, 64)
		if err != nil || seq <= 0 {
			return req, errors.New("seq must be a positive integer")
		}
		req.Seq = &seq
		set++
	}
	if set == 0 {
		return req, errors.New("one of at, lsn, seq query parameters is required")
	}
	if set > 1 {
		return req, errors.New("exactly one of at, lsn, seq may be given")
	}
	return req, nil
}

func (h *Handler) listBookmarks(w http.ResponseWriter, r *http.Request) {
	tenantID, streamID, ok := h.scope(w, r)
	if !ok {
		return
	}
	bms, err := h.svc.ListBookmarks(r.Context(), tenantID, streamID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if bms == nil {
		bms = []Bookmark{}
	}
	suiteapi.WriteData(w, http.StatusOK, bms)
}

func (h *Handler) createBookmark(w http.ResponseWriter, r *http.Request) {
	tenantID, streamID, ok := h.scope(w, r)
	if !ok {
		return
	}
	var in CreateBookmarkInput
	if err := suiteapi.DecodeJSON(r, &in); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	userID, err := suiteapi.UserID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_user", "user context required", nil)
		return
	}
	bm, err := h.svc.CreateBookmark(r.Context(), tenantID, streamID, userID, in)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, bm)
}

func (h *Handler) deleteBookmark(w http.ResponseWriter, r *http.Request) {
	tenantID, streamID, ok := h.scope(w, r)
	if !ok {
		return
	}
	bookmarkID, err := suiteapi.UUIDParam(r, "bookmarkID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if err := h.svc.DeleteBookmark(r.Context(), tenantID, streamID, bookmarkID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// scope resolves the tenant context and the {streamID} path param.
func (h *Handler) scope(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, bool) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, uuid.Nil, false
	}
	streamID, err := suiteapi.UUIDParam(r, "streamID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, uuid.Nil, false
	}
	return tenantID, streamID, true
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrAlreadyExists):
		suiteapi.WriteError(w, r, http.StatusConflict, "conflict", err.Error(), nil)
	case errors.Is(err, ErrInvalid):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrNoCoverage):
		// No recoverable coverage: 404 is the correct "nothing to resolve to".
		suiteapi.WriteError(w, r, http.StatusNotFound, "no_coverage", err.Error(), nil)
	case errors.Is(err, ErrPruned):
		// The instant is real but beyond the retention window — 410 Gone.
		suiteapi.WriteError(w, r, http.StatusGone, "beyond_retention", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("journal request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
