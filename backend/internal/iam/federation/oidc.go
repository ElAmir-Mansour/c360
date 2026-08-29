package federation

import (
	"context"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/clario360/platform/internal/iam/model"
)

// oidcDiscovery is the subset of the OpenID Connect discovery document we use.
type oidcDiscovery struct {
	Issuer       string `json:"issuer"`
	AuthorizeURL string `json:"authorization_endpoint"`
	TokenURL     string `json:"token_endpoint"`
	JWKSURL      string `json:"jwks_uri"`
	UserInfoURL  string `json:"userinfo_endpoint"`
}

// OIDCProvider is an OpenID Connect / OAuth2 relying-party (client). It also
// serves the Nafath integration, which is an OIDC connection variant.
type OIDCProvider struct {
	conn       model.IdPConnection
	httpClient *http.Client

	// resolved endpoints (from explicit config or discovery)
	authorizeURL string
	tokenURL     string
	jwksURL      string
	userInfoURL  string
	issuer       string

	scopes []string
}

// NewOIDCProvider builds an OIDC client from a connection config. If the
// authorize/token/JWKS endpoints are not set explicitly, they are fetched from
// the issuer's discovery document on first use.
func NewOIDCProvider(conn model.IdPConnection, httpClient *http.Client) (*OIDCProvider, error) {
	if conn.ClientID == "" {
		return nil, fmt.Errorf("oidc provider %q: client_id is required", conn.Provider)
	}
	if conn.Issuer == "" && conn.AuthorizeURL == "" {
		return nil, fmt.Errorf("oidc provider %q: issuer or explicit endpoints are required", conn.Provider)
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 15 * time.Second}
	}

	scopes := conn.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "profile", "email"}
	}

	return &OIDCProvider{
		conn:         conn,
		httpClient:   httpClient,
		authorizeURL: conn.AuthorizeURL,
		tokenURL:     conn.TokenURL,
		jwksURL:      conn.JWKSURL,
		userInfoURL:  conn.UserInfoURL,
		issuer:       strings.TrimRight(conn.Issuer, "/"),
		scopes:       scopes,
	}, nil
}

// Kind reports the configured kind (oidc or nafath).
func (p *OIDCProvider) Kind() model.IdPKind {
	if p.conn.Kind == model.IdPKindNafath {
		return model.IdPKindNafath
	}
	return model.IdPKindOIDC
}

// AuthCodeURL builds the IdP authorization redirect with state, nonce and PKCE.
func (p *OIDCProvider) AuthCodeURL(ctx context.Context, req AuthRequest) (string, error) {
	if err := p.ensureEndpoints(ctx); err != nil {
		return "", err
	}
	if req.State == "" || req.Nonce == "" || req.CodeVerifier == "" {
		return "", fmt.Errorf("oidc: state, nonce and code_verifier are required")
	}

	params := url.Values{}
	params.Set("response_type", "code")
	params.Set("client_id", p.conn.ClientID)
	params.Set("redirect_uri", req.RedirectURL)
	params.Set("scope", strings.Join(p.scopes, " "))
	params.Set("state", req.State)
	params.Set("nonce", req.Nonce)
	params.Set("code_challenge", pkceChallenge(req.CodeVerifier))
	params.Set("code_challenge_method", "S256")

	sep := "?"
	if strings.Contains(p.authorizeURL, "?") {
		sep = "&"
	}
	return p.authorizeURL + sep + params.Encode(), nil
}

// Exchange validates the callback, swaps the code for tokens, verifies the ID
// token against the IdP JWKS, checks issuer/audience/nonce, and returns claims.
func (p *OIDCProvider) Exchange(ctx context.Context, req AuthRequest, cb CallbackParams) (*ExternalClaims, error) {
	if cb.Error != "" {
		return nil, fmt.Errorf("oidc: idp returned error %q: %s", cb.Error, cb.ErrorDescription)
	}
	if cb.State == "" || cb.State != req.State {
		return nil, fmt.Errorf("oidc: state mismatch (possible CSRF)")
	}
	if cb.Code == "" {
		return nil, fmt.Errorf("oidc: authorization code missing from callback")
	}
	if err := p.ensureEndpoints(ctx); err != nil {
		return nil, err
	}

	tokens, err := p.exchangeCode(ctx, cb.Code, req.RedirectURL, req.CodeVerifier)
	if err != nil {
		return nil, err
	}
	if tokens.IDToken == "" {
		return nil, fmt.Errorf("oidc: token response did not include an id_token")
	}

	claims, err := p.verifyIDToken(ctx, tokens.IDToken, req.Nonce)
	if err != nil {
		return nil, err
	}
	return claims, nil
}

type tokenResponse struct {
	AccessToken string `json:"access_token"`
	IDToken     string `json:"id_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int    `json:"expires_in"`
	Scope       string `json:"scope"`
}

func (p *OIDCProvider) exchangeCode(ctx context.Context, code, redirectURL, codeVerifier string) (*tokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", redirectURL)
	form.Set("client_id", p.conn.ClientID)
	form.Set("code_verifier", codeVerifier)
	if p.conn.ClientSecret != "" {
		form.Set("client_secret", p.conn.ClientSecret)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, fmt.Errorf("oidc: building token request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	httpReq.Header.Set("Accept", "application/json")
	if p.conn.ClientSecret != "" {
		// Prefer HTTP Basic per RFC 6749 §2.3.1 (IdPs commonly require it).
		httpReq.SetBasicAuth(url.QueryEscape(p.conn.ClientID), url.QueryEscape(p.conn.ClientSecret))
	}

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("oidc: token endpoint request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc: token endpoint returned status %d", resp.StatusCode)
	}

	var tr tokenResponse
	if err := json.NewDecoder(resp.Body).Decode(&tr); err != nil {
		return nil, fmt.Errorf("oidc: decoding token response: %w", err)
	}
	return &tr, nil
}

// idTokenClaims is the standard OIDC ID-token claim set we consume.
type idTokenClaims struct {
	jwt.RegisteredClaims
	Email             string `json:"email"`
	EmailVerified     any    `json:"email_verified"`
	Name              string `json:"name"`
	GivenName         string `json:"given_name"`
	FamilyName        string `json:"family_name"`
	PreferredUsername string `json:"preferred_username"`
	Nonce             string `json:"nonce"`
	// Nafath-specific national identity attributes (optional).
	NationalID string `json:"national_id"`
}

func (p *OIDCProvider) verifyIDToken(ctx context.Context, rawIDToken, expectedNonce string) (*ExternalClaims, error) {
	keys, err := p.fetchJWKS(ctx)
	if err != nil {
		return nil, err
	}

	parser := jwt.NewParser(jwt.WithValidMethods([]string{"RS256", "RS384", "RS512"}))
	claims := &idTokenClaims{}
	token, err := parser.ParseWithClaims(rawIDToken, claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		key, ok := keys[kid]
		if !ok {
			// Fall back to the only key when the IdP omits kid.
			if kid == "" && len(keys) == 1 {
				for _, k := range keys {
					return k, nil
				}
			}
			return nil, fmt.Errorf("oidc: no JWKS key matches kid %q", kid)
		}
		return key, nil
	})
	if err != nil {
		return nil, fmt.Errorf("oidc: id_token verification failed: %w", err)
	}
	if !token.Valid {
		return nil, fmt.Errorf("oidc: id_token is invalid")
	}

	// Issuer check (when we know the issuer).
	if p.issuer != "" {
		iss, _ := claims.GetIssuer()
		if strings.TrimRight(iss, "/") != p.issuer {
			return nil, fmt.Errorf("oidc: id_token issuer mismatch: got %q want %q", iss, p.issuer)
		}
	}

	// Audience check.
	if !audienceContains(claims.Audience, p.conn.ClientID) {
		return nil, fmt.Errorf("oidc: id_token audience does not include client_id")
	}

	// Nonce check (replay/binding defense).
	if expectedNonce != "" && claims.Nonce != expectedNonce {
		return nil, fmt.Errorf("oidc: id_token nonce mismatch")
	}

	subject, _ := claims.GetSubject()
	if subject == "" {
		return nil, fmt.Errorf("oidc: id_token missing subject")
	}

	raw := map[string]any{
		"sub":   subject,
		"email": claims.Email,
		"name":  claims.Name,
	}
	if claims.NationalID != "" {
		raw["national_id"] = claims.NationalID
	}

	return &ExternalClaims{
		Subject:           subject,
		Email:             strings.ToLower(strings.TrimSpace(claims.Email)),
		Name:              claims.Name,
		GivenName:         claims.GivenName,
		FamilyName:        claims.FamilyName,
		PreferredUsername: claims.PreferredUsername,
		Raw:               raw,
	}, nil
}

// ensureEndpoints resolves authorize/token/JWKS endpoints from the issuer's
// discovery document when they were not configured explicitly.
func (p *OIDCProvider) ensureEndpoints(ctx context.Context) error {
	if p.authorizeURL != "" && p.tokenURL != "" && p.jwksURL != "" {
		return nil
	}
	if p.issuer == "" {
		return fmt.Errorf("oidc: cannot discover endpoints without an issuer")
	}

	discoURL := p.issuer + "/.well-known/openid-configuration"
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, discoURL, nil)
	if err != nil {
		return fmt.Errorf("oidc: building discovery request: %w", err)
	}
	httpReq.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return fmt.Errorf("oidc: discovery request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("oidc: discovery returned status %d", resp.StatusCode)
	}

	var disco oidcDiscovery
	if err := json.NewDecoder(resp.Body).Decode(&disco); err != nil {
		return fmt.Errorf("oidc: decoding discovery document: %w", err)
	}

	if p.authorizeURL == "" {
		p.authorizeURL = disco.AuthorizeURL
	}
	if p.tokenURL == "" {
		p.tokenURL = disco.TokenURL
	}
	if p.jwksURL == "" {
		p.jwksURL = disco.JWKSURL
	}
	if p.userInfoURL == "" {
		p.userInfoURL = disco.UserInfoURL
	}
	if p.issuer == "" {
		p.issuer = strings.TrimRight(disco.Issuer, "/")
	}

	if p.authorizeURL == "" || p.tokenURL == "" || p.jwksURL == "" {
		return fmt.Errorf("oidc: discovery document is missing required endpoints")
	}
	return nil
}

// jwk is a single JSON Web Key (RSA only — the algorithms we accept are RSA).
type jwk struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwks struct {
	Keys []jwk `json:"keys"`
}

func (p *OIDCProvider) fetchJWKS(ctx context.Context) (map[string]*rsa.PublicKey, error) {
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, p.jwksURL, nil)
	if err != nil {
		return nil, fmt.Errorf("oidc: building jwks request: %w", err)
	}
	httpReq.Header.Set("Accept", "application/json")

	resp, err := p.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("oidc: jwks request failed: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("oidc: jwks endpoint returned status %d", resp.StatusCode)
	}

	var set jwks
	if err := json.NewDecoder(resp.Body).Decode(&set); err != nil {
		return nil, fmt.Errorf("oidc: decoding jwks: %w", err)
	}

	keys := make(map[string]*rsa.PublicKey, len(set.Keys))
	for _, k := range set.Keys {
		if !strings.EqualFold(k.Kty, "RSA") {
			continue
		}
		pub, err := parseRSAJWK(k)
		if err != nil {
			continue
		}
		keys[k.Kid] = pub
	}
	if len(keys) == 0 {
		return nil, fmt.Errorf("oidc: jwks contained no usable RSA keys")
	}
	return keys, nil
}

func parseRSAJWK(k jwk) (*rsa.PublicKey, error) {
	nBytes, err := base64.RawURLEncoding.DecodeString(k.N)
	if err != nil {
		return nil, fmt.Errorf("decode n: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(k.E)
	if err != nil {
		return nil, fmt.Errorf("decode e: %w", err)
	}

	n := new(big.Int).SetBytes(nBytes)

	// Convert exponent bytes to int (big-endian, typically 0x010001).
	var e int
	if len(eBytes) > 8 {
		return nil, fmt.Errorf("exponent too large")
	}
	padded := make([]byte, 8)
	copy(padded[8-len(eBytes):], eBytes)
	e = int(binary.BigEndian.Uint64(padded))
	if e == 0 {
		return nil, fmt.Errorf("invalid zero exponent")
	}

	return &rsa.PublicKey{N: n, E: e}, nil
}

func pkceChallenge(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
}

func audienceContains(aud jwt.ClaimStrings, clientID string) bool {
	for _, a := range aud {
		if a == clientID {
			return true
		}
	}
	return false
}
