package handler

import (
	"errors"
	"net/http"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// PersonaHandler serves the Effective Lex Session Contract endpoints
// (Lex_Codebase_RBAC_Map.md §4 / §17.1 / §17.3):
//
//	GET  /api/v1/lex/me       -> resolve the caller's active persona + effective
//	                             permissions + capabilities + persona landing.
//	POST /api/v1/lex/persona  -> switch the active persona to one of the caller's
//	                             available legal roles and return the refreshed
//	                             contract.
//
// Both run on the AUTHENTICATED group (any authenticated user). A caller with no
// legal-affairs role receives the NO_LEX_ROLE_ASSIGNED state and the /dashboard
// landing rather than a 403 — discoverability over silent denial (§2.4).
type PersonaHandler struct {
	baseHandler
	service *service.PersonaService
}

func NewPersonaHandler(svc *service.PersonaService, logger zerolog.Logger) *PersonaHandler {
	return &PersonaHandler{baseHandler: baseHandler{logger: logger}, service: svc}
}

// roleSlugs reads the caller's role slugs from the JWT claims (the authoritative
// source — auth_service issues a token carrying only role slugs). Falls back to
// the context user's roles if claims are somehow absent.
func (h *PersonaHandler) roleSlugs(r *http.Request) []string {
	if claims := auth.ClaimsFromContext(r.Context()); claims != nil {
		return claims.Roles
	}
	if user := auth.UserFromContext(r.Context()); user != nil {
		return user.Roles
	}
	return nil
}

// Me handles GET /api/v1/lex/me.
func (h *PersonaHandler) Me(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	resp, err := h.service.Resolve(r.Context(), tenantID, userID, h.roleSlugs(r))
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, resp)
}

type setPersonaRequest struct {
	RoleSlug string `json:"role_slug"`
}

// SetPersona handles POST /api/v1/lex/persona.
func (h *PersonaHandler) SetPersona(w http.ResponseWriter, r *http.Request) {
	tenantID, userID, ok := h.tenantAndUser(w, r)
	if !ok {
		return
	}
	var body setPersonaRequest
	if err := suiteapi.DecodeJSON(r, &body); err != nil {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "INVALID_BODY", "request body must be {\"role_slug\": \"...\"}", nil)
		return
	}
	if body.RoleSlug == "" {
		suiteapi.WriteError(w, r, http.StatusBadRequest, "INVALID_BODY", "role_slug is required", nil)
		return
	}
	resp, err := h.service.SetPersona(r.Context(), tenantID, userID, h.roleSlugs(r), body.RoleSlug)
	if err != nil {
		if errors.Is(err, service.ErrPersonaNotAvailable()) {
			// The caller does not hold the requested legal role: reject 403 (they
			// are authenticated but not entitled to that persona).
			// Empty message → localized from the catalog per request locale.
			suiteapi.WriteError(w, r, http.StatusForbidden, "PERSONA_NOT_AVAILABLE", "", nil)
			return
		}
		h.writeError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, resp)
}
