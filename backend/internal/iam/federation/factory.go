package federation

import (
	"fmt"
	"net/http"

	"github.com/clario360/platform/internal/iam/model"
)

// NewProvider constructs the appropriate Provider for a connection's kind.
// OIDC and Nafath share the OIDC client implementation (Nafath is an OIDC/OAuth2
// connection variant); SAML uses the seam provider.
func NewProvider(conn model.IdPConnection, httpClient *http.Client) (Provider, error) {
	switch conn.Kind {
	case model.IdPKindOIDC, model.IdPKindNafath:
		return NewOIDCProvider(conn, httpClient)
	case model.IdPKindSAML:
		return NewSAMLProvider(conn)
	default:
		return nil, fmt.Errorf("federation: unsupported provider kind %q", conn.Kind)
	}
}
