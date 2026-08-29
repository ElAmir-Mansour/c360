package connectors

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
)

// restCapture records what the test REST endpoint received.
type restCapture struct {
	mu      sync.Mutex
	method  string
	headers http.Header
	body    []byte
	hits    int32
}

func (c *restCapture) record(r *http.Request) {
	body, _ := io.ReadAll(r.Body)
	c.mu.Lock()
	defer c.mu.Unlock()
	atomic.AddInt32(&c.hits, 1)
	c.method = r.Method
	c.headers = r.Header.Clone()
	c.body = body
}

func (c *restCapture) get() (method string, headers http.Header, body []byte, hits int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.method, c.headers, append([]byte(nil), c.body...), int(atomic.LoadInt32(&c.hits))
}

func newRESTServer(t *testing.T, status int, resp string) (*httptest.Server, *restCapture) {
	t.Helper()
	cap := &restCapture{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cap.record(r)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(resp))
	}))
	t.Cleanup(srv.Close)
	return srv, cap
}

func restEvent(t *testing.T) *events.Event {
	t.Helper()
	data, _ := json.Marshal(map[string]any{
		"severity": "high",
		"title":    "Disk almost full",
		"host":     "db-primary",
		"pct":      float64(94),
	})
	return &events.Event{
		ID:            "evt-rest-1",
		Type:          "com.clario360.acta.task.created",
		Source:        "clario360/acta-service",
		TenantID:      "tenant-orion",
		CorrelationID: "corr-rest",
		Time:          time.Date(2026, 6, 13, 8, 0, 0, 0, time.UTC),
		Data:          data,
	}
}

func TestREST_Manifest(t *testing.T) {
	m := NewREST().Manifest()
	if m.Type != RESTType {
		t.Errorf("type = %q, want %q", m.Type, RESTType)
	}
	if !m.Capabilities.CanNotify() {
		t.Error("rest must be notify-capable")
	}
	if err := m.Validate(); err != nil {
		t.Errorf("manifest invalid: %v", err)
	}
	secrets := map[string]bool{}
	for _, f := range m.ConfigSchema {
		if f.IsSecret() {
			secrets[f.Name] = true
		}
	}
	for _, want := range []string{"bearer_token", "basic_password", "api_key_value", "hmac_secret"} {
		if !secrets[want] {
			t.Errorf("field %q should be marked secret", want)
		}
	}
}

func TestREST_Send_DefaultEnvelope_NoAuth(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusOK, `{"ok":true}`)
	c := NewREST()

	cfg := map[string]any{"url": srv.URL, "auth": "none"}
	res, err := c.Send(context.Background(), cfg, restEvent(t))
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.ResponseCode != http.StatusOK {
		t.Errorf("code = %d, want 200", res.ResponseCode)
	}

	method, headers, body, hits := cap.get()
	if hits != 1 {
		t.Fatalf("expected 1 hit, got %d", hits)
	}
	if method != http.MethodPost {
		t.Errorf("method = %q, want POST (default)", method)
	}
	if headers.Get("Content-Type") != "application/json" {
		t.Errorf("Content-Type = %q", headers.Get("Content-Type"))
	}
	if headers.Get("Authorization") != "" {
		t.Errorf("auth=none should not set Authorization, got %q", headers.Get("Authorization"))
	}

	var envelope map[string]any
	if err := json.Unmarshal(body, &envelope); err != nil {
		t.Fatalf("default envelope not JSON: %v\n%s", err, body)
	}
	if envelope["id"] != "evt-rest-1" || envelope["severity"] != "high" {
		t.Errorf("envelope fields wrong: %+v", envelope)
	}
	if envelope["data"] == nil {
		t.Error("envelope should carry the event data")
	}
}

func TestREST_Send_BearerAuth(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusAccepted, "")
	c := NewREST()
	cfg := map[string]any{"url": srv.URL, "auth": "bearer", "bearer_token": "secret-bearer-xyz"}

	if _, err := c.Send(context.Background(), cfg, restEvent(t)); err != nil {
		t.Fatalf("Send: %v", err)
	}
	_, headers, _, _ := cap.get()
	if got := headers.Get("Authorization"); got != "Bearer secret-bearer-xyz" {
		t.Errorf("Authorization = %q, want Bearer secret-bearer-xyz", got)
	}
}

func TestREST_Send_BasicAuth(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusOK, "")
	c := NewREST()
	cfg := map[string]any{"url": srv.URL, "auth": "basic", "basic_username": "admin", "basic_password": "p@ss"}

	if _, err := c.Send(context.Background(), cfg, restEvent(t)); err != nil {
		t.Fatalf("Send: %v", err)
	}
	_, headers, _, _ := cap.get()
	want := basicAuthHeader("admin", "p@ss")
	if got := headers.Get("Authorization"); got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
	// And it must round-trip through Go's parser.
	u, p, ok := parseBasic(headers.Get("Authorization"))
	if !ok || u != "admin" || p != "p@ss" {
		t.Errorf("basic auth did not round-trip: u=%q p=%q ok=%v", u, p, ok)
	}
}

func TestREST_Send_APIKeyAuth(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusOK, "")
	c := NewREST()
	cfg := map[string]any{
		"url": srv.URL, "auth": "api_key",
		"api_key_header": "X-Custom-Key", "api_key_value": "key-12345",
	}
	if _, err := c.Send(context.Background(), cfg, restEvent(t)); err != nil {
		t.Fatalf("Send: %v", err)
	}
	_, headers, _, _ := cap.get()
	if got := headers.Get("X-Custom-Key"); got != "key-12345" {
		t.Errorf("X-Custom-Key = %q, want key-12345", got)
	}
}

func TestREST_Send_HMACSignature(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusOK, "")
	c := NewREST()
	cfg := map[string]any{"url": srv.URL, "hmac_secret": "shhh-signing-secret"}

	if _, err := c.Send(context.Background(), cfg, restEvent(t)); err != nil {
		t.Fatalf("Send: %v", err)
	}
	_, headers, body, _ := cap.get()

	ts := headers.Get("X-Clario-Timestamp")
	sig := headers.Get("X-Clario-Signature")
	if ts == "" || sig == "" {
		t.Fatalf("missing signature headers: ts=%q sig=%q", ts, sig)
	}
	if _, err := strconv.ParseInt(ts, 10, 64); err != nil {
		t.Errorf("timestamp not numeric: %q", ts)
	}

	// Recompute the signature exactly as a receiver would and compare.
	mac := hmac.New(sha256.New, []byte("shhh-signing-secret"))
	mac.Write([]byte(ts))
	mac.Write([]byte("."))
	mac.Write(body)
	want := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(want), []byte(sig)) {
		t.Errorf("signature mismatch:\n got=%s\nwant=%s", sig, want)
	}
}

func TestREST_Send_TemplatedBody(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusOK, "")
	c := NewREST()
	tmpl := `{"text":"[{{.Severity}}] {{.Title}} on {{.Data.host}} ({{.Data.pct}}%)","tenant":"{{.TenantID}}"}`
	cfg := map[string]any{"url": srv.URL, "body_template": tmpl}

	if _, err := c.Send(context.Background(), cfg, restEvent(t)); err != nil {
		t.Fatalf("Send: %v", err)
	}
	_, _, body, _ := cap.get()

	var got map[string]any
	if err := json.Unmarshal(body, &got); err != nil {
		t.Fatalf("templated body not valid JSON: %v\n%s", err, body)
	}
	wantText := "[high] Disk almost full on db-primary (94%)"
	if got["text"] != wantText {
		t.Errorf("templated text = %q, want %q", got["text"], wantText)
	}
	if got["tenant"] != "tenant-orion" {
		t.Errorf("templated tenant = %q", got["tenant"])
	}
}

func TestREST_Send_CustomMethodAndHeaders(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusOK, "")
	c := NewREST()
	cfg := map[string]any{
		"url":     srv.URL,
		"method":  "PUT",
		"headers": map[string]any{"X-Trace": "abc123", "X-Env": "prod"},
	}
	if _, err := c.Send(context.Background(), cfg, restEvent(t)); err != nil {
		t.Fatalf("Send: %v", err)
	}
	method, headers, _, _ := cap.get()
	if method != http.MethodPut {
		t.Errorf("method = %q, want PUT", method)
	}
	if headers.Get("X-Trace") != "abc123" || headers.Get("X-Env") != "prod" {
		t.Errorf("custom headers not applied: %v", headers)
	}
}

func TestREST_Send_NonRetryable4xx(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusBadRequest, `{"error":"bad payload"}`)
	c := NewREST(WithRESTRetry(3, 0))

	res, err := c.Send(context.Background(), map[string]any{"url": srv.URL}, restEvent(t))
	if err == nil {
		t.Fatal("expected error for 400")
	}
	if res.ResponseCode != http.StatusBadRequest {
		t.Errorf("code = %d, want 400", res.ResponseCode)
	}
	if !strings.Contains(err.Error(), "bad payload") {
		t.Errorf("error should surface body, got %v", err)
	}
	// 4xx must NOT be retried.
	if _, _, _, hits := cap.get(); hits != 1 {
		t.Errorf("4xx retried %d times, want exactly 1 attempt", hits)
	}
}

func TestREST_Send_Retries5xxThenSucceeds(t *testing.T) {
	var attempts int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&attempts, 1)
		if n < 3 {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("try again"))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))
	t.Cleanup(srv.Close)

	c := NewREST(WithRESTRetry(3, 0)) // zero backoff for a fast test
	res, err := c.Send(context.Background(), map[string]any{"url": srv.URL}, restEvent(t))
	if err != nil {
		t.Fatalf("Send should succeed after retries: %v", err)
	}
	if res.ResponseCode != http.StatusOK {
		t.Errorf("final code = %d, want 200", res.ResponseCode)
	}
	if got := atomic.LoadInt32(&attempts); got != 3 {
		t.Errorf("expected 3 attempts (2 retries), got %d", got)
	}
}

func TestREST_Send_RetriesExhausted(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusBadGateway, "down")
	c := NewREST(WithRESTRetry(3, 0))

	res, err := c.Send(context.Background(), map[string]any{"url": srv.URL}, restEvent(t))
	if err == nil {
		t.Fatal("expected error after exhausting retries")
	}
	if res.ResponseCode != http.StatusBadGateway {
		t.Errorf("code = %d, want 502", res.ResponseCode)
	}
	if _, _, _, hits := cap.get(); hits != 3 {
		t.Errorf("expected 3 attempts, got %d", hits)
	}
}

func TestREST_Send_ContextCancellationStopsRetry(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusServiceUnavailable, "busy")
	// Non-zero backoff so cancellation can interrupt the wait.
	c := NewREST(WithRESTRetry(5, 50*time.Millisecond))

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()

	_, err := c.Send(ctx, map[string]any{"url": srv.URL}, restEvent(t))
	if err == nil {
		t.Fatal("expected error due to context cancellation")
	}
	// Far fewer than 5 attempts should have run before the deadline.
	if _, _, _, hits := cap.get(); hits >= 5 {
		t.Errorf("context cancellation did not curb retries: %d attempts", hits)
	}
}

func TestREST_ValidateConfig(t *testing.T) {
	c := NewREST()
	tests := []struct {
		name    string
		cfg     map[string]any
		wantErr string
	}{
		{name: "valid none", cfg: map[string]any{"url": "https://h/x"}},
		{name: "missing url", cfg: map[string]any{}, wantErr: `field "url" is required`},
		{name: "non-http url", cfg: map[string]any{"url": "ftp://h/x"}, wantErr: "absolute http(s)"},
		{name: "bearer missing token", cfg: map[string]any{"url": "https://h", "auth": "bearer"}, wantErr: "requires bearer_token"},
		{name: "basic missing user", cfg: map[string]any{"url": "https://h", "auth": "basic", "basic_password": "p"}, wantErr: "requires basic_username"},
		{name: "api_key missing value", cfg: map[string]any{"url": "https://h", "auth": "api_key"}, wantErr: "requires api_key_value"},
		{name: "bad method enum", cfg: map[string]any{"url": "https://h", "method": "FETCH"}, wantErr: "must be one of"},
		{name: "bad template", cfg: map[string]any{"url": "https://h", "body_template": "{{ .Unclosed "}, wantErr: "invalid body_template"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := c.ValidateConfig(tt.cfg)
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("got %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestREST_Test_RealHTTP(t *testing.T) {
	srv, cap := newRESTServer(t, http.StatusOK, "ok")
	c := NewREST().(connector.Tester)
	res, err := c.Test(context.Background(), map[string]any{"url": srv.URL, "auth": "bearer", "bearer_token": "tok"})
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if res.ResponseCode != http.StatusOK {
		t.Errorf("Test code = %d, want 200", res.ResponseCode)
	}
	_, headers, body, _ := cap.get()
	if headers.Get("Authorization") != "Bearer tok" {
		t.Error("Test should apply configured auth")
	}
	// The synthetic test event must be present in the payload.
	if !strings.Contains(string(body), "connectivity test") {
		t.Errorf("Test payload should carry synthetic event, got %s", body)
	}
}

func TestREST_Conformance(t *testing.T) {
	var _ connector.Connector = (*RESTConnector)(nil)
	var _ connector.Tester = (*RESTConnector)(nil)
	c := NewREST()
	if _, ok := c.(connector.TicketConnector); ok {
		t.Error("RESTConnector should NOT implement TicketConnector")
	}
}

// parseBasic decodes an "Authorization: Basic ..." header for assertions.
func parseBasic(header string) (user, pass string, ok bool) {
	const prefix = "Basic "
	if !strings.HasPrefix(header, prefix) {
		return "", "", false
	}
	r := http.Request{Header: http.Header{"Authorization": {header}}}
	return r.BasicAuth()
}
