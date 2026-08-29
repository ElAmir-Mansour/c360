package connectors

import (
	"context"
	"crypto/tls"
	"fmt"
	"mime"
	"net"
	"net/mail"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
)

// EmailType is the connector type key for the SMTP email connector. It is the
// model.IntegrationType string the registry dispatches on.
const EmailType = "email"

// emailDialTimeout bounds how long we wait to establish the TCP/TLS connection
// to the SMTP server before giving up.
const emailDialTimeout = 15 * time.Second

// EmailConnector delivers events as email via SMTP. It speaks the protocol with
// the standard library net/smtp client: it opens a connection (optionally
// upgrading to TLS via STARTTLS), authenticates with PLAIN when credentials are
// present, and transmits a real RFC 5322 message rendered from the event.
//
// It is notify-capable and supports Test (a non-destructive connectivity/auth
// handshake that issues NOOP and never sends mail).
type EmailConnector struct {
	manifest connector.Manifest
	// now is injected for deterministic Date headers in tests; defaults to
	// time.Now.
	now func() time.Time
	// dialTimeout bounds connection establishment.
	dialTimeout time.Duration
}

// New returns a ready-to-register EmailConnector.
func New() connector.Connector {
	return &EmailConnector{
		manifest:    emailManifest(),
		now:         time.Now,
		dialTimeout: emailDialTimeout,
	}
}

// emailManifest declares the email connector's config schema. The schema is the
// single source of truth for validation, secret sanitization and the admin
// form. host/port/from/to are required; username/password are secret and
// optional (unauthenticated relays exist); use_tls toggles STARTTLS.
func emailManifest() connector.Manifest {
	return connector.Manifest{
		Type:         EmailType,
		DisplayName:  "Email (SMTP)",
		Capabilities: connector.CapabilityNotify,
		AuthKind:     connector.AuthBasic,
		ConfigSchema: []connector.FieldSpec{
			{Name: "host", Type: connector.FieldTypeString, Required: true, Description: "SMTP server hostname"},
			{Name: "port", Type: connector.FieldTypeInt, Required: true, Default: float64(587), Description: "SMTP server port (e.g. 25, 465, 587)"},
			{Name: "username", Type: connector.FieldTypeSecret, Description: "SMTP auth username (omit for unauthenticated relays)"},
			{Name: "password", Type: connector.FieldTypeSecret, Description: "SMTP auth password"},
			{Name: "from", Type: connector.FieldTypeString, Required: true, Description: "Envelope/From address (RFC 5322)"},
			{Name: "to", Type: connector.FieldTypeString, Required: true, Description: "Recipient address(es), comma-separated"},
			{Name: "use_tls", Type: connector.FieldTypeBool, Default: true, Description: "Upgrade the connection with STARTTLS"},
		},
	}
}

// Manifest returns the connector's declarative descriptor.
func (c *EmailConnector) Manifest() connector.Manifest { return c.manifest }

// ValidateConfig validates cfg against the schema and then enforces the
// email-specific rules the generic schema cannot express: parseable addresses,
// at least one recipient, an in-range port, and password-implies-username.
func (c *EmailConnector) ValidateConfig(cfg map[string]any) error {
	if err := connector.ValidateAgainstSchema(c.manifest.ConfigSchema, cfg); err != nil {
		return err
	}

	from := strings.TrimSpace(cfgString(cfg, "from"))
	if _, err := mail.ParseAddress(from); err != nil {
		return fmt.Errorf("email: invalid from address %q: %w", from, err)
	}

	recipients := cfgStringSlice(cfg, "to")
	if len(recipients) == 0 {
		return fmt.Errorf("email: at least one recipient (to) is required")
	}
	for _, rcpt := range recipients {
		if _, err := mail.ParseAddress(rcpt); err != nil {
			return fmt.Errorf("email: invalid recipient %q: %w", rcpt, err)
		}
	}

	port := cfgInt(cfg, "port", 0)
	if port <= 0 || port > 65535 {
		return fmt.Errorf("email: port %d is out of range (1-65535)", port)
	}

	// A password without a username is meaningless for PLAIN auth.
	if cfgString(cfg, "password") != "" && cfgString(cfg, "username") == "" {
		return fmt.Errorf("email: password is set but username is empty")
	}

	return nil
}

// Send renders event into an RFC 5322 message and delivers it over SMTP. It
// returns Result{ResponseCode: 250} on a successful queue/accept, mirroring the
// SMTP success status, with the rendered message echoed (header only) in the
// body for diagnostics.
func (c *EmailConnector) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	if err := c.ValidateConfig(cfg); err != nil {
		return connector.Result{}, fmt.Errorf("email: %w", err)
	}

	host := strings.TrimSpace(cfgString(cfg, "host"))
	port := cfgInt(cfg, "port", 587)
	from := strings.TrimSpace(cfgString(cfg, "from"))
	recipients := cfgStringSlice(cfg, "to")
	username := cfgString(cfg, "username")
	password := cfgString(cfg, "password")
	useTLS := cfgBool(cfg, "use_tls", true)

	subject, body := c.render(event)
	message := buildRFC5322Message(from, recipients, subject, body, c.now().UTC())

	var auth smtp.Auth
	if username != "" {
		auth = smtp.PlainAuth("", username, password, host)
	}

	if err := c.deliver(ctx, host, port, useTLS, auth, from, recipients, message); err != nil {
		return connector.Result{}, fmt.Errorf("email: delivery failed: %w", err)
	}

	return connector.Result{
		ResponseCode: 250,
		ResponseBody: "250 message accepted: " + subject,
	}, nil
}

// Test performs a non-destructive SMTP handshake: connect, EHLO, optional
// STARTTLS, optional AUTH, NOOP, QUIT. It sends no mail. A successful handshake
// proves the host, port, TLS setting and credentials are usable.
func (c *EmailConnector) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	if err := c.ValidateConfig(cfg); err != nil {
		return connector.Result{}, fmt.Errorf("email test: %w", err)
	}

	host := strings.TrimSpace(cfgString(cfg, "host"))
	port := cfgInt(cfg, "port", 587)
	username := cfgString(cfg, "username")
	password := cfgString(cfg, "password")
	useTLS := cfgBool(cfg, "use_tls", true)

	client, err := c.connect(ctx, host, port, useTLS)
	if err != nil {
		return connector.Result{}, fmt.Errorf("email test: connect: %w", err)
	}
	defer func() { _ = client.Close() }()

	if username != "" {
		if err := client.Auth(smtp.PlainAuth("", username, password, host)); err != nil {
			return connector.Result{}, fmt.Errorf("email test: auth: %w", err)
		}
	}
	if err := client.Noop(); err != nil {
		return connector.Result{}, fmt.Errorf("email test: noop: %w", err)
	}
	_ = client.Quit()

	return connector.Result{
		ResponseCode: 250,
		ResponseBody: fmt.Sprintf("250 SMTP handshake to %s:%d succeeded", host, port),
	}, nil
}

// deliver transmits message to recipients over a freshly-established (and
// possibly TLS-upgraded, possibly authenticated) SMTP session.
func (c *EmailConnector) deliver(ctx context.Context, host string, port int, useTLS bool, auth smtp.Auth, from string, recipients []string, message []byte) error {
	client, err := c.connect(ctx, host, port, useTLS)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer func() { _ = client.Close() }()

	if auth != nil {
		if ok, _ := client.Extension("AUTH"); ok {
			if err := client.Auth(auth); err != nil {
				return fmt.Errorf("auth: %w", err)
			}
		} else if err := client.Auth(auth); err != nil {
			// Some non-advertising servers still accept AUTH; if it fails,
			// surface the error rather than silently sending unauthenticated.
			return fmt.Errorf("auth: %w", err)
		}
	}

	fromAddr, err := extractAddr(from)
	if err != nil {
		return fmt.Errorf("from: %w", err)
	}
	if err := client.Mail(fromAddr); err != nil {
		return fmt.Errorf("MAIL FROM: %w", err)
	}
	for _, rcpt := range recipients {
		rcptAddr, err := extractAddr(rcpt)
		if err != nil {
			return fmt.Errorf("rcpt %q: %w", rcpt, err)
		}
		if err := client.Rcpt(rcptAddr); err != nil {
			return fmt.Errorf("RCPT TO %q: %w", rcptAddr, err)
		}
	}

	wc, err := client.Data()
	if err != nil {
		return fmt.Errorf("DATA: %w", err)
	}
	if _, err := wc.Write(message); err != nil {
		_ = wc.Close()
		return fmt.Errorf("write body: %w", err)
	}
	if err := wc.Close(); err != nil {
		return fmt.Errorf("close body: %w", err)
	}
	_ = client.Quit()
	return nil
}

// connect dials the SMTP server (honouring ctx for the dial deadline), issues
// EHLO, and upgrades to TLS via STARTTLS when useTLS is set and the server
// advertises the capability. It returns a connected *smtp.Client the caller
// must Close.
func (c *EmailConnector) connect(ctx context.Context, host string, port int, useTLS bool) (*smtp.Client, error) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))

	dialer := &net.Dialer{Timeout: c.dialTimeout}
	conn, err := dialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("dial %s: %w", addr, err)
	}
	// Propagate any context deadline to the raw connection so reads/writes can
	// be interrupted.
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}

	if err := client.Hello(ehloName(host)); err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("EHLO: %w", err)
	}

	if useTLS {
		if ok, _ := client.Extension("STARTTLS"); ok {
			tlsCfg := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
			if err := client.StartTLS(tlsCfg); err != nil {
				_ = client.Close()
				return nil, fmt.Errorf("STARTTLS: %w", err)
			}
		} else {
			_ = client.Close()
			return nil, fmt.Errorf("use_tls is set but server %s does not advertise STARTTLS", addr)
		}
	}

	return client, nil
}

// render builds the subject and plain-text body for an event. The subject
// encodes severity and a human title; the body lists the salient event fields.
func (c *EmailConnector) render(event *events.Event) (subject, body string) {
	ef := extractEventFields(event)

	sevLabel := strings.ToUpper(ef.Severity)
	subject = fmt.Sprintf("[Clario360][%s] %s", sevLabel, ef.Title)

	var b strings.Builder
	b.WriteString("A Clario 360 event was delivered to you by the integration engine.\r\n\r\n")
	writeField(&b, "Event ID", ef.ID)
	writeField(&b, "Type", ef.Type)
	writeField(&b, "Severity", ef.Severity)
	writeField(&b, "Source", ef.Source)
	writeField(&b, "Subject", ef.Subject)
	writeField(&b, "Tenant", ef.TenantID)
	writeField(&b, "Correlation", ef.CorrelationID)
	if ef.Summary != "" {
		b.WriteString("\r\nSummary:\r\n")
		b.WriteString(ef.Summary)
		b.WriteString("\r\n")
	}
	b.WriteString("\r\n--\r\nClario 360 Integration Engine\r\n")
	return subject, b.String()
}

// writeField appends a "Label: value" line when value is non-empty.
func writeField(b *strings.Builder, label, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	b.WriteString(label)
	b.WriteString(": ")
	b.WriteString(value)
	b.WriteString("\r\n")
}

// buildRFC5322Message assembles a complete RFC 5322 message: From, To, Subject,
// Date, MIME-Version, Content-Type headers, a blank separator line, then the
// CRLF-normalized body. The Subject is RFC 2047 encoded so non-ASCII survives.
func buildRFC5322Message(from string, recipients []string, subject, body string, now time.Time) []byte {
	var msg strings.Builder
	msg.WriteString("From: ")
	msg.WriteString(from)
	msg.WriteString("\r\n")
	msg.WriteString("To: ")
	msg.WriteString(strings.Join(recipients, ", "))
	msg.WriteString("\r\n")
	msg.WriteString("Subject: ")
	msg.WriteString(encodeHeaderWord(subject))
	msg.WriteString("\r\n")
	msg.WriteString("Date: ")
	msg.WriteString(now.Format(time.RFC1123Z))
	msg.WriteString("\r\n")
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	msg.WriteString("Content-Transfer-Encoding: 8bit\r\n")
	msg.WriteString("\r\n")
	msg.WriteString(normalizeCRLF(body))
	return []byte(msg.String())
}

// encodeHeaderWord RFC 2047 encodes s when it contains non-ASCII bytes, so a
// UTF-8 subject is transmitted safely; pure-ASCII subjects pass through.
func encodeHeaderWord(s string) string {
	for i := 0; i < len(s); i++ {
		if s[i] >= 0x80 {
			return mime.QEncoding.Encode("utf-8", s)
		}
	}
	return s
}

// normalizeCRLF ensures every line ending is CRLF, as RFC 5322 requires. It
// collapses any existing CRLF first so doubling cannot occur.
func normalizeCRLF(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\n", "\r\n")
	return s
}

// extractAddr returns the bare address (no display name) from an RFC 5322
// address string, which is what SMTP MAIL FROM / RCPT TO require.
func extractAddr(addr string) (string, error) {
	parsed, err := mail.ParseAddress(addr)
	if err != nil {
		return "", err
	}
	return parsed.Address, nil
}

// ehloName derives a syntactically valid EHLO argument. SMTP servers expect a
// domain-like token; we reuse the server host, which is always acceptable.
func ehloName(host string) string {
	if strings.TrimSpace(host) == "" {
		return "localhost"
	}
	return host
}

// Compile-time assertions: EmailConnector is a notify Connector and a Tester.
var (
	_ connector.Connector = (*EmailConnector)(nil)
	_ connector.Tester    = (*EmailConnector)(nil)
)
