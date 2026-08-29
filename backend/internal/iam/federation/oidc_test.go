package federation

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/clario360/platform/internal/iam/model"
)

// mockIdP is a minimal OpenID Connect provider for tests. It serves the
// discovery document, JWKS, and token endpoint, signing ID tokens with a
// generated RSA key so the relying-party can verify them against the JWKS.
type mockIdP struct {
	server   *httptest.Server
	key      *rsa.PrivateKey
	kid      string
	issuer   string
	clientID string

	subject string
	email   string
	name    string
	// lastNonce is set by the test before code exchange to simulate the IdP
	// binding the nonce from the auth request into the issued ID token.
	lastNonce string
}

func newMockIdP(t *testing.T, clientID string) *mockIdP {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generating idp key: %v", err)
	}
	idp := &mockIdP{
		key:      key,
		kid:      "test-key-1",
		clientID: clientID,
		subject:  "idp-subject-123",
		email:    "federated.user@example.com",
		name:     "Federated User",
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		writeJSONT(w, map[string]any{
			"issuer":                 idp.issuer,
			"authorization_endpoint": idp.issuer + "/authorize",
			"token_endpoint":         idp.issuer + "/token",
			"jwks_uri":               idp.issuer + "/jwks",
			"userinfo_endpoint":      idp.issuer + "/userinfo",
		})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		pub := idp.key.PublicKey
		writeJSONT(w, map[string]any{
			"keys": []map[string]any{{
				"kty": "RSA",
				"use": "sig",
				"alg": "RS256",
				"kid": idp.kid,
				"n":   base64.RawURLEncoding.EncodeToString(pub.N.Bytes()),
				"e":   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(pub.E)).Bytes()),
			}},
		})
	})
	mux.HandleFunc("/token", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		// The relying-party must present the authorization code and PKCE verifier.
		if r.Form.Get("grant_type") != "authorization_code" || r.Form.Get("code") == "" {
			http.Error(w, "bad grant", http.StatusBadRequest)
			return
		}
		// The nonce the RP requested is round-tripped via the code (the test
		// stores it on the idp before exchange).
		idToken := idp.signIDToken(t, idp.lastNonce)
		writeJSONT(w, map[string]any{
			"access_token": "idp-access-token",
			"id_token":     idToken,
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	})

	srv := httptest.NewServer(mux)
	idp.server = srv
	idp.issuer = srv.URL
	return idp
}

func (m *mockIdP) signIDToken(t *testing.T, nonce string) string {
	t.Helper()
	now := time.Now()
	claims := jwt.MapClaims{
		"iss":   m.issuer,
		"sub":   m.subject,
		"aud":   m.clientID,
		"exp":   now.Add(time.Hour).Unix(),
		"iat":   now.Unix(),
		"email": m.email,
		"name":  m.name,
		"nonce": nonce,
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = m.kid
	signed, err := tok.SignedString(m.key)
	if err != nil {
		t.Fatalf("signing id token: %v", err)
	}
	return signed
}

func writeJSONT(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

// setNonce records the nonce the IdP will embed into the next issued ID token.
func (m *mockIdP) setNonce(n string) { m.lastNonce = n }

// TestOIDCProvider_FullFlow exercises discovery → authorize URL → token
// exchange → JWKS-based ID token verification → normalized claims.
func TestOIDCProvider_FullFlow(t *testing.T) {
	idp := newMockIdP(t, "clario-rp")
	defer idp.server.Close()

	conn := model.IdPConnection{
		Provider:     "test-oidc",
		Kind:         model.IdPKindOIDC,
		Enabled:      true,
		Issuer:       idp.issuer, // endpoints resolved via discovery
		ClientID:     "clario-rp",
		ClientSecret: "rp-secret",
		RedirectURL:  "https://app.clario360.sa/api/v1/auth/sso/test-oidc/callback",
		Scopes:       []string{"openid", "profile", "email"},
	}

	prov, err := NewOIDCProvider(conn, idp.server.Client())
	if err != nil {
		t.Fatalf("NewOIDCProvider: %v", err)
	}

	authReq := AuthRequest{
		RedirectURL:  conn.RedirectURL,
		State:        "state-xyz",
		Nonce:        "nonce-abc",
		CodeVerifier: "verifier-0123456789-0123456789-0123456789",
	}

	// 1. Authorization URL is built with state, nonce and PKCE challenge.
	authURL, err := prov.AuthCodeURL(context.Background(), authReq)
	if err != nil {
		t.Fatalf("AuthCodeURL: %v", err)
	}
	parsed, err := url.Parse(authURL)
	if err != nil {
		t.Fatalf("parse auth url: %v", err)
	}
	q := parsed.Query()
	if q.Get("state") != "state-xyz" {
		t.Fatalf("expected state in auth URL, got %q", q.Get("state"))
	}
	if q.Get("nonce") != "nonce-abc" {
		t.Fatalf("expected nonce in auth URL")
	}
	if q.Get("code_challenge") == "" || q.Get("code_challenge_method") != "S256" {
		t.Fatalf("expected PKCE S256 challenge in auth URL")
	}
	if q.Get("client_id") != "clario-rp" {
		t.Fatalf("expected client_id in auth URL")
	}

	// 2. The IdP will embed our nonce into the ID token at the token endpoint.
	idp.setNonce("nonce-abc")

	// 3. Exchange the callback code and verify the ID token.
	claims, err := prov.Exchange(context.Background(), authReq, CallbackParams{
		Code:  "auth-code-1",
		State: "state-xyz",
	})
	if err != nil {
		t.Fatalf("Exchange: %v", err)
	}
	if claims.Subject != idp.subject {
		t.Fatalf("expected subject %q, got %q", idp.subject, claims.Subject)
	}
	if claims.Email != idp.email {
		t.Fatalf("expected email %q, got %q", idp.email, claims.Email)
	}
}

// TestOIDCProvider_StateMismatch ensures CSRF protection (state mismatch ⇒ error).
func TestOIDCProvider_StateMismatch(t *testing.T) {
	idp := newMockIdP(t, "clario-rp")
	defer idp.server.Close()

	conn := model.IdPConnection{
		Provider: "test-oidc", Kind: model.IdPKindOIDC, Enabled: true,
		Issuer: idp.issuer, ClientID: "clario-rp",
		RedirectURL: "https://app/cb", Scopes: []string{"openid"},
	}
	prov, _ := NewOIDCProvider(conn, idp.server.Client())

	authReq := AuthRequest{State: "expected", Nonce: "n", CodeVerifier: "v0123456789012345", RedirectURL: "https://app/cb"}
	_, err := prov.Exchange(context.Background(), authReq, CallbackParams{Code: "c", State: "ATTACKER"})
	if err == nil {
		t.Fatalf("expected state mismatch error")
	}
}

// TestOIDCProvider_NonceMismatch ensures the ID token nonce must match the request.
func TestOIDCProvider_NonceMismatch(t *testing.T) {
	idp := newMockIdP(t, "clario-rp")
	defer idp.server.Close()
	idp.setNonce("server-nonce") // IdP returns a different nonce than requested

	conn := model.IdPConnection{
		Provider: "test-oidc", Kind: model.IdPKindOIDC, Enabled: true,
		Issuer: idp.issuer, ClientID: "clario-rp",
		RedirectURL: "https://app/cb", Scopes: []string{"openid"},
	}
	prov, _ := NewOIDCProvider(conn, idp.server.Client())

	authReq := AuthRequest{State: "s", Nonce: "client-nonce", CodeVerifier: "v0123456789012345", RedirectURL: "https://app/cb"}
	_, err := prov.Exchange(context.Background(), authReq, CallbackParams{Code: "c", State: "s"})
	if err == nil {
		t.Fatalf("expected nonce mismatch error")
	}
}

// TestNafathProvider_IsOIDCVariant confirms a Nafath connection uses the OIDC
// client and reports the nafath kind.
func TestNafathProvider_IsOIDCVariant(t *testing.T) {
	idp := newMockIdP(t, "nafath-rp")
	defer idp.server.Close()

	conn := model.IdPConnection{
		Provider:    "nafath",
		Kind:        model.IdPKindNafath,
		Enabled:     true,
		Issuer:      idp.issuer,
		ClientID:    "nafath-rp",
		RedirectURL: "https://app/cb",
		Scopes:      []string{"openid", "profile"},
	}

	prov, err := NewProvider(conn, idp.server.Client())
	if err != nil {
		t.Fatalf("NewProvider(nafath): %v", err)
	}
	if prov.Kind() != model.IdPKindNafath {
		t.Fatalf("expected nafath kind, got %q", prov.Kind())
	}

	// And it must drive a real OIDC flow.
	authReq := AuthRequest{State: "s", Nonce: "n", CodeVerifier: "verifier-0123456789-0123456789", RedirectURL: "https://app/cb"}
	authURL, err := prov.AuthCodeURL(context.Background(), authReq)
	if err != nil {
		t.Fatalf("nafath AuthCodeURL: %v", err)
	}
	if authURL == "" {
		t.Fatalf("expected nafath authorization URL")
	}
	idp.setNonce("n")
	claims, err := prov.Exchange(context.Background(), authReq, CallbackParams{Code: "c", State: "s"})
	if err != nil {
		t.Fatalf("nafath Exchange: %v", err)
	}
	if claims.Subject == "" {
		t.Fatalf("expected nafath subject")
	}
}

// NOTE: SAML provider behavior (signed-assertion accept + tamper/expired/audience/
// signer/replay reject) is covered comprehensively in saml_test.go now that the
// provider performs real XML-DSig verification via gosaml2.
