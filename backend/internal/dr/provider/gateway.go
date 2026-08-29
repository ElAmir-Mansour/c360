package provider

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

const (
	settingGatewayURL   = "gateway_url"
	settingEnsurePath   = "ensure_path"
	settingTeardownPath = "teardown_path"
	settingAPIToken     = "api_token"
	settingBearerToken  = "bearer_token"
	settingToken        = "token"
)

// Transit tuning for the outbound gateway client (Wave 3 vendor transit
// hardening). Recovery calls are low-frequency and idempotent, so retries are
// bounded and short — enough to ride out a transient blip without ever risking
// a double-execute (the Idempotency-Key makes a retry safe).
const (
	gatewayRequestTimeout = 2 * time.Minute
	gatewayMaxAttempts    = 4 // 1 initial + 3 retries
	gatewayBaseBackoff    = 250 * time.Millisecond
	gatewayMaxBackoff     = 5 * time.Second
	gatewayMaxRespBytes   = 4 << 20 // 4 MiB cap on gateway response bodies
)

// GatewaySpec describes a live provider adapter that delegates the vendor SDK
// operation to a deployment-owned provider gateway. The gateway is where heavy
// vendor SDKs and regulated-network access live; this binary sends a signed,
// idempotent operation envelope and fails closed when that gateway is absent.
type GatewaySpec struct {
	Kind           string
	DisplayName    string
	RequiredConfig []string
	Notes          []string
}

// GatewayAdapter is the production seam for providers whose certified restore
// path is implemented by an environment-specific gateway backed by the vendor SDK
// (for example vSphere/govmomi, AWS/Azure/GCP SDKs, or NetApp ONTAP tooling).
//
// Transport is hardened once at construction: TLS >= 1.2 with a pinned CA
// bundle, optional mTLS client identity, InsecureSkipVerify=false, and bounded
// dialer/response timeouts. Every request carries a DETACHED signature over the
// canonical body plus a stable Idempotency-Key, and transient failures are
// retried with capped exponential backoff + jitter.
type GatewayAdapter struct {
	cfg    Config
	spec   GatewaySpec
	client *http.Client
	signer *envelopeSigner // nil when no signing key is configured
}

// NewGatewayAdapter builds the adapter and its ONE hardened HTTP client. It
// fails closed when the CA bundle, mTLS client pair, min-TLS floor, or signing
// key PEM is malformed so a mis-configured deployment never gets a degraded
// (unpinned/unsigned) client.
func NewGatewayAdapter(cfg Config, spec GatewaySpec) (*GatewayAdapter, error) {
	cfg.Kind = normalizeKind(firstNonEmpty(cfg.Kind, spec.Kind))

	client, err := newHardenedClient(cfg, gatewayRequestTimeout)
	if err != nil {
		return nil, fmt.Errorf("%s provider gateway transport: %w", cfg.Kind, err)
	}

	var signer *envelopeSigner
	if strings.TrimSpace(cfg.SigningKeyPEM) != "" {
		signer, err = newEnvelopeSigner(cfg.SigningKeyPEM, cfg.SigningKeyID)
		if err != nil {
			return nil, fmt.Errorf("%s provider gateway signer: %w", cfg.Kind, err)
		}
	}

	return &GatewayAdapter{
		cfg:    cfg,
		spec:   spec,
		client: client,
		signer: signer,
	}, nil
}

func (a *GatewayAdapter) Capabilities() Capabilities {
	notes := append([]string(nil), a.spec.Notes...)
	if len(notes) == 0 {
		notes = []string{"executes live recovery through a configured provider gateway"}
	}
	return Capabilities{
		Kind:                normalizeKind(firstNonEmpty(a.spec.Kind, a.cfg.Kind)),
		DisplayName:         firstNonEmpty(a.spec.DisplayName, a.spec.Kind, a.cfg.Kind),
		Live:                true,
		SDKBacked:           true,
		SupportsEnsure:      true,
		SupportsTeardown:    true,
		SupportsDrill:       true,
		SupportsIdempotency: true,
		RegulatedCompatible: true,
		RequiredConfig:      append([]string(nil), a.spec.RequiredConfig...),
		Notes:               notes,
	}
}

// SignerPublicKeyPEM exposes the detached-signature verification key (SPKI PEM)
// so a receiver/auditor can be provisioned with it. Empty string + nil when no
// signing key is configured.
func (a *GatewayAdapter) SignerPublicKeyPEM() (string, error) {
	if a.signer == nil {
		return "", nil
	}
	return a.signer.publicKeyPEM()
}

func (a *GatewayAdapter) Validate(cfg Config) error {
	if cfg.Kind == "" {
		cfg.Kind = a.cfg.Kind
	}
	if err := missingRequired(cfg, a.spec.RequiredConfig...); err != nil {
		return err
	}
	base := gatewayBaseURL(cfg)
	if strings.TrimSpace(base) == "" {
		return fmt.Errorf("%w: %s provider gateway endpoint is required", ErrNotConfigured, a.Capabilities().Kind)
	}
	// HTTPS-only: reject a plaintext gateway endpoint fail-closed.
	if err := requireHTTPS(base); err != nil {
		return fmt.Errorf("%s provider gateway endpoint: %w", a.Capabilities().Kind, err)
	}
	// Any explicit per-operation path overrides that are absolute URLs must also
	// be https (a relative path resolves against the https base, which is safe).
	for _, setting := range []string{settingEnsurePath, settingTeardownPath} {
		if cfg.Settings == nil {
			break
		}
		v := strings.TrimSpace(cfg.Settings[setting])
		if v == "" {
			continue
		}
		if strings.Contains(v, "://") {
			if err := requireHTTPS(v); err != nil {
				return fmt.Errorf("%s provider gateway %s: %w", a.Capabilities().Kind, setting, err)
			}
		}
	}
	return nil
}

func (a *GatewayAdapter) Ensure(ctx context.Context, req EnsureRequest) (EnsureResult, error) {
	if err := a.Validate(a.cfg); err != nil {
		return EnsureResult{}, err
	}
	endpoint, err := gatewayPath(a.cfg, settingEnsurePath, "/api/v1/dr/provider/ensure")
	if err != nil {
		return EnsureResult{}, err
	}
	var result EnsureResult
	if err := a.post(ctx, endpoint, "ensure", req, &result); err != nil {
		return EnsureResult{}, err
	}
	if strings.TrimSpace(result.ExternalID) == "" {
		return EnsureResult{}, fmt.Errorf("%w: %s provider gateway returned no external_id", ErrNotConfigured, a.Capabilities().Kind)
	}
	return result, nil
}

func (a *GatewayAdapter) Teardown(ctx context.Context, req TeardownRequest) error {
	if err := a.Validate(a.cfg); err != nil {
		return err
	}
	endpoint, err := gatewayPath(a.cfg, settingTeardownPath, "/api/v1/dr/provider/teardown")
	if err != nil {
		return err
	}
	return a.post(ctx, endpoint, "teardown", req, nil)
}

// post marshals the canonical envelope, derives a stable Idempotency-Key, signs
// the body with a detached signature, and sends it with bounded retries. A
// retry reuses the SAME idempotency key + envelope, so re-sending a transient
// failure can never double-execute.
func (a *GatewayAdapter) post(ctx context.Context, endpoint, operation string, body any, out any) error {
	// HTTPS-only defence in depth: never let a mutated setting slip a plaintext
	// URL past Validate.
	if err := requireHTTPS(endpoint); err != nil {
		return err
	}

	payload := map[string]any{
		"provider":       a.Capabilities().Kind,
		"operation":      operation,
		"credential_ref": a.cfg.CredentialRef,
		"config": map[string]any{
			"region":         a.cfg.Region,
			"project":        a.cfg.Project,
			"cluster":        a.cfg.Cluster,
			"datacenter":     a.cfg.Datacenter,
			"resource_group": a.cfg.ResourceGroup,
			"storage_vm":     a.cfg.StorageVM,
		},
		"request": body,
	}
	// Deterministic marshal (encoding/json sorts map keys), so the canonical
	// body — and therefore the idempotency key and the signature — are stable
	// across retries of the same logical operation.
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	idempotencyKey := deriveIdempotencyKey(a.Capabilities().Kind, operation, raw)

	// Sign the canonical body once; retries carry the identical headers.
	timestamp := time.Now().UTC().Format(time.RFC3339Nano)
	nonce, err := randomNonce()
	if err != nil {
		return err
	}
	var sigB64, sigAlg, sigKeyID string
	if a.signer != nil {
		sigB64, sigAlg, sigKeyID, err = a.signer.sign(raw, timestamp, nonce)
		if err != nil {
			return err
		}
	}

	var lastErr error
	for attempt := 0; attempt < gatewayMaxAttempts; attempt++ {
		if attempt > 0 {
			if err := sleepBackoff(ctx, attempt); err != nil {
				return err
			}
		}

		httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(raw))
		if err != nil {
			return err
		}
		httpReq.Header.Set("Content-Type", "application/json")
		httpReq.Header.Set("Accept", "application/json")
		httpReq.Header.Set("X-Clario-Provider", a.Capabilities().Kind)
		httpReq.Header.Set(HeaderIdempotencyKey, idempotencyKey)
		if a.cfg.CredentialRef != "" {
			httpReq.Header.Set("X-Clario-Credential-Ref", a.cfg.CredentialRef)
		}
		if token := gatewayToken(a.cfg); token != "" {
			httpReq.Header.Set("Authorization", "Bearer "+token)
		}
		if a.signer != nil {
			httpReq.Header.Set(HeaderSignature, sigB64)
			httpReq.Header.Set(HeaderSignatureAlg, sigAlg)
			httpReq.Header.Set(HeaderTimestamp, timestamp)
			httpReq.Header.Set(HeaderNonce, nonce)
			if sigKeyID != "" {
				httpReq.Header.Set(HeaderSignatureKeyID, sigKeyID)
			}
		}

		resp, err := a.client.Do(httpReq)
		if err != nil {
			// Network/transport error: transient. Respect the ctx deadline.
			lastErr = err
			if ctx.Err() != nil {
				return ctx.Err()
			}
			continue
		}

		// Definitive 4xx: never retry (retrying would just re-hit the same
		// rejection) EXCEPT 429, which is explicitly transient.
		if resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500 {
			drainAndClose(resp.Body)
			lastErr = fmt.Errorf("%s provider gateway %s failed: http %d", a.Capabilities().Kind, operation, resp.StatusCode)
			continue
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			drainAndClose(resp.Body)
			return fmt.Errorf("%s provider gateway %s failed: http %d", a.Capabilities().Kind, operation, resp.StatusCode)
		}

		// 2xx success.
		err = decodeGatewayResponse(resp, out)
		resp.Body.Close()
		return err
	}

	if lastErr == nil {
		lastErr = fmt.Errorf("%s provider gateway %s failed after %d attempts", a.Capabilities().Kind, operation, gatewayMaxAttempts)
	}
	return fmt.Errorf("%s provider gateway %s exhausted %d attempts: %w", a.Capabilities().Kind, operation, gatewayMaxAttempts, lastErr)
}

// decodeGatewayResponse reads a length-capped response body and unwraps the
// optional {"data": …} envelope.
func decodeGatewayResponse(resp *http.Response, out any) error {
	if out == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	rawBody, err := io.ReadAll(io.LimitReader(resp.Body, gatewayMaxRespBytes))
	if err != nil {
		return err
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(rawBody, &envelope); err == nil && len(envelope.Data) > 0 {
		return json.Unmarshal(envelope.Data, out)
	}
	return json.Unmarshal(rawBody, out)
}

func drainAndClose(body io.ReadCloser) {
	_, _ = io.Copy(io.Discard, io.LimitReader(body, gatewayMaxRespBytes))
	_ = body.Close()
}

// deriveIdempotencyKey produces a stable key for a logical operation: identical
// across retries of the SAME provider+operation+canonical body, and distinct for
// any different operation or payload. sha256 keeps it fixed-length and opaque.
func deriveIdempotencyKey(provider, operation string, canonicalBody []byte) string {
	h := sha256.New()
	h.Write([]byte(provider))
	h.Write([]byte{0})
	h.Write([]byte(operation))
	h.Write([]byte{0})
	h.Write(canonicalBody)
	return "dr-" + hex.EncodeToString(h.Sum(nil))
}

// sleepBackoff waits capped exponential backoff with full jitter before the
// given (1-based) retry attempt, honouring the context deadline.
func sleepBackoff(ctx context.Context, attempt int) error {
	// attempt starts at 1 for the first retry.
	backoff := float64(gatewayBaseBackoff) * math.Pow(2, float64(attempt-1))
	if backoff > float64(gatewayMaxBackoff) {
		backoff = float64(gatewayMaxBackoff)
	}
	// Full jitter in [0, backoff].
	jittered := time.Duration(backoff)
	if backoff > 0 {
		if n, err := rand.Int(rand.Reader, big.NewInt(int64(backoff))); err == nil {
			jittered = time.Duration(n.Int64())
		}
	}
	timer := time.NewTimer(jittered)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func randomNonce() (string, error) {
	buf := make([]byte, 16)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("dr provider gateway: nonce: %w", err)
	}
	return hex.EncodeToString(buf), nil
}

func gatewayBaseURL(cfg Config) string {
	if cfg.Settings != nil {
		if v := strings.TrimSpace(cfg.Settings[settingGatewayURL]); v != "" {
			return v
		}
	}
	return strings.TrimSpace(cfg.Endpoint)
}

// gatewayPath resolves the absolute request URL for an operation. It rejects a
// plaintext http:// base or absolute-path override fail-closed so no request can
// ever leave over plaintext.
func gatewayPath(cfg Config, setting, fallback string) (string, error) {
	base := gatewayBaseURL(cfg)
	if err := requireHTTPS(base); err != nil {
		return "", err
	}
	pathPart := fallback
	if cfg.Settings != nil {
		if v := strings.TrimSpace(cfg.Settings[setting]); v != "" {
			pathPart = v
		}
	}
	// An absolute-URL override must itself be https.
	if strings.Contains(pathPart, "://") {
		if err := requireHTTPS(pathPart); err != nil {
			return "", err
		}
		return pathPart, nil
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("%w: malformed gateway base %q: %v", ErrNotConfigured, redactURL(base), err)
	}
	parsed.Path = path.Join(parsed.Path, pathPart)
	resolved := parsed.String()
	// Defence in depth: the joined URL must still be https.
	if err := requireHTTPS(resolved); err != nil {
		return "", err
	}
	return resolved, nil
}

func gatewayToken(cfg Config) string {
	if cfg.Settings == nil {
		return ""
	}
	for _, key := range []string{settingBearerToken, settingAPIToken, settingToken} {
		if v := strings.TrimSpace(cfg.Settings[key]); v != "" {
			return v
		}
	}
	return ""
}
