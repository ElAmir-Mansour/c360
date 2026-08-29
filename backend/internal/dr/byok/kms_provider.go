package byok

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

// HTTPDoer is the minimal HTTP client surface the remote-custody provider needs
// (satisfied by *http.Client). An interface keeps the provider unit-testable
// against an httptest server or a stub transport without a live HSM/KMS.
type HTTPDoer interface {
	Do(req *http.Request) (*http.Response, error)
}

// RemoteKeyProviderConfig configures an HSM/cloud-KMS custody provider. The KEK
// never leaves the remote custodian: BYOK posts the DEK plaintext (over TLS) to
// the remote wrap endpoint and receives ciphertext back; unwrap is the inverse.
// This is the "interface boundary" path — the remote endpoint is not available
// in the test environment, so the SoftwareKeyProvider is the fully-tested
// implementation and this provider's request/response codec is the part exercised
// against an httptest stub.
type RemoteKeyProviderConfig struct {
	// Kind is ProviderHSM or ProviderKMS (used only for Provider()/labelling).
	Kind string
	// BaseURL is the custody endpoint root, e.g. https://kms.tenant.example/v1.
	// WrapDEK posts to BaseURL/wrap and UnwrapDEK to BaseURL/unwrap.
	BaseURL string
	// KeyRef is the remote key handle / ARN identifying the KEK version. It is
	// sent with every request so the custodian selects the correct key.
	KeyRef string
	// Version is the KEK version this provider instance represents.
	Version int
	// AuthHeader, when non-empty, is sent as the Authorization header value.
	AuthHeader string
	// Client performs the HTTP calls; defaults to a 30s-timeout *http.Client.
	Client HTTPDoer
}

// RemoteKeyProvider drives a tenant HSM / cloud KMS over HTTP to wrap and unwrap
// DEKs without the KEK material ever leaving the custodian. It satisfies the same
// KeyProvider interface as SoftwareKeyProvider, so the Service composes it
// identically; only the wrap/unwrap mechanism differs (remote vs. in-process AES).
type RemoteKeyProvider struct {
	cfg    RemoteKeyProviderConfig
	client HTTPDoer
}

// remoteWrapRequest is the body posted to the custody wrap endpoint.
type remoteWrapRequest struct {
	KeyRef    string `json:"key_ref"`
	Version   int    `json:"version"`
	Plaintext string `json:"plaintext"` // base64 DEK plaintext
}

// remoteWrapResponse is the custody wrap endpoint's reply.
type remoteWrapResponse struct {
	Ciphertext string `json:"ciphertext"` // base64 wrapped DEK (ciphertext+tag)
	Nonce      string `json:"nonce"`      // base64 nonce / IV the custodian used
}

// remoteUnwrapRequest is the body posted to the custody unwrap endpoint.
type remoteUnwrapRequest struct {
	KeyRef     string `json:"key_ref"`
	Version    int    `json:"version"`
	Ciphertext string `json:"ciphertext"` // base64 wrapped DEK
	Nonce      string `json:"nonce"`      // base64 nonce / IV
}

// remoteUnwrapResponse is the custody unwrap endpoint's reply.
type remoteUnwrapResponse struct {
	Plaintext string `json:"plaintext"` // base64 DEK plaintext
}

// NewRemoteKeyProvider constructs an HSM/KMS custody provider. It validates the
// configuration and applies a default HTTP client.
func NewRemoteKeyProvider(cfg RemoteKeyProviderConfig) (*RemoteKeyProvider, error) {
	if cfg.Kind != ProviderHSM && cfg.Kind != ProviderKMS {
		return nil, fmt.Errorf("%w: remote provider kind must be hsm|kms, got %q", ErrValidation, cfg.Kind)
	}
	if cfg.BaseURL == "" {
		return nil, fmt.Errorf("%w: remote provider BaseURL is required", ErrValidation)
	}
	if cfg.KeyRef == "" {
		return nil, fmt.Errorf("%w: remote provider KeyRef is required", ErrValidation)
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return &RemoteKeyProvider{cfg: cfg, client: client}, nil
}

// KeyVersion implements KeyProvider.
func (p *RemoteKeyProvider) KeyVersion() int { return p.cfg.Version }

// Provider implements KeyProvider.
func (p *RemoteKeyProvider) Provider() string { return p.cfg.Kind }

// WrapDEK posts the DEK plaintext to the custody wrap endpoint and returns the
// remote ciphertext and nonce. The DEK plaintext only transits to the custodian
// over the configured (TLS) endpoint and is not retained locally.
func (p *RemoteKeyProvider) WrapDEK(ctx context.Context, dek []byte) ([]byte, []byte, error) {
	if len(dek) == 0 {
		return nil, nil, fmt.Errorf("%w: DEK is empty", ErrValidation)
	}
	body, err := json.Marshal(remoteWrapRequest{
		KeyRef:    p.cfg.KeyRef,
		Version:   p.cfg.Version,
		Plaintext: base64.StdEncoding.EncodeToString(dek),
	})
	if err != nil {
		return nil, nil, fmt.Errorf("byok: marshaling wrap request: %w", err)
	}
	var out remoteWrapResponse
	if err := p.post(ctx, "/wrap", body, &out); err != nil {
		return nil, nil, err
	}
	wrapped, err := base64.StdEncoding.DecodeString(out.Ciphertext)
	if err != nil {
		return nil, nil, fmt.Errorf("byok: decoding remote ciphertext: %w", err)
	}
	nonce, err := base64.StdEncoding.DecodeString(out.Nonce)
	if err != nil {
		return nil, nil, fmt.Errorf("byok: decoding remote nonce: %w", err)
	}
	return wrapped, nonce, nil
}

// UnwrapDEK posts the wrapped DEK to the custody unwrap endpoint and returns the
// DEK plaintext. A non-2xx response (e.g. the custodian rejecting a tampered
// ciphertext or wrong key version) is surfaced as ErrUnwrap.
func (p *RemoteKeyProvider) UnwrapDEK(ctx context.Context, wrapped, nonce []byte) ([]byte, error) {
	body, err := json.Marshal(remoteUnwrapRequest{
		KeyRef:     p.cfg.KeyRef,
		Version:    p.cfg.Version,
		Ciphertext: base64.StdEncoding.EncodeToString(wrapped),
		Nonce:      base64.StdEncoding.EncodeToString(nonce),
	})
	if err != nil {
		return nil, fmt.Errorf("byok: marshaling unwrap request: %w", err)
	}
	var out remoteUnwrapResponse
	if err := p.post(ctx, "/unwrap", body, &out); err != nil {
		return nil, err
	}
	dek, err := base64.StdEncoding.DecodeString(out.Plaintext)
	if err != nil {
		return nil, fmt.Errorf("%w: decoding remote plaintext: %v", ErrUnwrap, err)
	}
	if len(dek) == 0 {
		return nil, fmt.Errorf("%w: remote returned empty plaintext", ErrUnwrap)
	}
	return dek, nil
}

// Rotate returns a successor RemoteKeyProvider pointing at the next remote key
// version. The remote custodian is responsible for materializing the new key
// version behind KeyRef; BYOK only advances the version it presents.
func (p *RemoteKeyProvider) Rotate(_ context.Context, newVersion int) (KeyProvider, error) {
	if newVersion <= p.cfg.Version {
		return nil, fmt.Errorf("%w: new version %d must exceed current %d", ErrValidation, newVersion, p.cfg.Version)
	}
	cfg := p.cfg
	cfg.Version = newVersion
	return NewRemoteKeyProvider(cfg)
}

// post performs a JSON POST to BaseURL+path, decodes a 2xx JSON body into out,
// and maps a non-2xx response to ErrUnwrap (for unwrap) or a wrapped error.
func (p *RemoteKeyProvider) post(ctx context.Context, path string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.cfg.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("byok: building remote request %s: %w", path, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Content-Length", strconv.Itoa(len(body)))
	if p.cfg.AuthHeader != "" {
		req.Header.Set("Authorization", p.cfg.AuthHeader)
	}
	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("byok: remote custody call %s: %w", path, err)
	}
	defer func() { _ = resp.Body.Close() }()

	payload, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("byok: reading remote response %s: %w", path, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// The custodian rejected the operation (e.g. tampered ciphertext, wrong
		// key version, auth failure). For an unwrap this is the authentication
		// failure the GCM tag enforces in the software provider.
		if path == "/unwrap" {
			return fmt.Errorf("%w: remote custody returned %d: %s", ErrUnwrap, resp.StatusCode, string(payload))
		}
		return fmt.Errorf("byok: remote custody %s returned %d: %s", path, resp.StatusCode, string(payload))
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("byok: decoding remote response %s: %w", path, err)
	}
	return nil
}

var _ KeyProvider = (*RemoteKeyProvider)(nil)
