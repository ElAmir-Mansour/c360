package handler

import (
	"encoding/json"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/federation"
	"github.com/clario360/platform/internal/iam/service"
)

// SSOHandler exposes external identity-provider (SSO) login and callback routes.
type SSOHandler struct {
	fedSvc *service.FederationService
	logger zerolog.Logger
	// successRedirect, when set, is the frontend URL the callback redirects to on
	// success with the access token in the fragment. When empty, the callback
	// returns the platform session as JSON.
	successRedirect string
}

// NewSSOHandler constructs the SSO handler.
func NewSSOHandler(fedSvc *service.FederationService, successRedirect string, logger zerolog.Logger) *SSOHandler {
	return &SSOHandler{fedSvc: fedSvc, logger: logger, successRedirect: successRedirect}
}

// Routes returns the SSO routes:
//
//	GET /{provider}/login    → redirects the browser to the external IdP
//	GET /{provider}/callback → handles the IdP redirect-back, issues a session
func (h *SSOHandler) Routes() chi.Router {
	r := chi.NewRouter()
	// /discover is a static segment and must be matched before the {provider}
	// wildcard. chi evaluates static routes before wildcards, but it is
	// registered first here for clarity.
	r.Get("/discover", h.DiscoverByDomain)
	r.Get("/{provider}/login", h.Login)
	r.Get("/{provider}/callback", h.Callback)
	r.Get("/providers", h.ListProviders)
	return r
}

// DiscoverByDomain resolves an email domain to its configured IdP and returns
// the provider slug plus an authorization redirect URL the caller can follow.
//
//	GET /discover?domain=acme.com → {"provider":"azure-ad","authorize_url":"https://..."}
//
// Returns 404 when no IdP is mapped to the domain.
func (h *SSOHandler) DiscoverByDomain(w http.ResponseWriter, r *http.Request) {
	domain := strings.TrimSpace(r.URL.Query().Get("domain"))
	if domain == "" {
		writeError(w, http.StatusBadRequest, "domain query parameter is required")
		return
	}

	provider, authorizeURL, err := h.fedSvc.DiscoverByDomain(r.Context(), domain)
	if err != nil {
		writeFederationError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"provider":      provider,
		"authorize_url": authorizeURL,
	})
}

// Login begins the SSO flow by redirecting the user to the external IdP.
func (h *SSOHandler) Login(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))

	redirectURL, err := h.fedSvc.LoginURL(r.Context(), tenantID, provider)
	if err != nil {
		writeFederationError(w, err)
		return
	}
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// Callback handles the IdP redirect-back: validates state, exchanges the code,
// provisions/links the user, issues a platform session, and either redirects to
// the frontend (with token) or returns the session as JSON.
func (h *SSOHandler) Callback(w http.ResponseWriter, r *http.Request) {
	provider := chi.URLParam(r, "provider")
	q := r.URL.Query()

	params := federation.CallbackParams{
		Code:             strings.TrimSpace(q.Get("code")),
		State:            strings.TrimSpace(q.Get("state")),
		Error:            strings.TrimSpace(q.Get("error")),
		ErrorDescription: strings.TrimSpace(q.Get("error_description")),
		SAMLResponse:     strings.TrimSpace(r.FormValue("SAMLResponse")),
		RelayState:       strings.TrimSpace(q.Get("RelayState")),
	}

	authResp, err := h.fedSvc.Callback(r.Context(), provider, params, getIPAddress(r), r.UserAgent())
	if err != nil {
		writeFederationError(w, err)
		return
	}

	if h.successRedirect != "" {
		target, perr := url.Parse(h.successRedirect)
		if perr == nil {
			// Tokens travel in the URL fragment (never sent to servers or logged
			// by proxies). The /auth/sso/complete page consumes
			// #access_token/#refresh_token and establishes the session.
			frag := url.Values{}
			frag.Set("access_token", authResp.AccessToken)
			if authResp.RefreshToken != "" {
				frag.Set("refresh_token", authResp.RefreshToken)
			}
			frag.Set("token_type", authResp.TokenType)
			target.Fragment = frag.Encode()
			http.Redirect(w, r, target.String(), http.StatusFound)
			return
		}
		h.logger.Warn().Err(perr).Msg("invalid SSO success redirect; returning JSON")
	}

	writeJSON(w, http.StatusOK, authResp)
}

// ListProviders returns the enabled IdP connections for a tenant (id + name +
// kind only — secrets are never exposed).
func (h *SSOHandler) ListProviders(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	conns, err := h.fedSvc.ListConnections(r.Context(), tenantID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list providers")
		return
	}
	out := make([]map[string]any, 0, len(conns))
	for _, c := range conns {
		out = append(out, map[string]any{
			"provider":     c.Provider,
			"display_name": c.DisplayName,
			"kind":         c.Kind,
			"login_url":    "/api/v1/auth/sso/" + c.Provider + "/login",
		})
	}
	writeJSON(w, http.StatusOK, out)
}

func writeFederationError(w http.ResponseWriter, err error) {
	if fedErr, ok := err.(*service.FederationError); ok {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(fedErr.Status)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"error":   fedErr.Code,
			"message": fedErr.Message,
		})
		return
	}
	writeError(w, http.StatusInternalServerError, "internal server error")
}
