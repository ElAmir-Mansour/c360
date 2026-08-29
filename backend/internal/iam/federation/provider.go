// Package federation implements external identity-provider (IdP) federation for
// Clario 360. The platform already ships a self-contained internal OIDC SERVER
// (see internal/iam/service/oauth_service.go). This package adds the missing
// piece: acting as an OIDC/OAuth2 CLIENT so platform users can authenticate
// against EXTERNAL IdPs such as Nafath (the Saudi national SSO) and generic
// OIDC providers (Azure AD, Keycloak, Okta, etc.).
//
// All providers implement the Provider interface so the federation service and
// HTTP handlers are protocol-agnostic. OIDC, Nafath and SAML are implemented
// behind the same interface.
package federation

import (
	"context"

	"github.com/clario360/platform/internal/iam/model"
)

// AuthRequest carries the per-login state the provider must echo back through
// the IdP round-trip so the callback can be validated (CSRF + replay defense).
type AuthRequest struct {
	// RedirectURL is the URL the IdP redirects back to after authentication.
	RedirectURL string
	// State is an opaque, unguessable value bound to the user's browser session.
	State string
	// Nonce binds the eventual ID token to this specific authentication request.
	Nonce string
	// CodeVerifier is the PKCE verifier; its S256 challenge is sent to the IdP.
	CodeVerifier string
}

// CallbackParams are the values the IdP returns to the platform's callback URL.
type CallbackParams struct {
	Code             string
	State            string
	Error            string
	ErrorDescription string
	// SAMLResponse carries the base64 SAML assertion for SAML providers.
	SAMLResponse string
	// RelayState is the SAML equivalent of OIDC state.
	RelayState string
}

// ExternalClaims are the normalized identity attributes extracted from a
// verified IdP assertion/ID token.
type ExternalClaims struct {
	// Subject is the IdP-stable unique identifier for the user (OIDC "sub",
	// or for Nafath the national-ID-derived subject).
	Subject string
	Email   string
	// Name is the display name when provided by the IdP.
	Name              string
	GivenName         string
	FamilyName        string
	PreferredUsername string
	// Raw carries the full claim set for auditing / advanced mapping.
	Raw map[string]any
}

// Provider abstracts an external identity provider behind a uniform contract.
// Implementations MUST be safe for concurrent use.
type Provider interface {
	// Kind reports the provider protocol (oidc|nafath|saml).
	Kind() model.IdPKind

	// AuthCodeURL builds the URL to which the user's browser is redirected to
	// begin authentication at the IdP. The returned URL embeds state, nonce and
	// (for OIDC) the PKCE code_challenge derived from req.
	AuthCodeURL(ctx context.Context, req AuthRequest) (string, error)

	// Exchange completes the login: it validates the callback, exchanges the
	// authorization code for tokens at the IdP, verifies the ID token signature
	// against the IdP JWKS, checks the nonce, and returns the normalized claims.
	Exchange(ctx context.Context, req AuthRequest, params CallbackParams) (*ExternalClaims, error)
}
