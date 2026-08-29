package service

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"mime"
	"net"
	"net/smtp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// CAP-157 — self-contained SMTP email dispatch.
//
// SMTPLexEmailDispatcher is a real, dependency-free adapter for the
// LexNotificationService email fan-out seam (LexEmailDispatcher). It speaks plain
// SMTP over net/smtp — the same transport pattern as
// integration/email_connector.go's smtpDispatcher — so a fully working local demo
// needs only a MailHog container (SMTP :1025 / UI :8025, no auth) and no external
// vendor. Pointed at a real relay (host/port/from + STARTTLS + AUTH) it is the
// production delivery path too; the only go-live gate is the relay's
// address/credentials (deploy-time config, not code).
//
// It builds a multipart/alternative message (plain-text + HTML) carrying BOTH the
// English and Arabic title/body from the inbox item, with the Arabic HTML block
// marked dir="rtl" for correct rendering. The subject is the localized title
// (EN — with an AR companion line) RFC 2047 encoded so non-ASCII is safe.
//
// Delivery is best-effort from the caller's perspective: Notify() commits the
// durable in-app row before dispatch and only logs on error, so a transient mail
// outage never loses the in-app notification.

// smtpLexDialFunc is the SMTP connection seam (tests inject a fake, mirroring the
// email connector's smtpDialFunc). A nil dialer uses the real net dialer.
type smtpLexDialFunc func(ctx context.Context, addr string) (smtpLexSession, error)

// smtpLexSession is the minimal subset of *smtp.Client the dispatcher drives.
type smtpLexSession interface {
	StartTLS(*tls.Config) error
	Auth(smtp.Auth) error
	Mail(from string) error
	Rcpt(to string) error
	Data() (io.WriteCloser, error)
	Quit() error
	Close() error
}

// SMTPLexEmailDispatcherConfig configures the SMTP email dispatcher. Host and From
// are required. Username/Password are optional (MailHog and other dev relays take
// none); when Username is set the dispatcher performs PLAIN auth. StartTLS upgrades
// the connection before AUTH (leave false for MailHog).
type SMTPLexEmailDispatcherConfig struct {
	Host     string
	Port     int
	From     string
	Username string
	Password string
	StartTLS bool
	Timeout  time.Duration
	// Dialer overrides the SMTP connection for tests; nil uses the real dialer.
	Dialer smtpLexDialFunc
}

// SMTPLexEmailDispatcher implements LexEmailDispatcher over plain SMTP.
type SMTPLexEmailDispatcher struct {
	host     string
	port     int
	from     string
	username string
	password string
	startTLS bool
	timeout  time.Duration
	dialer   smtpLexDialFunc
}

// NewSMTPLexEmailDispatcher constructs the SMTP dispatcher. Host and From are
// required; a zero/invalid port defaults to 25 and a zero timeout to 10s.
func NewSMTPLexEmailDispatcher(cfg SMTPLexEmailDispatcherConfig) (*SMTPLexEmailDispatcher, error) {
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		return nil, validationError("lex notification SMTP host is required", map[string]string{"smtp_host": "required"})
	}
	from := strings.TrimSpace(cfg.From)
	if from == "" {
		return nil, validationError("lex notification SMTP from address is required", map[string]string{"smtp_from": "required"})
	}
	port := cfg.Port
	if port <= 0 || port > 65535 {
		port = 25
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	return &SMTPLexEmailDispatcher{
		host:     host,
		port:     port,
		from:     from,
		username: strings.TrimSpace(cfg.Username),
		password: cfg.Password,
		startTLS: cfg.StartTLS,
		timeout:  timeout,
		dialer:   cfg.Dialer,
	}, nil
}

// DispatchNotificationEmail renders the bilingual message and sends it to
// recipientEmail via SMTP, returning a delivery proof compatible with the
// deterministic/HTTP adapters.
func (d *SMTPLexEmailDispatcher) DispatchNotificationEmail(ctx context.Context, tenantID uuid.UUID, item model.NotificationInboxItem, recipientID uuid.UUID, recipientEmail string, now time.Time) (map[string]any, error) {
	to := strings.TrimSpace(recipientEmail)
	if to == "" {
		return nil, validationError("lex notification email requires a recipient address", map[string]string{"recipient_email": "required"})
	}

	subject := smtpLexSubject(item)
	messageID := fmt.Sprintf("<%s@lex.clario360>", uuid.NewString())
	raw := d.renderMIME(to, subject, messageID, item, now)

	if err := d.send(ctx, to, raw); err != nil {
		return nil, internalError("dispatch lex notification email via SMTP", err)
	}

	return map[string]any{
		"provider_adapter": "smtp",
		"provider":         "smtp",
		"provider_host":    net.JoinHostPort(d.host, strconv.Itoa(d.port)),
		"tenant_id":        tenantID.String(),
		"recipient_id":     recipientID.String(),
		"recipient_email":  to,
		"notification_id":  item.ID.String(),
		"category":         string(item.Category),
		"subject":          item.Title.Localize("en"),
		"message_id":       messageID,
		"delivery_status":  "sent",
		"dispatched_at":    now.UTC().Format(time.RFC3339Nano),
	}, nil
}

// send performs the SMTP conversation (dial → optional STARTTLS+AUTH → MAIL/RCPT/
// DATA). It never logs or embeds credentials in errors.
func (d *SMTPLexEmailDispatcher) send(ctx context.Context, to string, raw []byte) error {
	cl, err := d.dial(ctx)
	if err != nil {
		return err
	}
	defer cl.Close()

	if d.startTLS {
		if err := cl.StartTLS(&tls.Config{ServerName: d.host, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if d.username != "" {
		if err := cl.Auth(smtp.PlainAuth("", d.username, d.password, d.host)); err != nil {
			// Never echo the password; smtp.PlainAuth errors do not include it.
			return fmt.Errorf("smtp auth rejected")
		}
	}
	if err := cl.Mail(smtpLexAddress(d.from)); err != nil {
		return fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	if err := cl.Rcpt(smtpLexAddress(to)); err != nil {
		return fmt.Errorf("smtp RCPT: %w", err)
	}
	w, err := cl.Data()
	if err != nil {
		return fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(raw); err != nil {
		_ = w.Close()
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp commit: %w", err)
	}
	return cl.Quit()
}

// dial opens the SMTP session, honouring the context deadline.
func (d *SMTPLexEmailDispatcher) dial(ctx context.Context) (smtpLexSession, error) {
	addr := net.JoinHostPort(d.host, strconv.Itoa(d.port))
	if d.dialer != nil {
		return d.dialer(ctx, addr)
	}
	dctx, cancel := context.WithTimeout(ctx, d.timeout)
	defer cancel()
	var netDialer net.Dialer
	conn, err := netDialer.DialContext(dctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("smtp dial: %w", err)
	}
	cl, err := smtp.NewClient(conn, d.host)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	return cl, nil
}

// renderMIME builds a multipart/alternative RFC 5322 message carrying the
// bilingual (EN + AR, RTL-aware) title/body. Headers are sanitized for CR/LF
// injection; non-ASCII is RFC 2047 encoded in the subject and UTF-8 in the body.
func (d *SMTPLexEmailDispatcher) renderMIME(to, subject, messageID string, item model.NotificationInboxItem, now time.Time) []byte {
	titleEN := strings.TrimSpace(item.Title.Localize("en"))
	titleAR := strings.TrimSpace(item.Title.Localize("ar"))
	bodyEN := strings.TrimSpace(item.Body.Localize("en"))
	bodyAR := strings.TrimSpace(item.Body.Localize("ar"))

	boundary := "lex_" + strings.ReplaceAll(uuid.NewString(), "-", "")

	var b strings.Builder
	b.WriteString("From: " + smtpLexHeaderSafe(d.from) + "\r\n")
	b.WriteString("To: " + smtpLexHeaderSafe(to) + "\r\n")
	b.WriteString("Subject: " + mime.QEncoding.Encode("UTF-8", subject) + "\r\n")
	b.WriteString("Message-ID: " + smtpLexHeaderSafe(messageID) + "\r\n")
	b.WriteString("Date: " + now.UTC().Format(time.RFC1123Z) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	b.WriteString("Content-Type: multipart/alternative; boundary=\"" + boundary + "\"\r\n\r\n")

	// Plain-text alternative (EN then AR).
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(smtpLexPlainSection(titleEN, bodyEN))
	if titleAR != "" || bodyAR != "" {
		b.WriteString("\r\n----------\r\n\r\n")
		b.WriteString(smtpLexPlainSection(titleAR, bodyAR))
	}
	b.WriteString("\r\n")

	// HTML alternative (EN block LTR + AR block RTL).
	b.WriteString("--" + boundary + "\r\n")
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n")
	b.WriteString("Content-Transfer-Encoding: 8bit\r\n\r\n")
	b.WriteString(smtpLexHTML(titleEN, bodyEN, titleAR, bodyAR, smtpLexPtrString(item.ActionURL)))
	b.WriteString("\r\n")

	b.WriteString("--" + boundary + "--\r\n")
	return []byte(b.String())
}

// smtpLexSubject derives the message subject: the EN title, with the AR title as a
// companion when present, so both scripts appear in the client's subject line.
func smtpLexSubject(item model.NotificationInboxItem) string {
	en := strings.TrimSpace(item.Title.Localize("en"))
	ar := strings.TrimSpace(item.Title.Localize("ar"))
	switch {
	case en != "" && ar != "" && !strings.EqualFold(en, ar):
		return en + " — " + ar
	case en != "":
		return en
	case ar != "":
		return ar
	default:
		return "Clario360 Lex notification"
	}
}

func smtpLexPlainSection(title, body string) string {
	var b strings.Builder
	if title != "" {
		b.WriteString(title)
		b.WriteString("\r\n\r\n")
	}
	if body != "" {
		b.WriteString(body)
		b.WriteString("\r\n")
	}
	return b.String()
}

func smtpLexHTML(titleEN, bodyEN, titleAR, bodyAR, actionURL string) string {
	var b strings.Builder
	b.WriteString("<!doctype html><html><body style=\"font-family:Arial,Helvetica,sans-serif;color:#06352F;background-color:#FDFFF6;margin:0;padding:24px;\">")
	b.WriteString("<div style=\"max-width:560px;margin:0 auto;border:1px solid #D1D8D5;padding:24px;\">")
	if titleEN != "" || bodyEN != "" {
		b.WriteString("<div dir=\"ltr\" style=\"text-align:left;margin-bottom:20px;\">")
		if titleEN != "" {
			b.WriteString("<h2 style=\"margin:0 0 8px;font-size:18px;\">" + smtpLexHTMLEscape(titleEN) + "</h2>")
		}
		if bodyEN != "" {
			b.WriteString("<p style=\"margin:0;font-size:14px;line-height:1.6;\">" + smtpLexHTMLEscape(bodyEN) + "</p>")
		}
		b.WriteString("</div>")
	}
	if titleAR != "" || bodyAR != "" {
		b.WriteString("<div dir=\"rtl\" style=\"text-align:right;margin-bottom:20px;\">")
		if titleAR != "" {
			b.WriteString("<h2 style=\"margin:0 0 8px;font-size:18px;\">" + smtpLexHTMLEscape(titleAR) + "</h2>")
		}
		if bodyAR != "" {
			b.WriteString("<p style=\"margin:0;font-size:14px;line-height:1.8;\">" + smtpLexHTMLEscape(bodyAR) + "</p>")
		}
		b.WriteString("</div>")
	}
	if url := strings.TrimSpace(actionURL); url != "" {
		safe := smtpLexHTMLAttr(url)
		b.WriteString("<p style=\"margin:16px 0 0;\"><a href=\"" + safe + "\" style=\"color:#005E5E;font-size:14px;\">" + smtpLexHTMLEscape(url) + "</a></p>")
	}
	b.WriteString("</div></body></html>")
	return b.String()
}

// smtpLexPtrString reads an optional *string (e.g. item.ActionURL) as a value.
func smtpLexPtrString(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

// smtpLexAddress extracts the bare addr-spec from a "Name <a@b>" or plain address
// for use in SMTP MAIL FROM / RCPT TO envelope commands.
func smtpLexAddress(addr string) string {
	addr = strings.TrimSpace(addr)
	if i := strings.LastIndex(addr, "<"); i >= 0 {
		if j := strings.Index(addr[i:], ">"); j >= 0 {
			return strings.TrimSpace(addr[i+1 : i+j])
		}
	}
	return addr
}

func smtpLexHeaderSafe(s string) string {
	s = strings.ReplaceAll(s, "\r", " ")
	s = strings.ReplaceAll(s, "\n", " ")
	return strings.TrimSpace(s)
}

func smtpLexHTMLEscape(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"<", "&lt;",
		">", "&gt;",
		"\"", "&quot;",
		"'", "&#39;",
	)
	return r.Replace(s)
}

func smtpLexHTMLAttr(s string) string {
	r := strings.NewReplacer(
		"&", "&amp;",
		"\"", "&quot;",
		"<", "&lt;",
		">", "&gt;",
	)
	return r.Replace(s)
}

// Compile-time assertions: the dispatcher satisfies the seam, and *smtp.Client
// satisfies the minimal session interface the dispatcher drives.
var (
	_ LexEmailDispatcher = (*SMTPLexEmailDispatcher)(nil)
	_ smtpLexSession     = (*smtp.Client)(nil)
)
