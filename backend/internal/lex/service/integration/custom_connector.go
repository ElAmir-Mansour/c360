package integration

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
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

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Integration EXTENSIBILITY #18 — no-code generic "custom" connector.
//
// A "custom" endpoint carries a declarative REST spec in its config: a base_url, an
// auth block, a request template, a response_mapping, and an optional pagination
// block. The CustomConnector adapter PARSES that spec and EXECUTES it: it builds an
// authenticated HTTP request per the template, sends it (paging when configured),
// and maps the response into neutral records via response_mapping — all WITHOUT any
// connector code per integration. An operator builds a brand-new connector entirely
// from the console form (POST /integrations kind=custom + the schema/custom fields)
// and tests it with the existing /test verb.
//
// Capabilities: Probe + ConnectionTester + Invoker + Syncer.
//   - Probe / TestConnection : an authenticated request per the spec; honest health
//     (not_configured when base_url is missing, unreachable on transport failure).
//   - Invoker ("fetch"/"run"): executes the spec and returns the mapped record count
//     + a sample (secret-free) so the console "run it" surfaces what it pulled.
//   - Syncer                 : executes the spec, applies the #19 RulePipeline to the
//     mapped records, and reports counts. It does NOT reconcile into a lex domain
//     table (a generic connector has no fixed lex target); the records ride the
//     report metadata for preview/inspection. This keeps the no-code connector
//     honest: it really runs the spec, it never fakes a write it cannot define.
//
// SSRF GUARD. The spec's base_url (and any absolute path override) is validated
// against an allow-policy that REJECTS internal / link-local / loopback / multicast
// addresses and the cloud metadata endpoint (169.254.169.254 / fd00:ec2::254). The
// guard runs at request-build time AND on the resolved IPs via a custom DialContext,
// so a DNS name that resolves to a private IP (DNS-rebinding) is also blocked. Only
// http/https on the default-or-explicit ports are allowed.
//
// SECRETS CUSTODY. The connector resolves PLAINTEXT config via the FieldCrypto-wired
// repository (the najiz_court_adapter pattern), never the redacting registry. Spec
// secret fields (auth.token/password/client_secret/hmac_secret) are declared SECRET
// in schema.go so they are encrypted at rest and masked on read; they are never
// logged or echoed in any TestResult/InvokeResult/health detail.
// =============================================================================

// Custom connector operation names recognised by Invoke. Both execute the spec.
const (
	CustomOpFetch = "fetch"
	CustomOpRun   = "run"
)

const (
	customDefaultTimeout  = 20 * time.Second
	customRespBodyLimit   = 4 << 20 // 4 MiB per response page
	customMaxPages        = 200     // hard cap so a cursor loop cannot run away
	customSampleRecordCap = 5       // sanitized sample size surfaced to the console
)

// ErrCustomSpecInvalid is returned when the endpoint's REST spec is missing/unusable
// (no base_url, malformed auth, etc.), so the connector grades not_configured rather
// than attempting a doomed or unsafe call.
var ErrCustomSpecInvalid = errors.New("lex/integration/custom: REST spec is incomplete or invalid")

// ErrCustomBlockedHost is returned when the spec targets a disallowed host (internal/
// link-local/loopback/metadata IP, or a non-http(s) scheme). It is the SSRF backstop.
var ErrCustomBlockedHost = errors.New("lex/integration/custom: target host is not permitted (internal/metadata address blocked)")

// CustomConnector is the no-code generic REST adapter for the "custom" kind.
type CustomConnector struct {
	endpoints *repository.IntegrationEndpointRepository
	client    *http.Client
	oauth     *OAuthTokenCache
	logger    zerolog.Logger
	now       func() time.Time
}

// CustomConnectorConfig parametrises the connector. Endpoints MUST be FieldCrypto-
// wired so the spec's secrets decrypt on read. A nil Client is built with the SSRF-
// guarding DialContext; passing a Client SKIPS that wiring, so the wiring site should
// leave Client nil (the connector installs the guard itself).
type CustomConnectorConfig struct {
	Endpoints *repository.IntegrationEndpointRepository
	OAuth     *OAuthTokenCache
	Logger    zerolog.Logger
}

// NewCustomConnector builds the connector with an SSRF-guarding HTTP client: the
// transport's DialContext rejects any connection whose RESOLVED address is internal/
// metadata, closing the DNS-rebinding hole that a pre-flight URL check alone leaves.
func NewCustomConnector(cfg CustomConnectorConfig) *CustomConnector {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	transport := &http.Transport{
		DialContext: func(ctx context.Context, network, addr string) (net.Conn, error) {
			host, _, err := net.SplitHostPort(addr)
			if err != nil {
				host = addr
			}
			ips, err := net.DefaultResolver.LookupIPAddr(ctx, host)
			if err != nil {
				return nil, err
			}
			for _, ip := range ips {
				if isBlockedIP(ip.IP) {
					return nil, ErrCustomBlockedHost
				}
			}
			return dialer.DialContext(ctx, network, addr)
		},
		ForceAttemptHTTP2:   true,
		MaxIdleConns:        20,
		IdleConnTimeout:     60 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	client := &http.Client{Timeout: 2 * customDefaultTimeout, Transport: transport}
	oauth := cfg.OAuth
	if oauth == nil {
		oauth = NewOAuthTokenCache(client, 30*time.Second)
	}
	c := &CustomConnector{
		client: client,
		oauth:  oauth,
		logger: cfg.Logger.With().Str("component", "lex-custom-connector").Logger(),
		now:    time.Now,
	}
	if cfg.Endpoints != nil {
		c.endpoints = cfg.Endpoints
	}
	return c
}

// Compile-time capability assertions.
var (
	_ ConnectionTester = (*CustomConnector)(nil)
	_ Invoker          = (*CustomConnector)(nil)
	_ Syncer           = (*CustomConnector)(nil)
)

// Kind implements service.IntegrationAdapter.
func (c *CustomConnector) Kind() model.IntegrationKind { return model.IntegrationKindCustom }

// Probe implements the live health snapshot: an active endpoint with a valid spec is
// exercised with a single authenticated request; everything else grades honestly.
func (c *CustomConnector) Probe(ctx context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindCustom,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}
	switch endpoint.Status {
	case model.IntegrationStatusActive:
		spec, err := parseCustomSpec(endpoint.Config)
		if err != nil {
			health.Reachable = false
			health.Detail = "not_configured: " + sanitizeErr(err)
			return health
		}
		res, _, perr := c.execute(ctx, spec, true)
		if perr != nil {
			health.Reachable = false
			health.Detail = "unreachable: " + sanitizeErr(perr)
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

// TestConnection implements ConnectionTester: it runs the spec once (probe mode:
// single page, no record processing) and reports a sanitized result with staged
// diagnostics. Secrets are never echoed.
func (c *CustomConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	checkedAt := c.now().UTC()
	spec, err := parseCustomSpec(endpoint.Config)
	if err != nil {
		return TestResult{
			Reachable: false,
			Detail:    "not_configured: " + sanitizeErr(err),
			CheckedAt: checkedAt,
			Steps: []DiagnosticStep{
				newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, 0, sanitizeErr(err), "complete the connector spec (base_url + request)"),
				newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusSkip, 0, "skipped: spec incomplete", ""),
				newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: spec incomplete", ""),
				newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: spec incomplete", ""),
			},
		}, nil
	}
	res, _, perr := c.execute(ctx, spec, true)
	res.CheckedAt = c.now().UTC()
	if perr != nil {
		blocked := errors.Is(perr, ErrCustomBlockedHost)
		detail := sanitizeErr(perr)
		hint := hintCheckNetwork
		if blocked {
			hint = "the target resolves to an internal/metadata address, which is not permitted"
		}
		res.Reachable = false
		res.Detail = detail
		res.Steps = []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, res.LatencyMillis, detail, hint),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusSkip, 0, "skipped: host not reachable", ""),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: host not reachable", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: host not reachable", ""),
		}
		return res, nil
	}
	return res, nil
}

// Invoke implements Invoker for "fetch"/"run": it executes the full spec (with
// pagination + response mapping) and returns the mapped record count plus a
// secret-free sample. It never mutates a lex table — a generic connector pulls data;
// what the operator does with it is configured via #19 rules + downstream wiring.
func (c *CustomConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	switch op {
	case CustomOpFetch, CustomOpRun, "":
		op = CustomOpFetch
	default:
		return InvokeResult{}, fmt.Errorf("%w: %q (supported: fetch, run)", ErrCapabilityNotSupported, operation)
	}
	spec, err := parseCustomSpec(endpoint.Config)
	if err != nil {
		return InvokeResult{}, fmt.Errorf("%w: %v", ErrCustomSpecInvalid, err)
	}
	_, records, perr := c.execute(ctx, spec, false)
	if perr != nil {
		return InvokeResult{Operation: op, Success: false, Detail: sanitizeErr(perr)}, fmt.Errorf("lex/integration/custom: invoke %s: %w", op, perr)
	}
	return InvokeResult{
		Operation: op,
		Success:   true,
		Detail:    fmt.Sprintf("%d record(s) fetched and mapped", len(records)),
		Output: map[string]any{
			"record_count": len(records),
			"sample":       sampleRecords(records),
		},
	}, nil
}

// Sync implements Syncer: it executes the spec, applies the connector's #19
// RulePipeline to the mapped records, and reports counts (Processed = mapped,
// Skipped = dropped by filters, Created = kept). A preview commits nothing (the
// custom connector never writes a lex table anyway, so preview and live differ only
// in the DryRun flag + that the records are surfaced on metadata for inspection).
func (c *CustomConnector) Sync(ctx context.Context, endpoint model.IntegrationEndpoint, mode SyncMode) (SyncReport, error) {
	report := SyncReport{Mode: mode, DryRun: mode.IsPreview()}
	spec, err := parseCustomSpec(endpoint.Config)
	if err != nil {
		return report, fmt.Errorf("%w: %v", ErrCustomSpecInvalid, err)
	}
	_, records, perr := c.execute(ctx, spec, false)
	if perr != nil {
		return report, perr
	}
	report.Processed = len(records)
	// #19: apply the configured transform/filter pipeline to the mapped records.
	pipeline := NewRulePipeline(ParseSyncRules(endpoint.Config))
	kept, dropped := pipeline.Apply(records)
	report.Skipped = dropped
	report.Created = len(kept)
	report.Detail = fmt.Sprintf("custom sync (%s): fetched=%d kept=%d filtered=%d",
		mode, report.Processed, report.Created, report.Skipped)
	report.Metadata = map[string]any{
		"connector":    "custom",
		"record_count": len(kept),
		"sample":       sampleRecords(kept),
	}
	return report, nil
}

// ----------------------------------------------------------------------------
// Spec execution
// ----------------------------------------------------------------------------

// execute runs the spec. When probe is true it sends ONE request (no pagination)
// and returns a TestResult-shaped summary; otherwise it pages per the pagination
// block, maps every page's records, and returns the full record slice. The returned
// TestResult always carries latency + a sanitized detail.
func (c *CustomConnector) execute(ctx context.Context, spec customSpec, probe bool) (TestResult, []map[string]any, error) {
	start := c.now()
	cctx, cancel := context.WithTimeout(ctx, spec.timeout())
	defer cancel()

	var (
		records    []map[string]any
		lastStatus int
		cursor     string
		page       int
	)
	for {
		page++
		status, body, err := c.doRequest(cctx, spec, page, cursor)
		latency := time.Since(start).Milliseconds()
		if err != nil {
			return TestResult{LatencyMillis: latency}, nil, err
		}
		lastStatus = status
		if status < 200 || status >= 300 {
			res := TestResult{
				LatencyMillis: latency,
				Reachable:     false,
				Detail:        fmt.Sprintf("endpoint returned %d", status),
				Metadata:      map[string]any{"status_code": status},
			}
			if status == http.StatusUnauthorized || status == http.StatusForbidden {
				res.Detail = fmt.Sprintf("%d: credentials rejected by endpoint", status)
			}
			return res, nil, nil
		}
		pageRecords, nextCursor := spec.mapResponse(body)
		records = append(records, pageRecords...)
		if probe {
			break
		}
		cursor = nextCursor
		if !spec.hasMorePages(page, len(pageRecords), nextCursor) || page >= customMaxPages {
			break
		}
	}

	latency := time.Since(start).Milliseconds()
	res := TestResult{
		LatencyMillis: latency,
		Reachable:     true,
		SampleCount:   len(records),
		Detail:        fmt.Sprintf("%d OK; %d record(s) mapped", lastStatus, len(records)),
		Metadata:      map[string]any{"status_code": lastStatus},
		Steps: []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusOK, latency, "host reachable over HTTP", ""),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusOK, latency, fmt.Sprintf("%d; %s credentials accepted", lastStatus, spec.Auth.Type), ""),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusOK, 0, "endpoint accepted the request", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusOK, latency, fmt.Sprintf("response mapped %d record(s)", len(records)), ""),
		},
	}
	return res, records, nil
}

// doRequest builds + sends one request per the spec for the given page/cursor,
// applying auth + the SSRF pre-flight URL check, and returns the status + capped body.
func (c *CustomConnector) doRequest(ctx context.Context, spec customSpec, page int, cursor string) (int, []byte, error) {
	target, err := spec.requestURL(page, cursor)
	if err != nil {
		return 0, nil, err
	}
	// SSRF pre-flight: reject a literal-IP target that is internal/metadata before we
	// even dial. The DialContext guard is the resolved-IP backstop for DNS names.
	if err := assertCustomURLAllowed(target); err != nil {
		return 0, nil, err
	}

	method := spec.Request.method()
	var bodyReader io.Reader
	var rawBody []byte
	if spec.Request.hasBody(method) {
		rawBody = []byte(spec.Request.BodyTemplate)
		bodyReader = bytes.NewReader(rawBody)
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bodyReader)
	if err != nil {
		return 0, nil, fmt.Errorf("build request")
	}
	if spec.Request.BodyTemplate != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Accept", "application/json")
	for k, v := range spec.Request.Headers {
		req.Header.Set(k, v)
	}
	if err := c.applyAuth(ctx, req, spec, rawBody); err != nil {
		return 0, nil, err
	}

	resp, err := c.client.Do(req)
	if err != nil {
		if errors.Is(err, ErrCustomBlockedHost) {
			return 0, nil, ErrCustomBlockedHost
		}
		return 0, nil, fmt.Errorf("connection failed")
	}
	defer resp.Body.Close()
	out, _ := io.ReadAll(io.LimitReader(resp.Body, customRespBodyLimit))
	return resp.StatusCode, out, nil
}

// applyAuth applies the spec's auth block. oauth2_cc mints a token via the shared
// cache; hmac signs the raw body with X-Clario-Signature. Secrets never logged.
func (c *CustomConnector) applyAuth(ctx context.Context, req *http.Request, spec customSpec, rawBody []byte) error {
	a := spec.Auth
	switch a.Type {
	case "", "none":
		// no auth
	case "basic":
		if a.Username == "" || a.Password == "" {
			return fmt.Errorf("basic auth requires username and password")
		}
		req.SetBasicAuth(a.Username, a.Password)
	case "bearer":
		if a.Token == "" {
			return fmt.Errorf("bearer auth requires a token")
		}
		req.Header.Set("Authorization", "Bearer "+a.Token)
	case "oauth2_cc":
		if a.TokenURL == "" || a.ClientID == "" || a.ClientSecret == "" {
			return fmt.Errorf("oauth2_cc requires token_url, client_id and client_secret")
		}
		// SSRF: the token URL is an outbound fetch too — guard it.
		if err := assertCustomURLAllowed(a.TokenURL); err != nil {
			return err
		}
		tok, err := c.oauth.Token(ctx, OAuthConfig{
			CacheKey:     spec.BaseURL + "|" + a.ClientID,
			TokenURL:     a.TokenURL,
			ClientID:     a.ClientID,
			ClientSecret: a.ClientSecret,
			Scope:        a.Scope,
		})
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
	case "hmac":
		if a.HMACSecret == "" {
			return fmt.Errorf("hmac auth requires an hmac_secret")
		}
		ts := strconv.FormatInt(c.now().UTC().Unix(), 10)
		mac := hmac.New(sha256.New, []byte(a.HMACSecret))
		mac.Write([]byte(ts))
		mac.Write([]byte("."))
		mac.Write(rawBody)
		req.Header.Set("X-Clario-Timestamp", ts)
		req.Header.Set("X-Clario-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
	default:
		return fmt.Errorf("unsupported auth type %q", a.Type)
	}
	return nil
}

// ----------------------------------------------------------------------------
// Spec parsing
// ----------------------------------------------------------------------------

// customSpec is the parsed declarative REST spec for a "custom" endpoint, resolved
// from the decrypted config map. The config may carry the spec either as nested
// maps (custom_spec / spec) OR flattened (the dynamic form's flat fields). Both are
// tolerated so the no-code console form and a raw JSON spec both work.
type customSpec struct {
	BaseURL    string
	TimeoutSec int
	Auth       customAuth
	Request    customRequest
	Mapping    customMapping
	Pagination customPagination
}

type customAuth struct {
	Type         string // none|basic|bearer|oauth2_cc|hmac
	Username     string
	Password     string
	Token        string
	TokenURL     string
	ClientID     string
	ClientSecret string
	Scope        string
	HMACSecret   string
}

type customRequest struct {
	Method       string
	Path         string
	Headers      map[string]string
	BodyTemplate string
}

type customMapping struct {
	RecordsPath string            // dot-path to the records array in the response
	FieldMap    map[string]string // lex field -> response field (per record)
}

type customPagination struct {
	Type  string // none|page|cursor
	Param string // query param name carrying the page number / cursor
}

func parseCustomSpec(config map[string]any) (customSpec, error) {
	spec := extractCustomSpec(config)
	spec.BaseURL = strings.TrimSpace(spec.BaseURL)
	if spec.BaseURL == "" {
		return spec, fmt.Errorf("base_url is required")
	}
	if err := assertCustomURLAllowed(spec.BaseURL); err != nil {
		return spec, err
	}
	if spec.Auth.Type == "" {
		spec.Auth.Type = "none"
	}
	return spec, nil
}

// extractCustomSpec reads the spec from either a nested spec object or flat config
// keys (the console form emits flat keys with the custom_* prefix for nested blocks).
func extractCustomSpec(config map[string]any) customSpec {
	if config == nil {
		config = map[string]any{}
	}
	// Prefer a nested spec object when present.
	if nested := nestedMap(config, "custom_spec", "spec", "rest_spec"); nested != nil {
		return specFromNested(nested)
	}
	// Otherwise read flat console-form keys.
	spec := customSpec{
		BaseURL:    cfgString(config, "base_url"),
		TimeoutSec: internalCfgInt(config, "timeout", "timeout_seconds"),
		Auth: customAuth{
			Type:         strings.ToLower(cfgString(config, "auth_type")),
			Username:     cfgString(config, "auth_username", "basic_username"),
			Password:     cfgString(config, "auth_password", "basic_password"),
			Token:        cfgString(config, "auth_token", "bearer_token"),
			TokenURL:     cfgString(config, "auth_token_url", "token_url"),
			ClientID:     cfgString(config, "auth_client_id", "client_id"),
			ClientSecret: cfgString(config, "auth_client_secret", "client_secret"),
			Scope:        cfgString(config, "auth_scope", "scope"),
			HMACSecret:   cfgString(config, "auth_hmac_secret", "hmac_secret"),
		},
		Request: customRequest{
			Method:       cfgString(config, "request_method"),
			Path:         cfgString(config, "request_path"),
			Headers:      stringMap(config["request_headers"]),
			BodyTemplate: cfgString(config, "request_body_template", "request_body"),
		},
		Mapping: customMapping{
			RecordsPath: cfgString(config, "response_records_path", "records_path"),
			FieldMap:    stringMap(config["response_field_map"]),
		},
		Pagination: customPagination{
			Type:  strings.ToLower(cfgString(config, "pagination_type")),
			Param: cfgString(config, "pagination_param"),
		},
	}
	return spec
}

func specFromNested(m map[string]any) customSpec {
	spec := customSpec{
		BaseURL:    cfgString(m, "base_url"),
		TimeoutSec: internalCfgInt(m, "timeout", "timeout_seconds"),
	}
	if auth := nestedMap(m, "auth"); auth != nil {
		spec.Auth = customAuth{
			Type:         strings.ToLower(cfgString(auth, "type")),
			Username:     cfgString(auth, "username"),
			Password:     cfgString(auth, "password"),
			Token:        cfgString(auth, "token"),
			TokenURL:     cfgString(auth, "token_url"),
			ClientID:     cfgString(auth, "client_id"),
			ClientSecret: cfgString(auth, "client_secret"),
			Scope:        cfgString(auth, "scope"),
			HMACSecret:   cfgString(auth, "hmac_secret"),
		}
	}
	if reqm := nestedMap(m, "request"); reqm != nil {
		spec.Request = customRequest{
			Method:       cfgString(reqm, "method"),
			Path:         cfgString(reqm, "path"),
			Headers:      stringMap(reqm["headers"]),
			BodyTemplate: cfgString(reqm, "body_template", "body"),
		}
	}
	if respm := nestedMap(m, "response_mapping"); respm != nil {
		spec.Mapping = customMapping{
			RecordsPath: cfgString(respm, "records_path"),
			FieldMap:    stringMap(respm["field_map"]),
		}
	}
	if pag := nestedMap(m, "pagination"); pag != nil {
		spec.Pagination = customPagination{
			Type:  strings.ToLower(cfgString(pag, "type")),
			Param: cfgString(pag, "param"),
		}
	}
	return spec
}

func (s customSpec) timeout() time.Duration {
	if s.TimeoutSec > 0 {
		return time.Duration(s.TimeoutSec) * time.Second
	}
	return customDefaultTimeout
}

// requestURL builds the absolute request URL for a page/cursor, appending the
// pagination query param when configured.
func (s customSpec) requestURL(page int, cursor string) (string, error) {
	raw := joinInternalPath(s.BaseURL, s.Request.Path)
	u, err := url.Parse(raw)
	if err != nil {
		return "", fmt.Errorf("invalid request url")
	}
	if s.Pagination.Param != "" && (s.Pagination.Type == "page" || s.Pagination.Type == "cursor") {
		q := u.Query()
		if s.Pagination.Type == "page" {
			q.Set(s.Pagination.Param, strconv.Itoa(page))
		} else if cursor != "" {
			q.Set(s.Pagination.Param, cursor)
		}
		u.RawQuery = q.Encode()
	}
	return u.String(), nil
}

func (r customRequest) method() string {
	m := strings.ToUpper(strings.TrimSpace(r.Method))
	if m == "" {
		return http.MethodGet
	}
	return m
}

func (r customRequest) hasBody(method string) bool {
	return r.BodyTemplate != "" && (method == http.MethodPost || method == http.MethodPut || method == http.MethodPatch)
}

func (s customSpec) hasMorePages(page, pageRecords int, nextCursor string) bool {
	switch s.Pagination.Type {
	case "page":
		return pageRecords > 0
	case "cursor":
		return nextCursor != ""
	default:
		return false
	}
}

// mapResponse extracts the records array at records_path, applies the field_map per
// record, and returns the mapped records plus a next-cursor (best-effort: a
// top-level "next_cursor"/"nextCursor" string when cursor pagination is configured).
func (s customSpec) mapResponse(body []byte) ([]map[string]any, string) {
	var root any
	if err := json.Unmarshal(body, &root); err != nil {
		return nil, ""
	}
	rawRecords := navigatePath(root, s.Mapping.RecordsPath)
	arr, _ := rawRecords.([]any)
	if arr == nil {
		// records_path pointed at a single object, or the body IS the array.
		if obj, ok := rawRecords.(map[string]any); ok {
			arr = []any{obj}
		} else if topArr, ok := root.([]any); ok && s.Mapping.RecordsPath == "" {
			arr = topArr
		}
	}
	out := make([]map[string]any, 0, len(arr))
	for _, item := range arr {
		obj, ok := item.(map[string]any)
		if !ok {
			continue
		}
		out = append(out, s.applyFieldMap(obj))
	}
	cursor := ""
	if s.Pagination.Type == "cursor" {
		if m, ok := root.(map[string]any); ok {
			cursor = firstNonEmpty(ruleString(m["next_cursor"]), ruleString(m["nextCursor"]), ruleString(m["cursor"]))
		}
	}
	return out, cursor
}

// applyFieldMap projects a raw record through field_map (lex field -> source field
// or source dot-path). An empty field_map passes the raw record through unchanged.
func (s customSpec) applyFieldMap(raw map[string]any) map[string]any {
	if len(s.Mapping.FieldMap) == 0 {
		return raw
	}
	out := make(map[string]any, len(s.Mapping.FieldMap))
	for lexField, sourcePath := range s.Mapping.FieldMap {
		out[lexField] = navigatePath(raw, sourcePath)
	}
	return out
}

// ----------------------------------------------------------------------------
// SSRF host policy
// ----------------------------------------------------------------------------

// assertCustomURLAllowed validates a URL's scheme + host before an outbound call.
// It rejects non-http(s) schemes and any LITERAL-IP host that is internal/metadata.
// DNS names pass this pre-flight (their resolved IPs are checked by the client's
// DialContext, closing the rebinding hole).
func assertCustomURLAllowed(raw string) error {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("%w: invalid url", ErrCustomBlockedHost)
	}
	scheme := strings.ToLower(u.Scheme)
	if scheme != "http" && scheme != "https" {
		return fmt.Errorf("%w: scheme %q not allowed", ErrCustomBlockedHost, u.Scheme)
	}
	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("%w: empty host", ErrCustomBlockedHost)
	}
	// Block the AWS/GCP/Azure metadata DNS aliases outright.
	switch strings.ToLower(host) {
	case "metadata.google.internal", "metadata", "instance-data":
		return fmt.Errorf("%w: metadata hostname", ErrCustomBlockedHost)
	}
	if ip := net.ParseIP(host); ip != nil && isBlockedIP(ip) {
		return ErrCustomBlockedHost
	}
	return nil
}

// isBlockedIP reports whether an IP is one the connector must never reach: loopback,
// link-local (incl. the 169.254.169.254 / fd00:ec2::254 cloud metadata endpoints),
// private RFC1918 / unique-local, unspecified, or multicast.
func isBlockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() || ip.IsPrivate() {
		return true
	}
	// Explicit cloud metadata endpoints (defense in depth; IsLinkLocalUnicast already
	// covers 169.254.0.0/16, but pin the well-known addresses too).
	if v4 := ip.To4(); v4 != nil {
		if v4[0] == 169 && v4[1] == 254 {
			return true
		}
		// Carrier-grade NAT 100.64.0.0/10 (often internal).
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
	}
	return false
}

// ----------------------------------------------------------------------------
// Generic map/path helpers
// ----------------------------------------------------------------------------

// navigatePath walks a dot-separated path into a decoded JSON value. An empty path
// returns the root unchanged.
func navigatePath(root any, path string) any {
	path = strings.TrimSpace(path)
	if path == "" {
		return root
	}
	cur := root
	for _, seg := range strings.Split(path, ".") {
		m, ok := cur.(map[string]any)
		if !ok {
			return nil
		}
		cur = m[seg]
	}
	return cur
}

func nestedMap(config map[string]any, keys ...string) map[string]any {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			if m, ok := v.(map[string]any); ok {
				return m
			}
			// Tolerate a JSON-string-encoded nested block.
			if s, ok := v.(string); ok && strings.TrimSpace(s) != "" {
				var m map[string]any
				if json.Unmarshal([]byte(s), &m) == nil {
					return m
				}
			}
		}
	}
	return nil
}

// stringMap coerces a config value into a map[string]string, tolerating a nested
// map[string]any or a JSON-string encoding (both produced by the console form / the
// config JSON round-trip).
func stringMap(raw any) map[string]string {
	out := map[string]string{}
	switch v := raw.(type) {
	case map[string]any:
		for k, val := range v {
			out[k] = ruleString(val)
		}
	case map[string]string:
		for k, val := range v {
			out[k] = val
		}
	case string:
		if strings.TrimSpace(v) != "" {
			var m map[string]any
			if json.Unmarshal([]byte(v), &m) == nil {
				for k, val := range m {
					out[k] = ruleString(val)
				}
			}
		}
	}
	return out
}

// sampleRecords returns a capped, defensively-trimmed sample of mapped records for
// the console "what did it pull" surface. Values are passed through as-is (the
// connector's response mapping is operator-defined and non-secret); the cap bounds
// the payload size.
func sampleRecords(records []map[string]any) []map[string]any {
	n := len(records)
	if n > customSampleRecordCap {
		n = customSampleRecordCap
	}
	out := make([]map[string]any, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, records[i])
	}
	return out
}
