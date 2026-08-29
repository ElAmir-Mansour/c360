package handler

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/service"
)

type MagicLinkHandler struct {
	svc    *service.MagicLinkService
	logger zerolog.Logger
}

func NewMagicLinkHandler(svc *service.MagicLinkService, logger zerolog.Logger) *MagicLinkHandler {
	return &MagicLinkHandler{svc: svc, logger: logger}
}

// Routes mounts at /auth/magic-link, yielding the public endpoints
// POST /api/v1/auth/magic-link/request and POST /api/v1/auth/magic-link/verify.
func (h *MagicLinkHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/request", h.Request)
	r.Post("/verify", h.Verify)
	return r
}

// Request issues and emails a single-use magic link. It always responds
// {sent: true} regardless of whether the email maps to a real account, so it
// cannot be used to enumerate users.
func (h *MagicLinkHandler) Request(w http.ResponseWriter, r *http.Request) {
	var req dto.MagicLinkRequestReq
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	// Service is non-disclosing and returns nil on every recoverable condition.
	_ = h.svc.Request(r.Context(), req.Email)

	writeJSON(w, http.StatusOK, dto.MagicLinkRequestResponse{Sent: true})
}

// Verify consumes a magic-link token. On success it returns either a full
// AuthResponse, or a MagicLinkMFAResponse ({requires_mfa: true, mfa_token}) when
// the user has MFA enabled.
func (h *MagicLinkHandler) Verify(w http.ResponseWriter, r *http.Request) {
	var req dto.MagicLinkVerifyReq
	if err := parseBody(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	ip := getIPAddress(r)
	userAgent := r.UserAgent()

	resp, err := h.svc.Verify(r.Context(), req.Token, ip, userAgent)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}
