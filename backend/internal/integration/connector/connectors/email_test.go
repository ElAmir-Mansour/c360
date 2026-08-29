package connectors

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"net"
	"net/mail"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
)

// capturedMail holds what a test SMTP server observed for a single session.
type capturedMail struct {
	mu       sync.Mutex
	authSeen bool
	mailFrom string
	rcptTo   []string
	data     bytes.Buffer
}

func (c *capturedMail) snapshot() (from string, rcpts []string, body string, auth bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	rcpts = append([]string(nil), c.rcptTo...)
	return c.mailFrom, rcpts, c.data.String(), c.authSeen
}

// startCaptureSMTPServer launches a real TCP SMTP server on a random local port.
// It speaks enough ESMTP for net/smtp to complete MAIL/RCPT/DATA (and AUTH when
// advertiseAuth is set), capturing the envelope and the full DATA body. It is a
// genuine network server, not a mock object.
func startCaptureSMTPServer(t *testing.T, advertiseAuth bool) (addr string, captured *capturedMail) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	captured = &capturedMail{}

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go serveSMTPSession(conn, captured, advertiseAuth)
		}
	}()

	t.Cleanup(func() { _ = ln.Close() })
	return ln.Addr().String(), captured
}

func serveSMTPSession(conn net.Conn, captured *capturedMail, advertiseAuth bool) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
	br := bufio.NewReader(conn)
	bw := bufio.NewWriter(conn)
	write := func(s string) { _, _ = bw.WriteString(s); _ = bw.Flush() }

	write("220 capture.local ESMTP ready\r\n")
	inData := false
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			return
		}
		if inData {
			if line == ".\r\n" {
				inData = false
				write("250 OK queued as ABC123\r\n")
				continue
			}
			captured.mu.Lock()
			captured.data.WriteString(line)
			captured.mu.Unlock()
			continue
		}
		trimmed := strings.TrimSpace(line)
		upper := strings.ToUpper(trimmed)
		switch {
		case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "HELO"):
			if advertiseAuth {
				write("250-capture.local\r\n250 AUTH PLAIN\r\n")
			} else {
				write("250-capture.local\r\n250 HELP\r\n")
			}
		case strings.HasPrefix(upper, "AUTH"):
			captured.mu.Lock()
			captured.authSeen = true
			captured.mu.Unlock()
			write("235 2.7.0 Authentication successful\r\n")
		case strings.HasPrefix(upper, "MAIL FROM"):
			captured.mu.Lock()
			captured.mailFrom = extractAngleAddr(trimmed)
			captured.mu.Unlock()
			write("250 OK\r\n")
		case strings.HasPrefix(upper, "RCPT TO"):
			captured.mu.Lock()
			captured.rcptTo = append(captured.rcptTo, extractAngleAddr(trimmed))
			captured.mu.Unlock()
			write("250 OK\r\n")
		case upper == "DATA":
			inData = true
			write("354 End data with <CR><LF>.<CR><LF>\r\n")
		case upper == "NOOP":
			write("250 OK\r\n")
		case upper == "QUIT":
			write("221 Bye\r\n")
			return
		case upper == "RSET":
			write("250 OK\r\n")
		default:
			write("250 OK\r\n")
		}
	}
}

// extractAngleAddr pulls the address out of "MAIL FROM:<a@b>" / "RCPT TO:<a@b>".
func extractAngleAddr(line string) string {
	lt := strings.Index(line, "<")
	gt := strings.Index(line, ">")
	if lt >= 0 && gt > lt {
		return line[lt+1 : gt]
	}
	idx := strings.Index(line, ":")
	if idx >= 0 {
		return strings.TrimSpace(line[idx+1:])
	}
	return strings.TrimSpace(line)
}

// newEmailConnectorForTest builds an EmailConnector with a fixed clock so the
// Date header is deterministic.
func newEmailConnectorForTest() *EmailConnector {
	c := New().(*EmailConnector)
	c.now = func() time.Time { return time.Date(2026, 6, 13, 10, 30, 0, 0, time.UTC) }
	c.dialTimeout = 3 * time.Second
	return c
}

func sampleAlertEvent(t *testing.T) *events.Event {
	t.Helper()
	data, err := json.Marshal(map[string]any{
		"severity":    "critical",
		"title":       "Suspicious lateral movement detected",
		"description": "Host srv-01 contacted 12 internal hosts in 30s",
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return &events.Event{
		ID:            "evt-email-1",
		Type:          "com.clario360.cyber.alert.created",
		Source:        "clario360/cyber-service",
		Subject:       "alert-777",
		TenantID:      "tenant-acme",
		CorrelationID: "corr-9",
		Time:          time.Date(2026, 6, 13, 10, 0, 0, 0, time.UTC),
		Data:          data,
	}
}

func TestEmail_Manifest(t *testing.T) {
	m := New().Manifest()
	if m.Type != EmailType {
		t.Errorf("type = %q, want %q", m.Type, EmailType)
	}
	if !m.Capabilities.CanNotify() {
		t.Errorf("email must be notify-capable, got %q", m.Capabilities)
	}
	if err := m.Validate(); err != nil {
		t.Errorf("manifest should be valid: %v", err)
	}
	// host/port/from/to are required; username/password are secret.
	byName := map[string]connector.FieldSpec{}
	for _, f := range m.ConfigSchema {
		byName[f.Name] = f
	}
	for _, req := range []string{"host", "port", "from", "to"} {
		if !byName[req].Required {
			t.Errorf("field %q should be required", req)
		}
	}
	for _, sec := range []string{"username", "password"} {
		if !byName[sec].IsSecret() {
			t.Errorf("field %q should be secret", sec)
		}
	}
}

func TestEmail_ValidateConfig(t *testing.T) {
	c := New()
	tests := []struct {
		name    string
		cfg     map[string]any
		wantErr string
	}{
		{
			name: "valid",
			cfg:  map[string]any{"host": "smtp.example.com", "port": float64(587), "from": "alerts@clario.dev", "to": "soc@clario.dev", "use_tls": false},
		},
		{
			name:    "missing host",
			cfg:     map[string]any{"port": float64(587), "from": "a@b.com", "to": "c@d.com"},
			wantErr: `field "host" is required`,
		},
		{
			name:    "bad from address",
			cfg:     map[string]any{"host": "h", "port": float64(25), "from": "not-an-email", "to": "c@d.com"},
			wantErr: "invalid from address",
		},
		{
			name:    "no recipients",
			cfg:     map[string]any{"host": "h", "port": float64(25), "from": "a@b.com", "to": ""},
			wantErr: "required",
		},
		{
			name:    "bad recipient",
			cfg:     map[string]any{"host": "h", "port": float64(25), "from": "a@b.com", "to": "nope"},
			wantErr: "invalid recipient",
		},
		{
			name:    "port out of range",
			cfg:     map[string]any{"host": "h", "port": float64(70000), "from": "a@b.com", "to": "c@d.com"},
			wantErr: "out of range",
		},
		{
			name:    "password without username",
			cfg:     map[string]any{"host": "h", "port": float64(25), "from": "a@b.com", "to": "c@d.com", "password": "secret"},
			wantErr: "password is set but username is empty",
		},
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
			if err == nil {
				t.Fatalf("expected error containing %q, got nil", tt.wantErr)
			}
			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("error %q does not contain %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestEmail_Send_RealSMTP_NoAuth(t *testing.T) {
	addr, captured := startCaptureSMTPServer(t, false)
	c := newEmailConnectorForTest()

	host, port := splitHostPortAny(t, addr)
	cfg := map[string]any{
		"host":    host,
		"port":    port,
		"from":    "Clario Alerts <alerts@clario.dev>",
		"to":      "soc@clario.dev, oncall@clario.dev",
		"use_tls": false,
	}

	evt := sampleAlertEvent(t)
	res, err := c.Send(context.Background(), cfg, evt)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if res.ResponseCode != 250 {
		t.Errorf("code = %d, want 250", res.ResponseCode)
	}

	from, rcpts, body, authSeen := waitCapture(captured, "evt-email-1")
	if authSeen {
		t.Error("no auth configured, but server saw AUTH")
	}
	if from != "alerts@clario.dev" {
		t.Errorf("MAIL FROM = %q, want bare alerts@clario.dev", from)
	}
	if len(rcpts) != 2 || rcpts[0] != "soc@clario.dev" || rcpts[1] != "oncall@clario.dev" {
		t.Errorf("RCPT TO = %v, want [soc@clario.dev oncall@clario.dev]", rcpts)
	}

	// The DATA body must be a well-formed RFC 5322 message.
	assertWellFormedMessage(t, body, "evt-email-1")

	// Subject carries severity + title.
	if !strings.Contains(body, "Subject: [Clario360][CRITICAL] Suspicious lateral movement detected") {
		t.Errorf("subject not rendered as expected in body:\n%s", body)
	}
	// Body carries salient fields.
	for _, want := range []string{"com.clario360.cyber.alert.created", "tenant-acme", "Host srv-01 contacted"} {
		if !strings.Contains(body, want) {
			t.Errorf("body missing %q\n%s", want, body)
		}
	}
}

func TestEmail_Send_RealSMTP_WithAuth(t *testing.T) {
	addr, captured := startCaptureSMTPServer(t, true)
	c := newEmailConnectorForTest()

	host, port := splitHostPortAny(t, addr)
	cfg := map[string]any{
		"host":     host,
		"port":     port,
		"username": "smtp-user",
		"password": "smtp-pass-1234",
		"from":     "alerts@clario.dev",
		"to":       "soc@clario.dev",
		"use_tls":  false,
	}

	evt := sampleAlertEvent(t)
	if _, err := c.Send(context.Background(), cfg, evt); err != nil {
		t.Fatalf("Send with auth: %v", err)
	}

	_, _, _, authSeen := waitCapture(captured, "evt-email-1")
	if !authSeen {
		t.Error("credentials configured but server never saw AUTH")
	}
}

func TestEmail_Test_RealSMTP(t *testing.T) {
	addr, _ := startCaptureSMTPServer(t, true)
	c := newEmailConnectorForTest()
	host, port := splitHostPortAny(t, addr)

	cfg := map[string]any{
		"host":     host,
		"port":     port,
		"username": "u",
		"password": "p",
		"from":     "a@b.com",
		"to":       "c@d.com",
		"use_tls":  false,
	}
	res, err := c.Test(context.Background(), cfg)
	if err != nil {
		t.Fatalf("Test: %v", err)
	}
	if res.ResponseCode != 250 {
		t.Errorf("Test code = %d, want 250", res.ResponseCode)
	}
}

func TestEmail_Test_RealSMTP_ConnectFailure(t *testing.T) {
	c := newEmailConnectorForTest()
	c.dialTimeout = 300 * time.Millisecond
	// Port 1 is reserved/unused; the dial must fail rather than hang.
	cfg := map[string]any{
		"host":    "127.0.0.1",
		"port":    float64(1),
		"from":    "a@b.com",
		"to":      "c@d.com",
		"use_tls": false,
	}
	if _, err := c.Test(context.Background(), cfg); err == nil {
		t.Fatal("expected connect failure against a closed port")
	}
}

func TestEmail_BuildRFC5322Message(t *testing.T) {
	now := time.Date(2026, 6, 13, 10, 30, 0, 0, time.UTC)
	msg := buildRFC5322Message("alerts@clario.dev", []string{"a@b.com", "c@d.com"}, "Hello", "Line one\nLine two", now)

	assertWellFormedMessage(t, string(msg), "")
	s := string(msg)
	if !strings.Contains(s, "From: alerts@clario.dev\r\n") {
		t.Error("missing From header")
	}
	if !strings.Contains(s, "To: a@b.com, c@d.com\r\n") {
		t.Error("missing/incorrect To header")
	}
	if !strings.Contains(s, "MIME-Version: 1.0\r\n") {
		t.Error("missing MIME-Version")
	}
	// Body lines must be CRLF-normalized.
	if !strings.Contains(s, "Line one\r\nLine two") {
		t.Errorf("body not CRLF-normalized:\n%q", s)
	}
}

func TestEmail_EncodeHeaderWord_UTF8(t *testing.T) {
	ascii := encodeHeaderWord("Plain ASCII")
	if ascii != "Plain ASCII" {
		t.Errorf("ASCII subject should pass through, got %q", ascii)
	}
	utf := encodeHeaderWord("Critical: café breach ☕")
	if !strings.HasPrefix(utf, "=?utf-8?") {
		t.Errorf("UTF-8 subject should be RFC2047 encoded, got %q", utf)
	}
}

// --- helpers ---------------------------------------------------------------

// assertWellFormedMessage parses the message headers with net/mail and checks
// addressability; if id is non-empty it must appear in the body.
func assertWellFormedMessage(t *testing.T, message, id string) {
	t.Helper()
	m, err := mail.ReadMessage(strings.NewReader(message))
	if err != nil {
		t.Fatalf("message is not RFC5322-parseable: %v\n%s", err, message)
	}
	if m.Header.Get("From") == "" {
		t.Error("parsed message has no From header")
	}
	if m.Header.Get("To") == "" {
		t.Error("parsed message has no To header")
	}
	if m.Header.Get("Subject") == "" {
		t.Error("parsed message has no Subject header")
	}
	if _, err := m.Header.AddressList("To"); err != nil {
		t.Errorf("To header is not a valid address list: %v", err)
	}
	if id != "" {
		body, _ := readAll(m.Body)
		if !strings.Contains(body, id) {
			t.Errorf("message body missing id %q:\n%s", id, body)
		}
	}
}

func readAll(r interface{ Read([]byte) (int, error) }) (string, error) {
	var buf bytes.Buffer
	tmp := make([]byte, 1024)
	for {
		n, err := r.Read(tmp)
		buf.Write(tmp[:n])
		if err != nil {
			if err.Error() == "EOF" {
				return buf.String(), nil
			}
			return buf.String(), err
		}
	}
}

// waitCapture polls until the captured DATA body contains marker (or times out),
// then returns the captured envelope/body/auth flag.
func waitCapture(c *capturedMail, marker string) (from string, rcpts []string, body string, auth bool) {
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		from, rcpts, body, auth = c.snapshot()
		if strings.Contains(body, marker) {
			return from, rcpts, body, auth
		}
		time.Sleep(10 * time.Millisecond)
	}
	return c.snapshot()
}

func splitHostPortStr(t *testing.T, addr string) (string, int) {
	t.Helper()
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil {
		t.Fatalf("parse port %q: %v", portStr, err)
	}
	return host, port
}

// splitHostPortAny returns host and port (as float64, the JSON-config shape).
func splitHostPortAny(t *testing.T, addr string) (string, any) {
	t.Helper()
	host, port := splitHostPortStr(t, addr)
	return host, float64(port)
}
