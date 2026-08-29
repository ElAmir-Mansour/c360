package enroll

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/suiteapi"
)

// API is implemented by *Service and kept small for handler tests.
type API interface {
	MintToken(ctx context.Context, in MintInput) (*MintOutput, error)
	Exchange(ctx context.Context, in ExchangeInput) (*ExchangeOutput, error)
}

// Handler hosts DR enrollment token and CSR exchange routes. Main should mount
// MintToken behind auth/tenant/RBAC, and Exchange on the token-only enrollment
// path agents call before they have a client certificate.
type Handler struct {
	svc    API
	logger zerolog.Logger
}

// NewHandler constructs a Handler.
func NewHandler(svc API, logger zerolog.Logger) *Handler {
	return &Handler{svc: svc, logger: logger.With().Str("handler", "dr-enroll").Logger()}
}

// Routes returns routes intended to be mounted under /api/v1/dr.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/agents/{agentID}/enrollment-token", h.MintToken)
	r.Post("/agents/enroll", h.Exchange)
	return r
}

type mintTokenRequest struct {
	TenantID   string          `json:"tenant_id,omitempty"`
	SiteID     string          `json:"site_id,omitempty"`
	Purpose    sources.Purpose `json:"purpose,omitempty"`
	TTLSeconds int64           `json:"ttl_seconds,omitempty"`
}

// MintToken mints a single-use token for an existing provisioning DR agent.
func (h *Handler) MintToken(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "enroll_disabled", ErrNotConfigured.Error(), nil)
		return
	}
	agentID, err := uuid.Parse(chi.URLParam(r, "agentID"))
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", "invalid agentID", nil)
		return
	}
	var req mintTokenRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	tenantID, err := tenantFromRequestOrBody(r, req.TenantID)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, "no_tenant", err.Error(), nil)
		return
	}
	siteID, err := optionalUUID(req.SiteID, "site_id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	var ttl time.Duration
	if req.TTLSeconds > 0 {
		ttl = time.Duration(req.TTLSeconds) * time.Second
	}
	out, err := h.svc.MintToken(r.Context(), MintInput{
		TenantID: tenantID,
		AgentID:  agentID,
		SiteID:   siteID,
		Purpose:  req.Purpose,
		TTL:      ttl,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusCreated, out)
}

type exchangeRequest struct {
	Token    string `json:"token"`
	CSRPEM   string `json:"csr_pem"`
	TenantID string `json:"tenant_id,omitempty"`
	SiteID   string `json:"site_id,omitempty"`
}

// Exchange completes the token claim and CSR exchange for a DR agent.
func (h *Handler) Exchange(w http.ResponseWriter, r *http.Request) {
	if h.svc == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "enroll_disabled", ErrNotConfigured.Error(), nil)
		return
	}
	var req exchangeRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	tenantID, err := optionalUUID(req.TenantID, "tenant_id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	siteID, err := optionalUUID(req.SiteID, "site_id")
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	out, err := h.svc.Exchange(r.Context(), ExchangeInput{
		Token:    req.Token,
		CSRPEM:   req.CSRPEM,
		IP:       clientIP(r),
		TenantID: tenantID,
		SiteID:   siteID,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, out)
}

func (h *Handler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotConfigured):
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, "enroll_disabled", err.Error(), nil)
	case errors.Is(err, sources.ErrTokenConsumed):
		suiteapi.WriteError(w, r, http.StatusConflict, "token_consumed", err.Error(), nil)
	case errors.Is(err, sources.ErrTenantMismatch):
		suiteapi.WriteError(w, r, http.StatusForbidden, "tenant_mismatch", err.Error(), nil)
	case errors.Is(err, sources.ErrInvalidState), errors.Is(err, model.ErrInvalidState):
		suiteapi.WriteError(w, r, http.StatusConflict, "invalid_state", err.Error(), nil)
	case errors.Is(err, sources.ErrTokenInvalid), errors.Is(err, sources.ErrValidation):
		suiteapi.WriteError(w, r, http.StatusBadRequest, "bad_request", err.Error(), nil)
	case errors.Is(err, model.ErrNotFound):
		suiteapi.WriteError(w, r, http.StatusNotFound, "not_found", err.Error(), nil)
	default:
		h.logger.Error().Err(err).Str("path", r.URL.Path).Msg("dr enrollment failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, "internal", "internal error", nil)
	}
}

func optionalUUID(raw, field string) (*uuid.UUID, error) {
	if raw == "" {
		return nil, nil
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("%s must be a UUID", field)
	}
	return &id, nil
}

func tenantFromRequestOrBody(r *http.Request, raw string) (uuid.UUID, error) {
	if tenantID, err := suiteapi.TenantID(r); err == nil {
		return tenantID, nil
	}
	if raw == "" {
		return uuid.Nil, errors.New("tenant context or tenant_id is required")
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, errors.New("tenant_id must be a UUID")
	}
	return id, nil
}

func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Forwarded-For"); ip != "" {
		return ip
	}
	return r.RemoteAddr
}
