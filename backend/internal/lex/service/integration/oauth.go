package integration

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// OAuth2 client-credentials token cache, keyed per (tenant, endpoint, client_id,
// token_url). Connectors that authenticate via the OAuth2 client-credentials
// grant (najiz, nafath_verify, OIDC SSO, some HRIS) share this cache so a token
// is minted once and reused until shortly before expiry, rather than on every
// call. Secrets are held only in memory and never logged.

// OAuthConfig parametrises a client-credentials token request. The caller
// extracts these from the endpoint's DECRYPTED config (resolved via the repo).
type OAuthConfig struct {
	// CacheKey uniquely identifies the credential set so cached tokens are not
	// shared across tenants/endpoints. Callers should build it from tenant id +
	// endpoint id (+ client id).
	CacheKey string
	// TokenURL is the OAuth2 token endpoint.
	TokenURL string
	// ClientID / ClientSecret are the client-credentials. ClientSecret is never
	// logged.
	ClientID     string
	ClientSecret string
	// Scope is the optional space-delimited scope set.
	Scope string
	// Audience is an optional audience parameter (some IdPs require it).
	Audience string
	// UseBasicAuth sends the client credentials via HTTP Basic instead of the
	// request body (RFC 6749 §2.3.1); defaults to body params.
	UseBasicAuth bool
}

// cachedToken is an in-memory access token with its computed expiry.
type cachedToken struct {
	accessToken string
	expiresAt   time.Time
}

// OAuthTokenCache mints and caches client-credentials access tokens. It is safe
// for concurrent use.
type OAuthTokenCache struct {
	client *http.Client
	now    func() time.Time
	// skew is subtracted from the upstream expires_in so a token is refreshed
	// before it actually lapses.
	skew time.Duration

	mu     sync.Mutex
	tokens map[string]cachedToken
}

// NewOAuthTokenCache builds a token cache. A nil client defaults to a 15s-timeout
// client; skew defaults to 30s.
func NewOAuthTokenCache(client *http.Client, skew time.Duration) *OAuthTokenCache {
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	if skew <= 0 {
		skew = 30 * time.Second
	}
	return &OAuthTokenCache{
		client: client,
		now:    time.Now,
		skew:   skew,
		tokens: map[string]cachedToken{},
	}
}

// Token returns a valid access token for cfg, minting a fresh one when the cache
// is empty or the cached token is within the skew window of expiry.
func (c *OAuthTokenCache) Token(ctx context.Context, cfg OAuthConfig) (string, error) {
	if strings.TrimSpace(cfg.TokenURL) == "" {
		return "", fmt.Errorf("lex/integration: oauth token_url is required")
	}
	key := cfg.CacheKey
	if key == "" {
		key = cfg.TokenURL + "|" + cfg.ClientID
	}

	c.mu.Lock()
	if tok, ok := c.tokens[key]; ok && c.now().Before(tok.expiresAt) {
		c.mu.Unlock()
		return tok.accessToken, nil
	}
	c.mu.Unlock()

	tok, err := c.fetch(ctx, cfg)
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	c.tokens[key] = tok
	c.mu.Unlock()
	return tok.accessToken, nil
}

// Invalidate drops any cached token for the given cache key (e.g. after a 401),
// forcing the next Token call to re-mint.
func (c *OAuthTokenCache) Invalidate(cacheKey string) {
	c.mu.Lock()
	delete(c.tokens, cacheKey)
	c.mu.Unlock()
}

type oauthTokenResponse struct {
	AccessToken string `json:"access_token"`
	TokenType   string `json:"token_type"`
	ExpiresIn   int64  `json:"expires_in"`
	Error       string `json:"error"`
	ErrorDesc   string `json:"error_description"`
}

func (c *OAuthTokenCache) fetch(ctx context.Context, cfg OAuthConfig) (cachedToken, error) {
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	if cfg.Scope != "" {
		form.Set("scope", cfg.Scope)
	}
	if cfg.Audience != "" {
		form.Set("audience", cfg.Audience)
	}
	if !cfg.UseBasicAuth {
		form.Set("client_id", cfg.ClientID)
		form.Set("client_secret", cfg.ClientSecret)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return cachedToken{}, fmt.Errorf("lex/integration: build token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	if cfg.UseBasicAuth {
		req.SetBasicAuth(cfg.ClientID, cfg.ClientSecret)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return cachedToken{}, fmt.Errorf("lex/integration: token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return cachedToken{}, fmt.Errorf("lex/integration: read token response: %w", err)
	}

	var tr oauthTokenResponse
	if len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &tr); err != nil {
			return cachedToken{}, fmt.Errorf("lex/integration: decode token response: %w", err)
		}
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Surface the upstream error label but NOT any credential material.
		detail := strings.TrimSpace(tr.Error)
		if tr.ErrorDesc != "" {
			detail = strings.TrimSpace(tr.Error + ": " + tr.ErrorDesc)
		}
		if detail == "" {
			detail = fmt.Sprintf("status %d", resp.StatusCode)
		}
		return cachedToken{}, fmt.Errorf("lex/integration: token endpoint rejected client-credentials: %s", detail)
	}
	if strings.TrimSpace(tr.AccessToken) == "" {
		return cachedToken{}, fmt.Errorf("lex/integration: token endpoint returned no access_token")
	}

	ttl := time.Duration(tr.ExpiresIn) * time.Second
	if ttl <= 0 {
		ttl = 5 * time.Minute // conservative default when the IdP omits expires_in
	}
	expiresAt := c.now().Add(ttl - c.skew)
	if !expiresAt.After(c.now()) {
		// ttl shorter than skew: keep a tiny positive window.
		expiresAt = c.now().Add(ttl / 2)
	}
	return cachedToken{accessToken: tr.AccessToken, expiresAt: expiresAt}, nil
}
