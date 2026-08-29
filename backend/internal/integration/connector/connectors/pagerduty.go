package connectors

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
)

// PagerDutyType is the connector type key for the PagerDuty connector.
const PagerDutyType = "pagerduty"

// pagerDutyEventsV2URL is the canonical PagerDuty Events API v2 enqueue
// endpoint. It is overridable per-connector for tests (see WithEndpoint).
const pagerDutyEventsV2URL = "https://events.pagerduty.com/v2/enqueue"

// pagerDutyTimeout bounds the HTTP call to the Events API.
const pagerDutyTimeout = 15 * time.Second

// PagerDuty Events API v2 severities. PD only accepts these four values; every
// Clario severity is mapped onto one of them by pdSeverity.
const (
	pdSeverityCritical = "critical"
	pdSeverityError    = "error"
	pdSeverityWarning  = "warning"
	pdSeverityInfo     = "info"
)

// PagerDutyConnector triggers PagerDuty incidents via the Events API v2. Send
// POSTs a real v2 "enqueue" payload (routing_key, event_action=trigger, and a
// payload block carrying summary/source/severity/custom_details) and treats the
// documented 202 Accepted as success, mapping other statuses to errors.
//
// It is notify-capable and supports Test (a trigger+resolve round-trip would be
// destructive, so Test issues a benign payload validation against the endpoint).
type PagerDutyConnector struct {
	manifest connector.Manifest
	endpoint string
	client   *http.Client
}

// PagerDutyOption customizes a PagerDutyConnector at construction.
type PagerDutyOption func(*PagerDutyConnector)

// WithPagerDutyEndpoint overrides the Events API URL (used by tests to point at
// an httptest server). Empty values are ignored.
func WithPagerDutyEndpoint(url string) PagerDutyOption {
	return func(c *PagerDutyConnector) {
		if strings.TrimSpace(url) != "" {
			c.endpoint = url
		}
	}
}

// WithPagerDutyHTTPClient overrides the HTTP client (used by tests).
func WithPagerDutyHTTPClient(client *http.Client) PagerDutyOption {
	return func(c *PagerDutyConnector) {
		if client != nil {
			c.client = client
		}
	}
}

// NewPagerDuty returns a ready-to-register PagerDutyConnector. Pass options to
// override the endpoint/client in tests.
func NewPagerDuty(opts ...PagerDutyOption) connector.Connector {
	c := &PagerDutyConnector{
		manifest: pagerDutyManifest(),
		endpoint: pagerDutyEventsV2URL,
		client:   &http.Client{Timeout: pagerDutyTimeout},
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// pagerDutyManifest declares the PagerDuty connector's config schema.
// routing_key is the secret integration key; severity_map optionally overrides
// the default Clario->PD severity mapping; dedup_key_field names the payload key
// whose value becomes the PD dedup_key (for alert de-duplication).
func pagerDutyManifest() connector.Manifest {
	return connector.Manifest{
		Type:         PagerDutyType,
		DisplayName:  "PagerDuty",
		Capabilities: connector.CapabilityNotify,
		AuthKind:     connector.AuthBearerToken,
		ConfigSchema: []connector.FieldSpec{
			{Name: "routing_key", Type: connector.FieldTypeSecret, Required: true, Description: "PagerDuty Events API v2 integration (routing) key"},
			{Name: "severity_map", Type: connector.FieldTypeObject, Description: "Optional override of Clario severity -> PD severity (critical|error|warning|info)"},
			{Name: "dedup_key_field", Type: connector.FieldTypeString, Default: "id", Description: "Event data field whose value is used as the PD dedup_key"},
		},
	}
}

// Manifest returns the connector's declarative descriptor.
func (c *PagerDutyConnector) Manifest() connector.Manifest { return c.manifest }

// ValidateConfig validates cfg against the schema and verifies any custom
// severity_map only maps onto valid PD severities.
func (c *PagerDutyConnector) ValidateConfig(cfg map[string]any) error {
	if err := connector.ValidateAgainstSchema(c.manifest.ConfigSchema, cfg); err != nil {
		return err
	}
	if m := cfgStringMap(cfg, "severity_map"); m != nil {
		for clario, pd := range m {
			if !validPDSeverity(pd) {
				return fmt.Errorf("pagerduty: severity_map[%q]=%q is not a valid PD severity (critical|error|warning|info)", clario, pd)
			}
		}
	}
	return nil
}

// pdEventV2 is the exact Events API v2 enqueue request body.
type pdEventV2 struct {
	RoutingKey  string      `json:"routing_key"`
	EventAction string      `json:"event_action"`
	DedupKey    string      `json:"dedup_key,omitempty"`
	Client      string      `json:"client,omitempty"`
	Payload     pdPayloadV2 `json:"payload"`
	Links       []pdLinkV2  `json:"links,omitempty"`
}

// pdPayloadV2 is the nested "payload" object of the v2 request.
type pdPayloadV2 struct {
	Summary       string         `json:"summary"`
	Source        string         `json:"source"`
	Severity      string         `json:"severity"`
	Timestamp     string         `json:"timestamp,omitempty"`
	Component     string         `json:"component,omitempty"`
	Group         string         `json:"group,omitempty"`
	Class         string         `json:"class,omitempty"`
	CustomDetails map[string]any `json:"custom_details,omitempty"`
}

// pdLinkV2 is a contextual link attached to the incident.
type pdLinkV2 struct {
	Href string `json:"href"`
	Text string `json:"text,omitempty"`
}

// pdResponseV2 is the documented 202 response body.
type pdResponseV2 struct {
	Status   string `json:"status"`
	Message  string `json:"message"`
	DedupKey string `json:"dedup_key"`
}

// Send builds and POSTs a v2 trigger event for the given Clario event. It
// returns the PD dedup_key in the ExternalRef on success (202), and maps any
// other status to an error while still surfacing the upstream code/body.
func (c *PagerDutyConnector) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	if err := c.ValidateConfig(cfg); err != nil {
		return connector.Result{}, fmt.Errorf("pagerduty: %w", err)
	}

	ef := extractEventFields(event)
	routingKey := strings.TrimSpace(cfgString(cfg, "routing_key"))

	body := pdEventV2{
		RoutingKey:  routingKey,
		EventAction: "trigger",
		DedupKey:    c.dedupKey(cfg, ef),
		Client:      "Clario 360",
		Payload: pdPayloadV2{
			Summary:   c.summary(ef),
			Source:    pdSource(ef),
			Severity:  c.pdSeverity(cfg, ef.Severity),
			Timestamp: pdTimestamp(event),
			Class:     ef.Type,
			Group:     ef.TenantID,
			CustomDetails: map[string]any{
				"event_id":        ef.ID,
				"event_type":      ef.Type,
				"clario_severity": ef.Severity,
				"tenant_id":       ef.TenantID,
				"source":          ef.Source,
				"correlation_id":  ef.CorrelationID,
				"summary":         ef.Summary,
			},
		},
	}

	res, parsed, err := c.post(ctx, body)
	if err != nil {
		return res, err
	}
	if parsed != nil && parsed.DedupKey != "" {
		res.ExternalRef = &connector.ExternalRef{
			System:      PagerDutyType,
			ExternalID:  parsed.DedupKey,
			ExternalKey: parsed.DedupKey,
		}
	}
	return res, nil
}

// Test verifies the routing key and endpoint are usable. PagerDuty has no
// non-destructive ping, so Test sends a low-severity "info" trigger flagged as
// a connectivity check and de-duplicated under a fixed key, then returns the
// 202/dedup outcome. This is intentionally benign (info severity, stable dedup
// key) and proves end-to-end auth + payload acceptance.
func (c *PagerDutyConnector) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	if err := c.ValidateConfig(cfg); err != nil {
		return connector.Result{}, fmt.Errorf("pagerduty test: %w", err)
	}
	routingKey := strings.TrimSpace(cfgString(cfg, "routing_key"))

	body := pdEventV2{
		RoutingKey:  routingKey,
		EventAction: "trigger",
		DedupKey:    "clario360-connectivity-test",
		Client:      "Clario 360",
		Payload: pdPayloadV2{
			Summary:  "Clario 360 PagerDuty integration connectivity test",
			Source:   "clario360/integration-engine",
			Severity: pdSeverityInfo,
			CustomDetails: map[string]any{
				"test": true,
			},
		},
	}

	res, _, err := c.post(ctx, body)
	return res, err
}

// post marshals body, POSTs it to the Events API endpoint with the documented
// content type, reads the response, and maps the status. 202 is success; any
// other status is an error carrying the upstream code and (truncated) body.
func (c *PagerDutyConnector) post(ctx context.Context, body pdEventV2) (connector.Result, *pdResponseV2, error) {
	raw, err := json.Marshal(body)
	if err != nil {
		return connector.Result{}, nil, fmt.Errorf("pagerduty: marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(raw))
	if err != nil {
		return connector.Result{}, nil, fmt.Errorf("pagerduty: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/vnd.pagerduty+json;version=2")

	resp, err := c.client.Do(req)
	if err != nil {
		return connector.Result{}, nil, fmt.Errorf("pagerduty: request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	result := connector.Result{ResponseCode: resp.StatusCode, ResponseBody: string(respBody)}

	var parsed pdResponseV2
	if len(respBody) > 0 {
		_ = json.Unmarshal(respBody, &parsed)
	}

	if resp.StatusCode == http.StatusAccepted {
		return result, &parsed, nil
	}

	// Map non-202 to a descriptive error. PagerDuty returns 400 for bad
	// payloads and 429 for rate limits, each with a JSON message.
	detail := parsed.Message
	if detail == "" {
		detail = strings.TrimSpace(string(respBody))
	}
	return result, &parsed, fmt.Errorf("pagerduty: Events API returned %d: %s", resp.StatusCode, detail)
}

// dedupKey resolves the PD dedup_key from the configured field name (default
// "id"), falling back to the event id so de-duplication still works when the
// configured field is absent.
func (c *PagerDutyConnector) dedupKey(cfg map[string]any, ef eventFields) string {
	field := strings.TrimSpace(cfgString(cfg, "dedup_key_field"))
	if field == "" {
		field = "id"
	}
	if field == "id" {
		return ef.ID
	}
	if v := dataString(ef.Data, field); v != "" {
		return v
	}
	return ef.ID
}

// summary builds the PD payload.summary (max 1024 chars per the API).
func (c *PagerDutyConnector) summary(ef eventFields) string {
	s := fmt.Sprintf("[%s] %s", strings.ToUpper(ef.Severity), ef.Title)
	if ef.Summary != "" {
		s = s + " — " + ef.Summary
	}
	if len(s) > 1024 {
		s = s[:1021] + "..."
	}
	return s
}

// pdSeverity maps a Clario severity to a PD Events API v2 severity, honouring
// any per-connector severity_map override first.
func (c *PagerDutyConnector) pdSeverity(cfg map[string]any, clarioSeverity string) string {
	clarioSeverity = strings.ToLower(strings.TrimSpace(clarioSeverity))
	if m := cfgStringMap(cfg, "severity_map"); m != nil {
		if mapped, ok := m[clarioSeverity]; ok && validPDSeverity(mapped) {
			return strings.ToLower(mapped)
		}
	}
	return pdSeverity(clarioSeverity)
}

// pdSeverity is the default Clario->PD severity mapping. Clario uses
// critical/high/medium/low/info; PD accepts critical/error/warning/info.
func pdSeverity(clarioSeverity string) string {
	switch strings.ToLower(strings.TrimSpace(clarioSeverity)) {
	case "critical", "crit", "fatal":
		return pdSeverityCritical
	case "high", "error", "err", "major":
		return pdSeverityError
	case "medium", "med", "warning", "warn", "moderate", "minor":
		return pdSeverityWarning
	case "low", "info", "informational", "debug", "":
		return pdSeverityInfo
	default:
		// Unknown severities default to info so an unexpected value never
		// escalates a non-incident to critical.
		return pdSeverityInfo
	}
}

// validPDSeverity reports whether s is one of PD's accepted severities.
func validPDSeverity(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case pdSeverityCritical, pdSeverityError, pdSeverityWarning, pdSeverityInfo:
		return true
	default:
		return false
	}
}

// pdSource resolves payload.source (a required, non-empty field). It prefers the
// event source, then the tenant, then a stable fallback.
func pdSource(ef eventFields) string {
	return firstNonEmpty(ef.Source, ef.TenantID, "clario360/integration-engine")
}

// pdTimestamp returns the event time in RFC3339, or "" so PD stamps it on
// receipt.
func pdTimestamp(event *events.Event) string {
	if event == nil {
		return ""
	}
	if !event.Time.IsZero() {
		return event.Time.UTC().Format(time.RFC3339)
	}
	return ""
}

// Compile-time assertions: PagerDutyConnector is a notify Connector and Tester.
var (
	_ connector.Connector = (*PagerDutyConnector)(nil)
	_ connector.Tester    = (*PagerDutyConnector)(nil)
)
