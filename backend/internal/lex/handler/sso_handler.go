package handler

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/federation"
	iamservice "github.com/clario360/platform/internal/iam/service"
	"github.com/clario360/platform/internal/lex/service"
	"github.com/clario360/platform/internal/suiteapi"
)

// SSOHandler exposes the lex-suite (Watheeq) SSO login + callback (CAP-152).
// These routes are PRE-AUTH: they must be registered OUTSIDE the JWT-gated
// subrouter because the user has no session yet. The handler is a thin
// delegation to the canonical platform IAM federation path (see
// service.LexSSOLoginService) — it owns no protocol or session-minting logic.
type SSOHandler struct {
	baseHandler
	sso *service.LexSSOLoginService
	// successRedirect, when set, is the frontend URL the callback redirects to on
	// success with the access token in the URL fragment (so the SPA can capture
	// it without it landing in server logs / history as a query param). When
	// empty, the callback returns the platform session as JSON. Mirrors the IAM
	// SSO handler contract.
	successRedirect string
}

// NewSSOHandler constructs the lex SSO handler. successRedirect may be empty.
func NewSSOHandler(sso *service.LexSSOLoginService, successRedirect string, logger zerolog.Logger) *SSOHandler {
	return &SSOHandler{
		baseHandler:     baseHandler{logger: logger},
		sso:             sso,
		successRedirect: strings.TrimSpace(successRedirect),
	}
}

// Routes returns the pre-auth SSO routes for mounting under (e.g.) /auth/sso:
//
//	GET  /initiate?provider=&tenant=  → redirects the browser to the external IdP
//	GET  /callback?provider=&code=&state=  → OIDC redirect-back, issues a session
//	POST /callback?provider=          → SAML POST binding (SAMLResponse form field)
//	GET  /discover?domain=acme.com    → resolves a domain to its IdP authorize URL
//
// The integrator mounts this OUTSIDE the JWT middleware (login is pre-auth).
func (h *SSOHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/initiate", h.Initiate)
	r.Get("/discover", h.Discover)
	r.Get("/callback", h.Callback)
	r.Post("/callback", h.Callback) // SAML HTTP-POST binding
	return r
}

// Initiate begins the lex SSO flow and redirects the browser to the external
// IdP. The provider slug is required; tenant (slug) is optional for
// single-tenant deployments where the IAM default tenant resolves it.
//
//	GET /auth/sso/initiate?provider=azure-ad&tenant=acme
func (h *SSOHandler) Initiate(w http.ResponseWriter, r *http.Request) {
	provider := strings.TrimSpace(r.URL.Query().Get("provider"))
	tenantSlug := strings.TrimSpace(r.URL.Query().Get("tenant"))

	redirectURL, err := h.sso.Initiate(r.Context(), uuid.Nil, tenantSlug, provider)
	if err != nil {
		h.writeSSOError(w, r, err)
		return
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// Discover resolves an email domain to its configured IdP and returns the
// provider slug plus a ready-to-follow authorization redirect URL.
//
//	GET /auth/sso/discover?domain=acme.com → {"provider":"azure-ad","authorize_url":"https://..."}
func (h *SSOHandler) Discover(w http.ResponseWriter, r *http.Request) {
	domain := strings.TrimSpace(r.URL.Query().Get("domain"))
	provider, authorizeURL, err := h.sso.Discover(r.Context(), domain)
	if err != nil {
		h.writeSSOError(w, r, err)
		return
	}
	suiteapi.WriteData(w, http.StatusOK, map[string]string{
		"provider":      provider,
		"authorize_url": authorizeURL,
	})
}

// Callback handles the IdP redirect-back. It supports both OIDC (code/state in
// the query) and SAML (SAMLResponse/RelayState via POST form). On success it
// either redirects to the configured frontend with the access token in the
// fragment, or returns the minted platform session as JSON.
//
//	GET  /auth/sso/callback?provider=azure-ad&code=...&state=...
//	POST /auth/sso/callback?provider=okta-saml   (SAMLResponse form field)
func (h *SSOHandler) Callback(w http.ResponseWriter, r *http.Request) {
	provider := strings.TrimSpace(r.URL.Query().Get("provider"))
	q := r.URL.Query()

	params := federation.CallbackParams{
		Code:             strings.TrimSpace(q.Get("code")),
		State:            strings.TrimSpace(q.Get("state")),
		Error:            strings.TrimSpace(q.Get("error")),
		ErrorDescription: strings.TrimSpace(q.Get("error_description")),
		SAMLResponse:     strings.TrimSpace(r.FormValue("SAMLResponse")),
		RelayState:       strings.TrimSpace(r.FormValue("RelayState")),
	}
	if params.RelayState == "" {
		params.RelayState = strings.TrimSpace(q.Get("RelayState"))
	}

	authResp, err := h.sso.Complete(r.Context(), uuid.Nil, provider, params, ssoRequestIP(r), r.UserAgent())
	if err != nil {
		h.writeSSOError(w, r, err)
		return
	}

	if h.successRedirect != "" {
		if target, perr := url.Parse(h.successRedirect); perr == nil {
			frag := url.Values{}
			frag.Set("access_token", authResp.AccessToken)
			frag.Set("token_type", authResp.TokenType)
			target.Fragment = frag.Encode()
			http.Redirect(w, r, target.String(), http.StatusFound)
			return
		}
		h.logger.Warn().Msg("invalid lex SSO success redirect; returning JSON")
	}

	suiteapi.WriteData(w, http.StatusOK, authResp)
}

// writeSSOError maps the delegate's errors to a suite-API error response. The
// canonical IAM federation path returns *iamservice.FederationError carrying the
// correct HTTP status + code; lex's own pre-flight validation returns AppError;
// ErrSSONotConfigured becomes 404 so callers fall back to password login.
func (h *SSOHandler) writeSSOError(w http.ResponseWriter, r *http.Request, err error) {
	var fedErr *iamservice.FederationError
	if errors.As(err, &fedErr) {
		suiteapi.WriteError(w, r, fedErr.Status, fedErr.Code, fedErr.Message, nil)
		return
	}
	if errors.Is(err, service.ErrSSONotConfigured) {
		suiteapi.WriteError(w, r, http.StatusNotFound, "SSO_NOT_CONFIGURED", "no identity provider is configured for SSO login", nil)
		return
	}
	// AppError (lex pre-flight validation) and everything else fall through to the
	// shared lex error mapper.
	h.writeError(w, r, err)
}

// ssoRequestIP extracts the client IP for the IAM audit/session record,
// honouring the proxy headers the gateway sets.
func ssoRequestIP(r *http.Request) string {
	for _, header := range []string{"X-Forwarded-For", "X-Real-IP"} {
		if v := strings.TrimSpace(r.Header.Get(header)); v != "" {
			return strings.TrimSpace(strings.Split(v, ",")[0])
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
}
