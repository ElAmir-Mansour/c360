package handler

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rs/zerolog"

	iamauth "github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/service"
)

// Permission slugs gating the IdP admin surface. These reuse the existing
// tenant-administration verbs (PermTenantRead / PermTenantWrite) so no RBAC
// migration is needed: super-admin (admin:*) and tenant_admin already hold them
// (see internal/auth/rbac.go). Writes require the write verb; reads the read verb.
const (
	permIdPRead  = "tenant:read"
	permIdPWrite = "tenant:write"
)

// IdPAdminHandler exposes tenant-scoped CRUD for external identity-provider
// connections (SSO federation config). Every route derives the tenant from the
// JWT (never the request body), so a caller can only manage their own tenant's
// connections — no cross-tenant IDOR.
type IdPAdminHandler struct {
	svc    *service.IdPAdminService
	logger zerolog.Logger
}

// NewIdPAdminHandler constructs the IdP admin handler.
func NewIdPAdminHandler(svc *service.IdPAdminService, logger zerolog.Logger) *IdPAdminHandler {
	return &IdPAdminHandler{svc: svc, logger: logger}
}

// Routes returns the IdP admin routes (mounted under /api/v1/idp-connections in
// the authenticated group, so Auth + Tenant middleware have already run):
//
//	GET    /            → list connections (secrets redacted)
//	POST   /            → create/upsert a connection
//	GET    /{provider}  → get one connection (incl. disabled; secret redacted)
//	PUT    /{provider}  → update a connection (blank secret keeps stored one)
//	DELETE /{provider}  → delete a connection
func (h *IdPAdminHandler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Save)
	r.Get("/{provider}", h.Get)
	r.Put("/{provider}", h.Save)
	r.Delete("/{provider}", h.Delete)
	return r
}

// idpConnectionRequest is the admin create/update payload. client_secret is
// write-only: a blank value on update preserves the stored (encrypted) secret.
type idpConnectionRequest struct {
	Provider             string   `json:"provider"`
	DisplayName          string   `json:"display_name"`
	Kind                 string   `json:"kind"`
	Enabled              bool     `json:"enabled"`
	Issuer               string   `json:"issuer"`
	ClientID             string   `json:"client_id"`
	ClientSecret         string   `json:"client_secret"`
	AuthorizeURL         string   `json:"authorize_url"`
	TokenURL             string   `json:"token_url"`
	JWKSURL              string   `json:"jwks_url"`
	UserInfoURL          string   `json:"userinfo_url"`
	RedirectURL          string   `json:"redirect_url"`
	Scopes               []string `json:"scopes"`
	DefaultRoleSlug      string   `json:"default_role_slug"`
	AllowJITProvisioning bool     `json:"allow_jit_provisioning"`
	SAMLMetadataXML      string   `json:"saml_metadata_xml"`
}

// idpConnectionResponse is the redacted view returned to admin surfaces. The
// client_secret is NEVER serialized.
type idpConnectionResponse struct {
	ID                   string   `json:"id"`
	TenantID             string   `json:"tenant_id"`
	Provider             string   `json:"provider"`
	DisplayName          string   `json:"display_name"`
	Kind                 string   `json:"kind"`
	Enabled              bool     `json:"enabled"`
	Issuer               string   `json:"issuer"`
	ClientID             string   `json:"client_id"`
	AuthorizeURL         string   `json:"authorize_url"`
	TokenURL             string   `json:"token_url"`
	JWKSURL              string   `json:"jwks_url"`
	UserInfoURL          string   `json:"userinfo_url"`
	RedirectURL          string   `json:"redirect_url"`
	Scopes               []string `json:"scopes"`
	DefaultRoleSlug      string   `json:"default_role_slug"`
	AllowJITProvisioning bool     `json:"allow_jit_provisioning"`
	SAMLMetadataXML      string   `json:"saml_metadata_xml"`
	LoginURL             string   `json:"login_url"`
	CreatedAt            string   `json:"created_at"`
	UpdatedAt            string   `json:"updated_at"`
}

func toIdPConnectionResponse(c *model.IdPConnection) idpConnectionResponse {
	scopes := c.Scopes
	if scopes == nil {
		scopes = []string{}
	}
	return idpConnectionResponse{
		ID:                   c.ID,
		TenantID:             c.TenantID,
		Provider:             c.Provider,
		DisplayName:          c.DisplayName,
		Kind:                 string(c.Kind),
		Enabled:              c.Enabled,
		Issuer:               c.Issuer,
		ClientID:             c.ClientID,
		AuthorizeURL:         c.AuthorizeURL,
		TokenURL:             c.TokenURL,
		JWKSURL:              c.JWKSURL,
		UserInfoURL:          c.UserInfoURL,
		RedirectURL:          c.RedirectURL,
		Scopes:               scopes,
		DefaultRoleSlug:      c.DefaultRoleSlug,
		AllowJITProvisioning: c.AllowJITProvisioning,
		SAMLMetadataXML:      c.SAMLMetadataXML,
		LoginURL:             "/api/v1/auth/sso/" + c.Provider + "/login",
		CreatedAt:            c.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt:            c.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// List returns all IdP connections for the caller's tenant (secrets redacted).
func (h *IdPAdminHandler) List(w http.ResponseWriter, r *http.Request) {
	user := iamauth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !hasIdPPermission(user, permIdPRead) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	conns, err := h.svc.List(r.Context(), user.TenantID)
	if err != nil {
		writeFederationError(w, err)
		return
	}

	out := make([]idpConnectionResponse, 0, len(conns))
	for i := range conns {
		out = append(out, toIdPConnectionResponse(&conns[i]))
	}
	writeJSON(w, http.StatusOK, out)
}

// Get returns a single IdP connection (including disabled) for the tenant.
func (h *IdPAdminHandler) Get(w http.ResponseWriter, r *http.Request) {
	user := iamauth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !hasIdPPermission(user, permIdPRead) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	provider := strings.TrimSpace(urlParam(r, "provider"))
	conn, err := h.svc.Get(r.Context(), user.TenantID, provider)
	if err != nil {
		writeFederationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toIdPConnectionResponse(conn))
}

// Save creates or updates an IdP connection for the caller's tenant. Used for
// both POST (create) and PUT (update). The tenant is taken from the JWT; the
// provider slug on a PUT comes from the URL and overrides the body.
func (h *IdPAdminHandler) Save(w http.ResponseWriter, r *http.Request) {
	user := iamauth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !hasIdPPermission(user, permIdPWrite) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	var req idpConnectionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// On PUT the provider slug is authoritative from the URL path.
	if p := strings.TrimSpace(urlParam(r, "provider")); p != "" {
		req.Provider = p
	}

	conn := &model.IdPConnection{
		TenantID:             user.TenantID, // authoritative: JWT tenant, never body
		Provider:             req.Provider,
		DisplayName:          req.DisplayName,
		Kind:                 model.IdPKind(req.Kind),
		Enabled:              req.Enabled,
		Issuer:               strings.TrimSpace(req.Issuer),
		ClientID:             strings.TrimSpace(req.ClientID),
		ClientSecret:         req.ClientSecret,
		AuthorizeURL:         strings.TrimSpace(req.AuthorizeURL),
		TokenURL:             strings.TrimSpace(req.TokenURL),
		JWKSURL:              strings.TrimSpace(req.JWKSURL),
		UserInfoURL:          strings.TrimSpace(req.UserInfoURL),
		RedirectURL:          strings.TrimSpace(req.RedirectURL),
		Scopes:               req.Scopes,
		DefaultRoleSlug:      strings.TrimSpace(req.DefaultRoleSlug),
		AllowJITProvisioning: req.AllowJITProvisioning,
		SAMLMetadataXML:      req.SAMLMetadataXML,
	}

	saved, err := h.svc.Save(r.Context(), conn)
	if err != nil {
		writeFederationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, toIdPConnectionResponse(saved))
}

// Delete removes an IdP connection for the caller's tenant.
func (h *IdPAdminHandler) Delete(w http.ResponseWriter, r *http.Request) {
	user := iamauth.UserFromContext(r.Context())
	if user == nil {
		writeError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	if !hasIdPPermission(user, permIdPWrite) {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	provider := strings.TrimSpace(urlParam(r, "provider"))
	if err := h.svc.Delete(r.Context(), user.TenantID, provider); err != nil {
		writeFederationError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "identity provider connection deleted"})
}

// hasIdPPermission gates on the tenant-admin verb. iamauth.HasPermission already
// resolves the "resource:*" and "*" (super-admin) wildcards, so a super-admin or
// a role holding "tenants:*" passes without any extra handling here.
func hasIdPPermission(user *iamauth.ContextUser, perm string) bool {
	return iamauth.HasPermission(user.Roles, perm)
}
