package appverify

import (
	"context"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// appverifyService is the read surface the HTTP router needs. *QueryService
// satisfies it; an interface keeps the router unit-testable without a database.
type appverifyService interface {
	ListByGroup(ctx context.Context, tenantID, groupID uuid.UUID, limit int) ([]StoredResult, error)
	GetByID(ctx context.Context, tenantID, id uuid.UUID) (*StoredResult, error)
}

// Router serves the app-verification result history HTTP surface, mounted under
// /api/v1/dr:
//
//	GET /api/v1/dr/app-verification?group=<uuid>[&limit=]  (dr:read) result history for a group
//	GET /api/v1/dr/app-verification/{id}                   (dr:read) one result with per-check detail
//
// These are read-only projections of results the failover VALIDATING gate already
// produced; the projector (not this router) writes them.
type Router struct {
	svc    appverifyService
	logger zerolog.Logger
}

// NewRouter constructs the router over a QueryService.
func NewRouter(svc *QueryService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger.With().Str("handler", "dr-appverify").Logger()}
}

// newRouter is the internal constructor accepting the service interface (tests).
func newRouter(svc appverifyService, logger zerolog.Logger) *Router {
	return &Router{svc: svc, logger: logger}
}

// Routes returns a chi.Router with the read-only endpoints, gated dr:read to match
// the rest of the DR API.
func (h *Router) Routes() chi.Router {
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/app-verification", h.listByGroup)
		r.Get("/app-verification/{id}", h.getResult)
	})
	return r
}

func (h *Router) listByGroup(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	groupRaw := r.URL.Query().Get("group")
	if groupRaw == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group query parameter is required", nil)
		return
	}
	groupID, perr := uuid.Parse(groupRaw)
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "group must be a valid UUID", nil)
		return
	}
	limit := 0
	if raw := r.URL.Query().Get("limit"); raw != "" {
		if n, cerr := strconv.Atoi(raw); cerr == nil {
			limit = n
		}
	}
	results, lerr := h.svc.ListByGroup(r.Context(), tenantID, groupID, limit)
	if lerr != nil {
		h.writeError(w, r, lerr)
		return
	}
	if results == nil {
		results = []StoredResult{}
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]any{"results": results, "count": len(results)})
}

func (h *Router) getResult(w http.ResponseWriter, r *http.Request) {
	tenantID, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "unauthorized", err.Error(), nil)
		return
	}
	id, perr := suiteapi.UUIDParam(r, "id")
	if perr != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", perr.Error(), nil)
		return
	}
	result, gerr := h.svc.GetByID(r.Context(), tenantID, id)
	if gerr != nil {
		h.writeError(w, r, gerr)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, result)
}

func (h *Router) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrResultNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "result_not_found", "app-verification result not found", nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr appverify request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal_error", "internal server error", nil)
	}
}
