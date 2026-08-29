package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// CAP-177 — Internal generic REST / webhook connector (catch-all).
//
// This is the FULLY-CONFIGURABLE, production-ready connector any tenant can point
// at one of its own internal systems. It is NOT gov-gated: it ships with a real
// HTTP transport and reports honest live health (it actually pings base_url). It
// has no onboarding gate and no sandbox/mock — if base_url is unconfigured it
// grades not_configured, never fake-healthy.
//
// Capabilities (framework.go):
//   - ConnectionTester — authenticated no-op GET against base_url, asserts 2xx and
//     that the configured credentials decrypt + apply. Side-effect free.
//   - Invoker — operations "notify" / "post": a SIGNED POST whose body carries an
//     X-Clario-Signature: sha256=<hex> HMAC over the EXACT raw request bytes, so
//     the receiving internal system can verify integrity/authenticity. (When the
//     endpoint's auth scheme is not hmac the signature header is still emitted IFF
//     an hmac_secret is configured, so signing is opt-in independent of auth.)
//
// Inbound webhooks (webhook:inbound) are received and HMAC-verified by the lex
// handler layer via VerifyInboundWebhook on this connector: the handler reads the
// raw body, looks up the addressed endpoint, and calls VerifyInboundWebhook with
// the signature header. The verification mirrors the intake_service.go shape
// (timestamped HMAC-SHA256, constant-time compare) and never logs secrets.
//
// CONFIG + SECRETS CUSTODY. Like najiz_court_adapter.go, this adapter resolves the
// endpoint's PLAINTEXT config via the repository (which FieldCrypto-decrypts on
// read) — NEVER via IntegrationRegistryService.Get/List, which redacts secrets.
// Secrets (bearer_token, basic_password, hmac_secret, client_secret) are never
// logged or echoed in any TestResult/InvokeResult/health detail.
//
// Mirrors the HTTP-dispatcher shape of obligation_reminder_http.go and the
// endpoint-resolution shape of najiz_court_adapter.go.
// =============================================================================

// Internal connector operation names recognised by Invoke. Both map onto the same
// signed-POST transport; "notify" and "post" are aliases the console/api can pick
// for readability.
const (
	InternalOpNotify = "notify"
	InternalOpPost   = "post"
)

// internalDefaultTimeout is the per-call HTTP timeout when the endpoint does not
// configure one.
const internalDefaultTimeout = 15 * time.Second

// internalMaxRetries caps configurable retry attempts so a misconfiguration cannot
// turn one invoke into an unbounded storm.
const internalMaxRetries = 5

// internalRespBodyLimit bounds how much of an upstream response body is read.
const internalRespBodyLimit = 1 << 20

// internalWebhookTolerance bounds inbound-webhook timestamp skew to limit replay.
const internalWebhookTolerance = 5 * time.Minute

// ErrInternalRESTNotConfigured is returned by VerifyInboundWebhook / Invoke /
// TestConnection helpers when the endpoint has no usable base_url (Invoke/Test) or
// no inbound hmac_secret (webhook), so the caller can surface an honest error
// rather than a faked success.
var ErrInternalRESTNotConfigured = errors.New("lex/integration/internal: endpoint not configured")

// ErrInternalWebhookUnauthorized is returned by VerifyInboundWebhook when the HMAC
// signature does not verify (or the timestamp is stale). It is a uniform
// authentication failure that leaks no secret or existence detail.
var ErrInternalWebhookUnauthorized = errors.New("lex/integration/internal: inbound webhook authentication failed")

// ErrInternalEgressDenied is returned (and surfaced as an honest failure, never a
// faked success) when an outbound call's destination host is outside the
// endpoint's allowed_egress_hosts allow-list. This is connector-level,
// defence-in-depth host egress control: it stops a misconfigured base_url or a
// per-call path override from opening a connection to an unapproved host EVEN IF
// the request never passes through the registry's region/field egress gate. It is
// secret-free and leaks no internal detail beyond the rejected host.
var ErrInternalEgressDenied = errors.New("lex/integration/internal: destination host is not permitted by the endpoint egress policy")

// AllowedEgressHostsKey is the per-endpoint NON-secret config field naming the host
// allow-list an internal endpoint may open outbound connections to. Empty list =
// unconstrained (any host the base_url resolves to). Entries are host names (an
// optional ":port" is honoured) compared case-insensitively. This complements the
// framework egress_policy (allowed_regions / allowed_egress_fields), which the
// registry enforces on the dispatch path; the host allow-list is enforced HERE so a
// direct connector call is also fenced.
const AllowedEgressHostsKey = "allowed_egress_hosts"

// internalEndpointResolver is the slice of the integration endpoint repository the
// connector needs: it must return the DECRYPTED config (repo wired WithFieldCrypto).
// Declared as an interface so tests can supply a fake without a live pool.
type internalEndpointResolver interface {
	Get(ctx context.Context, tenantID, id uuid.UUID) (*model.IntegrationEndpoint, error)
	List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error)
}

// InternalRESTConnector is the catch-all generic REST/webhook adapter for the
// "internal" integration kind. It implements the base IntegrationAdapter port
// (Kind + Probe) plus the ConnectionTester and Invoker capability interfaces.
type InternalRESTConnector struct {
	endpoints internalEndpointResolver
	client    *http.Client
	logger    zerolog.Logger
	now       func() time.Time
	// oauth is the lazily-built client-credentials token cache, shared across this
	// connector's endpoints. Built on first oauth2_cc call so a connector with no
	// oauth endpoints never allocates one.
	oauth *OAuthTokenCache
}

// InternalRESTConnectorConfig parametrises the connector. Only Endpoints is
// required; the HTTP client defaults to a sane timeout, applied per-call from the
// endpoint's own timeout config when present.
type InternalRESTConnectorConfig struct {
	// Endpoints is the integration endpoint repository, which MUST be wired with
	// FieldCrypto (repo.WithFieldCrypto) so Config is decrypted on read.
	Endpoints *repository.IntegrationEndpointRepository
	// Client is an optional shared HTTP client. Per-call timeouts are applied via
	// context derived from the endpoint config, so the client's own Timeout is left
	// as an outer bound only.
	Client *http.Client
	Logger zerolog.Logger
}

// NewInternalRESTConnector builds the connector.
func NewInternalRESTConnector(cfg InternalRESTConnectorConfig) *InternalRESTConnector {
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: 2 * internalDefaultTimeout}
	}
	conn := &InternalRESTConnector{
		client: client,
		logger: cfg.Logger.With().Str("component", "lex-internal-rest-connector").Logger(),
		now:    time.Now,
	}
	// Avoid storing a typed-nil pointer behind the interface (which would make the
	// c.endpoints == nil guards in VerifyInboundWebhook fail to fire).
	if cfg.Endpoints != nil {
		conn.endpoints = cfg.Endpoints
	}
	return conn
}

// Compile-time assertions that the connector satisfies the framework capability
// interfaces and that the concrete repository satisfies the resolver seam. (The
// base IntegrationAdapter port — Kind + Probe — lives in the service package and
// is satisfied structurally; it cannot be referenced here without an import
// cycle, so it is asserted at the RegisterAdapter call site in app.go instead.)
var (
	_ ConnectionTester         = (*InternalRESTConnector)(nil)
	_ Invoker                  = (*InternalRESTConnector)(nil)
	_ internalEndpointResolver = (*repository.IntegrationEndpointRepository)(nil)
)

// Kind implements service.IntegrationAdapter.
func (c *InternalRESTConnector) Kind() model.IntegrationKind { return model.IntegrationKindInternal }

// Probe implements service.IntegrationAdapter — the live health snapshot. It does
// a lightweight authenticated GET ping against base_url (the same no-op the
// TestConnection probe uses), so health reflects real reachability, never a faked
// "always healthy". A planned/disabled endpoint, or an active endpoint with no
// base_url, grades not-reachable honestly.
func (c *InternalRESTConnector) Probe(ctx context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindInternal,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}
	switch endpoint.Status {
	case model.IntegrationStatusActive:
		cfg := parseInternalConfig(endpoint.Config)
		if cfg.BaseURL == "" {
			health.Reachable = false
			health.Detail = "not_configured: active endpoint has no base_url"
			return health
		}
		res, err := c.ping(ctx, cfg)
		if err != nil {
			health.Reachable = false
			health.Detail = "unreachable: " + sanitizeErr(err)
			return health
		}
		health.Reachable = res.Reachable
		health.Detail = res.Detail
	case model.IntegrationStatusPlanned:
		health.Reachable = false
		health.Detail = "not_configured: planned, not yet activated"
	case model.IntegrationStatusDisabled:
		health.Reachable = false
		health.Detail = "disabled by operator"
	default:
		health.Reachable = false
		health.Detail = "endpoint in error state"
	}
	return health
}

// TestConnection implements ConnectionTester. It resolves the endpoint's plaintext
// config and performs an authenticated, side-effect-free GET against base_url,
// asserting a 2xx and that credentials decrypt + apply. It returns a sanitized
// TestResult and never echoes secrets.
func (c *InternalRESTConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	cfg := parseInternalConfig(endpoint.Config)
	checkedAt := c.now().UTC()
	if cfg.BaseURL == "" {
		return TestResult{
			Reachable: false,
			Detail:    "not_configured: base_url is required",
			CheckedAt: checkedAt,
			Steps: []DiagnosticStep{
				newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, 0,
					"base_url is not configured", hintCheckBaseURL),
				newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusSkip, 0, "skipped: no endpoint to reach", ""),
				newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: not authenticated", ""),
				newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: not authenticated", ""),
			},
		}, nil
	}
	if err := cfg.credentialError(); err != nil {
		return TestResult{
			Reachable: false,
			Detail:    "not_configured: " + sanitizeErr(err),
			CheckedAt: checkedAt,
			Steps: []DiagnosticStep{
				newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusSkip, 0, "skipped: credentials incomplete", ""),
				newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusFail, 0,
					sanitizeErr(err), hintCheckCreds),
				newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: not authenticated", ""),
				newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: not authenticated", ""),
			},
		}, nil
	}
	res, err := c.ping(ctx, cfg)
	res.CheckedAt = c.now().UTC()
	if err != nil {
		res.Reachable = false
		res.Detail = sanitizeErr(err)
		// A transport/auth failure is a sanitized non-reachable result, not a Go
		// error — the operator reads Reachable+Detail.
		res.Steps = []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, res.LatencyMillis,
				sanitizeErr(err), hintCheckNetwork),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusSkip, 0, "skipped: host not reachable", ""),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: host not reachable", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: host not reachable", ""),
		}
		return res, nil
	}
	res.Steps = c.internalDiagSteps(cfg, res)
	return res, nil
}

// Invoke implements Invoker for the "notify"/"post" operations: a signed POST of
// the supplied payload to base_url (+ optional path override in payload["path"]).
// The body is signed with X-Clario-Signature: sha256=<hex> HMAC-SHA256 over the
// EXACT serialized bytes when an hmac_secret is configured. Honors the endpoint's
// configured auth scheme, content_type, timeout and retry count.
func (c *InternalRESTConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	switch op {
	case InternalOpNotify, InternalOpPost:
	default:
		return InvokeResult{}, fmt.Errorf("%w: %q (supported: notify, post)", ErrCapabilityNotSupported, operation)
	}

	cfg := parseInternalConfig(endpoint.Config)
	if cfg.BaseURL == "" {
		return InvokeResult{}, fmt.Errorf("%w: base_url is required", ErrInternalRESTNotConfigured)
	}
	if err := cfg.credentialError(); err != nil {
		return InvokeResult{}, fmt.Errorf("%w: %v", ErrInternalRESTNotConfigured, err)
	}

	// An optional per-call relative path lets one endpoint multiplex routes; the
	// base path stays configurable and gov paths are never hardcoded.
	path := ""
	if payload != nil {
		if p, ok := payload["path"].(string); ok {
			path = strings.TrimSpace(p)
		}
	}
	targetURL := joinInternalPath(cfg.BaseURL, path)

	// Connector-level host egress fence (defence-in-depth): block a call to a host
	// outside the endpoint allow-list before any connection is opened. Fail-closed.
	if !cfg.hostAllowed(targetURL) {
		return InvokeResult{
			Operation: op,
			Success:   false,
			Detail:    "destination host is not permitted by the endpoint egress policy",
		}, ErrInternalEgressDenied
	}

	body, err := json.Marshal(internalInvokeEnvelope{
		TenantID:    endpoint.TenantID.String(),
		Endpoint:    endpoint.Code,
		Operation:   op,
		RequestedAt: c.now().UTC(),
		Payload:     payload,
	})
	if err != nil {
		return InvokeResult{}, fmt.Errorf("lex/integration/internal: marshal payload: %w", err)
	}

	// Idempotency key: a stable per-call identifier the receiving system can use to
	// de-dup safe retries (this connector retries transport errors + 5xx). It is
	// derived deterministically from the EXACT signed body + endpoint so an
	// identical retried invoke carries the SAME key, while distinct invokes differ.
	// Sent as both Idempotency-Key (the de-facto standard header) and
	// X-Clario-Idempotency-Key.
	idempotencyKey := internalIdempotencyKey(endpoint, op, body)

	now := c.now().UTC()
	resp, status, err := c.doWithRetry(ctx, cfg, http.MethodPost, targetURL, body, now, idempotencyKey)
	if err != nil {
		return InvokeResult{
			Operation: op,
			Success:   false,
			Detail:    sanitizeErr(err),
		}, fmt.Errorf("lex/integration/internal: invoke %s: %w", op, err)
	}

	out := map[string]any{
		"status_code": status,
		"endpoint":    endpoint.Code,
	}
	reference := ""
	if len(bytes.TrimSpace(resp)) > 0 {
		var decoded map[string]any
		if json.Unmarshal(resp, &decoded) == nil {
			if ref, ok := decoded["reference"].(string); ok {
				reference = strings.TrimSpace(ref)
			}
			if id, ok := decoded["id"].(string); ok && reference == "" {
				reference = strings.TrimSpace(id)
			}
		}
	}

	return InvokeResult{
		Operation: op,
		Success:   true,
		Reference: reference,
		Detail:    fmt.Sprintf("%d accepted by internal endpoint", status),
		Output:    out,
	}, nil
}

// VerifyInboundWebhook is the HMAC-verified generic receiver entrypoint. The lex
// handler reads the EXACT raw body bytes, resolves the addressed "internal"
// endpoint (by id), and calls this with the signature + optional timestamp header
// values. It returns the resolved endpoint on success so the handler can route the
// verified payload; it returns ErrInternalWebhookUnauthorized on a bad signature
// (uniform, leaks nothing) and ErrInternalRESTNotConfigured when no inbound
// hmac_secret is set. Secrets are never logged.
//
// Signature scheme (mirrors intake_service.go): HMAC-SHA256 keyed by hmac_secret
// over (timestamp + "." + body) when a timestamp header is present and inbound
// timestamping is in use; otherwise over the raw body alone (matching the outbound
// signature this connector emits). The header value is accepted as hex or base64,
// optionally "sha256="/"v1=" prefixed. Comparison is constant-time.
func (c *InternalRESTConnector) VerifyInboundWebhook(ctx context.Context, tenantID, endpointID uuid.UUID, rawBody []byte, signature, timestamp string) (*model.IntegrationEndpoint, error) {
	if c.endpoints == nil {
		return nil, ErrInternalRESTNotConfigured
	}
	endpoint, err := c.endpoints.Get(ctx, tenantID, endpointID)
	if err != nil {
		// De-oracle: an unverified caller must not distinguish "no such endpoint"
		// from "bad signature". Both surface as the same auth failure.
		return nil, ErrInternalWebhookUnauthorized
	}
	if endpoint.Kind != model.IntegrationKindInternal {
		return nil, ErrInternalWebhookUnauthorized
	}
	if endpoint.Status != model.IntegrationStatusActive {
		return nil, ErrInternalWebhookUnauthorized
	}
	cfg := parseInternalConfig(endpoint.Config)
	if cfg.HMACSecret == "" {
		return nil, fmt.Errorf("%w: inbound webhook requires hmac_secret", ErrInternalRESTNotConfigured)
	}
	if !verifyInternalSignature(cfg.HMACSecret, rawBody, timestamp, signature, c.now().UTC()) {
		return nil, ErrInternalWebhookUnauthorized
	}
	return endpoint, nil
}

// ----------------------------------------------------------------------------
// Transport
// ----------------------------------------------------------------------------

// ping performs the authenticated no-op GET used by both TestConnection and Probe.
func (c *InternalRESTConnector) ping(ctx context.Context, cfg internalConfig) (TestResult, error) {
	// Host egress fence applies to the probe too: never open even a no-op GET to a
	// host outside the allow-list. Fail-closed with a secret-free verdict.
	if !cfg.hostAllowed(cfg.BaseURL) {
		return TestResult{Reachable: false, Detail: "host not permitted by egress policy"}, ErrInternalEgressDenied
	}
	start := c.now()
	cctx, cancel := context.WithTimeout(ctx, cfg.timeout())
	defer cancel()

	req, err := http.NewRequestWithContext(cctx, http.MethodGet, cfg.BaseURL, nil)
	if err != nil {
		return TestResult{}, fmt.Errorf("invalid base_url")
	}
	req.Header.Set("Accept", cfg.contentType())
	if err := c.applyAuth(cctx, req, cfg, nil, c.now().UTC()); err != nil {
		return TestResult{}, err
	}

	resp, err := c.client.Do(req)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return TestResult{LatencyMillis: latency}, fmt.Errorf("connection failed")
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, internalRespBodyLimit))

	res := TestResult{
		LatencyMillis: latency,
		Metadata:      map[string]any{"status_code": resp.StatusCode},
	}
	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		res.Reachable = true
		res.Detail = fmt.Sprintf("%d OK; credentials applied", resp.StatusCode)
		return res, nil
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		res.Reachable = false
		res.Detail = fmt.Sprintf("%d: credentials rejected by endpoint", resp.StatusCode)
		return res, nil
	}
	res.Reachable = false
	res.Detail = fmt.Sprintf("endpoint returned %d", resp.StatusCode)
	return res, nil
}

// doWithRetry POSTs body with the endpoint's auth + signature, retrying transport
// errors and 5xx up to cfg.retries() times with a fixed small backoff. It returns
// the response body (capped) and status code, or an error on exhausted retries.
func (c *InternalRESTConnector) doWithRetry(ctx context.Context, cfg internalConfig, method, url string, body []byte, now time.Time, idempotencyKey string) ([]byte, int, error) {
	attempts := cfg.retries() + 1
	var lastErr error
	for attempt := 0; attempt < attempts; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, 0, ctx.Err()
			case <-time.After(time.Duration(attempt) * 250 * time.Millisecond):
			}
		}
		respBody, status, retryable, err := c.doOnce(ctx, cfg, method, url, body, now, idempotencyKey)
		if err == nil {
			return respBody, status, nil
		}
		lastErr = err
		if !retryable {
			return nil, status, err
		}
	}
	if lastErr == nil {
		lastErr = errors.New("request failed")
	}
	return nil, 0, lastErr
}

// doOnce performs a single signed, authenticated request attempt. retryable
// reports whether the failure is worth another attempt (transport error or 5xx).
func (c *InternalRESTConnector) doOnce(ctx context.Context, cfg internalConfig, method, url string, body []byte, now time.Time, idempotencyKey string) (respBody []byte, status int, retryable bool, err error) {
	cctx, cancel := context.WithTimeout(ctx, cfg.timeout())
	defer cancel()

	req, err := http.NewRequestWithContext(cctx, method, url, bytes.NewReader(body))
	if err != nil {
		return nil, 0, false, fmt.Errorf("invalid base_url")
	}
	req.Header.Set("Content-Type", cfg.contentType())
	req.Header.Set("Accept", "application/json")
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
		req.Header.Set("X-Clario-Idempotency-Key", idempotencyKey)
	}
	if err := c.applyAuth(cctx, req, cfg, body, now); err != nil {
		return nil, 0, false, err
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, 0, true, fmt.Errorf("connection failed")
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, internalRespBodyLimit))

	if resp.StatusCode >= http.StatusOK && resp.StatusCode < http.StatusMultipleChoices {
		return out, resp.StatusCode, false, nil
	}
	if resp.StatusCode >= http.StatusInternalServerError {
		return nil, resp.StatusCode, true, fmt.Errorf("endpoint returned %d", resp.StatusCode)
	}
	return nil, resp.StatusCode, false, fmt.Errorf("endpoint rejected request: %d", resp.StatusCode)
}

// applyAuth sets the Authorization (and, for signed POSTs, X-Clario-Signature)
// headers per the endpoint's auth scheme. body is non-nil only for signing POSTs.
// For oauth2_cc it acquires a token via the shared OAuthTokenCache on the
// connector (lazily built). Secrets are never logged.
func (c *InternalRESTConnector) applyAuth(ctx context.Context, req *http.Request, cfg internalConfig, body []byte, now time.Time) error {
	switch cfg.Auth {
	case "none", "":
		// no auth header
	case "bearer":
		if cfg.BearerToken == "" {
			return fmt.Errorf("bearer_token is required for bearer auth")
		}
		req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
	case "basic":
		if cfg.BasicUsername == "" || cfg.BasicPassword == "" {
			return fmt.Errorf("basic_username and basic_password are required for basic auth")
		}
		req.SetBasicAuth(cfg.BasicUsername, cfg.BasicPassword)
	case "hmac":
		if cfg.HMACSecret == "" {
			return fmt.Errorf("hmac_secret is required for hmac auth")
		}
		// HMAC auth is realized purely by the signature header (signed below).
	case "oauth2_cc":
		token, err := c.oauthToken(ctx, cfg)
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+token)
	default:
		return fmt.Errorf("unsupported auth scheme")
	}

	// Sign the body when we have one and a signing secret is configured (either an
	// explicit hmac_secret, or the bearer/basic secret is irrelevant here — only
	// hmac_secret keys the signature). This is independent of the auth scheme so an
	// operator can use bearer auth AND still get body integrity signatures.
	if body != nil && cfg.HMACSecret != "" {
		ts := strconv.FormatInt(now.Unix(), 10)
		req.Header.Set("X-Clario-Timestamp", ts)
		req.Header.Set("X-Clario-Signature", "sha256="+signInternalBody(cfg.HMACSecret, ts, body))
	}
	return nil
}

// oauthToken lazily builds a per-connector OAuthTokenCache and mints a
// client-credentials token for the endpoint.
func (c *InternalRESTConnector) oauthToken(ctx context.Context, cfg internalConfig) (string, error) {
	if cfg.TokenURL == "" || cfg.ClientID == "" || cfg.ClientSecret == "" {
		return "", fmt.Errorf("token_url, client_id and client_secret are required for oauth2_cc")
	}
	if c.oauth == nil {
		c.oauth = NewOAuthTokenCache(c.client, 30*time.Second)
	}
	return c.oauth.Token(ctx, OAuthConfig{
		CacheKey:     cfg.BaseURL + "|" + cfg.ClientID,
		TokenURL:     cfg.TokenURL,
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
	})
}

// ----------------------------------------------------------------------------
// Config parsing (plaintext, resolved via the repo)
// ----------------------------------------------------------------------------

// internalConfig is the parsed, decrypted connection config for an "internal"
// endpoint. Keys follow schema.go IntegrationKindInternal, with tolerant aliases.
type internalConfig struct {
	BaseURL       string
	Auth          string // none | basic | bearer | oauth2_cc | hmac
	ContentType   string
	TimeoutSec    int
	Retry         int
	TokenURL      string
	ClientID      string
	ClientSecret  string
	BearerToken   string
	BasicUsername string
	BasicPassword string
	HMACSecret    string
	// AllowedHosts is the lower-cased host allow-list (host or host:port). Empty =
	// unconstrained. Enforced by the connector on every outbound call (host egress).
	AllowedHosts []string
}

func parseInternalConfig(config map[string]any) internalConfig {
	auth := strings.ToLower(internalCfgString(config, "auth", "auth_scheme"))
	cfg := internalConfig{
		BaseURL:       internalCfgString(config, "base_url", "url", "endpoint"),
		Auth:          auth,
		ContentType:   internalCfgString(config, "content_type"),
		TimeoutSec:    internalCfgInt(config, "timeout", "timeout_seconds"),
		Retry:         internalCfgInt(config, "retry", "retries", "max_retries"),
		TokenURL:      internalCfgString(config, "token_url"),
		ClientID:      internalCfgString(config, "client_id"),
		ClientSecret:  internalCfgString(config, "client_secret"),
		BearerToken:   internalCfgString(config, "bearer_token", "token"),
		BasicUsername: internalCfgString(config, "basic_username", "username"),
		BasicPassword: internalCfgString(config, "basic_password", "password"),
		HMACSecret:    internalCfgString(config, "hmac_secret", "webhook_secret", "signing_secret"),
		AllowedHosts:  stringList(config[AllowedEgressHostsKey]),
	}
	if cfg.Auth == "" {
		cfg.Auth = "none"
	}
	return cfg
}

// hostAllowed reports whether the destination URL's host is permitted by the
// endpoint's allowed_egress_hosts allow-list. An EMPTY allow-list is unconstrained
// (allow). A non-empty list permits the host either as "host" or "host:port" (so an
// operator can pin a port or leave it open). An unparseable URL is DENIED
// fail-closed. The check never logs the URL or any secret.
func (cfg internalConfig) hostAllowed(rawURL string) bool {
	if len(cfg.AllowedHosts) == 0 {
		return true
	}
	u, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || u.Host == "" {
		return false
	}
	host := strings.ToLower(u.Host)             // host[:port]
	hostNoPort := strings.ToLower(u.Hostname()) // host
	for _, allowed := range cfg.AllowedHosts {
		a := strings.ToLower(strings.TrimSpace(allowed))
		if a == "" {
			continue
		}
		if a == host || a == hostNoPort {
			return true
		}
		// Tolerate an allow-list entry written as a bare host matching a URL that
		// carries a port, and vice-versa via Hostname() above; also strip an
		// accidental scheme/path on the allow-list entry.
		if ah, _, err := net.SplitHostPort(a); err == nil && ah == hostNoPort {
			return true
		}
	}
	return false
}

// credentialError reports a missing-credential condition for the configured auth
// scheme (used so an active-but-incomplete endpoint grades not_configured rather
// than attempting a doomed call). It never includes secret material.
func (cfg internalConfig) credentialError() error {
	switch cfg.Auth {
	case "bearer":
		if cfg.BearerToken == "" {
			return fmt.Errorf("bearer_token is required for bearer auth")
		}
	case "basic":
		if cfg.BasicUsername == "" || cfg.BasicPassword == "" {
			return fmt.Errorf("basic_username and basic_password are required for basic auth")
		}
	case "hmac":
		if cfg.HMACSecret == "" {
			return fmt.Errorf("hmac_secret is required for hmac auth")
		}
	case "oauth2_cc":
		if cfg.TokenURL == "" || cfg.ClientID == "" || cfg.ClientSecret == "" {
			return fmt.Errorf("token_url, client_id and client_secret are required for oauth2_cc")
		}
	}
	return nil
}

func (cfg internalConfig) timeout() time.Duration {
	if cfg.TimeoutSec > 0 {
		return time.Duration(cfg.TimeoutSec) * time.Second
	}
	return internalDefaultTimeout
}

func (cfg internalConfig) retries() int {
	if cfg.Retry < 0 {
		return 0
	}
	if cfg.Retry > internalMaxRetries {
		return internalMaxRetries
	}
	return cfg.Retry
}

func (cfg internalConfig) contentType() string {
	if ct := strings.TrimSpace(cfg.ContentType); ct != "" {
		return ct
	}
	return "application/json"
}

// ----------------------------------------------------------------------------
// Signing / verification
// ----------------------------------------------------------------------------

// signInternalBody computes the hex HMAC-SHA256 over (timestamp + "." + body)
// keyed by secret — the value placed (after a "sha256=" prefix) in
// X-Clario-Signature on outbound POSTs.
func signInternalBody(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// internalIdempotencyKey derives a stable, deterministic idempotency key for an
// invoke from the endpoint id + operation + the EXACT request body. A retried
// identical invoke (the connector retries transport errors / 5xx) yields the SAME
// key so the receiving system can de-dup; two distinct invokes (different payload,
// op, or endpoint) yield different keys. It carries no secret material (the body it
// hashes is the public envelope, not credentials). The key is the hex SHA-256 of
// "<endpointID>|<op>|<body>" — opaque, fixed-length, safe to place in a header.
func internalIdempotencyKey(endpoint model.IntegrationEndpoint, op string, body []byte) string {
	h := sha256.New()
	h.Write([]byte(endpoint.ID.String()))
	h.Write([]byte("|"))
	h.Write([]byte(op))
	h.Write([]byte("|"))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

// verifyInternalSignature checks an inbound HMAC-SHA256 signature. When a fresh
// timestamp is supplied it verifies over (timestamp + "." + body); otherwise it
// verifies over the raw body alone. Accepts hex or base64, optionally
// "sha256="/"v1=" prefixed. Constant-time compare; no secret is logged.
func verifyInternalSignature(secret string, body []byte, timestamp, signature string, now time.Time) bool {
	if strings.TrimSpace(secret) == "" || strings.TrimSpace(signature) == "" {
		return false
	}
	actual, ok := decodeInternalSignature(signature)
	if !ok {
		return false
	}

	// Timestamped variant (replay-bounded) when a parseable, fresh timestamp is
	// present.
	if ts := strings.TrimSpace(timestamp); ts != "" {
		if signedAt, ok := parseInternalUnixTimestamp(ts); ok {
			if absDuration(now.Sub(signedAt)) > internalWebhookTolerance {
				return false
			}
			mac := hmac.New(sha256.New, []byte(secret))
			mac.Write([]byte(ts))
			mac.Write([]byte("."))
			mac.Write(body)
			if subtle.ConstantTimeCompare(actual, mac.Sum(nil)) == 1 {
				return true
			}
			// Fall through to body-only in case the sender signed body alone.
		}
	}

	macBody := hmac.New(sha256.New, []byte(secret))
	macBody.Write(body)
	return subtle.ConstantTimeCompare(actual, macBody.Sum(nil)) == 1
}

// base64DecodeFlexible tries the common base64 alphabets/paddings a sender might
// use for an HMAC signature.
func base64DecodeFlexible(s string) ([]byte, error) {
	if raw, err := base64.StdEncoding.DecodeString(s); err == nil {
		return raw, nil
	}
	if raw, err := base64.RawStdEncoding.DecodeString(s); err == nil {
		return raw, nil
	}
	if raw, err := base64.URLEncoding.DecodeString(s); err == nil {
		return raw, nil
	}
	return base64.RawURLEncoding.DecodeString(s)
}

func decodeInternalSignature(signature string) ([]byte, bool) {
	sig := strings.TrimSpace(signature)
	for _, prefix := range []string{"sha256=", "sha256:", "v1=", "hmac-sha256="} {
		if strings.HasPrefix(strings.ToLower(sig), prefix) {
			sig = sig[len(prefix):]
			break
		}
	}
	sig = strings.TrimSpace(sig)
	if raw, err := hex.DecodeString(sig); err == nil && len(raw) == sha256.Size {
		return raw, true
	}
	if raw, err := base64DecodeFlexible(sig); err == nil && len(raw) == sha256.Size {
		return raw, true
	}
	return nil, false
}

// ----------------------------------------------------------------------------
// Small helpers (self-contained; this file lives in the integration package and
// must not import service-layer helpers)
// ----------------------------------------------------------------------------

// internalInvokeEnvelope is the wire body POSTed by Invoke. It is the exact bytes
// the X-Clario-Signature HMAC is computed over.
type internalInvokeEnvelope struct {
	TenantID    string         `json:"tenant_id"`
	Endpoint    string         `json:"endpoint"`
	Operation   string         `json:"operation"`
	RequestedAt time.Time      `json:"requested_at"`
	Payload     map[string]any `json:"payload,omitempty"`
}

func internalCfgString(config map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func cfgString(config map[string]any, keys ...string) string {
	return internalCfgString(config, keys...)
}

func internalCfgInt(config map[string]any, keys ...string) int {
	for _, k := range keys {
		v, ok := config[k]
		if !ok {
			continue
		}
		switch n := v.(type) {
		case int:
			return n
		case int64:
			return int(n)
		case float64:
			return int(n)
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func joinInternalPath(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = strings.TrimSpace(path)
	if path == "" {
		return base
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

func parseInternalUnixTimestamp(ts string) (time.Time, bool) {
	if secs, err := strconv.ParseInt(strings.TrimSpace(ts), 10, 64); err == nil {
		return time.Unix(secs, 0).UTC(), true
	}
	if t, err := time.Parse(time.RFC3339, strings.TrimSpace(ts)); err == nil {
		return t.UTC(), true
	}
	return time.Time{}, false
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// sanitizeErr returns an operator-safe, secret-free error string. The connector
// constructs its own error messages (never wrapping credential values), so this
// is a defensive trim only.
func sanitizeErr(err error) string {
	if err == nil {
		return ""
	}
	return strings.TrimSpace(err.Error())
}

// ----------------------------------------------------------------------------
// Rich diagnostic steps (feature 2) — shared, secret-free staged-probe builder.
//
// Self-serve connectors (sso / hr / internal) populate TestResult.Steps with a
// canonical sequence of DiagnosticStep entries — reachable → authenticated →
// authorized → sample_fetch — each carrying a status, a per-step latency, and a
// remediation Hint on failure. Steps is ADDITIVE: the existing
// Reachable/Detail/LatencyMillis fields stay populated for backward-compat.
//
// These helpers and constants are shared across the three self-serve connector
// files in this package; they live here (the catch-all connector) so the sso/hr
// files only build steps, never redefine the plumbing.
// ----------------------------------------------------------------------------

// Diagnostic step keys — the stable, canonical stages every self-serve probe
// reports against (a connector emits the subset it can actually exercise).
const (
	diagStepReachable     = "reachable"     // DNS / TCP / HTTP to the endpoint
	diagStepAuthenticated = "authenticated" // credentials accepted
	diagStepAuthorized    = "authorized"    // scope / permission granted
	diagStepSampleFetch   = "sample_fetch"  // a lightweight read returned data
)

// Diagnostic step statuses (TestResult.Steps[].Status domain): ok|warn|fail|skip.
const (
	diagStatusOK   = "ok"
	diagStatusWarn = "warn"
	diagStatusFail = "fail"
	diagStatusSkip = "skip"
)

// Remediation hints — short, operator-facing, secret-free next-actions surfaced
// on a failing step. Centralized so the three connectors stay consistent.
const (
	hintRotateClientSecret = "rotate client_secret / verify the IdP application credentials"
	hintGrantScope         = "grant the required read scope to the integration application"
	hintCheckBaseURL       = "verify base_url and that the host is reachable from the platform"
	hintCheckCreds         = "verify the configured credentials (token / username+password)"
	hintCheckNetwork       = "check DNS / firewall egress to the upstream host"
)

// newDiagStep builds a DiagnosticStep with a bilingual label and a measured
// latency. label is authored in both locales; status must be one of the
// diagStatus* values. detail/hint are operator-safe and never carry secrets.
func newDiagStep(key string, label forms.LocalizedText, status string, latencyMs int64, detail, hint string) DiagnosticStep {
	return DiagnosticStep{
		Key:       key,
		Label:     label,
		Status:    status,
		LatencyMs: latencyMs,
		Detail:    detail,
		Hint:      hint,
	}
}

// diagLabel returns the canonical bilingual label for a stage key, so all three
// connectors render identical step names.
func diagLabel(key string) forms.LocalizedText {
	switch key {
	case diagStepReachable:
		return forms.LocalizedText{AR: "إمكانية الوصول", EN: "Reachable"}
	case diagStepAuthenticated:
		return forms.LocalizedText{AR: "المصادقة", EN: "Authenticated"}
	case diagStepAuthorized:
		return forms.LocalizedText{AR: "التفويض", EN: "Authorized"}
	case diagStepSampleFetch:
		return forms.LocalizedText{AR: "قراءة تجريبية", EN: "Sample fetch"}
	default:
		return forms.LocalizedText{AR: key, EN: key}
	}
}

// internalDiagSteps derives the staged DiagnosticStep sequence for the internal
// REST connector from a completed ping (no extra transport calls). Reachable is
// graded from connectivity; authenticated/authorized from the HTTP status the
// ping observed; sample_fetch reflects that the no-op GET returned a usable body.
func (c *InternalRESTConnector) internalDiagSteps(cfg internalConfig, res TestResult) []DiagnosticStep {
	status := 0
	if res.Metadata != nil {
		if s, ok := res.Metadata["status_code"].(int); ok {
			status = s
		}
	}

	reachable := newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusOK, res.LatencyMillis,
		"host reachable over HTTP", "")

	authStatus, authHint := diagStatusForHTTP(status)
	authDetail := fmt.Sprintf("endpoint returned %d", status)
	if authStatus == diagStatusOK {
		authDetail = fmt.Sprintf("%d; %s credentials accepted", status, cfg.Auth)
	} else if status == http.StatusUnauthorized {
		authDetail = "401: credentials rejected"
	}
	authenticated := newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), authStatus, res.LatencyMillis, authDetail, authHint)

	// Authorized: a 403 specifically signals an authz/scope gap; otherwise the
	// generic endpoint has no per-scope model, so OK on 2xx, skip when auth failed.
	authorized := newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusOK, 0,
		"endpoint accepted the request", "")
	switch {
	case status == http.StatusForbidden:
		authorized = newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusFail, 0,
			"403: caller not permitted for this resource", hintGrantScope)
	case authStatus != diagStatusOK:
		authorized = newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0,
			"skipped: not authenticated", "")
	}

	// Sample fetch: the no-op GET is itself the lightweight read for this catch-all
	// connector, so reflect its outcome without issuing a second request.
	sample := newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusOK, res.LatencyMillis,
		"no-op read returned a response", "")
	if authStatus != diagStatusOK {
		sample = newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0,
			"skipped: not authenticated", "")
	}

	return []DiagnosticStep{reachable, authenticated, authorized, sample}
}

// diagStatusForHTTP maps an HTTP status into a (step status, hint) pair for the
// authenticated/authorized stages. 401 → fail+rotate-secret, 403 → fail+grant-
// scope, 2xx → ok, other → warn.
func diagStatusForHTTP(status int) (string, string) {
	switch {
	case status == http.StatusUnauthorized:
		return diagStatusFail, hintRotateClientSecret
	case status == http.StatusForbidden:
		return diagStatusFail, hintGrantScope
	case status >= 200 && status < 300:
		return diagStatusOK, ""
	default:
		return diagStatusWarn, ""
	}
}
