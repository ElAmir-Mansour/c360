package model

import "time"

// IdPKind enumerates the supported external identity-provider protocols.
type IdPKind string

const (
	// IdPKindOIDC is a generic OpenID Connect / OAuth2 identity provider.
	IdPKindOIDC IdPKind = "oidc"
	// IdPKindNafath is the Saudi national single-sign-on (Nafath), which is an
	// OIDC/OAuth2 connection variant handled by the OIDC provider.
	IdPKindNafath IdPKind = "nafath"
	// IdPKindSAML is a SAML 2.0 identity provider (handled via the SAML seam).
	IdPKindSAML IdPKind = "saml"
)

// IdPConnection is a tenant-scoped configuration of an external identity
// provider that platform users can federate against.
type IdPConnection struct {
	ID           string
	TenantID     string
	Provider     string // stable slug used in URLs, e.g. "nafath", "azure-ad"
	DisplayName  string
	Kind         IdPKind
	Enabled      bool
	Issuer       string
	ClientID     string
	ClientSecret string
	// AuthorizeURL/TokenURL/JWKSURL/UserInfoURL may be left empty for OIDC
	// connections that expose a discovery document at Issuer/.well-known/openid-configuration.
	AuthorizeURL string
	TokenURL     string
	JWKSURL      string
	UserInfoURL  string
	RedirectURL  string
	Scopes       []string
	// DefaultRoleSlug is the platform role assigned to just-in-time provisioned
	// users from this provider. Empty defaults to "viewer".
	DefaultRoleSlug string
	// AllowJITProvisioning controls whether unknown external subjects are
	// auto-created as platform users. When false, only previously-linked users
	// may sign in.
	AllowJITProvisioning bool
	// SAMLMetadataXML holds the IdP metadata for SAML connections (seam).
	SAMLMetadataXML string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// ExternalIdentity links an external IdP subject to a platform user.
type ExternalIdentity struct {
	ID              string
	TenantID        string
	UserID          string
	Provider        string
	ExternalSubject string
	Email           string
	DisplayName     string
	CreatedAt       time.Time
	LastLoginAt     *time.Time
}
