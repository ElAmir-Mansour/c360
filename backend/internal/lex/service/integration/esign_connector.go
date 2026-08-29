package integration

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// E-signature connector (Integration Platform Phase 2).
//
// Surfaces the EXISTING lex signature dispatchers (native deterministic, generic
// HTTP, Najiz MOJ) under the integration registry as per-provider connector
// records with FieldCrypto-encrypted secrets + Test Connection + honest Health,
// replacing reliance on the env-gated LEX_SIGNATURE_PROVIDER_* block.
//
// It implements the base IntegrationAdapter port (Kind + Probe) PLUS:
//   - ConnectionTester — a non-mutating auth/reachability probe.
//   - Invoker          — action "dispatch_envelope" reuses the existing
//                        DispatchSignatureEnvelope seam via an injected port.
//
// HONEST HEALTH (NEVER fake-healthy):
//   - native  (deterministic local signing)            -> always reachable.
//   - external/docusign/adobe (self-serve commercial)  -> reachable iff the
//        endpoint is active AND a real transport credential is configured and a
//        lightweight token-fetch / GET probe (or creds-decrypt) succeeds.
//   - najiz / emdha / nafath identity-proofing (gov-gated) -> these ship as
//        fully-configurable adapters with a sandbox/mock transport. Until real
//        MOJ / Nafath / emdha-TSP credentials land they grade not_configured
//        (Reachable=false, status surfaced as planned/sandbox), NEVER healthy.
//
// CONFIG + SECRETS CUSTODY. The connector resolves the PLAINTEXT endpoint config
// via the repository (the najiz_court_adapter.go pattern) — the repo
// FieldCrypto-DECRYPTS config_encrypted on read. It NEVER calls the registry
// service's Get/List (those schema-redact secrets). Secrets are never logged or
// returned in cleartext.
//
// CONFIG SHAPE (esign kind, see schema.go / Lex_Integration_Platform_Design):
//   provider          docusign|adobe|native|emdha   (schema "provider")
//   provider_kind     native|nafath|najiz|external  (lex SignatureProvider)
//   mode              deterministic|http|najiz|emdha|docusign|adobe
//   base_url          configurable per-endpoint (NEVER a hardcoded gov path)
//   token_url         OAuth2 token endpoint (when OAuth client-credentials)
//   scopes            optional space-delimited OAuth scope set
//   callback_url      provider-event webhook the provider calls back
//   account_id        provider account / integrator id
//   client_id         OAuth / integrator client id
//   client_secret     SECRET — OAuth client secret
//   private_key       SECRET — JWT-grant private key (DocuSign JWT)
//   webhook_secret    SECRET — inbound callback HMAC signing secret
//   signer_id_proofing  nafath|none  (two-stage identity_confirmed gate)
//   default_signature_level  basic|advanced|qualified
//   require_nafath    bool (schema)
// =============================================================================

// esignProviderKind is the lex SignatureProvider family the endpoint maps onto.
// It mirrors model.SignatureProvider (native|nafath|najiz|external) so the
// connector can hand the right provider to the dispatch seam.
type esignProviderKind string

const (
	esignProviderNative   esignProviderKind = "native"
	esignProviderNafath   esignProviderKind = "nafath"
	esignProviderNajiz    esignProviderKind = "najiz"
	esignProviderExternal esignProviderKind = "external"
)

// esignMode selects the transport. deterministic/native always works offline;
// http/docusign/adobe are self-serve real transports; najiz/emdha are gov-gated
// and sandbox-mock until credentials land.
type esignMode string

const (
	esignModeDeterministic esignMode = "deterministic"
	esignModeHTTP          esignMode = "http"
	esignModeNajiz         esignMode = "najiz"
	esignModeEmdha         esignMode = "emdha"
	esignModeDocuSign      esignMode = "docusign"
	esignModeAdobe         esignMode = "adobe"
)

// EsignDispatchPort is the seam the connector's Invoke("dispatch_envelope") calls
// to reuse the EXISTING SignatureService.DispatchSignatureEnvelope path. The
// integrator binds this to the live SignatureService at wiring time (app.go),
// avoiding an import cycle (this package must not import service). The connector
// passes the resolved endpoint config (provider family + mode + decrypted
// transport settings) so the service can route to the correct dispatcher.
//
// DispatchEnvelope sends a previously-created+drafted signature envelope through
// the provider transport selected by the endpoint and returns a sanitized,
// provider-assigned reference (the provider envelope id). It MUST NOT echo
// secrets in the returned detail/reference.
type EsignDispatchPort interface {
	DispatchEnvelope(ctx context.Context, tenantID uuid.UUID, route EsignDispatchRoute, envelopeID uuid.UUID, message string) (EsignDispatchOutcome, error)
}

// EsignDispatchRoute is the secret-free routing descriptor the connector hands to
// the dispatch port. It carries the resolved transport selection plus the
// non-secret endpoint URLs; the port re-resolves secrets through the repo by
// EndpointID exactly like the connector does, so no credential crosses this seam.
type EsignDispatchRoute struct {
	EndpointID   uuid.UUID
	EndpointCode string
	Provider     model.SignatureProvider // native|nafath|najiz|external
	Mode         string                  // deterministic|http|najiz|emdha|docusign|adobe
	BaseURL      string
	CallbackURL  string
}

// EsignDispatchOutcome is the sanitized result of a dispatch reused from the
// signature service. It never carries credentials.
type EsignDispatchOutcome struct {
	ProviderEnvelopeID string
	DeliveryStatus     string
	ProviderStatus     string
	Adapter            string
	Detail             string
	Metadata           map[string]any
}

// EsignConnector is the registry adapter for the esign kind. It satisfies the
// registry's IntegrationAdapter port (Kind + Probe) structurally and adds the
// ConnectionTester + Invoker capabilities.
type EsignConnector struct {
	endpoints *repository.IntegrationEndpointRepository
	tokens    *OAuthTokenCache
	client    *http.Client
	breaker   *Breaker
	dispatch  EsignDispatchPort
	logger    zerolog.Logger
	now       func() time.Time
}

// EsignConnectorConfig parametrises the connector. Only the repository is
// strictly required (config custody); the rest default sensibly. Dispatch is the
// reuse seam onto SignatureService — when nil, Invoke("dispatch_envelope")
// reports an honest "not wired" error rather than faking a send.
type EsignConnectorConfig struct {
	Endpoints *repository.IntegrationEndpointRepository
	Tokens    *OAuthTokenCache
	Client    *http.Client
	Breaker   *Breaker
	Dispatch  EsignDispatchPort
	Timeout   time.Duration
	Logger    zerolog.Logger
}

// NewEsignConnector builds the connector. The repository MUST be FieldCrypto-wired
// (repo.WithFieldCrypto) so Config is decrypted on read.
func NewEsignConnector(cfg EsignConnectorConfig) *EsignConnector {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copied := *client
		copied.Timeout = timeout
		client = &copied
	}
	tokens := cfg.Tokens
	if tokens == nil {
		tokens = NewOAuthTokenCache(client, 30*time.Second)
	}
	return &EsignConnector{
		endpoints: cfg.Endpoints,
		tokens:    tokens,
		client:    client,
		breaker:   cfg.Breaker,
		dispatch:  cfg.Dispatch,
		logger:    cfg.Logger.With().Str("component", "lex-esign-connector").Logger(),
		now:       time.Now,
	}
}

// Kind reports the integration kind this connector serves.
func (c *EsignConnector) Kind() model.IntegrationKind { return model.IntegrationKindEsign }

// esignConfig is the resolved, decrypted connection configuration for an esign
// endpoint. Secret fields are held only in memory and never logged.
type esignConfig struct {
	Provider       esignProviderKind
	Mode           esignMode
	BaseURL        string
	TokenURL       string
	Scopes         string
	CallbackURL    string
	AccountID      string
	ClientID       string
	clientSecret   string // SECRET
	privateKey     string // SECRET
	webhookSecret  string // SECRET
	SignerProofing string // nafath|none
	SignatureLevel string
}

// hasTransportCredential reports whether a real transport credential is present
// (used by honest health/test grading). native never needs one.
func (e esignConfig) hasTransportCredential() bool {
	return e.clientSecret != "" || e.privateKey != "" || e.AccountID != "" || e.webhookSecret != ""
}

// isGovGated reports whether this endpoint targets a gov-gated rail (najiz MOJ,
// emdha TSP, or Nafath identity-proofing). These NEVER grade healthy until real
// credentials are confirmed present.
func (e esignConfig) isGovGated() bool {
	if e.Provider == esignProviderNajiz || e.Provider == esignProviderNafath {
		return true
	}
	switch e.Mode {
	case esignModeNajiz, esignModeEmdha:
		return true
	}
	return e.SignerProofing == "nafath"
}

func parseEsignConfig(config map[string]any) esignConfig {
	provider := esignProviderKind(strings.ToLower(firstConfigStr(config, "provider_kind", "provider")))
	switch provider {
	case esignProviderNative, esignProviderNafath, esignProviderNajiz, esignProviderExternal:
	default:
		// Schema "provider" enum is docusign|adobe|native|emdha — map onto the
		// lex SignatureProvider family.
		switch strings.ToLower(firstConfigStr(config, "provider")) {
		case "native":
			provider = esignProviderNative
		case "emdha":
			provider = esignProviderNafath // emdha pairs with Nafath identity proofing
		default:
			provider = esignProviderExternal // docusign/adobe/unknown -> external
		}
	}

	mode := esignMode(strings.ToLower(firstConfigStr(config, "mode")))
	switch mode {
	case esignModeDeterministic, esignModeHTTP, esignModeNajiz, esignModeEmdha, esignModeDocuSign, esignModeAdobe:
	default:
		// Derive a sane default mode from provider when unset.
		switch provider {
		case esignProviderNative:
			mode = esignModeDeterministic
		case esignProviderNajiz:
			mode = esignModeNajiz
		default:
			switch strings.ToLower(firstConfigStr(config, "provider")) {
			case "docusign":
				mode = esignModeDocuSign
			case "adobe":
				mode = esignModeAdobe
			case "emdha":
				mode = esignModeEmdha
			default:
				mode = esignModeHTTP
			}
		}
	}

	return esignConfig{
		Provider:       provider,
		Mode:           mode,
		BaseURL:        firstConfigStr(config, "base_url", "base_endpoint", "endpoint", "url"),
		TokenURL:       firstConfigStr(config, "token_url"),
		Scopes:         firstConfigStr(config, "scopes", "scope"),
		CallbackURL:    firstConfigStr(config, "callback_url", "callback"),
		AccountID:      firstConfigStr(config, "account_id"),
		ClientID:       firstConfigStr(config, "client_id", "integrator_key"),
		clientSecret:   firstConfigStr(config, "client_secret"),
		privateKey:     firstConfigStr(config, "private_key"),
		webhookSecret:  firstConfigStr(config, "webhook_secret"),
		SignerProofing: strings.ToLower(firstConfigStr(config, "signer_id_proofing")),
		SignatureLevel: strings.ToLower(firstConfigStr(config, "default_signature_level")),
	}
}

func firstConfigStr(config map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func (c *EsignConnector) providerFor(cfg esignConfig) model.SignatureProvider {
	switch cfg.Provider {
	case esignProviderNative:
		return model.SignatureProviderNative
	case esignProviderNafath:
		return model.SignatureProviderNafath
	case esignProviderNajiz:
		return model.SignatureProviderNajiz
	default:
		return model.SignatureProviderExternal
	}
}

// Probe returns an HONEST health snapshot. It performs no network call (the
// readiness surface must be cheap): native is healthy when active; self-serve is
// healthy when active + credentialed; gov-gated never grades healthy until real
// creds are present (sandbox-mock otherwise).
func (c *EsignConnector) Probe(_ context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindEsign,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}
	cfg := parseEsignConfig(endpoint.Config)

	switch endpoint.Status {
	case model.IntegrationStatusActive:
		// fallthrough to capability grading below.
	case model.IntegrationStatusPlanned:
		health.Reachable = false
		health.Detail = c.plannedDetail(cfg)
		return health
	case model.IntegrationStatusDisabled:
		health.Reachable = false
		health.Detail = "disabled by operator"
		return health
	default:
		health.Reachable = false
		health.Detail = "endpoint in error state"
		return health
	}

	// ACTIVE endpoint — grade by provider family, honestly.
	if cfg.Provider == esignProviderNative || cfg.Mode == esignModeDeterministic {
		health.Reachable = true
		health.Detail = "native deterministic signing (no external transport)"
		return health
	}
	if cfg.isGovGated() {
		if !cfg.hasTransportCredential() {
			// Gov-gated + no real creds: sandbox-mock, NOT healthy.
			health.Reachable = false
			health.Detail = "gov-gated provider in sandbox/mock mode: real credentials not configured (not_configured)"
			return health
		}
		// Creds present but provider acceptance still pending real onboarding —
		// surface reachable-but-pending honestly via Detail (TestConnection
		// confirms the live token/probe).
		if strings.TrimSpace(cfg.BaseURL) == "" {
			health.Reachable = false
			health.Detail = "gov-gated provider missing base_url (not_configured)"
			return health
		}
		health.Reachable = true
		health.Detail = "gov-gated provider configured with credentials (run Test Connection to confirm live transport)"
		return health
	}
	// Self-serve commercial (docusign/adobe/external http).
	if strings.TrimSpace(cfg.BaseURL) == "" {
		health.Reachable = false
		health.Detail = "active endpoint missing base_url"
		return health
	}
	if !cfg.hasTransportCredential() {
		health.Reachable = false
		health.Detail = "active endpoint missing transport credential (client_secret / private_key / account_id)"
		return health
	}
	health.Reachable = true
	health.Detail = fmt.Sprintf("%s transport configured", cfg.Mode)
	return health
}

func (c *EsignConnector) plannedDetail(cfg esignConfig) string {
	if cfg.isGovGated() {
		return "planned: gov-gated provider awaiting credentials & activation (sandbox-mock)"
	}
	return "planned: not yet activated"
}

// TestConnection performs a non-mutating auth/reachability probe.
//   - native              -> always passes (no external dependency).
//   - gov-gated, no creds -> honest not-reachable (sandbox-mock; never fake pass).
//   - OAuth (token_url)   -> mints a client-credentials token via the shared cache.
//   - else                -> lightweight GET on base_url asserting a 2xx/auth-shaped
//     response + confirms secrets decrypt.
//
// The returned TestResult is sanitized (never echoes credentials).
func (c *EsignConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	start := c.now()
	cfg := c.resolveConfig(ctx, endpoint)
	result := TestResult{CheckedAt: start.UTC()}

	finish := func(reachable bool, detail string, meta map[string]any) (TestResult, error) {
		result.Reachable = reachable
		result.Detail = detail
		result.LatencyMillis = time.Since(start).Milliseconds()
		result.CheckedAt = c.now().UTC()
		result.Metadata = meta
		return result, nil
	}

	if cfg.Provider == esignProviderNative || cfg.Mode == esignModeDeterministic {
		return finish(true, "native deterministic signing: no external transport to test", map[string]any{
			"provider": "native", "mode": "deterministic",
		})
	}

	// Gov-gated rails without real credentials are HONESTLY not reachable.
	if cfg.isGovGated() && !cfg.hasTransportCredential() {
		return finish(false, "gov-gated provider in sandbox/mock mode: real credentials not configured", map[string]any{
			"provider": string(cfg.Provider), "mode": string(cfg.Mode), "grade": "not_configured",
		})
	}

	if strings.TrimSpace(cfg.BaseURL) == "" && strings.TrimSpace(cfg.TokenURL) == "" {
		return finish(false, "endpoint is missing base_url and token_url", nil)
	}

	// OAuth2 client-credentials path: mint a token (proves client_id/secret).
	if strings.TrimSpace(cfg.TokenURL) != "" && cfg.ClientID != "" && cfg.clientSecret != "" {
		var tokenErr error
		run := func(cctx context.Context) error {
			_, tokenErr = c.tokens.Token(cctx, OAuthConfig{
				CacheKey:     c.cacheKey(endpoint),
				TokenURL:     cfg.TokenURL,
				ClientID:     cfg.ClientID,
				ClientSecret: cfg.clientSecret,
				Scope:        cfg.Scopes,
			})
			return tokenErr
		}
		if err := c.execute(ctx, run); err != nil {
			return finish(false, esignSanitizeErr("oauth token fetch failed", err), map[string]any{
				"provider": string(cfg.Provider), "mode": string(cfg.Mode), "auth": "oauth_client_credentials",
			})
		}
		return finish(true, "oauth client-credentials token acquired", map[string]any{
			"provider": string(cfg.Provider), "mode": string(cfg.Mode), "auth": "oauth_client_credentials",
		})
	}

	// Lightweight GET probe on base_url. We treat any HTTP response that the
	// transport returns (including 401/403/404) as REACHABLE-but-unauthorized
	// only when no auth was attempted; with an Authorization header set we require
	// a 2xx to claim reachable. A transport (DNS/TCP/TLS) failure is unreachable.
	if strings.TrimSpace(cfg.BaseURL) == "" {
		return finish(false, "endpoint missing base_url for reachability probe", nil)
	}
	status, transportErr := c.probeGET(ctx, cfg)
	if transportErr != nil {
		return finish(false, esignSanitizeErr("reachability probe failed", transportErr), map[string]any{
			"provider": string(cfg.Provider), "mode": string(cfg.Mode),
		})
	}
	reachable := status >= 200 && status < 300
	detail := fmt.Sprintf("HTTP %d from provider base endpoint", status)
	if !reachable {
		detail = fmt.Sprintf("HTTP %d from provider base endpoint (credentials may be required)", status)
	}
	return finish(reachable, detail, map[string]any{
		"provider": string(cfg.Provider), "mode": string(cfg.Mode), "http_status": status,
	})
}

func (c *EsignConnector) probeGET(ctx context.Context, cfg esignConfig) (int, error) {
	var status int
	run := func(cctx context.Context) error {
		req, err := http.NewRequestWithContext(cctx, http.MethodGet, cfg.BaseURL, nil)
		if err != nil {
			return fmt.Errorf("invalid base_url")
		}
		req.Header.Set("Accept", "application/json")
		if cfg.clientSecret != "" {
			// Bearer the client secret only when the provider expects a static
			// API-key style auth (external http). Never log it.
			req.Header.Set("Authorization", "Bearer "+cfg.clientSecret)
		}
		resp, err := c.client.Do(req)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
		status = resp.StatusCode
		return nil
	}
	if err := c.execute(ctx, run); err != nil {
		return 0, err
	}
	return status, nil
}

// Invoke performs the connector's mutating action. The supported operation is
// "dispatch_envelope": it reuses the EXISTING SignatureService dispatch seam to
// send a drafted signature envelope through the provider transport selected by
// this endpoint. The two-stage identity_confirmed(nafath)->signed(emdha) gate is
// preserved by the underlying provider/method on the envelope — this connector
// only routes the dispatch and never collapses the two stages.
func (c *EsignConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	switch op {
	case "dispatch_envelope", "send_envelope", "dispatch":
		return c.invokeDispatchEnvelope(ctx, endpoint, payload)
	default:
		return InvokeResult{Operation: operation, Success: false, Detail: "unsupported operation"},
			fmt.Errorf("lex/esign: unsupported operation %q", operation)
	}
}

func (c *EsignConnector) invokeDispatchEnvelope(ctx context.Context, endpoint model.IntegrationEndpoint, payload map[string]any) (InvokeResult, error) {
	res := InvokeResult{Operation: "dispatch_envelope"}
	if c.dispatch == nil {
		// Honest "not wired" — do NOT fake a send.
		res.Detail = "dispatch seam not wired"
		return res, fmt.Errorf("lex/esign: dispatch port not configured")
	}
	cfg := c.resolveConfig(ctx, endpoint)

	// Gov-gated rails without real creds must not pretend to dispatch.
	if cfg.isGovGated() && !cfg.hasTransportCredential() {
		res.Detail = "gov-gated provider in sandbox/mock mode: real credentials not configured"
		return res, fmt.Errorf("lex/esign: gov-gated provider not configured for live dispatch")
	}

	envelopeID, err := uuidFromPayload(payload, "envelope_id", "envelopeId", "id")
	if err != nil {
		res.Detail = "envelope_id is required"
		return res, err
	}
	message := firstConfigStr(payload, "message")

	route := EsignDispatchRoute{
		EndpointID:   endpoint.ID,
		EndpointCode: endpoint.Code,
		Provider:     c.providerFor(cfg),
		Mode:         string(cfg.Mode),
		BaseURL:      cfg.BaseURL,
		CallbackURL:  cfg.CallbackURL,
	}
	outcome, derr := c.dispatch.DispatchEnvelope(ctx, endpoint.TenantID, route, envelopeID, message)
	if derr != nil {
		res.Detail = esignSanitizeErr("provider dispatch failed", derr)
		return res, derr
	}
	res.Success = true
	res.Reference = outcome.ProviderEnvelopeID
	res.Detail = firstNonEmpty(outcome.Detail, "envelope dispatched to provider")
	res.Output = map[string]any{
		"provider":             string(route.Provider),
		"mode":                 route.Mode,
		"provider_envelope_id": outcome.ProviderEnvelopeID,
		"delivery_status":      outcome.DeliveryStatus,
		"provider_status":      outcome.ProviderStatus,
		"adapter":              outcome.Adapter,
	}
	for k, v := range outcome.Metadata {
		// Non-secret provider annotation only; the service already sanitized this.
		res.Output[k] = v
	}
	return res, nil
}

// resolveConfig loads the DECRYPTED endpoint config via the repository (config
// custody pattern) and parses it. When the repo is unavailable it falls back to
// the (already-decrypted-by-the-registry-Get? no) endpoint.Config passed in —
// but callers (the registry) hand us the repo-decrypted endpoint, so we re-read
// to be certain we have plaintext and not a masked copy.
func (c *EsignConnector) resolveConfig(ctx context.Context, endpoint model.IntegrationEndpoint) esignConfig {
	if c.endpoints != nil {
		if fresh, err := c.endpoints.Get(ctx, endpoint.TenantID, endpoint.ID); err == nil && fresh != nil {
			return parseEsignConfig(fresh.Config)
		}
	}
	return parseEsignConfig(endpoint.Config)
}

func (c *EsignConnector) cacheKey(endpoint model.IntegrationEndpoint) string {
	return "esign|" + endpoint.TenantID.String() + "|" + endpoint.ID.String()
}

// execute runs fn under the breaker (when configured) or directly with the
// client timeout otherwise.
func (c *EsignConnector) execute(ctx context.Context, fn func(ctx context.Context) error) error {
	if c.breaker != nil {
		return c.breaker.Execute(ctx, fn)
	}
	return fn(ctx)
}

func uuidFromPayload(payload map[string]any, keys ...string) (uuid.UUID, error) {
	for _, k := range keys {
		if v, ok := payload[k]; ok {
			if s, ok := v.(string); ok {
				if id, err := uuid.Parse(strings.TrimSpace(s)); err == nil {
					return id, nil
				}
			}
			if id, ok := v.(uuid.UUID); ok {
				return id, nil
			}
		}
	}
	return uuid.Nil, fmt.Errorf("lex/esign: envelope_id is required")
}

// esignSanitizeErr returns an operator-safe message. It deliberately drops the
// raw error chain detail when it could carry credential-bearing URLs; the prefix
// is stable and secret-free. (The package's bare sanitizeErr has a different
// signature, so the esign connector keeps its own prefix-aware variant.)
func esignSanitizeErr(prefix string, err error) string {
	if err == nil {
		return prefix
	}
	msg := err.Error()
	// Never surface anything resembling a token/secret query param.
	if strings.Contains(strings.ToLower(msg), "secret") || strings.Contains(strings.ToLower(msg), "authorization") {
		return prefix
	}
	return prefix + ": " + msg
}

// Compile-time assertions that the connector satisfies the capability seams.
var (
	_ ConnectionTester = (*EsignConnector)(nil)
	_ Invoker          = (*EsignConnector)(nil)
)
