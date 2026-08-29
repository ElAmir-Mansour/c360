package vault

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strings"
	"sync"
	"time"

	vaultapi "github.com/hashicorp/vault/api"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// Client is the platform's single Vault entry point. NO other package
// constructs vault/api clients directly; a contract test enforces this.
type Client interface {
	// EnsureTransitKey idempotently creates a Transit KEK of type
	// aes256-gcm96. Re-running with an existing key is a no-op.
	EnsureTransitKey(ctx context.Context, keyName string) error

	// GenerateDataKey returns a fresh 32-byte DEK plus the Vault-wrapped
	// envelope to persist. The caller MUST zero DataKey.Plaintext as soon
	// as the per-field AES-GCM operation completes.
	GenerateDataKey(ctx context.Context, keyName string) (DataKey, error)

	// Decrypt unwraps a previously stored ciphertext envelope back to the
	// plaintext DEK. The envelope bytes must be exactly what
	// GenerateDataKey produced.
	Decrypt(ctx context.Context, keyName string, ciphertextEnvelope []byte) (plaintextDEK []byte, err error)

	// Health probes /v1/sys/health and returns nil only when the node is
	// active and unsealed.
	Health(ctx context.Context) error

	// EnsurePKIMount idempotently mounts the PKI secrets engine at mountPath
	// with the given default and max TTL. No-op if already mounted.
	EnsurePKIMount(ctx context.Context, mountPath string, defaultTTL, maxTTL time.Duration) error

	// GenerateRootCA generates an internal root CA at mountPath. Idempotent
	// (returns the existing CA cert PEM if already generated). Common name
	// is e.g. "Clario360 SIEM Root CA".
	GenerateRootCA(ctx context.Context, mountPath, commonName string, ttl time.Duration) (caCertPEM string, err error)

	// EnsureIntermediate idempotently creates an intermediate CA at intermediateMount,
	// signs its CSR with rootMount, and uploads the signed cert back. Returns
	// the intermediate cert PEM (chained: leaf || root).
	EnsureIntermediate(ctx context.Context, rootMount, intermediateMount, commonName string, ttl time.Duration) (intermediateCertPEM string, err error)

	// EnsurePKIRole idempotently creates/updates a role for issuing leaf certs.
	// Settings include allowed_domains, key_type, max_ttl, client_flag etc.
	EnsurePKIRole(ctx context.Context, mountPath, roleName string, settings PKIRoleSettings) error

	// IssueLeaf signs the given CSR against the role and returns the leaf cert,
	// CA chain, and serial. The private key NEVER traverses this service (CSR flow).
	IssueLeaf(ctx context.Context, mountPath, roleName, csrPEM, commonName string, ttl time.Duration) (LeafCert, error)

	// RevokeLeaf revokes a leaf by serial. Idempotent (revoking an already-revoked
	// cert succeeds silently).
	RevokeLeaf(ctx context.Context, mountPath, serial string) error

	// Close releases any resources held by the underlying transport.
	Close() error
}

// DataKey holds the result of GenerateDataKey.
type DataKey struct {
	// Plaintext is the freshly generated DEK (32 bytes for aes256-gcm96).
	// Callers MUST zero this slice after use.
	Plaintext []byte
	// Ciphertext is the opaque envelope to persist. It is the raw bytes of
	// Vault's "vault:vN:<base64>" form encoded as UTF-8.
	Ciphertext []byte
	// KEKVersion is the Vault key version embedded in the envelope.
	KEKVersion int
}

// transitOp is used only for span tags / log fields.
type transitOp string

const (
	opEnsureKey   transitOp = "ensure_transit_key"
	opGenerateKey transitOp = "generate_data_key"
	opDecrypt     transitOp = "decrypt"
	opHealth      transitOp = "health"
)

// tracerName is the OTEL tracer used by this package.
const tracerName = "github.com/clario360/platform/internal/vault"

// New returns the package tracer; exported for tests that want to attach an
// in-memory exporter.
func tracer() trace.Tracer { return otel.Tracer(tracerName) }

// httpClient is the minimal HTTP surface used internally for sys/health.
type httpClient interface {
	Do(req *http.Request) (*http.Response, error)
}

// vaultClient is the concrete Client implementation backed by vault/api.
type vaultClient struct {
	cfg     Config
	api     *vaultapi.Client
	http    httpClient
	authMtx sync.Mutex // serializes re-auth (approle) within a single client
}

// NewClient constructs a Client from cfg. The returned Client owns the
// underlying *vault/api.Client and is safe for concurrent use.
func NewClient(ctx context.Context, cfg Config) (Client, error) {
	cfg = cfg.WithDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	apiCfg := vaultapi.DefaultConfig()
	apiCfg.Address = cfg.Addr
	apiCfg.Timeout = cfg.Timeout
	// We do our own retry policy below; disable vault/api's built-in retries
	// so behaviour is deterministic.
	apiCfg.MaxRetries = 0
	if cfg.TLSCACert != "" {
		if err := apiCfg.ConfigureTLS(&vaultapi.TLSConfig{CACert: cfg.TLSCACert}); err != nil {
			return nil, fmt.Errorf("vault: configure TLS: %w", err)
		}
	}

	api, err := vaultapi.NewClient(apiCfg)
	if err != nil {
		return nil, fmt.Errorf("vault: new client: %w", err)
	}
	if cfg.Namespace != "" {
		api.SetNamespace(cfg.Namespace)
	}

	c := &vaultClient{
		cfg:  cfg,
		api:  api,
		http: apiCfg.HttpClient,
	}
	if c.http == nil {
		c.http = http.DefaultClient
	}

	if err := c.authenticate(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

// authenticate populates the underlying vault/api client with a token
// according to cfg.AuthMethod.
func (c *vaultClient) authenticate(ctx context.Context) error {
	c.authMtx.Lock()
	defer c.authMtx.Unlock()

	switch c.cfg.AuthMethod {
	case AuthMethodToken:
		if c.cfg.Token == "" {
			return fmt.Errorf("vault: empty token: %w", ErrAuthFailed)
		}
		c.api.SetToken(c.cfg.Token)
		return nil

	case AuthMethodAppRole:
		callCtx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
		defer cancel()
		secret, err := c.api.Logical().WriteWithContext(callCtx, "auth/approle/login", map[string]interface{}{
			"role_id":   c.cfg.AppRoleRoleID,
			"secret_id": c.cfg.AppRoleSecretID,
		})
		if err != nil {
			return fmt.Errorf("vault: approle login: %w", classifyError(err))
		}
		if secret == nil || secret.Auth == nil || secret.Auth.ClientToken == "" {
			return fmt.Errorf("vault: empty approle response: %w", ErrAuthFailed)
		}
		c.api.SetToken(secret.Auth.ClientToken)
		return nil

	default:
		return fmt.Errorf("vault: unsupported auth method %q: %w", c.cfg.AuthMethod, ErrAuthFailed)
	}
}

// transitKeyPath returns the absolute Logical path for a Transit key.
func (c *vaultClient) transitKeyPath(keyName string) string {
	return path.Join(strings.TrimSuffix(c.cfg.TransitPath, "/"), "keys", keyName)
}

func (c *vaultClient) transitOpPath(op, keyName string) string {
	return path.Join(strings.TrimSuffix(c.cfg.TransitPath, "/"), op, keyName)
}

// EnsureTransitKey idempotently provisions a KEK. Read-then-create: if the
// key exists, success; on 404 create it; on subsequent errors propagate.
func (c *vaultClient) EnsureTransitKey(ctx context.Context, keyName string) error {
	if keyName == "" {
		return fmt.Errorf("vault: key name is required")
	}
	ctx, span := c.startSpan(ctx, opEnsureKey, keyName)
	defer span.End()

	keyPath := c.transitKeyPath(keyName)

	// Read first. Note: vault/api treats HTTP 404 on a Read as a successful
	// "no secret here" — it returns (nil, nil), NOT an error. So absence is
	// signalled by secret==nil, not by an ErrKeyNotFound from classifyError.
	secret, err := c.doRead(ctx, keyPath)
	switch {
	case err == nil && secret != nil:
		return nil
	case err == nil && secret == nil:
		// fall through to create
	case errors.Is(err, ErrKeyNotFound):
		// fall through to create
	default:
		return fmt.Errorf("vault: read transit key %q: %w", keyName, err)
	}

	// Create.
	_, err = c.doWrite(ctx, keyPath, map[string]interface{}{
		"type":                   "aes256-gcm96",
		"exportable":             false,
		"allow_plaintext_backup": false,
	})
	if err != nil {
		// Concurrent creator may have produced 400 "key already exists";
		// re-read once and treat success as idempotent.
		if s, readErr := c.doRead(ctx, keyPath); readErr == nil && s != nil {
			return nil
		}
		return fmt.Errorf("vault: create transit key %q: %w", keyName, err)
	}
	return nil
}

// GenerateDataKey calls transit/datakey/plaintext/<keyName>.
func (c *vaultClient) GenerateDataKey(ctx context.Context, keyName string) (DataKey, error) {
	if keyName == "" {
		return DataKey{}, fmt.Errorf("vault: key name is required")
	}
	ctx, span := c.startSpan(ctx, opGenerateKey, keyName)
	defer span.End()

	secret, err := c.doWrite(ctx, c.transitOpPath("datakey/plaintext", keyName), map[string]interface{}{
		"bits": 256,
	})
	if err != nil {
		return DataKey{}, fmt.Errorf("vault: generate data key %q: %w", keyName, err)
	}
	if secret == nil || secret.Data == nil {
		return DataKey{}, fmt.Errorf("vault: empty datakey response: %w", ErrTransitDenied)
	}

	plaintextB64, _ := secret.Data["plaintext"].(string)
	ciphertext, _ := secret.Data["ciphertext"].(string)
	if plaintextB64 == "" || ciphertext == "" {
		return DataKey{}, fmt.Errorf("vault: malformed datakey response: %w", ErrTransitDenied)
	}

	plaintext, err := base64.StdEncoding.DecodeString(plaintextB64)
	if err != nil {
		return DataKey{}, fmt.Errorf("vault: decode plaintext DEK: %w", ErrEnvelopeInvalid)
	}

	ver, err := parseEnvelopeVersion(ciphertext)
	if err != nil {
		return DataKey{}, err
	}

	c.debugSafe(opGenerateKey, keyName, ver)

	return DataKey{
		Plaintext:  plaintext,
		Ciphertext: []byte(ciphertext),
		KEKVersion: ver,
	}, nil
}

// Decrypt calls transit/decrypt/<keyName>.
func (c *vaultClient) Decrypt(ctx context.Context, keyName string, envelope []byte) ([]byte, error) {
	if keyName == "" {
		return nil, fmt.Errorf("vault: key name is required")
	}
	if _, err := parseEnvelopeVersion(string(envelope)); err != nil {
		return nil, err
	}
	ctx, span := c.startSpan(ctx, opDecrypt, keyName)
	defer span.End()

	secret, err := c.doWrite(ctx, c.transitOpPath("decrypt", keyName), map[string]interface{}{
		"ciphertext": string(envelope),
	})
	if err != nil {
		return nil, fmt.Errorf("vault: decrypt %q: %w", keyName, err)
	}
	if secret == nil || secret.Data == nil {
		return nil, fmt.Errorf("vault: empty decrypt response: %w", ErrTransitDenied)
	}
	plaintextB64, _ := secret.Data["plaintext"].(string)
	if plaintextB64 == "" {
		return nil, fmt.Errorf("vault: empty plaintext: %w", ErrTransitDenied)
	}
	plaintext, err := base64.StdEncoding.DecodeString(plaintextB64)
	if err != nil {
		return nil, fmt.Errorf("vault: decode plaintext DEK: %w", ErrEnvelopeInvalid)
	}
	return plaintext, nil
}

// Health probes /v1/sys/health.
func (c *vaultClient) Health(ctx context.Context) error {
	ctx, span := c.startSpan(ctx, opHealth, "")
	defer span.End()

	callCtx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(callCtx, http.MethodGet,
		strings.TrimSuffix(c.cfg.Addr, "/")+"/v1/sys/health?standbyok=true&sealedcode=503&standbycode=429", nil)
	if err != nil {
		return fmt.Errorf("vault: health build request: %w", err)
	}
	if c.cfg.Namespace != "" {
		req.Header.Set("X-Vault-Namespace", c.cfg.Namespace)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("vault: health request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, resp.Body)

	switch resp.StatusCode {
	case http.StatusOK:
		return nil
	case http.StatusTooManyRequests:
		return ErrStandby
	case http.StatusServiceUnavailable:
		return ErrVaultSealed
	default:
		return fmt.Errorf("vault: health status %d: %w", resp.StatusCode, ErrTransitDenied)
	}
}

func (c *vaultClient) Close() error { return nil }

// ---- internals ----

// doRead reads a Logical path with retries + timeout + 404→ErrKeyNotFound.
func (c *vaultClient) doRead(ctx context.Context, p string) (*vaultapi.Secret, error) {
	var (
		secret *vaultapi.Secret
		err    error
	)
	err = c.retry(ctx, func(callCtx context.Context) error {
		secret, err = c.api.Logical().ReadWithContext(callCtx, p)
		return classifyError(err)
	})
	return secret, err
}

// doWrite writes a Logical path with retries + timeout.
func (c *vaultClient) doWrite(ctx context.Context, p string, data map[string]interface{}) (*vaultapi.Secret, error) {
	var (
		secret *vaultapi.Secret
		err    error
	)
	err = c.retry(ctx, func(callCtx context.Context) error {
		secret, err = c.api.Logical().WriteWithContext(callCtx, p, data)
		return classifyError(err)
	})
	return secret, err
}

// retry runs fn with retries: 3 attempts, backoff 50ms, 200ms, 800ms.
// Retries ONLY on HTTP 503 and network errors; never on 4xx.
func (c *vaultClient) retry(ctx context.Context, fn func(context.Context) error) error {
	backoffs := []time.Duration{50 * time.Millisecond, 200 * time.Millisecond, 800 * time.Millisecond}
	var lastErr error
	for attempt := 0; attempt < len(backoffs); attempt++ {
		callCtx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
		err := fn(callCtx)
		cancel()
		if err == nil {
			return nil
		}
		lastErr = err
		if !isRetryable(err) {
			return err
		}
		// Don't sleep after the last attempt.
		if attempt == len(backoffs)-1 {
			break
		}
		select {
		case <-time.After(backoffs[attempt]):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	return lastErr
}

// isRetryable returns true for the errors we should retry on.
func isRetryable(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrVaultSealed) {
		// Sealed is technically a 503 but represents an operator condition;
		// retry would only mask it. Don't retry.
		return false
	}
	var respErr *vaultapi.ResponseError
	if errors.As(err, &respErr) {
		return respErr.StatusCode == http.StatusServiceUnavailable
	}
	// Network / transport errors (no ResponseError attached) are retryable.
	return true
}

// classifyError converts a raw vault/api error into one of our sentinels
// where appropriate, leaving the original error chain intact.
func classifyError(err error) error {
	if err == nil {
		return nil
	}
	var respErr *vaultapi.ResponseError
	if errors.As(err, &respErr) {
		switch respErr.StatusCode {
		case http.StatusNotFound:
			return fmt.Errorf("%w: %s", ErrKeyNotFound, respErr.Error())
		case http.StatusServiceUnavailable:
			// Distinguish sealed by message; vault returns 503 for both
			// sealed and overload, with body "Vault is sealed" when sealed.
			joined := strings.ToLower(strings.Join(respErr.Errors, " "))
			if strings.Contains(joined, "sealed") {
				return fmt.Errorf("%w: %s", ErrVaultSealed, respErr.Error())
			}
			return respErr
		case http.StatusForbidden, http.StatusBadRequest:
			return fmt.Errorf("%w: %s", ErrTransitDenied, respErr.Error())
		}
	}
	return err
}

// parseEnvelopeVersion extracts N from "vault:vN:..." and rejects malformed
// envelopes.
func parseEnvelopeVersion(envelope string) (int, error) {
	if !strings.HasPrefix(envelope, "vault:v") {
		return 0, fmt.Errorf("vault: envelope missing prefix: %w", ErrEnvelopeInvalid)
	}
	rest := envelope[len("vault:v"):]
	colon := strings.IndexByte(rest, ':')
	if colon <= 0 {
		return 0, fmt.Errorf("vault: envelope missing version separator: %w", ErrEnvelopeInvalid)
	}
	verStr := rest[:colon]
	var ver int
	for _, r := range verStr {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("vault: envelope version not numeric: %w", ErrEnvelopeInvalid)
		}
		ver = ver*10 + int(r-'0')
	}
	if ver == 0 {
		return 0, fmt.Errorf("vault: envelope version zero: %w", ErrEnvelopeInvalid)
	}
	return ver, nil
}

// startSpan opens an OTEL span "vault.<method>" with sanitized tags. Never
// includes plaintext or envelope bytes.
func (c *vaultClient) startSpan(ctx context.Context, op transitOp, keyName string) (context.Context, trace.Span) {
	return tracer().Start(ctx, "vault."+string(op), trace.WithAttributes(
		attribute.String("vault.key_name", keyName),
		attribute.String("vault.auth_method", c.cfg.AuthMethod),
	))
}

// debugSafe emits a debug log entry that never contains key material.
func (c *vaultClient) debugSafe(op transitOp, keyName string, kekVersion int) {
	logEvent(&log.Logger, zerolog.DebugLevel, op, keyName, kekVersion)
}

// logEvent is split out so tests can inject a buffer-backed logger and
// verify that no plaintext bytes leak.
func logEvent(l *zerolog.Logger, lvl zerolog.Level, op transitOp, keyName string, kekVersion int) {
	if l == nil {
		return
	}
	ev := l.WithLevel(lvl).
		Str("component", "vault").
		Str("op", string(op)).
		Str("key_name", keyName)
	if kekVersion > 0 {
		ev = ev.Int("kek_version", kekVersion)
	}
	ev.Msg("vault transit operation")
}
