package connectors

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
)

// pdCapture records the request a fake PagerDuty Events API endpoint received.
type pdCapture struct {
	mu          sync.Mutex
	contentType string
	accept      string
	body        []byte
	hits        int
}

func (c *pdCapture) get() (contentType, accept string, body []byte, hits int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.contentType, c.accept, append([]byte(nil), c.body...), c.hits
}

// newPDServer returns an httptest server emulating the Events API v2 enqueue
// endpoint with a caller-supplied status and response body. It is a real HTTP
// server; the connector issues genuine http.Client.Do against it.
func newPDServer(t *testing.T, status int, respBody string) (*httptest.Server, *pdCapture) {
	t.Helper()
	cap := &pdCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		cap.mu.Lock()
		cap.hits++
		cap.contentType = r.Header.Get("Content-Type")
		cap.accept = r.Header.Get("Accept")
		cap.body = body
		cap.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(respBody))
	}))
	t.Cleanup(srv.Close)
	return srv, cap
}

func pdEvent(t *testing.T, severity, title string) *events.Event {
	t.Helper()
	data, _ := json.Marshal(map[string]any{"severity": severity, "title": title, "alert_id": "A-42"})
	return &events.Event{
		ID:            "evt-pd-1",
		Type:          "com.clario360.siem.alert.created",
		Source:        "clario360/siem-service",
		TenantID:      "tenant-zeta",
		CorrelationID: "corr-pd",
		Time:          time.Date(2026, 6, 13, 9, 0, 0, 0, time.UTC),
		Data:          data,
	}
}

func TestPagerDuty_Manifest(t *testing.T) {
	m := NewPagerDuty().Manifest()
	if m.Type != PagerDutyType {
		t.Errorf("type = %q, want %q", m.Type, PagerDutyType)
	}
	if !m.Capabilities.CanNotify() {
		t.Error("pagerduty must be notify-capable")
	}
	if err := m.Validate(); err != nil {
		t.Errorf("manifest invalid: %v", err)
	}
	var routingKey connector.FieldSpec
	for _, f := range m.ConfigSchema {
		if f.Name == "routing_key" {
			routingKey = f
		}
	}
	if !routingKey.Required || !routingKey.IsSecret() {
		t.Errorf("routing_key must be required+secret, got %+v", routingKey)
	}
}

func TestPagerDuty_Send_RealHTTP_V2Shape(t *testing.T) {
	srv, cap := newPDServer(t, http.StatusAccepted,
		`{"status":"success","message":"Event processed","dedup_key":"evt-pd-1"}`)
	c := NewPagerDuty(WithPagerDutyEndpoint(srv.URL))

	cfg := map[string]any{"routing_key": "R0UTING-KEY-ABCDEF"}
	res, err := c.Send(context.Background(), cfg, pdEvent(t, "critical", "Brute force on VPN"))
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.ResponseCode != http.StatusAccepted {
		t.Errorf("code = %d, want 202", res.ResponseCode)
	}
	if res.ExternalRef == nil || res.ExternalRef.ExternalID != "evt-pd-1" {
		t.Errorf("expected dedup_key in ExternalRef, got %+v", res.ExternalRef)
	}

	contentType, accept, body, hits := cap.get()
	if hits != 1 {
		t.Fatalf("expected exactly 1 request, got %d", hits)
	}
	if contentType != "application/json" {
		t.Errorf("Content-Type = %q", contentType)
	}
	if !strings.Contains(accept, "pagerduty+json") {
		t.Errorf("Accept = %q, want vendor v2 media type", accept)
	}

	// Assert the EXACT v2 enqueue JSON shape.
	var got pdEventV2
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("request body is not valid v2 JSON: %v\n%s", err, body)
	}
	if got.RoutingKey != "R0UTING-KEY-ABCDEF" {
		t.Errorf("routing_key = %q", got.RoutingKey)
	}
	if got.EventAction != "trigger" {
		t.Errorf("event_action = %q, want trigger", got.EventAction)
	}
	if got.DedupKey != "evt-pd-1" {
		t.Errorf("dedup_key = %q, want evt-pd-1 (default field id)", got.DedupKey)
	}
	if got.Payload.Severity != pdSeverityCritical {
		t.Errorf("payload.severity = %q, want critical", got.Payload.Severity)
	}
	if got.Payload.Source == "" {
		t.Error("payload.source must be non-empty (PD requires it)")
	}
	if !strings.Contains(got.Payload.Summary, "Brute force on VPN") {
		t.Errorf("payload.summary = %q", got.Payload.Summary)
	}
	if got.Payload.CustomDetails["event_id"] != "evt-pd-1" {
		t.Errorf("custom_details.event_id = %v", got.Payload.CustomDetails["event_id"])
	}
	if got.Payload.Timestamp == "" {
		t.Error("payload.timestamp should be set from event time")
	}
}

func TestPagerDuty_Send_DedupKeyFromCustomField(t *testing.T) {
	srv, cap := newPDServer(t, http.StatusAccepted, `{"status":"success","dedup_key":"A-42"}`)
	c := NewPagerDuty(WithPagerDutyEndpoint(srv.URL))

	cfg := map[string]any{"routing_key": "rk", "dedup_key_field": "alert_id"}
	if _, err := c.Send(context.Background(), cfg, pdEvent(t, "high", "x")); err != nil {
		t.Fatalf("Send: %v", err)
	}
	_, _, body, _ := cap.get()
	var got pdEventV2
	_ = json.Unmarshal(body, &got)
	if got.DedupKey != "A-42" {
		t.Errorf("dedup_key = %q, want A-42 (from alert_id field)", got.DedupKey)
	}
}

func TestPagerDuty_SeverityMapping(t *testing.T) {
	tests := []struct {
		clario string
		wantPD string
	}{
		{"critical", pdSeverityCritical},
		{"high", pdSeverityError},
		{"medium", pdSeverityWarning},
		{"low", pdSeverityInfo},
		{"info", pdSeverityInfo},
		{"unknown-value", pdSeverityInfo},
		{"", pdSeverityInfo},
	}
	for _, tt := range tests {
		t.Run(tt.clario, func(t *testing.T) {
			if got := pdSeverity(tt.clario); got != tt.wantPD {
				t.Errorf("pdSeverity(%q) = %q, want %q", tt.clario, got, tt.wantPD)
			}
		})
	}
}

func TestPagerDuty_Send_SeverityMapOverride(t *testing.T) {
	srv, cap := newPDServer(t, http.StatusAccepted, `{"dedup_key":"k"}`)
	c := NewPagerDuty(WithPagerDutyEndpoint(srv.URL))

	cfg := map[string]any{
		"routing_key":  "rk",
		"severity_map": map[string]any{"medium": "error"},
	}
	if _, err := c.Send(context.Background(), cfg, pdEvent(t, "medium", "x")); err != nil {
		t.Fatalf("Send: %v", err)
	}
	_, _, body, _ := cap.get()
	var got pdEventV2
	_ = json.Unmarshal(body, &got)
	if got.Payload.Severity != "error" {
		t.Errorf("severity_map override failed: got %q, want error", got.Payload.Severity)
	}
}

func TestPagerDuty_ValidateConfig(t *testing.T) {
	c := NewPagerDuty()
	if err := c.ValidateConfig(map[string]any{}); err == nil {
		t.Error("expected error for missing routing_key")
	}
	if err := c.ValidateConfig(map[string]any{"routing_key": "rk"}); err != nil {
		t.Errorf("valid config rejected: %v", err)
	}
	// Bad severity_map target.
	err := c.ValidateConfig(map[string]any{
		"routing_key":  "rk",
		"severity_map": map[string]any{"high": "catastrophic"},
	})
	if err == nil || !strings.Contains(err.Error(), "not a valid PD severity") {
		t.Errorf("expected invalid severity error, got %v", err)
	}
}

func TestPagerDuty_Send_ErrorMapping(t *testing.T) {
	srv, _ := newPDServer(t, http.StatusBadRequest,
		`{"status":"invalid event","message":"Event object is invalid","errors":["routing_key missing"]}`)
	c := NewPagerDuty(WithPagerDutyEndpoint(srv.URL))

	res, err := c.Send(context.Background(), map[string]any{"routing_key": "rk"}, pdEvent(t, "critical", "x"))
	if err == nil {
		t.Fatal("expected error for 400 response")
	}
	if res.ResponseCode != http.StatusBadRequest {
		t.Errorf("code = %d, want 400", res.ResponseCode)
	}
	if !strings.Contains(err.Error(), "Event object is invalid") {
		t.Errorf("error should surface PD message, got %v", err)
	}
}

func TestPagerDuty_Send_RateLimited(t *testing.T) {
	srv, _ := newPDServer(t, http.StatusTooManyRequests, `{"status":"throttled","message":"Too many requests"}`)
	c := NewPagerDuty(WithPagerDutyEndpoint(srv.URL))

	res, err := c.Send(context.Background(), map[string]any{"routing_key": "rk"}, pdEvent(t, "low", "x"))
	if err == nil {
		t.Fatal("expected error for 429")
	}
	if res.ResponseCode != http.StatusTooManyRequests {
		t.Errorf("code = %d, want 429", res.ResponseCode)
	}
}

func TestPagerDuty_Test_RealHTTP(t *testing.T) {
	srv, cap := newPDServer(t, http.StatusAccepted, `{"status":"success","dedup_key":"clario360-connectivity-test"}`)
	c := NewPagerDuty(WithPagerDutyEndpoint(srv.URL)).(connector.Tester)

	res, err := c.Test(context.Background(), map[string]any{"routing_key": "rk"})
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if res.ResponseCode != http.StatusAccepted {
		t.Errorf("Test code = %d, want 202", res.ResponseCode)
	}
	_, _, body, _ := cap.get()
	var got pdEventV2
	_ = json.Unmarshal(body, &got)
	if got.Payload.Severity != pdSeverityInfo {
		t.Errorf("Test should use info severity, got %q", got.Payload.Severity)
	}
	if got.DedupKey != "clario360-connectivity-test" {
		t.Errorf("Test dedup_key = %q", got.DedupKey)
	}
}

// TestPagerDuty_Conformance verifies the optional-interface conformance.
func TestPagerDuty_Conformance(t *testing.T) {
	var _ connector.Connector = (*PagerDutyConnector)(nil)
	var _ connector.Tester = (*PagerDutyConnector)(nil)
	c := NewPagerDuty()
	if _, ok := c.(connector.Tester); !ok {
		t.Error("PagerDutyConnector should implement Tester")
	}
	if _, ok := c.(connector.TicketConnector); ok {
		t.Error("PagerDutyConnector should NOT implement TicketConnector")
	}
}
