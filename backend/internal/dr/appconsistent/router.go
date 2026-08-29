package appconsistent

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/middleware"
	"github.com/clario360/platform/internal/suiteapi"
)

// API is the HTTP-facing contract for application-consistent points, satisfied by
// *Service. Defining it as an interface keeps the router testable with a stub.
type API interface {
	TriggerAppConsistentPoint(ctx context.Context, tenantID, groupID uuid.UUID, in TriggerRequest) (*Barrier, error)
	ListConsistencyBarriers(ctx context.Context, tenantID, groupID uuid.UUID) ([]*Barrier, error)
}

// TriggerRequest is the decoded POST body for an app-consistent-point trigger.
type TriggerRequest struct {
	// Provider selects the quiesce mechanism: "script" or "http". Empty means a
	// crash-consistent point (no quiesce) — the API still records a barrier.
	Provider string `json:"provider"`
	// Script configures a ScriptQuiesceProvider when Provider == "script".
	Script *ScriptProviderRequest `json:"script,omitempty"`
	// HTTP configures an HTTPQuiesceProvider when Provider == "http".
	HTTP *HTTPProviderRequest `json:"http,omitempty"`
	// RetentionUntil overrides the WORM default retain-until when set.
	RetentionUntil *time.Time `json:"retention_until,omitempty"`
}

// ScriptProviderRequest configures the script quiesce provider from the API.
type ScriptProviderRequest struct {
	FreezeCmd  string `json:"freeze_cmd"`
	ThawCmd    string `json:"thaw_cmd"`
	Shell      string `json:"shell,omitempty"`
	TimeoutSec int    `json:"timeout_sec,omitempty"`
}

// HTTPProviderRequest configures the HTTP quiesce provider from the API.
type HTTPProviderRequest struct {
	BaseURL    string `json:"base_url"`
	AuthToken  string `json:"auth_token,omitempty"`
	TimeoutSec int    `json:"timeout_sec,omitempty"`
}

// Handler maps HTTP to the app-consistent service.
type Handler struct {
	svc    API
	logger zerolog.Logger
}

// NewHandler constructs the app-consistent HTTP handler.
func NewHandler(svc API, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr-appconsistent").Logger()}
}

// Routes returns a chi.Router mounted by the integration phase under the DR API.
// It adds:
//
//	POST /groups/{groupID}/app-consistent-point  (dr:failover) -> trigger a point
//	GET  /groups/{groupID}/consistency-barriers  (dr:read)     -> barrier history
//
// The trigger requires dr:failover because quiescing a production workload is a
// disruptive, gated action; the listing is a plain read.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRRead))
		r.Get("/groups/{groupID}/consistency-barriers", h.listBarriers)
	})

	r.Group(func(r chi.Router) {
		r.Use(middleware.RequirePermission(auth.PermDRFailover))
		r.Post("/groups/{groupID}/app-consistent-point", h.triggerPoint)
	})

	return r
}

// triggerPoint handles POST .../app-consistent-point: it coordinates a
// quiesce/seal/thaw and returns the durable barrier. A failed barrier (quiesce
// or capture failed) is a 409 with the recorded barrier body — the request was
// well-formed but the protected workload could not be quiesced/sealed.
func (h *Handler) triggerPoint(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	groupID, ok := h.groupID(w, r)
	if !ok {
		return
	}

	var req TriggerRequest
	if r.Body != nil && r.ContentLength != 0 {
		if err := suiteapi.DecodeJSON(r, &req); err != nil {
			suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}

	barrier, err := h.svc.TriggerAppConsistentPoint(r.Context(), tenantID, groupID, req)
	if err != nil {
		h.writeTriggerError(w, r, barrier, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, barrier)
}

// listBarriers handles GET .../consistency-barriers: the group's barrier history,
// newest first.
func (h *Handler) listBarriers(w http.ResponseWriter, r *http.Request) {
	tenantID, ok := h.tenant(w, r)
	if !ok {
		return
	}
	groupID, ok := h.groupID(w, r)
	if !ok {
		return
	}
	barriers, err := h.svc.ListConsistencyBarriers(r.Context(), tenantID, groupID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	if barriers == nil {
		barriers = []*Barrier{}
	}
	suiteapi.WriteData(w, http.StatusOK, barriers)
}

func (h *Handler) writeTriggerError(w http.ResponseWriter, r *http.Request, barrier *Barrier, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, ErrQuiesceFailed):
		// The workload could not be quiesced; the barrier is recorded crash-level.
		suiteapi.WriteError(w, r, http.StatusConflict, "quiesce_failed", err.Error(), barrier)
	case errors.Is(err, ErrCaptureFailed):
		suiteapi.WriteError(w, r, http.StatusConflict, "capture_failed", err.Error(), barrier)
	case errors.Is(err, ErrFenceFailed):
		suiteapi.WriteError(w, r, http.StatusConflict, "fence_failed", err.Error(), barrier)
	case errors.Is(err, ErrThawFailed):
		suiteapi.WriteError(w, r, http.StatusConflict, "thaw_failed", err.Error(), barrier)
	case errors.Is(err, ErrNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "dependency_not_configured", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("app-consistent trigger failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	case errors.Is(err, ErrInvalidInput):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("app-consistent request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func (h *Handler) tenant(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", "tenant context required", nil)
		return uuid.Nil, false
	}
	return id, true
}

func (h *Handler) groupID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := suiteapi.UUIDParam(r, "groupID")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return uuid.Nil, false
	}
	return id, true
}
