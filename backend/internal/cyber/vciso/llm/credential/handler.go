package credential

import (
	"errors"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/suiteapi"
)

// Stable client-facing error codes for the credential management endpoints.
const (
	codeUnauthorized = "UNAUTHORIZED"
	codeForbidden    = "FORBIDDEN"
	codeValidation   = "VALIDATION_ERROR"
	codeNotFound     = "NOT_FOUND"
	codeInternal     = "INTERNAL_ERROR"
)

// setCredentialRequest is the PUT body. api_key is accepted on WRITE only and is
// NEVER echoed back in any response (the Status DTO has no key field).
type setCredentialRequest struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	APIKey   string `json:"api_key"`
}

// rotateCredentialRequest is the rotate body: only the new key. Provider/model
// are reused from the stored credential.
type rotateCredentialRequest struct {
	APIKey string `json:"api_key"`
}

// Handler exposes the tenant-admin LLM credential management API. It is
// RBAC-gated inside each method (mirroring the existing /llm/config admin idiom)
// so it can be mounted on the shared vciso route tree without extra route-level
// middleware. The key is write-only: it is accepted on Set/Rotate and never
// returned by GetStatus.
type Handler struct {
	svc    *Service
	logger zerolog.Logger
}

// NewHandler builds a credential Handler. A nil svc yields a handler whose
// endpoints all return 503-equivalent errors, so callers may register routes
// unconditionally and gate on svc != nil at the call site instead.
func NewHandler(svc *Service, logger zerolog.Logger) *Handler {
	return &Handler{
		svc:    svc,
		logger: logger.With().Str("component", "vciso_llm_credential_handler").Logger(),
	}
}

// Set handles PUT /llm/credential — create or replace the tenant credential.
func (h *Handler) Set(w http.ResponseWriter, r *http.Request) {
	tenantID, actor, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}

	var req setCredentialRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		h.writeValidation(w, r, "invalid request body")
		return
	}

	// Copy the key into a []byte we can zero; the request struct's string field
	// is not zeroable, so we wipe our copy and drop the struct reference ASAP.
	keyBytes := []byte(req.APIKey)
	req.APIKey = ""

	status, err := h.svc.Set(r.Context(), tenantID, req.Provider, strings.TrimSpace(req.Model), keyBytes)
	zeroBytes(keyBytes)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	h.logAdminAction(r, "set", actor, tenantID, status.Provider, status.Version)
	suiteapi.WriteJSON(w, http.StatusOK, status)
}

// Rotate handles POST /llm/credential/rotate — replace the key, keep provider/model.
func (h *Handler) Rotate(w http.ResponseWriter, r *http.Request) {
	tenantID, actor, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}

	var req rotateCredentialRequest
	if err := suiteapi.DecodeJSON(r, &req); err != nil {
		h.writeValidation(w, r, "invalid request body")
		return
	}

	keyBytes := []byte(req.APIKey)
	req.APIKey = ""

	status, err := h.svc.Rotate(r.Context(), tenantID, keyBytes)
	zeroBytes(keyBytes)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	h.logAdminAction(r, "rotate", actor, tenantID, status.Provider, status.Version)
	suiteapi.WriteJSON(w, http.StatusOK, status)
}

// Delete handles DELETE /llm/credential — remove the tenant credential (idempotent).
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	tenantID, actor, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}

	if err := h.svc.Delete(r.Context(), tenantID); err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	h.logAdminAction(r, "delete", actor, tenantID, "", 0)
	w.WriteHeader(http.StatusNoContent)
}

// GetStatus handles GET /llm/credential — return key-free credential metadata.
func (h *Handler) GetStatus(w http.ResponseWriter, r *http.Request) {
	tenantID, _, ok := h.requireAdmin(w, r)
	if !ok {
		return
	}

	status, err := h.svc.GetStatus(r.Context(), tenantID)
	if err != nil {
		h.writeServiceError(w, r, err)
		return
	}

	suiteapi.WriteJSON(w, http.StatusOK, status)
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

// requireAdmin extracts the tenant, verifies LLM-admin permission, and returns
// the tenant id + an actor label for audit. On failure it writes the HTTP error.
func (h *Handler) requireAdmin(w http.ResponseWriter, r *http.Request) (tenantID uuid.UUID, actor string, ok bool) {
	if h.svc == nil {
		suiteapi.WriteError(w, r, http.StatusServiceUnavailable, codeInternal, "llm credential service is unavailable", nil)
		return uuid.Nil, "", false
	}

	tid, err := suiteapi.TenantID(r)
	if err != nil {
		suiteapi.WriteError(w, r, http.StatusUnauthorized, codeUnauthorized, "missing tenant context", nil)
		return uuid.Nil, "", false
	}

	if !isLLMAdmin(r) {
		suiteapi.WriteError(w, r, http.StatusForbidden, codeForbidden, "vciso llm admin permission required", nil)
		return uuid.Nil, "", false
	}

	return tid, currentUserLabel(r), true
}

// isLLMAdmin mirrors the existing llm chat handler's admin check: claims- or
// user-roles carrying vciso:llm:admin or the admin:* wildcard.
func isLLMAdmin(r *http.Request) bool {
	ctx := r.Context()
	if claims := auth.ClaimsFromContext(ctx); claims != nil {
		if hasAdminPerm(claims.Roles) {
			return true
		}
	}
	if user := auth.UserFromContext(ctx); user != nil {
		return hasAdminPerm(user.Roles)
	}
	return false
}

func hasAdminPerm(roles []string) bool {
	return auth.HasPermission(roles, auth.PermVCISOLLMAdmin) ||
		auth.HasPermission(roles, auth.PermAdminAll)
}

func currentUserLabel(r *http.Request) string {
	if user := auth.UserFromContext(r.Context()); user != nil {
		if email := strings.TrimSpace(user.Email); email != "" {
			return email
		}
	}
	return "system"
}

// ---------------------------------------------------------------------------
// Error + audit
// ---------------------------------------------------------------------------

func (h *Handler) writeValidation(w http.ResponseWriter, r *http.Request, detail string) {
	suiteapi.WriteError(w, r, http.StatusBadRequest, codeValidation, detail, nil)
}

// writeServiceError maps service-layer sentinel errors to HTTP responses. It
// NEVER includes the key (none of these errors carry it).
func (h *Handler) writeServiceError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrNotConfigured):
		suiteapi.WriteError(w, r, http.StatusNotFound, codeNotFound, "tenant has no LLM credential configured", nil)
	case errors.Is(err, ErrUnsupportedProvider):
		suiteapi.WriteError(w, r, http.StatusBadRequest, codeValidation, "unsupported provider", nil)
	case errors.Is(err, ErrInvalidKeyFormat), errors.Is(err, ErrEmptyKey):
		suiteapi.WriteError(w, r, http.StatusBadRequest, codeValidation, "invalid api key format", nil)
	default:
		h.logger.Error().Err(err).Msg("llm credential request failed")
		suiteapi.WriteError(w, r, http.StatusInternalServerError, codeInternal, "request failed", nil)
	}
}

// logAdminAction emits a structured handler-level audit line. It records who,
// what, and the resulting version — NEVER the key or ciphertext.
func (h *Handler) logAdminAction(r *http.Request, action, actor string, tenantID uuid.UUID, provider string, version int64) {
	event := h.logger.Info().
		Str("admin_action", "llm_credential_"+action).
		Str("actor", actor).
		Str("tenant_id", tenantID.String()).
		Str("method", r.Method).
		Str("path", r.URL.Path).
		Str("remote_addr", r.RemoteAddr)
	if provider != "" {
		event = event.Str("provider", provider)
	}
	if version > 0 {
		event = event.Int64("version", version)
	}
	event.Msg("llm credential admin action performed")
}
