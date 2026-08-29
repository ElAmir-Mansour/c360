package cleanroom

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

// API is the HTTP-facing contract for clean-room validation, satisfied by
// *Service. Defining it as an interface keeps the router testable with a stub.
type API interface {
	ScanRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*Scan, error)
	LatestScan(ctx context.Context, tenantID, pointID uuid.UUID) (*Scan, error)
}

// Handler maps HTTP to the clean-room service.
type Handler struct {
	svc    API
	logger zerolog.Logger
}

// NewHandler constructs the clean-room HTTP handler.
func NewHandler(svc API, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr-cleanroom").Logger()}
}

// Routes returns a chi.Router mounted by the integration phase under the DR
// recovery-point API. It adds:
//
//	POST /recovery-points/{recoveryPointID}/cleanroom-scan  (dr:write)  -> run a scan
//	GET  /recovery-points/{recoveryPointID}/cleanroom       (dr:read)   -> latest verdict
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/recovery-points/{recoveryPointID}/cleanroom", h.getCleanroom)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRWrite))
		r.Post("/recovery-points/{recoveryPointID}/cleanroom-scan", h.runCleanroomScan)
	})

	return r
}

// runCleanroomScan handles POST .../cleanroom-scan: it runs a full clean-room
// validation and returns the verdict. A dirty verdict is still a 200 with a
// blocking verdict body (the scan succeeded; the recovery point failed) — only a
// service/transport failure is a 5xx.
func (h *Handler) runCleanroomScan(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	pointID, ok := h.pointID(w, r)
	if !ok {
		return
	}
	scan, err := h.svc.ScanRecoveryPoint(r.Context(), tenantID, pointID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, scan)
}

// getCleanroom handles GET .../cleanroom: it returns the latest recorded verdict
// for the recovery point, or 404 when it has never been scanned.
func (h *Handler) getCleanroom(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	pointID, ok := h.pointID(w, r)
	if !ok {
		return
	}
	scan, err := h.svc.LatestScan(r.Context(), tenantID, pointID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, scan)
}

func (h *Handler) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) pointID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.UUIDParam(r, "recoveryPointID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "dependency_not_configured", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("clean-room request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}
