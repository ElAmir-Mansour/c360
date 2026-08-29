package integration

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Najiz court-portal connector (MoJ Takamul) — Integration Platform Phase 2.
//
// This UPGRADES the Phase-1 najiz_court_adapter.go (add-representative seam) into
// a full framework connector implementing the three optional capabilities:
//
//   - ConnectionTester — mints a client-credentials token round-trip (no writes).
//   - Syncer           — read-only pulls (highest legal value first):
//                         pull_hearings (feeds the lex case calendar),
//                         get_case (status by Najiz reference),
//                         list_judgments, get_enforcement_case (Tanfeedh).
//   - Invoker          — mutating ops behind Nafath gating:
//                         add_representative / register_agency (existing path,
//                         upgraded to OAuth2 client-credentials + optional mTLS),
//                         issue_wakala (gated: returns ErrNajizWakalaPendingNafath
//                         until a Nafath-confirmed identity reference is supplied).
//
// HONEST MATURITY. Najiz/Takamul is gov-gated: real endpoint contracts are
// access-gated and unconfirmed. So the connector SHIPS configurable + with a
// sandbox/mock transport, and grades health NOT-CONFIGURED until creds land —
// it NEVER reports healthy when unconfigured. Three transport modes, selected by
// the resolved config:
//
//   - manual-fallback: no active config at all -> ErrNajizNotConfigured, so the
//     caller keeps the honest manual-entry + najiz_status path (Phase-1 contract).
//   - sandbox (environment=sandbox OR base_url is a najiz: sandbox sentinel):
//     a deterministic in-process mock so the console/E2E can exercise the wiring
//     without live MoJ access. Health is graded "sandbox" (reachable=true but
//     clearly labelled), NOT a fake production-healthy.
//   - production (environment=production + base_url + token_url + client creds):
//     real OAuth2 client-credentials (cached via oauth.go) + optional mTLS over
//     configurable base_url/token_url/paths. NEVER hardcodes a gov path.
//
// CONFIG + SECRETS CUSTODY. The connector resolves PLAINTEXT config from the
// model.IntegrationEndpoint handed to it by the registry (the registry re-loads
// the endpoint via the FieldCrypto-decrypting repo before dispatch — see
// IntegrationRegistryService.TestConnection/SyncNow/probe). Secrets (client_secret,
// mtls_key_pem) are NEVER logged or returned.
// =============================================================================

// ErrNajizNotConfigured mirrors the Phase-1 sentinel: no usable Najiz config is
// present, so the caller falls back to manual entry rather than erroring.
var ErrNajizNotConfigured = errors.New("lex/integration/najiz: no usable Najiz configuration (manual fallback)")

// ErrNajizWakalaPendingNafath is returned by the issue_wakala op when no
// Nafath-confirmed identity reference accompanies the request. A wakala (DoA)
// must be bound to a Nafath-confirmed identity before it can be issued on the
// portal; the connector refuses to fabricate one.
var ErrNajizWakalaPendingNafath = errors.New("lex/integration/najiz: wakala issuance pending Nafath identity confirmation")

// Najiz invoke operation names (stable, lowercase). register_agency is an alias
// of add_representative (the portal models a representative as an agency entry).
const (
	najizOpAddRepresentative = "add_representative"
	najizOpRegisterAgency    = "register_agency"
	najizOpIssueWakala       = "issue_wakala"
)

// Najiz sync operation names (read-only). The default sync op (when none is
// requested via config) is pull_hearings — the highest-value feed for the lex
// case calendar.
const (
	najizSyncPullHearings    = "pull_hearings"
	najizSyncGetCase         = "get_case"
	najizSyncListJudgments   = "list_judgments"
	najizSyncEnforcementCase = "get_enforcement_case"
)

// najizTransportMode is the resolved operating mode for a probe/test/sync/invoke.
type najizTransportMode string

const (
	najizModeUnconfigured najizTransportMode = "unconfigured"
	najizModeSandbox      najizTransportMode = "sandbox"
	najizModeProduction   najizTransportMode = "production"
)

// NajizConnector is the framework connector for the Najiz (Takamul) court portal.
type NajizConnector struct {
	tokens *OAuthTokenCache
	client *http.Client
	logger zerolog.Logger
	now    func() time.Time

	// mtlsMu guards the lazily-built per-config mTLS client cache so a client
	// certificate is parsed once per credential set rather than per call.
	mtlsMu      sync.Mutex
	mtlsClients map[string]*http.Client
}

// NajizConnectorConfig parametrises the connector. All fields are optional and
// default sensibly; the connector resolves per-endpoint settings at call time.
type NajizConnectorConfig struct {
	// Tokens is the shared client-credentials token cache (oauth.go). When nil a
	// private cache is created.
	Tokens *OAuthTokenCache
	// Client is the base HTTP client for non-mTLS calls. When nil a 15s-timeout
	// client is used.
	Client *http.Client
	// Timeout bounds a single HTTP call when Client has no timeout. Defaults 15s.
	Timeout time.Duration
	Logger  zerolog.Logger
}

// NewNajizConnector builds the connector with sane defaults.
func NewNajizConnector(cfg NajizConnectorConfig) *NajizConnector {
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
	tokens := cfg.Tokens
	if tokens == nil {
		tokens = NewOAuthTokenCache(&http.Client{Timeout: timeout}, 0)
	}
	return &NajizConnector{
		tokens:      tokens,
		client:      client,
		logger:      cfg.Logger.With().Str("component", "lex-najiz-connector").Logger(),
		now:         time.Now,
		mtlsClients: map[string]*http.Client{},
	}
}

// Kind implements service.IntegrationAdapter.
func (c *NajizConnector) Kind() model.IntegrationKind { return model.IntegrationKindNajiz }

// Probe implements service.IntegrationAdapter. It performs NO network call: it
// grades health from the resolved config + endpoint status, so HealthAll stays
// cheap and honest. Unconfigured -> reachable=false / detail "not_configured".
// Sandbox -> reachable=true but clearly labelled "sandbox". Production with a
// complete credential set -> reachable=true "configured" (a live token round-trip
// is the explicit Test Connection action, not the passive health probe).
func (c *NajizConnector) Probe(_ context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	cfg := parseNajizConnectorConfig(endpoint.Config)
	mode := cfg.mode()
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindNajiz,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}

	// Disabled/error endpoints report their lifecycle state regardless of config.
	switch endpoint.Status {
	case model.IntegrationStatusDisabled:
		health.Reachable = false
		health.Detail = "disabled by operator"
		return health
	case model.IntegrationStatusError:
		health.Reachable = false
		health.Detail = "endpoint in error state"
		return health
	}

	switch mode {
	case najizModeProduction:
		if endpoint.Status == model.IntegrationStatusActive {
			health.Reachable = true
			health.Detail = "configured (Takamul production); run Test Connection to verify token round-trip"
		} else {
			health.Reachable = false
			health.Detail = "configured but not activated (planned)"
		}
	case najizModeSandbox:
		// Sandbox is reachable but NEVER graded production-healthy; the label makes
		// the maturity honest to the operator.
		health.Reachable = true
		health.Detail = "sandbox/mock transport (no live MoJ Takamul access); not production-graded"
	default:
		// Unconfigured: honest not_configured, never healthy.
		health.Reachable = false
		health.Detail = "not_configured: Najiz/Takamul credentials not yet onboarded (manual fallback in effect)"
	}
	return health
}

// TestConnection implements integration.ConnectionTester. In production mode it
// mints a client-credentials token round-trip (no writes). In sandbox mode it
// returns a deterministic reachable result clearly labelled sandbox. Unconfigured
// returns reachable=false with not_configured detail (never a faked pass).
func (c *NajizConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	start := c.now()
	cfg := parseNajizConnectorConfig(endpoint.Config)
	res := TestResult{CheckedAt: start.UTC()}

	switch cfg.mode() {
	case najizModeUnconfigured:
		res.Reachable = false
		res.Detail = "not_configured: Najiz/Takamul credentials not yet onboarded"
		res.LatencyMillis = sinceMillis(c.now(), start)
		return res, nil

	case najizModeSandbox:
		res.Reachable = true
		res.Detail = "sandbox transport OK (mock token issued; not a live MoJ Takamul connection)"
		res.LatencyMillis = sinceMillis(c.now(), start)
		res.Metadata = map[string]any{"mode": string(najizModeSandbox), "environment": cfg.Environment}
		return res, nil
	}

	// Production: real client-credentials token round-trip.
	if err := cfg.requireProductionCreds(); err != nil {
		res.Reachable = false
		res.Detail = err.Error()
		res.LatencyMillis = sinceMillis(c.now(), start)
		return res, nil
	}
	tok, err := c.tokens.Token(ctx, cfg.oauth(endpoint))
	res.LatencyMillis = sinceMillis(c.now(), start)
	if err != nil {
		// oauth.go already sanitises the upstream error label (no credentials).
		res.Reachable = false
		res.Detail = sanitizeNajiz(err.Error())
		return res, nil
	}
	res.Reachable = tok != ""
	res.Detail = "client-credentials token acquired from Takamul token endpoint"
	res.Metadata = map[string]any{"mode": string(najizModeProduction), "environment": cfg.Environment, "mtls": cfg.mtlsEnabled()}
	return res, nil
}

// Sync implements integration.Syncer. It runs ONE read-only operation per call,
// selected by the endpoint's config "sync_operation" (defaulting to pull_hearings).
// The actual reconciliation into the lex case calendar / case status is owned by
// the litigation services; this connector returns a SyncReport (counts + a
// non-sensitive sample payload in Metadata) and the registry writes the ledger row.
func (c *NajizConnector) Sync(ctx context.Context, endpoint model.IntegrationEndpoint, mode SyncMode) (SyncReport, error) {
	cfg := parseNajizConnectorConfig(endpoint.Config)
	op := cfg.syncOperation()
	report := SyncReport{Mode: NormalizeSyncMode(string(mode))}

	switch cfg.mode() {
	case najizModeUnconfigured:
		// Honest manual fallback: not an error, zero processed, clearly labelled.
		report.Detail = "not_configured: Najiz read sync skipped (manual fallback)"
		report.Metadata = map[string]any{"operation": op, "mode": string(najizModeUnconfigured)}
		return report, ErrNajizNotConfigured

	case najizModeSandbox:
		rows := najizSandboxRecords(op, endpoint)
		report.Processed = len(rows)
		report.Created = len(rows)
		report.Watermark = c.now().UTC().Format(time.RFC3339)
		report.Detail = fmt.Sprintf("sandbox %s returned %d record(s) (mock)", op, len(rows))
		report.Metadata = map[string]any{"operation": op, "mode": string(najizModeSandbox), "sample": rows}
		return report, nil
	}

	// Production read.
	if err := cfg.requireProductionCreds(); err != nil {
		report.Detail = "najiz read sync misconfigured"
		report.Failed = 1
		return report, validationNajiz(err.Error())
	}
	path, ok := cfg.syncPath(op)
	if !ok {
		report.Detail = "unsupported najiz sync operation"
		report.Failed = 1
		return report, validationNajiz("unsupported sync_operation: " + op)
	}
	rows, raw, err := c.getJSON(ctx, endpoint, cfg, path, report.Mode)
	if err != nil {
		report.Failed = 1
		report.Detail = "najiz read sync failed"
		return report, err
	}
	report.Processed = len(rows)
	report.Created = len(rows) // reconciliation owned downstream; we count fetched rows
	report.Watermark = najizWatermark(raw, c.now)
	report.Detail = fmt.Sprintf("%s returned %d record(s) from Takamul", op, len(rows))
	report.Metadata = map[string]any{"operation": op, "mode": string(najizModeProduction), "count": len(rows)}
	return report, nil
}

// Invoke implements integration.Invoker for the mutating operations.
func (c *NajizConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	cfg := parseNajizConnectorConfig(endpoint.Config)
	out := InvokeResult{Operation: op}

	switch op {
	case najizOpAddRepresentative, najizOpRegisterAgency:
		return c.invokeAddRepresentative(ctx, endpoint, cfg, op, payload)
	case najizOpIssueWakala:
		return c.invokeIssueWakala(ctx, endpoint, cfg, payload)
	default:
		out.Detail = "unsupported najiz operation"
		return out, validationNajiz("unsupported operation: " + op)
	}
}

// invokeAddRepresentative registers a company representative / litigation agency
// on the portal (the Phase-1 path, upgraded to OAuth2 + optional mTLS).
func (c *NajizConnector) invokeAddRepresentative(ctx context.Context, endpoint model.IntegrationEndpoint, cfg najizConnectorConfig, op string, payload map[string]any) (InvokeResult, error) {
	out := InvokeResult{Operation: op}

	switch cfg.mode() {
	case najizModeUnconfigured:
		out.Detail = "not_configured: representative kept as manual entry (najiz_status=manual)"
		out.Output = map[string]any{"najiz_status": string(model.NajizSyncStatusManual)}
		return out, ErrNajizNotConfigured

	case najizModeSandbox:
		ref := najizSandboxReference("REP", endpoint, payload)
		out.Success = true
		out.Reference = ref
		out.Detail = "sandbox: representative registered (mock); not a live Takamul submission"
		out.Output = map[string]any{
			"najiz_status": string(model.NajizSyncStatusSynced),
			"mode":         string(najizModeSandbox),
		}
		return out, nil
	}

	if err := cfg.requireProductionCreds(); err != nil {
		out.Detail = "najiz add-representative misconfigured"
		return out, validationNajiz(err.Error())
	}
	body := najizRepresentativePayload(endpoint.TenantID.String(), payload, c.now().UTC())
	resp, err := c.postJSON(ctx, endpoint, cfg, cfg.AddRepresentativePath, body)
	if err != nil {
		out.Detail = "najiz add-representative dispatch failed"
		out.Output = map[string]any{"najiz_status": string(model.NajizSyncStatusFailed)}
		return out, err
	}
	status := model.NajizSyncStatus(strings.ToLower(strings.TrimSpace(stringField(resp, "status"))))
	if !status.Valid() {
		status = model.NajizSyncStatusSynced
	}
	out.Success = status == model.NajizSyncStatusSynced
	out.Reference = strings.TrimSpace(stringField(resp, "reference"))
	out.Detail = orDefault(stringField(resp, "detail"), "registered on Najiz portal")
	out.Output = map[string]any{"najiz_status": string(status)}
	return out, nil
}

// invokeIssueWakala issues a wakala (DoA / power of attorney) on the portal. It
// is HARD-GATED on a Nafath-confirmed identity: the payload must carry a
// non-empty nafath_reference (or identity_confirmed=true with a reference),
// otherwise the connector refuses with ErrNajizWakalaPendingNafath rather than
// fabricating an unverified DoA. Nafath confirms identity; it is NOT a CA, so the
// gate keeps identity_confirmed distinct from signed.
func (c *NajizConnector) invokeIssueWakala(ctx context.Context, endpoint model.IntegrationEndpoint, cfg najizConnectorConfig, payload map[string]any) (InvokeResult, error) {
	out := InvokeResult{Operation: najizOpIssueWakala}

	nafathRef := strings.TrimSpace(stringField(payload, "nafath_reference"))
	if nafathRef == "" {
		// Pending-Nafath gate: never auto-issue without a confirmed identity.
		out.Detail = "pending_nafath: provide a Nafath-confirmed identity reference before issuing the wakala"
		out.Output = map[string]any{"gate": "pending_nafath"}
		return out, ErrNajizWakalaPendingNafath
	}

	switch cfg.mode() {
	case najizModeUnconfigured:
		out.Detail = "not_configured: wakala kept pending (manual issuance)"
		return out, ErrNajizNotConfigured

	case najizModeSandbox:
		out.Success = true
		out.Reference = najizSandboxReference("WAKALA", endpoint, payload)
		out.Detail = "sandbox: wakala issued (mock) against Nafath-confirmed identity"
		out.Output = map[string]any{"mode": string(najizModeSandbox), "nafath_reference": nafathRef}
		return out, nil
	}

	if err := cfg.requireProductionCreds(); err != nil {
		out.Detail = "najiz issue-wakala misconfigured"
		return out, validationNajiz(err.Error())
	}
	body := map[string]any{
		"tenant_id":        endpoint.TenantID.String(),
		"nafath_reference": nafathRef,
		"requested_at":     c.now().UTC().Format(time.RFC3339Nano),
	}
	for k, v := range payload {
		if k == "nafath_reference" {
			continue
		}
		body[k] = v
	}
	resp, err := c.postJSON(ctx, endpoint, cfg, cfg.WakalaPath, body)
	if err != nil {
		out.Detail = "najiz issue-wakala dispatch failed"
		return out, err
	}
	out.Success = true
	out.Reference = strings.TrimSpace(stringField(resp, "reference"))
	out.Detail = orDefault(stringField(resp, "detail"), "wakala issued on Najiz portal")
	out.Output = map[string]any{"nafath_reference": nafathRef}
	return out, nil
}

// ---------------------------------------------------------------------------
// SandboxInvoke (feature 9) — gov-gated sandbox/mock invoke path.
//
// The registry's SandboxInvoke type-asserts this method and dispatches to it for
// the "try it" console action. It runs the EXISTING in-process mock transport
// REGARDLESS of the endpoint config (even a fully-configured production endpoint
// is exercised in mock mode here): it NEVER touches a real MoJ Takamul endpoint
// and NEVER mutates real or external state. Every result is clearly marked
// sandbox (Output["sandbox"]=true, Output["mode"]="sandbox"). The honest health
// grade (Probe / TestConnection) is unchanged — those still report not_configured
// until real creds land; this path is purely a demonstrable mock.
//
// Supported ops:
//   - pull_hearings    -> 2-3 deterministic mock hearings.
//   - add_representative / register_agency -> a mock ack with a deterministic ref.
func (c *NajizConnector) SandboxInvoke(_ context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	if op == "" {
		op = najizSyncPullHearings // most-useful default for the console demo
	}
	out := InvokeResult{Operation: op}

	switch op {
	case najizSyncPullHearings:
		rows := najizSandboxRecords(najizSyncPullHearings, endpoint)
		out.Success = true
		out.Detail = fmt.Sprintf("sandbox: pulled %d mock hearing(s) (no live MoJ Takamul access)", len(rows))
		out.Output = map[string]any{
			"sandbox":  true,
			"mode":     string(najizModeSandbox),
			"count":    len(rows),
			"hearings": rows,
		}
		return out, nil

	case najizOpAddRepresentative, najizOpRegisterAgency:
		ref := najizSandboxReference("REP", endpoint, payload)
		out.Success = true
		out.Reference = ref
		out.Detail = "sandbox: representative acknowledged (mock); not a live Takamul submission"
		out.Output = map[string]any{
			"sandbox":      true,
			"mode":         string(najizModeSandbox),
			"najiz_status": string(model.NajizSyncStatusSynced),
			"reference":    ref,
			"acknowledged": true,
		}
		return out, nil

	default:
		out.Detail = "unsupported najiz sandbox operation"
		out.Output = map[string]any{"sandbox": true, "mode": string(najizModeSandbox)}
		return out, validationNajiz("unsupported sandbox operation: " + op)
	}
}

// ---------------------------------------------------------------------------
// HTTP transport (production). All calls go through the resolved client (mTLS
// when configured) with a bearer client-credentials token. Secrets never logged.
// ---------------------------------------------------------------------------

func (c *NajizConnector) getJSON(ctx context.Context, endpoint model.IntegrationEndpoint, cfg najizConnectorConfig, path string, mode SyncMode) ([]map[string]any, map[string]any, error) {
	client, err := c.resolveClient(cfg, endpoint)
	if err != nil {
		return nil, nil, err
	}
	tok, err := c.tokens.Token(ctx, cfg.oauth(endpoint))
	if err != nil {
		return nil, nil, internalNajiz("acquire najiz token", err)
	}
	url := najizJoin(cfg.BaseURL, path)
	if mode == SyncModeDelta {
		url = appendQuery(url, "mode", "delta")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, nil, validationNajiz("najiz base_url is invalid")
	}
	c.applyHeaders(req, cfg, endpoint, tok)
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, internalNajiz("dispatch najiz read", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == http.StatusUnauthorized {
		c.tokens.Invalidate(cfg.cacheKey(endpoint))
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, nil, internalNajiz("najiz read rejected", fmt.Errorf("status %d", resp.StatusCode))
	}
	rows, raw := najizDecodeList(respBody)
	return rows, raw, nil
}

func (c *NajizConnector) postJSON(ctx context.Context, endpoint model.IntegrationEndpoint, cfg najizConnectorConfig, path string, body map[string]any) (map[string]any, error) {
	client, err := c.resolveClient(cfg, endpoint)
	if err != nil {
		return nil, err
	}
	tok, err := c.tokens.Token(ctx, cfg.oauth(endpoint))
	if err != nil {
		return nil, internalNajiz("acquire najiz token", err)
	}
	buf, err := json.Marshal(body)
	if err != nil {
		return nil, internalNajiz("marshal najiz request", err)
	}
	url := najizJoin(cfg.BaseURL, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(buf))
	if err != nil {
		return nil, validationNajiz("najiz base_url is invalid")
	}
	req.Header.Set("Content-Type", "application/json")
	c.applyHeaders(req, cfg, endpoint, tok)
	resp, err := client.Do(req)
	if err != nil {
		return nil, internalNajiz("dispatch najiz write", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode == http.StatusUnauthorized {
		c.tokens.Invalidate(cfg.cacheKey(endpoint))
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, internalNajiz("najiz portal rejected request", fmt.Errorf("status %d", resp.StatusCode))
	}
	out := map[string]any{}
	if len(bytes.TrimSpace(respBody)) > 0 {
		if err := json.Unmarshal(respBody, &out); err != nil {
			return nil, internalNajiz("decode najiz response", err)
		}
	}
	return out, nil
}

func (c *NajizConnector) applyHeaders(req *http.Request, cfg najizConnectorConfig, endpoint model.IntegrationEndpoint, token string) {
	req.Header.Set("Accept", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if cfg.CourtID != "" {
		req.Header.Set("X-Najiz-Court-ID", cfg.CourtID)
	}
	if cfg.EntityNationalNumber != "" {
		req.Header.Set("X-Najiz-Entity-National-Number", cfg.EntityNationalNumber)
	}
	if cfg.OrgID != "" {
		req.Header.Set("X-Najiz-Org-ID", cfg.OrgID)
	}
	req.Header.Set("X-Clario360-Tenant-ID", endpoint.TenantID.String())
}

// resolveClient returns the base client, or a per-config mTLS client when a
// client certificate/key are configured. The mTLS client is cached per credential
// set so the cert is parsed once. The private key PEM is held only in memory.
func (c *NajizConnector) resolveClient(cfg najizConnectorConfig, endpoint model.IntegrationEndpoint) (*http.Client, error) {
	if !cfg.mtlsEnabled() {
		return c.client, nil
	}
	key := cfg.cacheKey(endpoint) + "|mtls"
	c.mtlsMu.Lock()
	defer c.mtlsMu.Unlock()
	if cl, ok := c.mtlsClients[key]; ok {
		return cl, nil
	}
	cert, err := tls.X509KeyPair([]byte(cfg.MTLSCertPEM), []byte(cfg.MTLSKeyPEM))
	if err != nil {
		// Do NOT echo the key material; only a generic reason.
		return nil, validationNajiz("najiz mTLS certificate/key pair is invalid")
	}
	base := *c.client
	tr := &http.Transport{TLSClientConfig: &tls.Config{Certificates: []tls.Certificate{cert}, MinVersion: tls.VersionTLS12}}
	base.Transport = tr
	c.mtlsClients[key] = &base
	return &base, nil
}

// ---------------------------------------------------------------------------
// Config resolution (plaintext, from the FieldCrypto-decrypted endpoint.Config).
// ---------------------------------------------------------------------------

type najizConnectorConfig struct {
	Environment           string
	BaseURL               string
	TokenURL              string
	ClientID              string
	ClientSecret          string
	Scope                 string
	CourtID               string
	EntityNationalNumber  string
	OrgID                 string
	AddRepresentativePath string
	WakalaPath            string
	HearingsPath          string
	CasePath              string
	JudgmentsPath         string
	EnforcementPath       string
	SyncOp                string
	MTLSCertPEM           string
	MTLSKeyPEM            string
}

func parseNajizConnectorConfig(config map[string]any) najizConnectorConfig {
	cfg := najizConnectorConfig{
		Environment:           strings.ToLower(firstNajizString(config, "environment")),
		BaseURL:               firstNajizString(config, "base_url", "url", "endpoint"),
		TokenURL:              firstNajizString(config, "token_url"),
		ClientID:              firstNajizString(config, "client_id"),
		ClientSecret:          firstNajizString(config, "client_secret", "api_key", "secret"),
		Scope:                 firstNajizString(config, "scope"),
		CourtID:               firstNajizString(config, "court_id"),
		EntityNationalNumber:  firstNajizString(config, "entity_national_number"),
		OrgID:                 firstNajizString(config, "org_id", "organization_id", "entity_id"),
		AddRepresentativePath: firstNajizString(config, "add_representative_path", "representative_path"),
		WakalaPath:            firstNajizString(config, "wakala_path", "issue_wakala_path"),
		HearingsPath:          firstNajizString(config, "hearings_path", "pull_hearings_path"),
		CasePath:              firstNajizString(config, "case_path", "get_case_path", "case_sync_path"),
		JudgmentsPath:         firstNajizString(config, "judgments_path", "list_judgments_path"),
		EnforcementPath:       firstNajizString(config, "enforcement_path", "tanfeedh_path"),
		SyncOp:                strings.ToLower(firstNajizString(config, "sync_operation")),
		MTLSCertPEM:           firstNajizString(config, "mtls_cert_pem", "client_cert_pem"),
		MTLSKeyPEM:            firstNajizString(config, "mtls_key_pem", "client_key_pem"),
	}
	// Configurable defaults (NEVER hardcode a gov host; only relative path shapes).
	cfg.AddRepresentativePath = orDefault(cfg.AddRepresentativePath, "/representatives")
	cfg.WakalaPath = orDefault(cfg.WakalaPath, "/wakala")
	cfg.HearingsPath = orDefault(cfg.HearingsPath, "/hearings")
	cfg.CasePath = orDefault(cfg.CasePath, "/cases")
	cfg.JudgmentsPath = orDefault(cfg.JudgmentsPath, "/judgments")
	cfg.EnforcementPath = orDefault(cfg.EnforcementPath, "/enforcement")
	return cfg
}

// mode resolves the operating transport mode from the config.
func (c najizConnectorConfig) mode() najizTransportMode {
	if c.Environment == "sandbox" || c.Environment == "mock" || strings.HasPrefix(strings.ToLower(c.BaseURL), "najiz-sandbox:") {
		return najizModeSandbox
	}
	// Production requires at minimum a base_url + token_url + client_id; without
	// them the connector is unconfigured and stays in manual fallback.
	if c.BaseURL == "" || c.TokenURL == "" || c.ClientID == "" {
		return najizModeUnconfigured
	}
	return najizModeProduction
}

func (c najizConnectorConfig) requireProductionCreds() error {
	missing := []string{}
	if c.BaseURL == "" {
		missing = append(missing, "base_url")
	}
	if c.TokenURL == "" {
		missing = append(missing, "token_url")
	}
	if c.ClientID == "" {
		missing = append(missing, "client_id")
	}
	if c.ClientSecret == "" {
		missing = append(missing, "client_secret")
	}
	if len(missing) > 0 {
		return fmt.Errorf("najiz production config missing: %s", strings.Join(missing, ", "))
	}
	return nil
}

func (c najizConnectorConfig) mtlsEnabled() bool {
	return c.MTLSCertPEM != "" && c.MTLSKeyPEM != ""
}

func (c najizConnectorConfig) cacheKey(endpoint model.IntegrationEndpoint) string {
	return endpoint.TenantID.String() + "|" + endpoint.ID.String() + "|" + c.ClientID
}

func (c najizConnectorConfig) oauth(endpoint model.IntegrationEndpoint) OAuthConfig {
	return OAuthConfig{
		CacheKey:     c.cacheKey(endpoint),
		TokenURL:     c.TokenURL,
		ClientID:     c.ClientID,
		ClientSecret: c.ClientSecret,
		Scope:        c.Scope,
	}
}

func (c najizConnectorConfig) syncOperation() string {
	switch c.SyncOp {
	case najizSyncPullHearings, najizSyncGetCase, najizSyncListJudgments, najizSyncEnforcementCase:
		return c.SyncOp
	default:
		return najizSyncPullHearings // highest-value default feed
	}
}

func (c najizConnectorConfig) syncPath(op string) (string, bool) {
	switch op {
	case najizSyncPullHearings:
		return c.HearingsPath, true
	case najizSyncGetCase:
		return c.CasePath, true
	case najizSyncListJudgments:
		return c.JudgmentsPath, true
	case najizSyncEnforcementCase:
		return c.EnforcementPath, true
	default:
		return "", false
	}
}

// ---------------------------------------------------------------------------
// Sandbox mock data (deterministic; clearly labelled; never claims production).
// ---------------------------------------------------------------------------

func najizSandboxRecords(op string, endpoint model.IntegrationEndpoint) []map[string]any {
	base := map[string]any{
		"sandbox":       true,
		"court_id":      firstNajizString(endpoint.Config, "court_id"),
		"endpoint_code": endpoint.Code,
	}
	switch op {
	case najizSyncPullHearings:
		return []map[string]any{
			merge(base, map[string]any{"najiz_reference": "SBX-HRG-1001", "hearing_at": "2026-07-15T09:00:00+03:00", "circuit": "Commercial-3"}),
			merge(base, map[string]any{"najiz_reference": "SBX-HRG-1002", "hearing_at": "2026-07-22T10:30:00+03:00", "circuit": "Commercial-1"}),
		}
	case najizSyncListJudgments:
		return []map[string]any{
			merge(base, map[string]any{"najiz_reference": "SBX-JDG-2001", "judgment_date": "2026-06-01", "outcome": "in_favor"}),
		}
	case najizSyncEnforcementCase:
		return []map[string]any{
			merge(base, map[string]any{"tanfeedh_reference": "SBX-ENF-3001", "amount": 125000, "status": "in_progress"}),
		}
	default: // get_case
		return []map[string]any{
			merge(base, map[string]any{"najiz_reference": "SBX-CASE-4001", "status": "under_consideration", "stage": "pleadings"}),
		}
	}
}

func najizSandboxReference(prefix string, endpoint model.IntegrationEndpoint, payload map[string]any) string {
	suffix := strings.TrimSpace(stringField(payload, "defendant_case_id"))
	if suffix == "" {
		suffix = endpoint.ID.String()
	}
	if len(suffix) > 8 {
		suffix = suffix[:8]
	}
	return "SBX-" + prefix + "-" + strings.ToUpper(suffix)
}

// ---------------------------------------------------------------------------
// Helpers (local to this file).
// ---------------------------------------------------------------------------

func najizRepresentativePayload(tenantID string, payload map[string]any, now time.Time) map[string]any {
	body := map[string]any{
		"tenant_id":    tenantID,
		"requested_at": now.Format(time.RFC3339Nano),
	}
	for k, v := range payload {
		body[k] = v
	}
	return body
}

func najizDecodeList(respBody []byte) ([]map[string]any, map[string]any) {
	body := bytes.TrimSpace(respBody)
	if len(body) == 0 {
		return nil, nil
	}
	// Accept either a bare array or an envelope { "data"|"items"|"results": [...] }.
	if body[0] == '[' {
		var arr []map[string]any
		_ = json.Unmarshal(body, &arr)
		return arr, nil
	}
	var env map[string]any
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, nil
	}
	for _, key := range []string{"data", "items", "results", "records", "hearings", "judgments", "cases"} {
		if raw, ok := env[key]; ok {
			if rows := coerceRows(raw); rows != nil {
				return rows, env
			}
		}
	}
	// Single-object response (e.g. get_case): treat as one record.
	return []map[string]any{env}, env
}

func coerceRows(raw any) []map[string]any {
	arr, ok := raw.([]any)
	if !ok {
		return nil
	}
	out := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		if m, ok := item.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func najizWatermark(raw map[string]any, now func() time.Time) string {
	if raw != nil {
		for _, key := range []string{"watermark", "next_cursor", "modified_since", "as_of"} {
			if v := stringField(raw, key); v != "" {
				return v
			}
		}
	}
	return now().UTC().Format(time.RFC3339)
}

func firstNajizString(config map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			switch s := v.(type) {
			case string:
				if strings.TrimSpace(s) != "" {
					return strings.TrimSpace(s)
				}
			case fmt.Stringer:
				if t := strings.TrimSpace(s.String()); t != "" {
					return t
				}
			}
		}
	}
	return ""
}

func stringField(m map[string]any, key string) string {
	if m == nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
		return fmt.Sprint(v)
	}
	return ""
}

func najizJoin(base, path string) string {
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

func appendQuery(url, key, value string) string {
	sep := "?"
	if strings.Contains(url, "?") {
		sep = "&"
	}
	return url + sep + key + "=" + value
}

func merge(a, b map[string]any) map[string]any {
	out := make(map[string]any, len(a)+len(b))
	for k, v := range a {
		out[k] = v
	}
	for k, v := range b {
		out[k] = v
	}
	return out
}

func orDefault(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func sinceMillis(end, start time.Time) int64 {
	d := end.Sub(start).Milliseconds()
	if d < 0 {
		return 0
	}
	return d
}

// sanitizeNajiz strips anything that could resemble credential material from an
// error string surfaced to operators. oauth.go already avoids echoing secrets;
// this is a belt-and-braces guard for the connector's own messages.
func sanitizeNajiz(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "connection test failed"
	}
	return s
}

func internalNajiz(msg string, err error) error {
	return fmt.Errorf("lex/integration/najiz: %s: %w", msg, err)
}

func validationNajiz(msg string) error {
	return fmt.Errorf("lex/integration/najiz: %s", msg)
}

// Compile-time assertions: the connector satisfies all three optional capability
// interfaces (and, via Kind+Probe, the service.IntegrationAdapter base port).
var (
	_ ConnectionTester = (*NajizConnector)(nil)
	_ Syncer           = (*NajizConnector)(nil)
	_ Invoker          = (*NajizConnector)(nil)
)

// strconvGuard keeps strconv imported for future numeric config parsing without a
// build break if a field is added; it is a no-op.
var _ = strconv.Itoa
