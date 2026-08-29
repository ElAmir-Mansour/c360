package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Nafath identity-confirmation connector (e-sign basis) — kind="nafath_verify".
//
// Nafath is the KSA national single-sign-on / identity-confirmation service. This
// connector drives the ExtNafath MFA "number-match" flow that is the BASIS for an
// identity-confirmed signature:
//
//	request  POST {base}/ExtNafath/request   {nationalId}            -> {transId, random}
//	status   POST {base}/ExtNafath/status    {transId,random,nationalId} -> WAITING|COMPLETED|REJECTED|EXPIRED|ERROR
//	details  GET  {base}/ExtNafath/details?transId=...               -> verified attributes (after COMPLETED)
//
// The `random` returned by request is surfaced to the app so it can show the
// citizen the number to match in the Nafath app. Nafath CONFIRMS IDENTITY — it is
// NOT a Certificate Authority — so a legally binding signature pairs this identity
// confirmation with a TSP (emdha). Lex keeps `identity_confirmed` distinct from
// `signed`; see nafath_status_map.go.
//
// GOV-GATED HONESTY. Nafath access is gated on Elm / TCC (SP onboarding). Until a
// tenant lands real SP credentials this connector ships fully built + configurable
// with a UAT/sandbox MOCK transport (so demos and the e-sign happy path work), but
// it NEVER reports a healthy live connection it does not have:
//   - environment=uat/sandbox            -> Probe grades "not_configured" with a
//     "sandbox mock; status=planned until Elm/TCC creds" detail (Reachable=false).
//   - environment=production + real creds -> Probe performs a real reachability
//     check and grades honestly from the upstream response.
//
// CONFIG CUSTODY. The adapter resolves the endpoint's PLAINTEXT config via the
// repository (which FieldCrypto-decrypts on read) — the najiz_court_adapter.go
// pattern — never via the redacting registry service. Secrets (sp_api_secret) are
// never logged or echoed in any TestResult / InvokeResult / health detail.
// =============================================================================

// NafathVerifyKind is the integration kind this connector serves.
const NafathVerifyKind = model.IntegrationKindNafathVerify

// Nafath invoke operation names (Invoker.Invoke `operation` argument).
const (
	NafathOpRequest = "request"
	NafathOpStatus  = "status"
	NafathOpDetails = "details"
)

// Default ExtNafath paths (configurable per endpoint; never hardcode gov paths
// into the request — these are only fallbacks when the config omits them).
const (
	defaultNafathRequestPath = "/ExtNafath/request"
	defaultNafathStatusPath  = "/ExtNafath/status"
	defaultNafathDetailsPath = "/ExtNafath/details"
)

// ErrNafathConfigIncomplete is returned by Invoke/TestConnection when the resolved
// endpoint config lacks the minimum settings (base_url + SP credentials) to talk
// to a live Nafath SP. It is an honest "not wired", never a faked success.
var ErrNafathConfigIncomplete = errors.New("lex/integration/nafath: endpoint config incomplete (base_url + sp credentials required)")

// configResolver is the minimal slice of the integration repository the connector
// needs: resolve the DECRYPTED endpoint for a tenant. The repository decrypts the
// config blob on read, so the connector sees plaintext base_url + secrets.
type configResolver interface {
	Get(ctx context.Context, tenantID, id uuid.UUID) (*model.IntegrationEndpoint, error)
}

// NafathVerifyConnector implements the base IntegrationAdapter (Kind + Probe) plus
// the ConnectionTester and Invoker capabilities for the Nafath ExtNafath flow.
type NafathVerifyConnector struct {
	repo    configResolver
	client  *http.Client
	breaker *Breaker
	logger  zerolog.Logger
	now     func() time.Time
	// sandbox forces the in-process mock transport regardless of environment
	// (used by tests); production code leaves it false and lets the environment
	// config decide.
	forceSandbox bool
}

// NafathVerifyConnectorConfig parametrises the connector.
type NafathVerifyConnectorConfig struct {
	// Repo resolves decrypted endpoints. Must be wired with FieldCrypto so the
	// config is plaintext on read. Required for live operation; when nil the
	// connector still answers Probe (honest "not configured") and serves the
	// sandbox mock for endpoints whose environment is uat/sandbox.
	Repo *repository.IntegrationEndpointRepository
	// Client is the HTTP client for non-mTLS calls. Defaults to a 15s client.
	Client *http.Client
	// Timeout bounds a single HTTP call. Defaults to 15s.
	Timeout time.Duration
	// Logger is the structured logger (secrets are never logged).
	Logger zerolog.Logger
}

// NewNafathVerifyConnector builds the connector. The returned value satisfies the
// registry's base IntegrationAdapter (Kind + Probe) structurally, plus the
// ConnectionTester and Invoker capability interfaces, so it can be slotted in via
// IntegrationRegistryService.RegisterAdapter.
func NewNafathVerifyConnector(cfg NafathVerifyConnectorConfig) *NafathVerifyConnector {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copied := *client
		copied.Timeout = timeout
		client = &copied
	}
	var resolver configResolver
	if cfg.Repo != nil {
		resolver = cfg.Repo
	}
	return &NafathVerifyConnector{
		repo:    resolver,
		client:  client,
		breaker: NewBreaker(BreakerConfig{Name: "lex-nafath-verify", Timeout: timeout}),
		logger:  cfg.Logger.With().Str("component", "lex-nafath-verify-connector").Logger(),
		now:     time.Now,
	}
}

// Kind reports the integration kind this connector serves.
func (c *NafathVerifyConnector) Kind() model.IntegrationKind { return NafathVerifyKind }

// Probe reports an HONEST health snapshot for a Nafath endpoint.
//
//   - planned/disabled/error status               -> not reachable (lifecycle).
//   - active + sandbox/uat environment            -> not reachable, graded
//     "not_configured" with a sandbox-mock note: the connector is wired and the
//     mock transport works for demos, but there is NO real Nafath connection yet
//     (status=planned until Elm/TCC creds). NEVER reports healthy here.
//   - active + production + incomplete config      -> not reachable.
//   - active + production + complete config        -> a real reachability check
//     against the SP base_url, graded from the outcome.
func (c *NafathVerifyConnector) Probe(ctx context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        NafathVerifyKind,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}

	if endpoint.Status != model.IntegrationStatusActive {
		health.Reachable = false
		switch endpoint.Status {
		case model.IntegrationStatusPlanned:
			health.Detail = "planned: gov-gated, awaiting Elm/TCC SP onboarding (not_configured)"
		case model.IntegrationStatusDisabled:
			health.Detail = "disabled by operator"
		default:
			health.Detail = "endpoint in error state"
		}
		return health
	}

	cfg := parseNafathConfig(endpoint.Config)

	// Sandbox / UAT: the mock transport is available for demos, but this is NOT a
	// real Nafath connection — grade it honestly as not_configured.
	if c.isSandbox(cfg) {
		health.Reachable = false
		health.Detail = "active in UAT/sandbox: mock transport only; status=planned until Elm/TCC production SP credentials land (not_configured)"
		return health
	}

	if !cfg.complete() {
		health.Reachable = false
		health.Detail = "active but config incomplete: base_url + sp credentials required (not_configured)"
		return health
	}

	// Production with complete config: do a real, side-effect-free reachability
	// probe against the SP base host.
	start := c.now()
	rerr := c.breaker.Execute(ctx, func(cctx context.Context) error {
		return c.ping(cctx, cfg)
	})
	latency := time.Since(start)
	if rerr != nil {
		health.Reachable = false
		health.Detail = "live probe failed: " + sanitizeNafathErr(rerr)
		return health
	}
	health.Reachable = true
	health.Detail = fmt.Sprintf("live Nafath SP reachable (%dms)", latency.Milliseconds())
	return health
}

// TestConnection is the non-mutating Test-Connection probe. It resolves plaintext
// config via the repository and reports a sanitized TestResult. For sandbox/uat it
// returns Reachable=false with an honest mock note (never a faked pass). It NEVER
// echoes secrets.
func (c *NafathVerifyConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	now := c.now().UTC()
	resolved, err := c.resolvePlaintext(ctx, endpoint)
	if err != nil {
		return TestResult{Reachable: false, Detail: sanitizeNafathErr(err), CheckedAt: now}, nil
	}
	cfg := parseNafathConfig(resolved.Config)

	if c.isSandbox(cfg) {
		return TestResult{
			Reachable:     false,
			Detail:        "UAT/sandbox endpoint: mock transport configured; status=planned until production Elm/TCC SP credentials land",
			LatencyMillis: 0,
			CheckedAt:     now,
			Metadata: map[string]any{
				"environment": cfg.Environment,
				"transport":   "sandbox-mock",
				"grade":       "not_configured",
			},
		}, nil
	}

	if !cfg.complete() {
		return TestResult{
			Reachable: false,
			Detail:    "config incomplete: base_url + sp_api_key + sp_api_secret are required for a live Nafath connection",
			CheckedAt: now,
			Metadata:  map[string]any{"grade": "not_configured"},
		}, nil
	}

	start := c.now()
	perr := c.breaker.Execute(ctx, func(cctx context.Context) error { return c.ping(cctx, cfg) })
	latency := time.Since(start)
	if perr != nil {
		return TestResult{
			Reachable:     false,
			Detail:        sanitizeNafathErr(perr),
			LatencyMillis: latency.Milliseconds(),
			CheckedAt:     now,
			Metadata:      map[string]any{"environment": cfg.Environment},
		}, nil
	}
	return TestResult{
		Reachable:     true,
		Detail:        "Nafath SP reachable; SP credentials accepted",
		LatencyMillis: latency.Milliseconds(),
		CheckedAt:     now,
		Metadata:      map[string]any{"environment": cfg.Environment, "sp_id": cfg.SPID},
	}, nil
}

// Invoke performs a named Nafath operation: request | status | details. The
// adapter resolves plaintext config via the repository. In UAT/sandbox it serves a
// deterministic in-process mock so the e-sign happy path is demonstrable without
// real SP access; in production it calls the configured ExtNafath paths. Secrets
// are never returned.
func (c *NafathVerifyConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	resolved, err := c.resolvePlaintext(ctx, endpoint)
	if err != nil {
		return InvokeResult{Operation: op, Success: false, Detail: sanitizeNafathErr(err)}, err
	}
	cfg := parseNafathConfig(resolved.Config)

	switch op {
	case NafathOpRequest, NafathOpStatus, NafathOpDetails:
	default:
		return InvokeResult{Operation: op, Success: false, Detail: "unsupported operation"},
			fmt.Errorf("lex/integration/nafath: unsupported operation %q", operation)
	}

	if c.isSandbox(cfg) {
		return c.invokeSandbox(op, payload, cfg)
	}
	if !cfg.complete() {
		return InvokeResult{Operation: op, Success: false, Detail: "config incomplete; cannot invoke live Nafath"}, ErrNafathConfigIncomplete
	}

	switch op {
	case NafathOpRequest:
		return c.liveRequest(ctx, cfg, payload)
	case NafathOpStatus:
		return c.liveStatus(ctx, cfg, payload)
	default: // NafathOpDetails
		return c.liveDetails(ctx, cfg, payload)
	}
}

// -----------------------------------------------------------------------------
// Live transport
// -----------------------------------------------------------------------------

// liveRequest POSTs {base}{request_path} {nationalId} and surfaces {transId,
// random}. `random` is the number-match value the app shows the citizen.
func (c *NafathVerifyConnector) liveRequest(ctx context.Context, cfg nafathConfig, payload map[string]any) (InvokeResult, error) {
	nationalID := payloadString(payload, "national_id", "nationalId", "id")
	if nationalID == "" {
		return InvokeResult{Operation: NafathOpRequest, Success: false, Detail: "national_id is required"},
			fmt.Errorf("lex/integration/nafath: national_id is required")
	}
	body := map[string]any{"nationalId": nationalID}
	if cfg.SPID != "" {
		body["spId"] = cfg.SPID
	}
	if cfg.Locale != "" {
		body["locale"] = cfg.Locale
	}
	var out struct {
		TransID string `json:"transId"`
		Random  string `json:"random"`
		Status  string `json:"status"`
		Detail  string `json:"detail"`
	}
	if err := c.doJSON(ctx, http.MethodPost, nafathJoin(cfg.BaseURL, cfg.RequestPath), cfg, body, &out); err != nil {
		return InvokeResult{Operation: NafathOpRequest, Success: false, Detail: sanitizeNafathErr(err)}, err
	}
	transID := strings.TrimSpace(out.TransID)
	if transID == "" {
		return InvokeResult{Operation: NafathOpRequest, Success: false, Detail: "Nafath returned no transId"},
			fmt.Errorf("lex/integration/nafath: missing transId in response")
	}
	return InvokeResult{
		Operation: NafathOpRequest,
		Success:   true,
		Reference: transID,
		Detail:    "Nafath challenge dispatched; show the number to the citizen",
		Output: map[string]any{
			"trans_id": transID,
			"random":   strings.TrimSpace(out.Random), // number-match value (not a secret)
			"status":   string(NafathStatusPending),
		},
	}, nil
}

// liveStatus POSTs {transId,random,nationalId} and normalises the upstream state.
func (c *NafathVerifyConnector) liveStatus(ctx context.Context, cfg nafathConfig, payload map[string]any) (InvokeResult, error) {
	transID := payloadString(payload, "trans_id", "transId")
	if transID == "" {
		return InvokeResult{Operation: NafathOpStatus, Success: false, Detail: "trans_id is required"},
			fmt.Errorf("lex/integration/nafath: trans_id is required")
	}
	body := map[string]any{
		"transId":    transID,
		"random":     payloadString(payload, "random"),
		"nationalId": payloadString(payload, "national_id", "nationalId", "id"),
	}
	// Decode into a generic map so the tolerant LoA/acr extraction can see any
	// assurance field shape the SP emits, alongside the typed status.
	var out map[string]any
	if err := c.doJSON(ctx, http.MethodPost, nafathJoin(cfg.BaseURL, cfg.StatusPath), cfg, body, &out); err != nil {
		return InvokeResult{Operation: NafathOpStatus, Success: false, Detail: sanitizeNafathErr(err)}, err
	}
	rawStatus, _ := out["status"].(string)
	mapped := MapNafathStatus(rawStatus)
	loa := extractNafathLoA(out)
	minLoA := resolveMinimumLoA(cfg)
	output := map[string]any{
		"trans_id":      transID,
		"status":        string(mapped),
		"raw_status":    strings.ToUpper(strings.TrimSpace(rawStatus)),
		"terminal":      mapped.IsTerminal(),
		"confirmed":     mapped.Confirmed(),
		"loa":           string(loa),
		"minimum_loa":   string(minLoA),
		"poll_interval": cfg.PollInterval,
	}
	// Fail-closed LoA gate: a CONFIRMED transaction below the minimum assurance is
	// NOT a valid e-sign basis. We surface confirmed=false and a clear reason so a
	// signing flow that trusts `valid_esign_basis` never anchors on a weak factor.
	if loaErr := EnforceNafathLoA(mapped, loa, minLoA); loaErr != nil {
		output["valid_esign_basis"] = false
		output["loa_satisfied"] = false
		output["esign_basis_reason"] = "assurance below minimum (" + string(loa) + " < " + string(minLoA) + ")"
		return InvokeResult{
			Operation: NafathOpStatus,
			Success:   true,
			Reference: transID,
			Detail:    "status: " + string(mapped) + " but assurance below minimum for e-sign basis",
			Output:    output,
		}, nil
	}
	output["loa_satisfied"] = mapped.Confirmed()
	output["valid_esign_basis"] = mapped.Confirmed()
	return InvokeResult{
		Operation: NafathOpStatus,
		Success:   true,
		Reference: transID,
		Detail:    "status: " + string(mapped),
		Output:    output,
	}, nil
}

// liveDetails GETs verified attributes after a COMPLETED transaction.
func (c *NafathVerifyConnector) liveDetails(ctx context.Context, cfg nafathConfig, payload map[string]any) (InvokeResult, error) {
	transID := payloadString(payload, "trans_id", "transId")
	if transID == "" {
		return InvokeResult{Operation: NafathOpDetails, Success: false, Detail: "trans_id is required"},
			fmt.Errorf("lex/integration/nafath: trans_id is required")
	}
	url := nafathJoin(cfg.BaseURL, cfg.DetailsPath) + "?transId=" + transID
	var out map[string]any
	if err := c.doJSON(ctx, http.MethodGet, url, cfg, nil, &out); err != nil {
		return InvokeResult{Operation: NafathOpDetails, Success: false, Detail: sanitizeNafathErr(err)}, err
	}
	loa := extractNafathLoA(out)
	minLoA := resolveMinimumLoA(cfg)
	// Details are only fetched after a COMPLETED transaction, so treat them as the
	// verified basis and gate on assurance fail-closed.
	loaSatisfied := EnforceNafathLoA(NafathStatusVerified, loa, minLoA) == nil
	return InvokeResult{
		Operation: NafathOpDetails,
		Success:   true,
		Reference: transID,
		Detail:    "verified identity attributes retrieved",
		Output: map[string]any{
			"trans_id":          transID,
			"attributes":        redactNafathAttributes(out),
			"loa":               string(loa),
			"minimum_loa":       string(minLoA),
			"loa_satisfied":     loaSatisfied,
			"valid_esign_basis": loaSatisfied,
		},
	}, nil
}

// ping is a side-effect-free reachability probe: a GET against the SP base_url.
// A transport-level success (any HTTP response, even 401) proves reachability;
// only a transport error is a failure.
func (c *NafathVerifyConnector) ping(ctx context.Context, cfg nafathConfig) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, strings.TrimRight(cfg.BaseURL, "/")+"/", nil)
	if err != nil {
		return fmt.Errorf("invalid base_url")
	}
	c.applyAuth(req, cfg)
	resp, err := c.httpClient(cfg).Do(req)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	return nil
}

// doJSON performs an authenticated JSON request against a Nafath path under the
// breaker, retrying TRANSIENT failures (transport errors + 5xx) with a bounded
// linear backoff, and decodes the response into out. The whole retry loop runs
// inside a single breaker Execute so a sustained outage still trips the breaker.
// Non-2xx client responses (4xx) are NOT retried (they will not self-heal). A
// non-2xx is mapped to an operator-safe error carrying only the upstream status
// code (never credentials or response bodies).
func (c *NafathVerifyConnector) doJSON(ctx context.Context, method, url string, cfg nafathConfig, body any, out any) error {
	var raw []byte
	if body != nil {
		marshalled, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request")
		}
		raw = marshalled
	}
	attempts := cfg.MaxRetries
	if attempts < 0 {
		attempts = 0
	}
	if attempts > 5 {
		attempts = 5 // guard against a pathological config
	}
	attempts++ // total = retries + the initial try

	return c.breaker.Execute(ctx, func(cctx context.Context) error {
		var lastErr error
		for attempt := 0; attempt < attempts; attempt++ {
			if attempt > 0 {
				select {
				case <-cctx.Done():
					return cctx.Err()
				case <-time.After(time.Duration(attempt) * 200 * time.Millisecond):
				}
			}
			retryable, err := c.doJSONOnce(cctx, method, url, cfg, raw, body != nil, out)
			if err == nil {
				return nil
			}
			lastErr = err
			if !retryable {
				return err
			}
		}
		if lastErr == nil {
			lastErr = fmt.Errorf("nafath request failed")
		}
		return lastErr
	})
}

// doJSONOnce performs a single Nafath request attempt. retryable reports whether
// the failure is worth another try (transport error or 5xx); 4xx and decode
// failures are terminal.
func (c *NafathVerifyConnector) doJSONOnce(ctx context.Context, method, url string, cfg nafathConfig, raw []byte, hasBody bool, out any) (retryable bool, err error) {
	var reader io.Reader
	if hasBody {
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, url, reader)
	if err != nil {
		return false, fmt.Errorf("invalid endpoint url")
	}
	req.Header.Set("Accept", "application/json")
	if hasBody {
		req.Header.Set("Content-Type", "application/json")
	}
	c.applyAuth(req, cfg)

	resp, err := c.httpClient(cfg).Do(req)
	if err != nil {
		return true, fmt.Errorf("nafath SP unreachable")
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= http.StatusInternalServerError {
		return true, fmt.Errorf("nafath SP returned status %d", resp.StatusCode)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return false, fmt.Errorf("nafath SP returned status %d", resp.StatusCode)
	}
	if out != nil && len(bytes.TrimSpace(respBody)) > 0 {
		if err := json.Unmarshal(respBody, out); err != nil {
			return false, fmt.Errorf("decode nafath response")
		}
	}
	return false, nil
}

// applyAuth sets the SP API key/secret headers. These are the SP credentials, not
// citizen data; they are sent on the wire but NEVER logged or returned.
func (c *NafathVerifyConnector) applyAuth(req *http.Request, cfg nafathConfig) {
	if cfg.SPAPIKey != "" {
		req.Header.Set("apiKey", cfg.SPAPIKey)
		req.Header.Set("Authorization", "Bearer "+cfg.SPAPIKey)
	}
	if cfg.SPAPISecret != "" {
		req.Header.Set("apiSecret", cfg.SPAPISecret)
	}
	if cfg.SPID != "" {
		req.Header.Set("spId", cfg.SPID)
	}
}

// httpClient returns the mTLS client when the endpoint supplies a client cert/key,
// else the default client. The mTLS client is lazily built per call from the
// plaintext PEM in config (cheap; the connector is not on a hot path).
func (c *NafathVerifyConnector) httpClient(cfg nafathConfig) *http.Client {
	if cfg.ClientCertPEM == "" || cfg.ClientKeyPEM == "" {
		return c.client
	}
	cert, err := tls.X509KeyPair([]byte(cfg.ClientCertPEM), []byte(cfg.ClientKeyPEM))
	if err != nil {
		// Fall back to the non-mTLS client; the live call will fail at the TLS
		// handshake with an honest transport error rather than here.
		c.logger.Warn().Msg("nafath mTLS keypair invalid; using non-mTLS client")
		return c.client
	}
	timeout := c.client.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	return &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12},
		},
	}
}

// -----------------------------------------------------------------------------
// Sandbox / UAT mock transport (honest: never reports a real connection)
// -----------------------------------------------------------------------------

// invokeSandbox serves a deterministic in-process Nafath flow for demos. It is
// gated on environment=uat/sandbox and is clearly labelled mock in every result's
// metadata, so it can never be mistaken for a live confirmation.
func (c *NafathVerifyConnector) invokeSandbox(op string, payload map[string]any, cfg nafathConfig) (InvokeResult, error) {
	switch op {
	case NafathOpRequest:
		nationalID := payloadString(payload, "national_id", "nationalId", "id")
		if nationalID == "" {
			return InvokeResult{Operation: op, Success: false, Detail: "national_id is required"},
				fmt.Errorf("lex/integration/nafath: national_id is required")
		}
		transID := "uat-" + uuid.NewString()
		return InvokeResult{
			Operation: op,
			Success:   true,
			Reference: transID,
			Detail:    "sandbox: Nafath challenge simulated",
			Output: map[string]any{
				"trans_id":  transID,
				"random":    sandboxRandom(transID), // deterministic 2-digit match number
				"status":    string(NafathStatusPending),
				"transport": "sandbox-mock",
			},
		}, nil
	case NafathOpStatus:
		transID := payloadString(payload, "trans_id", "transId")
		// In sandbox, a transaction resolves to verified unless the caller asks for
		// a specific outcome via simulate_status (declined/expired/error/pending).
		mapped := NafathStatusVerified
		if sim := payloadString(payload, "simulate_status"); sim != "" {
			mapped = MapNafathStatus(sim)
		}
		return InvokeResult{
			Operation: op,
			Success:   true,
			Reference: transID,
			Detail:    "sandbox: status " + string(mapped),
			Output: map[string]any{
				"trans_id":  transID,
				"status":    string(mapped),
				"terminal":  mapped.IsTerminal(),
				"confirmed": mapped.Confirmed(),
				"transport": "sandbox-mock",
			},
		}, nil
	default: // details
		transID := payloadString(payload, "trans_id", "transId")
		return InvokeResult{
			Operation: op,
			Success:   true,
			Reference: transID,
			Detail:    "sandbox: simulated verified attributes",
			Output: map[string]any{
				"trans_id":  transID,
				"transport": "sandbox-mock",
				"attributes": map[string]any{
					"nationalId":  payloadString(payload, "national_id", "nationalId"),
					"fullNameAr":  "مستخدم تجريبي",
					"fullNameEn":  "Sandbox User",
					"verified":    true,
					"environment": cfg.Environment,
				},
			},
		}, nil
	}
}

// SandboxInvoke (feature 9) — gov-gated sandbox/mock invoke path.
//
// The registry's SandboxInvoke type-asserts this method and dispatches to it for
// the console "try it" action. It serves the EXISTING in-process mock transport
// REGARDLESS of the endpoint config (even a complete production endpoint runs in
// mock mode here): it NEVER calls a real Nafath SP and NEVER mutates real or
// external state. Every result is clearly marked sandbox (Output["sandbox"]=true,
// Output["transport"]="sandbox-mock"). Honest health (Probe / TestConnection) is
// unchanged — those still report not_configured until production Elm/TCC SP
// credentials land; this path is purely a demonstrable deterministic mock.
//
// Deterministic demo flow:
//   - request -> {trans_id, random} where trans_id is a deterministic "sbx-..."
//     id derived from the national_id (so repeat demos are stable) and random is
//     the 2-digit number-match value derived from that trans_id.
//   - status  -> cycles WAITING -> COMPLETED: the first poll (no/zero "attempt")
//     returns pending (WAITING); any attempt>=1 returns verified (COMPLETED). The
//     caller drives the cycle by incrementing payload["attempt"], so the flow is
//     stateless yet deterministic.
//   - details -> deterministic simulated verified attributes.
func (c *NafathVerifyConnector) SandboxInvoke(_ context.Context, _ model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	switch op {
	case NafathOpRequest:
		nationalID := payloadString(payload, "national_id", "nationalId", "id")
		if nationalID == "" {
			nationalID = "1000000000" // demo default so the console try-it always works
		}
		transID := "sbx-" + sandboxTransID(nationalID)
		return InvokeResult{
			Operation: op,
			Success:   true,
			Reference: transID,
			Detail:    "sandbox: Nafath challenge simulated (no live SP); show the number to the citizen",
			Output: map[string]any{
				"sandbox":   true,
				"transport": "sandbox-mock",
				"trans_id":  transID,
				"random":    sandboxRandom(transID), // deterministic 2-digit match number
				"status":    string(NafathStatusPending),
			},
		}, nil

	case NafathOpStatus:
		transID := payloadString(payload, "trans_id", "transId")
		// WAITING -> COMPLETED cycle: poll 0 is pending, any later poll is verified.
		mapped := NafathStatusVerified
		if sandboxAttempt(payload) <= 0 {
			mapped = NafathStatusPending
		}
		return InvokeResult{
			Operation: op,
			Success:   true,
			Reference: transID,
			Detail:    "sandbox: status " + string(mapped),
			Output: map[string]any{
				"sandbox":   true,
				"transport": "sandbox-mock",
				"trans_id":  transID,
				"status":    string(mapped),
				"terminal":  mapped.IsTerminal(),
				"confirmed": mapped.Confirmed(),
			},
		}, nil

	case NafathOpDetails:
		transID := payloadString(payload, "trans_id", "transId")
		return InvokeResult{
			Operation: op,
			Success:   true,
			Reference: transID,
			Detail:    "sandbox: simulated verified attributes",
			Output: map[string]any{
				"sandbox":   true,
				"transport": "sandbox-mock",
				"trans_id":  transID,
				"attributes": map[string]any{
					"nationalId": payloadString(payload, "national_id", "nationalId"),
					"fullNameAr": "مستخدم تجريبي",
					"fullNameEn": "Sandbox User",
					"verified":   true,
				},
			},
		}, nil

	default:
		return InvokeResult{
				Operation: op,
				Success:   false,
				Detail:    "unsupported nafath sandbox operation",
				Output:    map[string]any{"sandbox": true, "transport": "sandbox-mock"},
			},
			fmt.Errorf("lex/integration/nafath: unsupported sandbox operation %q", operation)
	}
}

// sandboxTransID derives a deterministic, credential-free transaction id suffix
// from a seed (the national id) so the console try-it flow is stable across runs.
func sandboxTransID(seed string) string {
	sum := sha256.Sum256([]byte("nafath-sandbox|" + seed))
	return hex.EncodeToString(sum[:6])
}

// sandboxAttempt reads the caller-supplied poll counter that drives the
// WAITING -> COMPLETED cycle. Accepts numeric or string forms; absent/invalid
// counts as 0 (first poll = WAITING).
func sandboxAttempt(payload map[string]any) int {
	for _, k := range []string{"attempt", "poll", "polls", "tick"} {
		v, ok := payload[k]
		if !ok {
			continue
		}
		switch n := v.(type) {
		case float64:
			return int(n)
		case int:
			return n
		case int64:
			return int(n)
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
				return parsed
			}
		}
	}
	return 0
}

// isSandbox reports whether the endpoint should use the mock transport: explicit
// forceSandbox (tests), or a non-production environment.
func (c *NafathVerifyConnector) isSandbox(cfg nafathConfig) bool {
	if c.forceSandbox {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(cfg.Environment)) {
	case "production", "prod", "live":
		return false
	default:
		// uat / sandbox / empty -> mock.
		return true
	}
}

// resolvePlaintext re-loads the endpoint from the repository so the connector
// holds DECRYPTED config (the registry hands it the masked model). When no repo is
// wired it falls back to the passed endpoint (its Config may already be plaintext
// in tests).
func (c *NafathVerifyConnector) resolvePlaintext(ctx context.Context, endpoint model.IntegrationEndpoint) (*model.IntegrationEndpoint, error) {
	if c.repo == nil {
		ep := endpoint
		return &ep, nil
	}
	resolved, err := c.repo.Get(ctx, endpoint.TenantID, endpoint.ID)
	if err != nil {
		return nil, fmt.Errorf("resolve nafath endpoint")
	}
	return resolved, nil
}

// -----------------------------------------------------------------------------
// Webhook: NafathVerificationCompleted (HMAC-verified)
// -----------------------------------------------------------------------------

// NafathWebhookEvent is the normalised inbound webhook payload the integrator's
// route handler (POST /webhooks/lex/nafath/verify) hands downstream after HMAC
// verification. It carries no secrets.
type NafathWebhookEvent struct {
	// TransID is the Nafath transaction the callback refers to.
	TransID string `json:"trans_id"`
	// NationalID of the confirmed citizen (when the SP echoes it).
	NationalID string `json:"national_id,omitempty"`
	// Status is the NORMALISED lex status (verified/declined/expired/...).
	Status NafathVerificationStatus `json:"status"`
	// RawStatus is the upstream vendor status, upper-cased.
	RawStatus string `json:"raw_status"`
	// LoA is the normalised assurance level the confirmation was performed at.
	LoA NafathLoA `json:"loa"`
	// MinimumLoA is the minimum assurance level required for an e-sign basis.
	MinimumLoA NafathLoA `json:"minimum_loa"`
	// LoASatisfied reports whether LoA meets-or-exceeds MinimumLoA. When the status
	// is verified but this is false the confirmation is NOT a valid e-sign basis.
	LoASatisfied bool `json:"loa_satisfied"`
	// ValidEsignBasis is true only when the status is verified AND the assurance
	// level meets the minimum — the precondition for anchoring an identity-confirmed
	// signature (which still pairs with a TSP; identity_confirmed != signed).
	ValidEsignBasis bool `json:"valid_esign_basis"`
	// ReceivedAt is when lex accepted the callback (UTC).
	ReceivedAt time.Time `json:"received_at"`
}

// nafathWebhookWire is the raw inbound webhook body shape (tolerant field names).
type nafathWebhookWire struct {
	TransID    string `json:"transId"`
	TransIDAlt string `json:"trans_id"`
	NationalID string `json:"nationalId"`
	NationalAt string `json:"national_id"`
	Status     string `json:"status"`
}

// VerifyNafathWebhook authenticates an inbound NafathVerificationCompleted
// webhook and returns the normalised event. It verifies an HMAC-SHA256 over the
// RAW request body keyed by the endpoint's webhook secret (constant-time compare),
// then maps the upstream status and gates the assurance level fail-closed. The
// signature may be bare hex or "sha256="/"v1=" prefixed. The integrator's route
// handler resolves the active nafath_verify endpoint for the tenant, reads its
// plaintext webhook secret + minimum LoA via the repo, and passes (secret,
// rawBody, signatureHeader, minLoA) here. Use WebhookSecretFor and
// MinimumLoAFor to derive the latter two from the decrypted endpoint.
//
// Fail-closed: an unverified signature yields ErrNafathWebhookSignature (the body
// is NEVER parsed before the HMAC checks out, so a forged/tampered callback can
// never mutate identity state). A verified callback whose assurance is below the
// minimum is returned with Status preserved but ValidEsignBasis=false, so a
// downstream signing flow cannot anchor on a weak factor.
//
// Secrets are never logged.
func VerifyNafathWebhook(secret string, rawBody []byte, signatureHeader string, minLoA NafathLoA, now time.Time) (NafathWebhookEvent, error) {
	if strings.TrimSpace(secret) == "" {
		return NafathWebhookEvent{}, ErrNafathWebhookSignature
	}
	if !verifyNafathHMAC(secret, rawBody, signatureHeader) {
		return NafathWebhookEvent{}, ErrNafathWebhookSignature
	}
	var wire nafathWebhookWire
	var generic map[string]any
	if len(bytes.TrimSpace(rawBody)) > 0 {
		if err := json.Unmarshal(rawBody, &wire); err != nil {
			return NafathWebhookEvent{}, fmt.Errorf("lex/integration/nafath: decode webhook body")
		}
		// A second tolerant decode lets the LoA/acr extraction see any assurance
		// field shape without coupling the typed wire struct to every vendor key.
		_ = json.Unmarshal(rawBody, &generic)
	}
	transID := nafathFirstNonEmpty(wire.TransID, wire.TransIDAlt)
	nationalID := nafathFirstNonEmpty(wire.NationalID, wire.NationalAt)
	mapped := MapNafathStatus(wire.Status)
	loa := extractNafathLoA(generic)
	if minLoA.rank() < DefaultNafathMinimumLoA.rank() {
		minLoA = DefaultNafathMinimumLoA // clamp to the hard floor
	}
	loaSatisfied := EnforceNafathLoA(mapped, loa, minLoA) == nil
	return NafathWebhookEvent{
		TransID:         transID,
		NationalID:      nationalID,
		Status:          mapped,
		RawStatus:       strings.ToUpper(strings.TrimSpace(wire.Status)),
		LoA:             loa,
		MinimumLoA:      minLoA,
		LoASatisfied:    loaSatisfied,
		ValidEsignBasis: mapped.Confirmed() && loaSatisfied,
		ReceivedAt:      now.UTC(),
	}, nil
}

// MinimumLoAFor exposes the (clamped) minimum assurance level configured on an
// endpoint, so the integrator's webhook route can pass it to VerifyNafathWebhook
// without re-implementing the tolerant key lookup + number-match floor clamp. It
// must be called with a DECRYPTED endpoint (resolved via the repository).
func MinimumLoAFor(endpoint model.IntegrationEndpoint) NafathLoA {
	return resolveMinimumLoA(parseNafathConfig(endpoint.Config))
}

// ErrNafathWebhookSignature is returned when the inbound webhook HMAC does not
// verify against the endpoint's webhook secret.
var ErrNafathWebhookSignature = errors.New("lex/integration/nafath: invalid webhook signature")

// verifyNafathHMAC computes HMAC-SHA256 over the raw body and constant-time
// compares it to the supplied signature (hex, optionally prefixed).
func verifyNafathHMAC(secret string, body []byte, signature string) bool {
	expected := hmac.New(sha256.New, []byte(secret))
	expected.Write(body)
	want := expected.Sum(nil)
	got, ok := decodeNafathSignature(signature)
	if !ok {
		return false
	}
	return subtle.ConstantTimeCompare(got, want) == 1
}

func decodeNafathSignature(signature string) ([]byte, bool) {
	sig := strings.TrimSpace(signature)
	for _, prefix := range []string{"sha256=", "hmac-sha256=", "v1="} {
		if strings.HasPrefix(strings.ToLower(sig), prefix) {
			sig = sig[len(prefix):]
			break
		}
	}
	raw, err := hex.DecodeString(strings.TrimSpace(sig))
	if err != nil || len(raw) == 0 {
		return nil, false
	}
	return raw, true
}

// -----------------------------------------------------------------------------
// Config parsing (plaintext, tolerant keys — najiz_court_adapter.go shape)
// -----------------------------------------------------------------------------

// nafathConfig is the connection config resolved from the decrypted endpoint.
type nafathConfig struct {
	Environment   string
	BaseURL       string
	SPID          string
	CallbackURL   string
	Locale        string
	MinimumLoA    string // configured minimum assurance level (clamped to the number-match floor)
	MaxRetries    int    // transient-failure retry budget (0 disables, clamped)
	PollInterval  int
	RequestPath   string
	StatusPath    string
	DetailsPath   string
	SPAPIKey      string // secret
	SPAPISecret   string // secret
	WebhookSecret string // secret
	ClientCertPEM string // optional mTLS (secret)
	ClientKeyPEM  string // optional mTLS (secret)
}

// complete reports whether the config has the minimum settings for a LIVE call.
func (cfg nafathConfig) complete() bool {
	return cfg.BaseURL != "" && cfg.SPAPIKey != "" && cfg.SPAPISecret != ""
}

func parseNafathConfig(config map[string]any) nafathConfig {
	cfg := nafathConfig{
		Environment:   firstNafathString(config, "environment", "env"),
		BaseURL:       firstNafathString(config, "base_url", "url", "endpoint"),
		SPID:          firstNafathString(config, "sp_id", "spId", "service_id", "client_id"),
		CallbackURL:   firstNafathString(config, "callback_url", "callbackUrl", "redirect_uri"),
		Locale:        firstNafathString(config, "locale", "lang"),
		MinimumLoA:    firstNafathString(config, "minimum_loa", "min_loa", "minimum_acr", "min_acr"),
		RequestPath:   firstNafathString(config, "request_path", "requestPath"),
		StatusPath:    firstNafathString(config, "status_path", "statusPath"),
		DetailsPath:   firstNafathString(config, "details_path", "detailsPath"),
		SPAPIKey:      firstNafathString(config, "sp_api_key", "api_key", "apiKey", "client_secret"),
		SPAPISecret:   firstNafathString(config, "sp_api_secret", "api_secret", "apiSecret"),
		WebhookSecret: firstNafathString(config, "webhook_secret", "callback_secret", "hmac_secret"),
		ClientCertPEM: firstNafathString(config, "client_cert_pem", "mtls_cert"),
		ClientKeyPEM:  firstNafathString(config, "client_key_pem", "mtls_key"),
	}
	if cfg.RequestPath == "" {
		cfg.RequestPath = defaultNafathRequestPath
	}
	if cfg.StatusPath == "" {
		cfg.StatusPath = defaultNafathStatusPath
	}
	if cfg.DetailsPath == "" {
		cfg.DetailsPath = defaultNafathDetailsPath
	}
	cfg.PollInterval = firstNafathInt(config, 5, "poll_interval", "pollInterval")
	cfg.MaxRetries = firstNafathInt(config, 2, "max_retries", "maxRetries", "retries")
	return cfg
}

// WebhookSecretFor exposes the (plaintext) webhook secret resolved from an
// endpoint's config, so the integrator's route handler can verify the inbound
// signature without re-implementing the tolerant key lookup. It must be called
// with a DECRYPTED endpoint (resolved via the repository), never the masked one.
func WebhookSecretFor(endpoint model.IntegrationEndpoint) string {
	return parseNafathConfig(endpoint.Config).WebhookSecret
}

func firstNafathString(config map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
		}
	}
	return ""
}

func firstNafathInt(config map[string]any, def int, keys ...string) int {
	for _, k := range keys {
		v, ok := config[k]
		if !ok {
			continue
		}
		switch n := v.(type) {
		case float64:
			if int(n) > 0 {
				return int(n)
			}
		case int:
			if n > 0 {
				return n
			}
		case string:
			if parsed, err := strconv.Atoi(strings.TrimSpace(n)); err == nil && parsed > 0 {
				return parsed
			}
		}
	}
	return def
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

func nafathJoin(base, path string) string {
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

func payloadString(payload map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := payload[k]; ok {
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				return strings.TrimSpace(s)
			}
			if v != nil {
				if s := strings.TrimSpace(fmt.Sprint(v)); s != "" && s != "<nil>" {
					return s
				}
			}
		}
	}
	return ""
}

func nafathFirstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

// sandboxRandom derives a deterministic 2-digit number-match value from a trans id
// so the same demo transaction always shows the same number.
func sandboxRandom(transID string) string {
	sum := 0
	for _, r := range transID {
		sum += int(r)
	}
	return fmt.Sprintf("%02d", sum%100)
}

// redactNafathAttributes strips any obviously sensitive keys from a details
// response before it leaves the connector (defence in depth — the details call
// returns identity attributes, never SP credentials, but we drop anything that
// looks like a secret/token regardless).
func redactNafathAttributes(attrs map[string]any) map[string]any {
	if attrs == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(attrs))
	for k, v := range attrs {
		lk := strings.ToLower(k)
		if strings.Contains(lk, "secret") || strings.Contains(lk, "apikey") ||
			strings.Contains(lk, "api_key") || strings.Contains(lk, "password") ||
			strings.Contains(lk, "token") {
			continue
		}
		out[k] = v
	}
	return out
}

// sanitizeNafathErr produces an operator-safe error string that never contains
// credential material. Breaker-open is surfaced plainly; other errors pass through
// their (already credential-free) message.
func sanitizeNafathErr(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, ErrBreakerOpen) {
		return "circuit breaker open (upstream Nafath SP considered down)"
	}
	if errors.Is(err, ErrNafathConfigIncomplete) {
		return "endpoint config incomplete"
	}
	return err.Error()
}

// Compile-time assertions: the connector satisfies the capability interfaces.
// (The base IntegrationAdapter — Kind + Probe — is satisfied structurally and
// asserted at the registry wiring site, which lives in the service package.)
var (
	_ ConnectionTester = (*NafathVerifyConnector)(nil)
	_ Invoker          = (*NafathVerifyConnector)(nil)
)
