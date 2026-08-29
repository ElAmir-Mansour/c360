package connectors

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
)

// RESTType is the connector type key for the generalized REST connector.
const RESTType = "rest"

// REST connector defaults.
const (
	restTimeout      = 15 * time.Second
	restMaxAttempts  = 3
	restBaseBackoff  = 200 * time.Millisecond
	restMaxBodyBytes = 4096
)

// REST auth modes.
const (
	restAuthNone   = "none"
	restAuthBearer = "bearer"
	restAuthBasic  = "basic"
	restAuthAPIKey = "api_key"
)

// RESTConnector is a generalized webhook/REST connector. It builds an HTTP
// request to an arbitrary URL with a chosen method, applies one of several auth
// schemes, optionally signs the body with an HMAC-SHA256 signature, renders the
// request body from a text/template over the event fields, and delivers it with
// bounded retry/backoff. It is the config-driven superset of the existing
// webhook client, delivered with zero changes to that client.
//
// It is notify-capable and supports Test (a benign request carrying a synthetic
// event so operators can validate auth/URL/signature without a live event).
type RESTConnector struct {
	manifest connector.Manifest
	client   *http.Client
	// maxAttempts/baseBackoff are tunable for tests.
	maxAttempts int
	baseBackoff time.Duration
}

// RESTOption customizes a RESTConnector at construction.
type RESTOption func(*RESTConnector)

// WithRESTHTTPClient overrides the HTTP client (used by tests).
func WithRESTHTTPClient(client *http.Client) RESTOption {
	return func(c *RESTConnector) {
		if client != nil {
			c.client = client
		}
	}
}

// WithRESTRetry overrides retry behavior (used by tests to shorten backoff).
func WithRESTRetry(maxAttempts int, baseBackoff time.Duration) RESTOption {
	return func(c *RESTConnector) {
		if maxAttempts > 0 {
			c.maxAttempts = maxAttempts
		}
		if baseBackoff >= 0 {
			c.baseBackoff = baseBackoff
		}
	}
}

// NewREST returns a ready-to-register RESTConnector.
func NewREST(opts ...RESTOption) connector.Connector {
	c := &RESTConnector{
		manifest:    restManifest(),
		client:      &http.Client{Timeout: restTimeout},
		maxAttempts: restMaxAttempts,
		baseBackoff: restBaseBackoff,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// restManifest declares the REST connector's config schema. url/method are the
// target; auth selects the scheme; bearer_token/basic_username/basic_password/
// api_key_value carry secrets for the chosen scheme; api_key_header names the
// header for api_key auth; body_template is a text/template rendered over the
// event; content_type sets the request media type; hmac_secret enables request
// signing; headers carries arbitrary extra headers.
func restManifest() connector.Manifest {
	return connector.Manifest{
		Type:         RESTType,
		DisplayName:  "REST / Webhook",
		Capabilities: connector.CapabilityNotify,
		AuthKind:     connector.AuthHMAC,
		ConfigSchema: []connector.FieldSpec{
			{Name: "url", Type: connector.FieldTypeString, Required: true, Description: "Target endpoint URL"},
			{Name: "method", Type: connector.FieldTypeEnum, Enum: []string{"POST", "PUT", "PATCH", "GET", "DELETE"}, Default: "POST", Description: "HTTP method"},
			{Name: "auth", Type: connector.FieldTypeEnum, Enum: []string{restAuthNone, restAuthBearer, restAuthBasic, restAuthAPIKey}, Default: restAuthNone, Description: "Authentication scheme"},
			{Name: "bearer_token", Type: connector.FieldTypeSecret, Description: "Bearer token (auth=bearer)"},
			{Name: "basic_username", Type: connector.FieldTypeString, Description: "Basic auth username (auth=basic)"},
			{Name: "basic_password", Type: connector.FieldTypeSecret, Description: "Basic auth password (auth=basic)"},
			{Name: "api_key_header", Type: connector.FieldTypeString, Default: "X-API-Key", Description: "Header name for the API key (auth=api_key)"},
			{Name: "api_key_value", Type: connector.FieldTypeSecret, Description: "API key value (auth=api_key)"},
			{Name: "content_type", Type: connector.FieldTypeString, Default: "application/json", Description: "Request Content-Type"},
			{Name: "body_template", Type: connector.FieldTypeString, Description: "text/template rendered over event fields; empty = default JSON envelope"},
			{Name: "hmac_secret", Type: connector.FieldTypeSecret, Description: "HMAC-SHA256 signing secret; when set, X-Clario-Signature/Timestamp headers are added"},
			{Name: "headers", Type: connector.FieldTypeObject, Description: "Additional static request headers"},
		},
	}
}

// Manifest returns the connector's declarative descriptor.
func (c *RESTConnector) Manifest() connector.Manifest { return c.manifest }

// ValidateConfig validates cfg against the schema and enforces the
// auth-dependent requirements (each scheme needs its credential fields) and
// that any supplied body_template parses.
func (c *RESTConnector) ValidateConfig(cfg map[string]any) error {
	if err := connector.ValidateAgainstSchema(c.manifest.ConfigSchema, cfg); err != nil {
		return err
	}

	url := strings.TrimSpace(cfgString(cfg, "url"))
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		return fmt.Errorf("rest: url must be an absolute http(s) URL, got %q", url)
	}

	switch c.authMode(cfg) {
	case restAuthBearer:
		if cfgString(cfg, "bearer_token") == "" {
			return fmt.Errorf("rest: auth=bearer requires bearer_token")
		}
	case restAuthBasic:
		if cfgString(cfg, "basic_username") == "" {
			return fmt.Errorf("rest: auth=basic requires basic_username")
		}
	case restAuthAPIKey:
		if cfgString(cfg, "api_key_value") == "" {
			return fmt.Errorf("rest: auth=api_key requires api_key_value")
		}
	}

	if tmpl := cfgString(cfg, "body_template"); strings.TrimSpace(tmpl) != "" {
		if _, err := template.New("rest_body").Option("missingkey=zero").Parse(tmpl); err != nil {
			return fmt.Errorf("rest: invalid body_template: %w", err)
		}
	}

	return nil
}

// Send builds the request (auth + signature + templated body) and delivers it
// with retry/backoff, returning the final response. 2xx is success; the last
// non-2xx (or transport error) is returned with the upstream code/body.
func (c *RESTConnector) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	if err := c.ValidateConfig(cfg); err != nil {
		return connector.Result{}, fmt.Errorf("rest: %w", err)
	}

	ef := extractEventFields(event)
	body, err := c.renderBody(cfg, event, ef)
	if err != nil {
		return connector.Result{}, fmt.Errorf("rest: render body: %w", err)
	}

	return c.deliver(ctx, cfg, body)
}

// Test sends a synthetic event through the full pipeline (auth, signature,
// template) so operators can confirm the endpoint accepts a well-formed,
// authenticated request. The synthetic event is clearly marked as a test in its
// payload.
func (c *RESTConnector) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	if err := c.ValidateConfig(cfg); err != nil {
		return connector.Result{}, fmt.Errorf("rest test: %w", err)
	}

	now := time.Now().UTC()
	testEvent := &events.Event{
		ID:            "rest-connectivity-test",
		Type:          "com.clario360.integration.test",
		Source:        "clario360/integration-engine",
		TenantID:      "connectivity-test",
		CorrelationID: "rest-connectivity-test",
		Time:          now,
		Data:          json.RawMessage(`{"severity":"info","title":"Clario 360 REST connectivity test","test":true}`),
	}

	ef := extractEventFields(testEvent)
	body, err := c.renderBody(cfg, testEvent, ef)
	if err != nil {
		return connector.Result{}, fmt.Errorf("rest test: render body: %w", err)
	}
	return c.deliver(ctx, cfg, body)
}

// deliver performs the request with bounded retry/backoff. It retries on
// transport errors and on retryable status codes (429 and 5xx), honouring the
// context for cancellation between attempts. It returns the result of the last
// attempt.
func (c *RESTConnector) deliver(ctx context.Context, cfg map[string]any, body []byte) (connector.Result, error) {
	attempts := c.maxAttempts
	if attempts < 1 {
		attempts = 1
	}

	var lastResult connector.Result
	var lastErr error

	for attempt := 1; attempt <= attempts; attempt++ {
		req, err := c.buildRequest(ctx, cfg, body)
		if err != nil {
			// Request construction errors are not retryable.
			return connector.Result{}, fmt.Errorf("rest: build request: %w", err)
		}

		resp, err := c.client.Do(req)
		if err != nil {
			lastResult = connector.Result{}
			lastErr = fmt.Errorf("rest: request failed (attempt %d/%d): %w", attempt, attempts, err)
			if attempt < attempts && c.waitBackoff(ctx, attempt) == nil {
				continue
			}
			return lastResult, lastErr
		}

		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, restMaxBodyBytes))
		_ = resp.Body.Close()
		lastResult = connector.Result{ResponseCode: resp.StatusCode, ResponseBody: string(respBody)}

		if resp.StatusCode >= 200 && resp.StatusCode < 300 {
			return lastResult, nil
		}

		lastErr = fmt.Errorf("rest: endpoint returned %d (attempt %d/%d): %s",
			resp.StatusCode, attempt, attempts, strings.TrimSpace(string(respBody)))

		if !retryableStatus(resp.StatusCode) || attempt == attempts {
			return lastResult, lastErr
		}
		if err := c.waitBackoff(ctx, attempt); err != nil {
			return lastResult, lastErr
		}
	}

	return lastResult, lastErr
}

// buildRequest constructs the HTTP request for a single attempt: method, URL,
// content type, static headers, auth header, and (when configured) the HMAC
// signature headers over the exact body bytes.
func (c *RESTConnector) buildRequest(ctx context.Context, cfg map[string]any, body []byte) (*http.Request, error) {
	method := c.method(cfg)
	url := strings.TrimSpace(cfgString(cfg, "url"))

	var reqBody io.Reader
	if method != http.MethodGet && method != http.MethodDelete && len(body) > 0 {
		reqBody = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, reqBody)
	if err != nil {
		return nil, err
	}

	contentType := firstNonEmpty(cfgString(cfg, "content_type"), "application/json")
	if reqBody != nil {
		req.Header.Set("Content-Type", contentType)
	}

	for k, v := range cfgStringMap(cfg, "headers") {
		req.Header.Set(k, v)
	}

	c.applyAuth(req, cfg)

	if secret := cfgString(cfg, "hmac_secret"); secret != "" {
		ts := strconv.FormatInt(time.Now().UTC().Unix(), 10)
		req.Header.Set("X-Clario-Timestamp", ts)
		req.Header.Set("X-Clario-Signature", signHMAC(secret, ts, body))
	}

	return req, nil
}

// applyAuth sets the request's authentication header(s) per the configured
// scheme. none is a no-op.
func (c *RESTConnector) applyAuth(req *http.Request, cfg map[string]any) {
	switch c.authMode(cfg) {
	case restAuthBearer:
		req.Header.Set("Authorization", "Bearer "+cfgString(cfg, "bearer_token"))
	case restAuthBasic:
		req.SetBasicAuth(cfgString(cfg, "basic_username"), cfgString(cfg, "basic_password"))
	case restAuthAPIKey:
		header := firstNonEmpty(cfgString(cfg, "api_key_header"), "X-API-Key")
		req.Header.Set(header, cfgString(cfg, "api_key_value"))
	}
}

// renderBody produces the request body. With no body_template it emits a
// canonical JSON envelope (id/type/source/tenant/severity/data/...) compatible
// with the legacy webhook payload. With a template it renders text/template over
// a flattened field map (see templateData), allowing arbitrary payload shapes.
func (c *RESTConnector) renderBody(cfg map[string]any, event *events.Event, ef eventFields) ([]byte, error) {
	tmplSrc := strings.TrimSpace(cfgString(cfg, "body_template"))
	if tmplSrc == "" {
		return c.defaultEnvelope(event, ef)
	}

	tmpl, err := template.New("rest_body").Option("missingkey=zero").Parse(tmplSrc)
	if err != nil {
		return nil, fmt.Errorf("parse template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, templateData(event, ef)); err != nil {
		return nil, fmt.Errorf("execute template: %w", err)
	}
	return buf.Bytes(), nil
}

// defaultEnvelope marshals the canonical Clario event envelope as JSON.
func (c *RESTConnector) defaultEnvelope(event *events.Event, ef eventFields) ([]byte, error) {
	envelope := map[string]any{
		"id":          ef.ID,
		"type":        ef.Type,
		"source":      ef.Source,
		"subject":     ef.Subject,
		"tenant_id":   ef.TenantID,
		"user_id":     ef.UserID,
		"severity":    ef.Severity,
		"correlation": ef.CorrelationID,
	}
	if event != nil {
		envelope["time"] = event.Time
		if len(event.Data) > 0 {
			envelope["data"] = json.RawMessage(event.Data)
		}
	}
	raw, err := json.Marshal(envelope)
	if err != nil {
		return nil, fmt.Errorf("marshal envelope: %w", err)
	}
	return raw, nil
}

// templateData builds the data passed to a body_template. Top-level keys are the
// envelope fields; ".Data" exposes the decoded payload map for deep access
// (e.g. {{ .Data.alert_id }}).
func templateData(event *events.Event, ef eventFields) map[string]any {
	data := map[string]any{
		"ID":            ef.ID,
		"Type":          ef.Type,
		"Source":        ef.Source,
		"Subject":       ef.Subject,
		"TenantID":      ef.TenantID,
		"UserID":        ef.UserID,
		"Severity":      ef.Severity,
		"Title":         ef.Title,
		"Summary":       ef.Summary,
		"CorrelationID": ef.CorrelationID,
		"Data":          ef.Data,
	}
	if event != nil {
		data["Time"] = event.Time.UTC().Format(time.RFC3339)
	} else {
		data["Time"] = ""
	}
	return data
}

// method returns the configured (upper-cased) HTTP method, defaulting to POST.
func (c *RESTConnector) method(cfg map[string]any) string {
	m := strings.ToUpper(strings.TrimSpace(cfgString(cfg, "method")))
	if m == "" {
		return http.MethodPost
	}
	return m
}

// authMode returns the configured (lower-cased) auth scheme, defaulting to none.
func (c *RESTConnector) authMode(cfg map[string]any) string {
	a := strings.ToLower(strings.TrimSpace(cfgString(cfg, "auth")))
	if a == "" {
		return restAuthNone
	}
	return a
}

// waitBackoff sleeps for an exponentially increasing interval before the next
// attempt, returning early (with ctx.Err()) if the context is cancelled. A zero
// baseBackoff yields immediate retries (used in tests).
func (c *RESTConnector) waitBackoff(ctx context.Context, attempt int) error {
	if c.baseBackoff <= 0 {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			return nil
		}
	}
	// Exponential: base * 2^(attempt-1).
	delay := c.baseBackoff << (attempt - 1)
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

// signHMAC computes the hex HMAC-SHA256 over "timestamp.body", matching the
// scheme the existing webhook signer uses so receivers verify identically.
func signHMAC(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

// basicAuthHeader returns the canonical "Basic base64(user:pass)" value. It is
// kept for callers/tests that need to assert the exact header; the request path
// uses req.SetBasicAuth which produces the same value.
func basicAuthHeader(username, password string) string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(username+":"+password))
}

// retryableStatus reports whether an HTTP status warrants a retry: 429 (rate
// limited) and 5xx (server errors) are transient; 4xx (other) are not.
func retryableStatus(code int) bool {
	return code == http.StatusTooManyRequests || (code >= 500 && code <= 599)
}

// Compile-time assertions: RESTConnector is a notify Connector and a Tester.
var (
	_ connector.Connector = (*RESTConnector)(nil)
	_ connector.Tester    = (*RESTConnector)(nil)
)
