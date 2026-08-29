package service

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/iam/repository"
)

// providerSlugPattern constrains a provider slug to URL-safe lowercase tokens
// (letters, digits, hyphen), since the slug is embedded in the SSO login/callback
// path (/api/v1/auth/sso/{provider}/login).
var providerSlugPattern = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`)

// IdPAdminService is the tenant-administration surface for external identity
// provider connections. It wraps the admin repository (read + write + delete)
// and validates/normalizes connections before persistence. It never touches the
// FederationService (login path), so the two evolve independently.
//
// Returned errors are *FederationError so the handler reuses writeFederationError
// and maps a stable {error,message} + HTTP status, matching the public SSO routes.
type IdPAdminService struct {
	repo   repository.IdPConnectionAdminRepository
	logger zerolog.Logger
	// callbackBaseURL is the public base (scheme+host, no trailing slash) used to
	// default a connection's redirect_url to
	// {base}/api/v1/auth/sso/{provider}/callback when the admin leaves it blank.
	callbackBaseURL string
}

// NewIdPAdminService constructs the IdP admin service. callbackBaseURL should be
// the externally reachable gateway base (e.g. https://demo.clario360.sa); a
// trailing slash is trimmed.
func NewIdPAdminService(repo repository.IdPConnectionAdminRepository, callbackBaseURL string, logger zerolog.Logger) *IdPAdminService {
	return &IdPAdminService{
		repo:            repo,
		logger:          logger,
		callbackBaseURL: strings.TrimRight(strings.TrimSpace(callbackBaseURL), "/"),
	}
}

// List returns every connection for the tenant with secrets redacted (the repo
// ListByTenant already redacts). Suitable for the admin list surface.
func (s *IdPAdminService) List(ctx context.Context, tenantID string) ([]model.IdPConnection, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "tenant could not be determined"}
	}
	conns, err := s.repo.ListByTenant(ctx, tenantID)
	if err != nil {
		return nil, &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to list identity providers"}
	}
	return conns, nil
}

// Get loads a single connection (including disabled ones) for the tenant, with
// the client_secret redacted so it is never echoed back to an admin surface.
func (s *IdPAdminService) Get(ctx context.Context, tenantID, provider string) (*model.IdPConnection, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "tenant could not be determined"}
	}
	provider = normalizeSlug(provider)
	if provider == "" {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "provider is required"}
	}
	conn, err := s.repo.GetByProviderAny(ctx, tenantID, provider)
	if err != nil {
		return nil, &FederationError{Status: http.StatusNotFound, Code: "PROVIDER_NOT_FOUND", Message: "identity provider connection not found"}
	}
	repository.RedactSecret(conn)
	return conn, nil
}

// Save validates, normalizes and upserts a connection for the tenant. The
// tenant_id on the connection is authoritative (set by the handler from the JWT,
// never the request body). A blank client_secret preserves the stored ciphertext
// (repo merge-on-update). Returns the persisted connection with the secret
// redacted.
func (s *IdPAdminService) Save(ctx context.Context, c *model.IdPConnection) (*model.IdPConnection, error) {
	if c == nil {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "connection is required"}
	}
	if strings.TrimSpace(c.TenantID) == "" {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "tenant could not be determined"}
	}

	c.Provider = normalizeSlug(c.Provider)
	if c.Provider == "" || !providerSlugPattern.MatchString(c.Provider) {
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "provider must be a URL-safe slug (lowercase letters, digits, hyphens)"}
	}

	c.Kind = model.IdPKind(strings.ToLower(strings.TrimSpace(string(c.Kind))))
	if c.Kind == "" {
		c.Kind = model.IdPKindOIDC
	}

	switch c.Kind {
	case model.IdPKindOIDC, model.IdPKindNafath:
		// An OIDC/Nafath connection needs EITHER a discovery issuer OR the explicit
		// authorize+token endpoints.
		hasIssuer := strings.TrimSpace(c.Issuer) != ""
		hasEndpoints := strings.TrimSpace(c.AuthorizeURL) != "" && strings.TrimSpace(c.TokenURL) != ""
		if !hasIssuer && !hasEndpoints {
			return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "an OIDC/Nafath connection requires an issuer (discovery URL) or both authorize_url and token_url"}
		}
		if strings.TrimSpace(c.ClientID) == "" {
			return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "client_id is required for an OIDC/Nafath connection"}
		}
	case model.IdPKindSAML:
		if strings.TrimSpace(c.SAMLMetadataXML) == "" {
			return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "saml_metadata_xml is required for a SAML connection"}
		}
	default:
		return nil, &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: fmt.Sprintf("unsupported connection kind %q (expected oidc, nafath or saml)", c.Kind)}
	}

	if strings.TrimSpace(c.DisplayName) == "" {
		c.DisplayName = c.Provider
	}

	// Default the redirect_url (OAuth redirect_uri registered at the IdP) to the
	// platform callback when the admin leaves it blank.
	if strings.TrimSpace(c.RedirectURL) == "" && s.callbackBaseURL != "" {
		c.RedirectURL = s.callbackBaseURL + "/api/v1/auth/sso/" + c.Provider + "/callback"
	}

	if len(c.Scopes) == 0 {
		c.Scopes = []string{"openid", "profile", "email"}
	}
	if strings.TrimSpace(c.DefaultRoleSlug) == "" {
		c.DefaultRoleSlug = "viewer"
	}

	if err := s.repo.UpsertConnection(ctx, c); err != nil {
		s.logger.Error().Err(err).Str("tenant", c.TenantID).Str("provider", c.Provider).Msg("failed to upsert idp connection")
		return nil, &FederationError{Status: http.StatusInternalServerError, Code: "INTERNAL_ERROR", Message: "failed to save identity provider connection"}
	}

	repository.RedactSecret(c)
	return c, nil
}

// Delete removes a connection for the tenant. A slug that matches no row in the
// tenant resolves to 404 (RLS + tenant scoping guarantee no cross-tenant delete).
func (s *IdPAdminService) Delete(ctx context.Context, tenantID, provider string) error {
	if strings.TrimSpace(tenantID) == "" {
		return &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "tenant could not be determined"}
	}
	provider = normalizeSlug(provider)
	if provider == "" {
		return &FederationError{Status: http.StatusBadRequest, Code: "INVALID_REQUEST", Message: "provider is required"}
	}
	if err := s.repo.DeleteConnection(ctx, tenantID, provider); err != nil {
		return &FederationError{Status: http.StatusNotFound, Code: "PROVIDER_NOT_FOUND", Message: "identity provider connection not found"}
	}
	return nil
}

// normalizeSlug lowercases and trims a provider slug and collapses internal
// whitespace to hyphens so "Azure AD" becomes "azure-ad".
func normalizeSlug(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	s = strings.Join(strings.Fields(s), "-")
	return s
}
