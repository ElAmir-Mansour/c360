package handler

import (
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/dto"
	"github.com/clario360/platform/internal/iam/service"
)

// maxWebAuthnAssertionBytes bounds the assertion body to a sane size; a
// WebAuthn assertion is a few KB at most.
const maxWebAuthnAssertionBytes = 64 * 1024

// WebAuthnHandler exposes the passkey / FIDO2 assertion (login) endpoints.
type WebAuthnHandler struct {
	svc    *service.WebAuthnService
	logger zerolog.Logger
}

// NewWebAuthnHandler constructs the WebAuthn handler.
func NewWebAuthnHandler(svc *service.WebAuthnService, logger zerolog.Logger) *WebAuthnHandler {
	return &WebAuthnHandler{svc: svc, logger: logger}
}

// Routes returns the WebAuthn routes:
//
//	POST /options → PublicKeyCredentialRequestOptions for the browser
//	POST /verify  → AuthResponse, or {mfa_required, mfa_token} for step-up
func (h *WebAuthnHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/options", h.Options)
	r.Post("/verify", h.Verify)
	return r
}

// Options begins an assertion ceremony and returns the request options.
//
//	POST /api/v1/auth/webauthn/options  body: {"email": "user@example.com"}  (email optional)
//
// The response is a PublicKeyCredentialRequestOptions object the BFF passes
// straight to navigator.credentials.get().
func (h *WebAuthnHandler) Options(w http.ResponseWriter, r *http.Request) {
	var req dto.WebAuthnOptionsRequest
	// Body is optional (empty body → usernameless ceremony). Decode leniently:
	// only treat a non-empty, malformed body as a client error.
	if r.ContentLength != 0 {
		if err := parseBody(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	options, err := h.svc.BeginLogin(r.Context(), req.Email)
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, options)
}

// Verify completes an assertion ceremony.
//
//	POST /api/v1/auth/webauthn/verify  body: serialized WebAuthn assertion
//
// On success it returns a full AuthResponse, or an MFARequiredResponse
// ({mfa_required:true, mfa_token}) when the account requires MFA step-up.
func (h *WebAuthnHandler) Verify(w http.ResponseWriter, r *http.Request) {
	if r.Body == nil {
		writeError(w, http.StatusBadRequest, "request body is required")
		return
	}
	defer r.Body.Close()

	body, err := io.ReadAll(io.LimitReader(r.Body, maxWebAuthnAssertionBytes))
	if err != nil || len(body) == 0 {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	result, err := h.svc.FinishLogin(r.Context(), body, getIPAddress(r), r.UserAgent())
	if err != nil {
		handleServiceError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, result)
}
