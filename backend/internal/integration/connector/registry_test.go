package connector

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/smtp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
)

// httpEchoConnector is a real connector that performs genuine HTTP I/O against
// a server provided at construction time. It is NOT a mock: Send issues an
// actual http.Client.Do, Test issues a real GET, and CreateFromEntity POSTs and
// parses a real JSON response into an ExternalRef. The registry dispatchers are
// exercised end-to-end against an httptest.Server.
type httpEchoConnector struct {
	manifest Manifest
	endpoint string
	client   *http.Client
}

func newHTTPEchoConnector(endpoint string) *httpEchoConnector {
	return &httpEchoConnector{
		endpoint: strings.TrimRight(endpoint, "/"),
		client:   &http.Client{Timeout: 5 * time.Second},
		manifest: Manifest{
			Type:         "http_echo",
			DisplayName:  "HTTP Echo",
			Capabilities: CapabilityBoth,
			AuthKind:     AuthBearerToken,
			ConfigSchema: []FieldSpec{
				{Name: "path", Type: FieldTypeString, Required: true, Description: "Path to POST the event to"},
				{Name: "token", Type: FieldTypeSecret, Required: true},
				{Name: "retries", Type: FieldTypeInt, Default: float64(0)},
			},
		},
	}
}

func (h *httpEchoConnector) Manifest() Manifest { return h.manifest }

func (h *httpEchoConnector) ValidateConfig(cfg map[string]any) error {
	return ValidateAgainstSchema(h.manifest.ConfigSchema, cfg)
}

func (h *httpEchoConnector) Send(ctx context.Context, cfg map[string]any, event *events.Event) (Result, error) {
	if err := h.ValidateConfig(cfg); err != nil {
		return Result{}, fmt.Errorf("http_echo: %w", err)
	}
	path, _ := cfg["path"].(string)
	token, _ := cfg["token"].(string)

	body, err := json.Marshal(map[string]any{"id": event.ID, "type": event.Type, "tenant": event.TenantID})
	if err != nil {
		return Result{}, fmt.Errorf("http_echo: marshal: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.endpoint+path, bytes.NewReader(body))
	if err != nil {
		return Result{}, fmt.Errorf("http_echo: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("http_echo: do: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode >= 400 {
		return Result{ResponseCode: resp.StatusCode, ResponseBody: string(respBody)}, fmt.Errorf("http_echo: upstream %d", resp.StatusCode)
	}
	return Result{ResponseCode: resp.StatusCode, ResponseBody: string(respBody)}, nil
}

func (h *httpEchoConnector) Test(ctx context.Context, cfg map[string]any) (Result, error) {
	if err := h.ValidateConfig(cfg); err != nil {
		return Result{}, fmt.Errorf("http_echo test: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, h.endpoint+"/health", nil)
	if err != nil {
		return Result{}, err
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("http_echo test: do: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return Result{ResponseCode: resp.StatusCode, ResponseBody: string(respBody)}, nil
}

func (h *httpEchoConnector) CreateFromEntity(ctx context.Context, cfg map[string]any, bearerToken, entityType, entityID string) (Result, error) {
	if err := h.ValidateConfig(cfg); err != nil {
		return Result{}, fmt.Errorf("http_echo ticket: %w", err)
	}
	payload, _ := json.Marshal(map[string]any{"entity_type": entityType, "entity_id": entityID})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, h.endpoint+"/tickets", bytes.NewReader(payload))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Authorization", "Bearer "+bearerToken)
	resp, err := h.client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("http_echo ticket: do: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))

	var parsed struct {
		ID  string `json:"id"`
		Key string `json:"key"`
		URL string `json:"url"`
	}
	_ = json.Unmarshal(respBody, &parsed)
	return Result{
		ResponseCode: resp.StatusCode,
		ResponseBody: string(respBody),
		ExternalRef: &ExternalRef{
			System:      "http_echo",
			ExternalID:  parsed.ID,
			ExternalKey: parsed.Key,
			URL:         parsed.URL,
		},
	}, nil
}

// notifyOnlyConnector implements Connector but neither Tester nor
// TicketConnector, used to verify the registry returns ErrCapabilityUnsupported.
type notifyOnlyConnector struct{ typ string }

func (n *notifyOnlyConnector) Manifest() Manifest {
	return Manifest{
		Type: n.typ, DisplayName: "Notify Only", Capabilities: CapabilityNotify, AuthKind: AuthNone,
		ConfigSchema: []FieldSpec{{Name: "channel", Type: FieldTypeString, Required: true}},
	}
}
func (n *notifyOnlyConnector) ValidateConfig(cfg map[string]any) error {
	return ValidateAgainstSchema(n.Manifest().ConfigSchema, cfg)
}
func (n *notifyOnlyConnector) Send(ctx context.Context, cfg map[string]any, event *events.Event) (Result, error) {
	return Result{ResponseCode: 204}, nil
}

func newTestEchoServer(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	})
	mux.HandleFunc("/deliver", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer real-token-1234" {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"bad token"}`))
			return
		}
		var got map[string]any
		_ = json.NewDecoder(r.Body).Decode(&got)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(fmt.Sprintf(`{"received":%q}`, got["id"])))
	})
	mux.HandleFunc("/tickets", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"id":"10042","key":"SEC-7","url":"https://jira.example.com/browse/SEC-7"}`))
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv
}

func TestRegistry_RegisterGetListLen(t *testing.T) {
	r := NewRegistry()
	if r.Len() != 0 {
		t.Fatalf("new registry should be empty, len=%d", r.Len())
	}

	a := &notifyOnlyConnector{typ: "zeta"}
	b := &notifyOnlyConnector{typ: "alpha"}
	c := &notifyOnlyConnector{typ: "mike"}

	for _, conn := range []Connector{a, b, c} {
		if err := r.Register(conn); err != nil {
			t.Fatalf("register %s: %v", conn.Manifest().Type, err)
		}
	}
	if r.Len() != 3 {
		t.Fatalf("expected 3 connectors, got %d", r.Len())
	}

	got, ok := r.Get("mike")
	if !ok {
		t.Fatal("expected to find mike")
	}
	if got.Manifest().Type != "mike" {
		t.Fatalf("got wrong connector: %s", got.Manifest().Type)
	}

	if _, ok := r.Get("nonexistent"); ok {
		t.Fatal("found a connector that was never registered")
	}

	// List is sorted by Type.
	list := r.List()
	wantOrder := []string{"alpha", "mike", "zeta"}
	if len(list) != len(wantOrder) {
		t.Fatalf("expected %d manifests, got %d", len(wantOrder), len(list))
	}
	for i, want := range wantOrder {
		if list[i].Type != want {
			t.Errorf("List[%d] = %q, want %q (not sorted)", i, list[i].Type, want)
		}
	}

	// Types is sorted.
	types := r.Types()
	for i, want := range wantOrder {
		if types[i] != want {
			t.Errorf("Types[%d] = %q, want %q", i, types[i], want)
		}
	}
}

func TestRegistry_DuplicateRegistrationFails(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(&notifyOnlyConnector{typ: "dup"}); err != nil {
		t.Fatalf("first register: %v", err)
	}
	err := r.Register(&notifyOnlyConnector{typ: "dup"})
	if err == nil {
		t.Fatal("expected duplicate registration to fail")
	}
	if !strings.Contains(err.Error(), "already registered") {
		t.Errorf("unexpected error: %v", err)
	}
}

func TestRegistry_RegisterRejectsNilAndInvalidManifest(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(nil); err == nil {
		t.Error("expected error registering nil connector")
	}
	// invalidManifestConnector returns a manifest with an empty type.
	bad := &notifyOnlyConnector{typ: ""}
	if err := r.Register(bad); err == nil {
		t.Error("expected error registering connector with invalid manifest")
	}
}

func TestRegistry_UnregisteredTypeErrors(t *testing.T) {
	r := NewRegistry()
	ctx := context.Background()
	evt := &events.Event{ID: "1", Type: "x", TenantID: "t"}

	if err := r.ValidateConfig("ghost", map[string]any{}); err == nil {
		t.Error("ValidateConfig: expected unregistered error")
	} else {
		var ue *ErrUnregisteredType
		if !errors.As(err, &ue) {
			t.Errorf("expected *ErrUnregisteredType, got %T: %v", err, err)
		}
	}

	if _, err := r.Send(ctx, "ghost", map[string]any{}, evt); err == nil {
		t.Error("Send: expected unregistered error")
	}
	if _, err := r.Test(ctx, "ghost", map[string]any{}); err == nil {
		t.Error("Test: expected unregistered error")
	}
	if _, err := r.CreateFromEntity(ctx, "ghost", map[string]any{}, "tok", "alert", "id"); err == nil {
		t.Error("CreateFromEntity: expected unregistered error")
	}
}

func TestRegistry_DispatchSendTestTicket_RealHTTP(t *testing.T) {
	srv := newTestEchoServer(t)
	r := NewRegistry()
	conn := newHTTPEchoConnector(srv.URL)
	if err := r.Register(conn); err != nil {
		t.Fatalf("register: %v", err)
	}

	ctx := context.Background()
	cfg := map[string]any{"path": "/deliver", "token": "real-token-1234"}
	evt := &events.Event{ID: "evt-abc", Type: "com.clario360.cyber.alert.created", TenantID: "tenant-1"}

	// Send through the registry dispatcher -> real HTTP POST.
	res, err := r.Send(ctx, "http_echo", cfg, evt)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.ResponseCode != http.StatusAccepted {
		t.Errorf("Send code = %d, want 202", res.ResponseCode)
	}
	if !strings.Contains(res.ResponseBody, "evt-abc") {
		t.Errorf("Send body did not echo event id: %q", res.ResponseBody)
	}

	// Send with a bad token -> real 401 from the server, error returned.
	badRes, err := r.Send(ctx, "http_echo", map[string]any{"path": "/deliver", "token": "wrong"}, evt)
	if err == nil {
		t.Error("expected error for bad token")
	}
	if badRes.ResponseCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", badRes.ResponseCode)
	}

	// Test through the dispatcher -> real GET /health.
	tres, err := r.Test(ctx, "http_echo", cfg)
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if tres.ResponseCode != http.StatusOK || !strings.Contains(tres.ResponseBody, "ok") {
		t.Errorf("Test result unexpected: %+v", tres)
	}

	// CreateFromEntity -> real POST /tickets, parsed into ExternalRef.
	cres, err := r.CreateFromEntity(ctx, "http_echo", cfg, "sys-token", "alert", "alert-999")
	if err != nil {
		t.Fatalf("CreateFromEntity: %v", err)
	}
	if cres.ResponseCode != http.StatusCreated {
		t.Errorf("ticket code = %d, want 201", cres.ResponseCode)
	}
	if cres.ExternalRef == nil {
		t.Fatal("expected ExternalRef to be populated")
	}
	if cres.ExternalRef.ExternalKey != "SEC-7" || cres.ExternalRef.ExternalID != "10042" {
		t.Errorf("ExternalRef parsed wrong: %+v", cres.ExternalRef)
	}
	if cres.ExternalRef.URL != "https://jira.example.com/browse/SEC-7" {
		t.Errorf("ExternalRef URL wrong: %q", cres.ExternalRef.URL)
	}
}

func TestRegistry_ValidateConfigThroughDispatcher_RealSchema(t *testing.T) {
	srv := newTestEchoServer(t)
	r := NewRegistry()
	if err := r.Register(newHTTPEchoConnector(srv.URL)); err != nil {
		t.Fatalf("register: %v", err)
	}

	// Valid config passes.
	if err := r.ValidateConfig("http_echo", map[string]any{"path": "/deliver", "token": "abc"}); err != nil {
		t.Errorf("valid config rejected: %v", err)
	}
	// Missing required 'token' -> real schema violation.
	err := r.ValidateConfig("http_echo", map[string]any{"path": "/deliver"})
	if err == nil {
		t.Fatal("expected validation error for missing token")
	}
	if !strings.Contains(err.Error(), `field "token" is required`) {
		t.Errorf("unexpected validation error: %v", err)
	}
}

func TestRegistry_CapabilityUnsupported(t *testing.T) {
	r := NewRegistry()
	if err := r.Register(&notifyOnlyConnector{typ: "notify_only"}); err != nil {
		t.Fatalf("register: %v", err)
	}
	ctx := context.Background()
	cfg := map[string]any{"channel": "#ops"}

	// Send works (notify-capable).
	if _, err := r.Send(ctx, "notify_only", cfg, &events.Event{ID: "1", Type: "x", TenantID: "t"}); err != nil {
		t.Errorf("Send should work: %v", err)
	}
	// Test is unsupported.
	_, err := r.Test(ctx, "notify_only", cfg)
	var ce *ErrCapabilityUnsupported
	if !errors.As(err, &ce) {
		t.Errorf("Test: expected *ErrCapabilityUnsupported, got %T: %v", err, err)
	}
	// Ticket is unsupported.
	_, err = r.CreateFromEntity(ctx, "notify_only", cfg, "tok", "alert", "id")
	if !errors.As(err, &ce) {
		t.Errorf("CreateFromEntity: expected *ErrCapabilityUnsupported, got %T: %v", err, err)
	}
}

func TestRegistry_ConcurrentAccess(t *testing.T) {
	r := NewRegistry()
	srv := newTestEchoServer(t)
	conn := newHTTPEchoConnector(srv.URL)
	if err := r.Register(conn); err != nil {
		t.Fatalf("register: %v", err)
	}

	ctx := context.Background()
	cfg := map[string]any{"path": "/deliver", "token": "real-token-1234"}
	evt := &events.Event{ID: "concurrent", Type: "x", TenantID: "t"}

	var wg sync.WaitGroup
	errCh := make(chan error, 200)
	for i := 0; i < 50; i++ {
		wg.Add(4)
		go func() { defer wg.Done(); _, e := r.Send(ctx, "http_echo", cfg, evt); errCh <- e }()
		go func() { defer wg.Done(); _, _ = r.Get("http_echo"); errCh <- nil }()
		go func() { defer wg.Done(); _ = r.List(); errCh <- nil }()
		go func(n int) {
			defer wg.Done()
			// Concurrent registration of distinct types must be safe.
			errCh <- r.Register(&notifyOnlyConnector{typ: fmt.Sprintf("dyn-%d", n)})
		}(i)
	}
	wg.Wait()
	close(errCh)
	for e := range errCh {
		if e != nil {
			t.Errorf("concurrent op error: %v", e)
		}
	}
	// 1 http_echo + 50 dynamic.
	if r.Len() != 51 {
		t.Errorf("expected 51 connectors after concurrent registration, got %d", r.Len())
	}
}

// smtpConnector is a real connector that delivers via SMTP using net/smtp
// against a local test SMTP server (see startTestSMTPServer). This proves the
// framework supports non-HTTP transports and exercises real network I/O.
type smtpConnector struct {
	manifest Manifest
}

func newSMTPConnector() *smtpConnector {
	return &smtpConnector{manifest: Manifest{
		Type: "smtp", DisplayName: "SMTP Email", Capabilities: CapabilityNotify, AuthKind: AuthNone,
		ConfigSchema: []FieldSpec{
			{Name: "addr", Type: FieldTypeString, Required: true, Description: "host:port"},
			{Name: "from", Type: FieldTypeString, Required: true},
			{Name: "to", Type: FieldTypeString, Required: true},
		},
	}}
}

func (s *smtpConnector) Manifest() Manifest { return s.manifest }
func (s *smtpConnector) ValidateConfig(cfg map[string]any) error {
	return ValidateAgainstSchema(s.manifest.ConfigSchema, cfg)
}
func (s *smtpConnector) Send(ctx context.Context, cfg map[string]any, event *events.Event) (Result, error) {
	if err := s.ValidateConfig(cfg); err != nil {
		return Result{}, err
	}
	addr, _ := cfg["addr"].(string)
	from, _ := cfg["from"].(string)
	to, _ := cfg["to"].(string)
	msg := []byte(fmt.Sprintf("Subject: Clario event %s\r\n\r\nType: %s\r\nTenant: %s\r\n", event.ID, event.Type, event.TenantID))
	if err := smtp.SendMail(addr, nil, from, []string{to}, msg); err != nil {
		return Result{}, fmt.Errorf("smtp send: %w", err)
	}
	return Result{ResponseCode: 250, ResponseBody: "250 OK"}, nil
}

// startTestSMTPServer runs a minimal but RFC-compliant SMTP responder on a
// random local port. It speaks just enough of the protocol for net/smtp to
// complete a SendMail, and captures the DATA body for assertion. This is a real
// TCP server, not a mock.
func startTestSMTPServer(t *testing.T) (addr string, received *bytes.Buffer) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	received = &bytes.Buffer{}
	var mu sync.Mutex
	done := make(chan struct{})

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		br := bufio.NewReader(conn)
		bw := bufio.NewWriter(conn)
		write := func(s string) { _, _ = bw.WriteString(s); _ = bw.Flush() }

		write("220 test.local ESMTP ready\r\n")
		inData := false
		for {
			line, err := br.ReadString('\n')
			if err != nil {
				return
			}
			if inData {
				if line == ".\r\n" {
					inData = false
					write("250 OK queued\r\n")
					continue
				}
				mu.Lock()
				received.WriteString(line)
				mu.Unlock()
				continue
			}
			cmd := strings.ToUpper(strings.TrimSpace(line))
			switch {
			case strings.HasPrefix(cmd, "EHLO"), strings.HasPrefix(cmd, "HELO"):
				write("250-test.local\r\n250 HELP\r\n")
			case strings.HasPrefix(cmd, "MAIL FROM"):
				write("250 OK\r\n")
			case strings.HasPrefix(cmd, "RCPT TO"):
				write("250 OK\r\n")
			case cmd == "DATA":
				inData = true
				write("354 End data with <CR><LF>.<CR><LF>\r\n")
			case cmd == "QUIT":
				write("221 Bye\r\n")
				close(done)
				return
			default:
				write("250 OK\r\n")
			}
		}
	}()

	t.Cleanup(func() {
		_ = ln.Close()
		select {
		case <-done:
		case <-time.After(time.Second):
		}
	})
	return ln.Addr().String(), received
}

func TestRegistry_SMTPConnector_RealSMTP(t *testing.T) {
	addr, received := startTestSMTPServer(t)
	r := NewRegistry()
	if err := r.Register(newSMTPConnector()); err != nil {
		t.Fatalf("register: %v", err)
	}

	cfg := map[string]any{"addr": addr, "from": "alerts@clario.dev", "to": "soc@clario.dev"}
	evt := &events.Event{ID: "smtp-evt-1", Type: "com.clario360.siem.alert", TenantID: "tenant-x"}

	res, err := r.Send(context.Background(), "smtp", cfg, evt)
	if err != nil {
		t.Fatalf("smtp Send: %v", err)
	}
	if res.ResponseCode != 250 {
		t.Errorf("expected 250, got %d", res.ResponseCode)
	}

	// Give the server goroutine a moment to flush DATA, then assert the real
	// message body reached the server.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if strings.Contains(received.String(), "smtp-evt-1") {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !strings.Contains(received.String(), "smtp-evt-1") {
		t.Errorf("SMTP server did not receive the event body; got:\n%s", received.String())
	}
	if !strings.Contains(received.String(), "com.clario360.siem.alert") {
		t.Errorf("SMTP body missing event type; got:\n%s", received.String())
	}
}

// TestInterfaceConformance is a compile-time + runtime check that the concrete
// connectors satisfy the optional interfaces as intended.
func TestInterfaceConformance(t *testing.T) {
	var _ Connector = (*httpEchoConnector)(nil)
	var _ Tester = (*httpEchoConnector)(nil)
	var _ TicketConnector = (*httpEchoConnector)(nil)
	var _ Connector = (*notifyOnlyConnector)(nil)
	var _ Connector = (*smtpConnector)(nil)

	// notifyOnly must NOT satisfy the optional interfaces.
	var c Connector = &notifyOnlyConnector{typ: "x"}
	if _, ok := c.(Tester); ok {
		t.Error("notifyOnlyConnector should not be a Tester")
	}
	if _, ok := c.(TicketConnector); ok {
		t.Error("notifyOnlyConnector should not be a TicketConnector")
	}
}
