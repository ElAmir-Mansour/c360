package channel

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"mime/quotedprintable"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"github.com/sony/gobreaker"

	"github.com/clario360/platform/internal/notification/metrics"
	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/unsubscribe"
)

// emailTextRenderer is optionally implemented by the template service to
// produce a plain-text alternative for the multipart/alternative email. When
// the renderer does not implement it, EmailChannel derives text from the HTML.
type emailTextRenderer interface {
	RenderEmailText(notif *model.Notification) (string, error)
}

// htmlTagRe strips HTML tags for the plain-text fallback part.
var htmlTagRe = regexp.MustCompile(`(?s)<[^>]*>`)

var emailRegex = regexp.MustCompile(`^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$`)

// sendgridHTTPClient is a long-lived HTTP client with a hard timeout.
var sendgridHTTPClient = &http.Client{Timeout: 15 * time.Second}

// EmailConfig holds email channel configuration.
type EmailConfig struct {
	Provider   string // "smtp" or "sendgrid"
	SMTPHost   string
	SMTPPort   int
	SMTPUser   string
	SMTPPass   string
	SMTPFrom   string
	TLSEnabled bool

	SendGridAPIKey string
	SendGridFrom   string

	// RFC 8058 one-click unsubscribe (#17). When BOTH are set, every outbound
	// email carries List-Unsubscribe + List-Unsubscribe-Post headers pointing at
	// a signed one-click URL. Empty values disable the headers (backward
	// compatible: emails send exactly as before).
	UnsubscribeBaseURL string // public URL of the unsubscribe endpoint
	UnsubscribeSecret  string // HMAC secret used to sign the unsubscribe token
}

// EmailChannel sends email notifications via SMTP or SendGrid.
type EmailChannel struct {
	cfg     EmailConfig
	tmplSvc EmailTemplateRenderer
	cb      *gobreaker.CircuitBreaker
	logger  zerolog.Logger
}

// NewEmailChannel creates a new EmailChannel.
func NewEmailChannel(cfg EmailConfig, tmplSvc EmailTemplateRenderer, logger zerolog.Logger) *EmailChannel {
	cb := gobreaker.NewCircuitBreaker(gobreaker.Settings{
		Name:        "email_channel",
		MaxRequests: 3,
		Interval:    60 * time.Second,
		Timeout:     30 * time.Second,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= 3
		},
	})

	return &EmailChannel{
		cfg:     cfg,
		tmplSvc: tmplSvc,
		cb:      cb,
		logger:  logger.With().Str("channel", "email").Logger(),
	}
}

// Name returns the channel name.
func (c *EmailChannel) Name() string { return model.ChannelEmail }

// Send delivers an email notification.
func (c *EmailChannel) Send(ctx context.Context, notif *model.Notification) *ChannelResult {
	// Extract email from notification data.
	email := c.extractEmail(notif)
	if email == "" {
		return &ChannelResult{
			Success:  false,
			Error:    fmt.Errorf("no email address available for user %s", notif.UserID),
			Metadata: map[string]interface{}{"reason": "no_email"},
		}
	}

	if !emailRegex.MatchString(email) {
		return &ChannelResult{
			Success:  false,
			Error:    fmt.Errorf("invalid email address: %s", email),
			Metadata: map[string]interface{}{"reason": "invalid_email"},
		}
	}

	// Render email template.
	subject, body, err := c.tmplSvc.RenderEmail(notif)
	if err != nil {
		c.logger.Warn().Err(err).Msg("template rendering failed, using fallback")
		subject = notif.Title
		body = notif.Body
	}

	// Plain-text alternative: prefer a dedicated renderer, else derive from HTML.
	textBody := c.renderText(notif, body)

	// RFC 8058 one-click unsubscribe URL (#17). Empty when unconfigured, in which
	// case no List-Unsubscribe headers are emitted.
	unsubURL := c.unsubscribeURL(notif)

	// Send via configured provider with circuit breaker.
	_, cbErr := c.cb.Execute(func() (interface{}, error) {
		switch c.cfg.Provider {
		case "sendgrid":
			return nil, c.sendViaSendGrid(ctx, email, subject, textBody, body, unsubURL)
		default:
			return nil, c.sendViaSMTP(email, subject, textBody, body, unsubURL)
		}
	})

	if cbErr != nil {
		metrics.EmailSent.WithLabelValues(c.cfg.Provider, "failed").Inc()
		return &ChannelResult{
			Success:  false,
			Error:    cbErr,
			Metadata: map[string]interface{}{"provider": c.cfg.Provider},
		}
	}

	metrics.EmailSent.WithLabelValues(c.cfg.Provider, "sent").Inc()
	return &ChannelResult{
		Success:  true,
		Metadata: map[string]interface{}{"provider": c.cfg.Provider},
	}
}

// renderText produces the plain-text alternative for an email. It prefers a
// dedicated RenderEmailText method on the template renderer (better output),
// falling back to stripping tags from the already-rendered HTML so there is
// always a text part in the multipart/alternative message.
func (c *EmailChannel) renderText(notif *model.Notification, htmlBody string) string {
	if tr, ok := c.tmplSvc.(emailTextRenderer); ok {
		if text, err := tr.RenderEmailText(notif); err == nil && strings.TrimSpace(text) != "" {
			return text
		}
	}
	return htmlToText(htmlBody)
}

// unsubscribeURL builds the signed RFC 8058 one-click unsubscribe URL for a
// notification's recipient, or "" when unsubscribe is not configured or the
// notification lacks the tenant/user needed to sign a token.
func (c *EmailChannel) unsubscribeURL(notif *model.Notification) string {
	if c.cfg.UnsubscribeBaseURL == "" || c.cfg.UnsubscribeSecret == "" {
		return ""
	}
	token, err := unsubscribe.Sign(c.cfg.UnsubscribeSecret, notif.TenantID, notif.UserID, string(notif.Type))
	if err != nil {
		c.logger.Debug().Err(err).Msg("skipping List-Unsubscribe header (token sign failed)")
		return ""
	}
	sep := "?"
	if strings.Contains(c.cfg.UnsubscribeBaseURL, "?") {
		sep = "&"
	}
	return c.cfg.UnsubscribeBaseURL + sep + "token=" + url.QueryEscape(token)
}

// unsubscribeHeaders returns the RFC 8058 List-Unsubscribe headers for a given
// one-click URL, or nil when the URL is empty.
func unsubscribeHeaders(unsubURL string) map[string]string {
	if unsubURL == "" {
		return nil
	}
	return map[string]string{
		"List-Unsubscribe":      "<" + unsubURL + ">",
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	}
}

// sanitizeHeader strips CR/LF from a header value to defeat header injection
// (e.g. a subject containing "\r\nBcc:"). Applied before RFC 2047 encoding.
func sanitizeHeader(v string) string {
	return strings.NewReplacer("\r", "", "\n", "").Replace(v)
}

// encodeSubject strips CR/LF then RFC 2047 (Q) encodes the subject so non-ASCII
// (e.g. Arabic) subjects survive transport with the correct charset.
func encodeSubject(subject string) string {
	return mime.QEncoding.Encode("utf-8", sanitizeHeader(subject))
}

// qpEncode quoted-printable encodes a UTF-8 body part.
func qpEncode(s string) string {
	var buf bytes.Buffer
	w := quotedprintable.NewWriter(&buf)
	_, _ = w.Write([]byte(s))
	_ = w.Close()
	return buf.String()
}

// randomBoundary returns a MIME multipart boundary.
func randomBoundary() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "clario360boundary000000000000000"
	}
	return "clario360_" + hex.EncodeToString(b[:])
}

// htmlToText derives a readable plain-text approximation of an HTML body.
func htmlToText(html string) string {
	s := html
	// Preserve block breaks before stripping tags.
	replacer := strings.NewReplacer(
		"</p>", "\n\n", "</P>", "\n\n",
		"<br>", "\n", "<br/>", "\n", "<br />", "\n",
		"</div>", "\n", "</tr>", "\n", "</h1>", "\n\n", "</h2>", "\n\n",
	)
	s = replacer.Replace(s)
	s = htmlTagRe.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "&amp;", "&")
	s = strings.ReplaceAll(s, "&lt;", "<")
	s = strings.ReplaceAll(s, "&gt;", ">")
	s = strings.ReplaceAll(s, "&quot;", "\"")
	s = strings.ReplaceAll(s, "&#39;", "'")
	s = strings.ReplaceAll(s, "&nbsp;", " ")
	// Collapse excessive blank lines / trailing whitespace.
	lines := strings.Split(s, "\n")
	out := make([]string, 0, len(lines))
	blank := 0
	for _, ln := range lines {
		ln = strings.TrimRight(strings.TrimSpace(ln), " \t")
		if ln == "" {
			blank++
			if blank > 1 {
				continue
			}
		} else {
			blank = 0
		}
		out = append(out, ln)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// buildMIMEMessage assembles a multipart/alternative message carrying both a
// text/plain and a text/html part (RFC 2046). The subject is RFC 2047 encoded
// and CR/LF-stripped; each body part is quoted-printable encoded for UTF-8.
func buildMIMEMessage(from, to, subject, textBody, htmlBody string) []byte {
	return buildMIMEMessageWithHeaders(from, to, subject, textBody, htmlBody, nil)
}

// buildMIMEMessageWithHeaders is buildMIMEMessage plus a set of additional
// top-level headers (e.g. RFC 8058 List-Unsubscribe). Header names/values are
// CR/LF-stripped to defeat header injection and emitted in a stable (sorted)
// order for deterministic output.
func buildMIMEMessageWithHeaders(from, to, subject, textBody, htmlBody string, extraHeaders map[string]string) []byte {
	boundary := randomBoundary()
	var msg bytes.Buffer
	msg.WriteString(fmt.Sprintf("From: %s\r\n", sanitizeHeader(from)))
	msg.WriteString(fmt.Sprintf("To: %s\r\n", sanitizeHeader(to)))
	msg.WriteString(fmt.Sprintf("Subject: %s\r\n", encodeSubject(subject)))
	for _, k := range sortedKeys(extraHeaders) {
		msg.WriteString(fmt.Sprintf("%s: %s\r\n", sanitizeHeader(k), sanitizeHeader(extraHeaders[k])))
	}
	msg.WriteString("MIME-Version: 1.0\r\n")
	msg.WriteString(fmt.Sprintf("Content-Type: multipart/alternative; boundary=\"%s\"\r\n", boundary))
	msg.WriteString("\r\n")

	// text/plain part first (least-preferred alternative per RFC 2046).
	msg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msg.WriteString("Content-Type: text/plain; charset=\"utf-8\"\r\n")
	msg.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
	msg.WriteString("\r\n")
	msg.WriteString(qpEncode(textBody))
	msg.WriteString("\r\n")

	// text/html part second (most-preferred).
	msg.WriteString(fmt.Sprintf("--%s\r\n", boundary))
	msg.WriteString("Content-Type: text/html; charset=\"utf-8\"\r\n")
	msg.WriteString("Content-Transfer-Encoding: quoted-printable\r\n")
	msg.WriteString("\r\n")
	msg.WriteString(qpEncode(htmlBody))
	msg.WriteString("\r\n")

	msg.WriteString(fmt.Sprintf("--%s--\r\n", boundary))
	return msg.Bytes()
}

// sortedKeys returns the keys of m in ascending order for deterministic header
// emission.
func sortedKeys(m map[string]string) []string {
	if len(m) == 0 {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func (c *EmailChannel) sendViaSMTP(to, subject, textBody, htmlBody, unsubURL string) error {
	addr := fmt.Sprintf("%s:%d", c.cfg.SMTPHost, c.cfg.SMTPPort)
	from := c.cfg.SMTPFrom

	msgBytes := buildMIMEMessageWithHeaders(from, to, subject, textBody, htmlBody, unsubscribeHeaders(unsubURL))

	if c.cfg.TLSEnabled {
		return c.sendSMTPWithTLS(addr, to, from, msgBytes)
	}

	var auth smtp.Auth
	if c.cfg.SMTPUser != "" {
		auth = smtp.PlainAuth("", c.cfg.SMTPUser, c.cfg.SMTPPass, c.cfg.SMTPHost)
	}
	return smtp.SendMail(addr, auth, from, []string{to}, msgBytes)
}

func (c *EmailChannel) sendSMTPWithTLS(addr, to, from string, msg []byte) error {
	host, _, _ := net.SplitHostPort(addr)

	conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return fmt.Errorf("tls dial: %w", err)
	}

	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return fmt.Errorf("smtp client: %w", err)
	}
	defer client.Close()

	if c.cfg.SMTPUser != "" {
		auth := smtp.PlainAuth("", c.cfg.SMTPUser, c.cfg.SMTPPass, host)
		if err := client.Auth(auth); err != nil {
			return fmt.Errorf("smtp auth: %w", err)
		}
	}

	if err := client.Mail(from); err != nil {
		return fmt.Errorf("smtp mail: %w", err)
	}
	if err := client.Rcpt(to); err != nil {
		return fmt.Errorf("smtp rcpt: %w", err)
	}

	w, err := client.Data()
	if err != nil {
		return fmt.Errorf("smtp data: %w", err)
	}
	if _, err := w.Write(msg); err != nil {
		return fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("smtp close data: %w", err)
	}

	return client.Quit()
}

func (c *EmailChannel) sendViaSendGrid(ctx context.Context, to, subject, textBody, htmlBody, unsubURL string) error {
	// SendGrid v3 requires content entries in order of increasing preference:
	// text/plain first, then text/html (RFC 2046 multipart/alternative ordering).
	// The subject is CR/LF-stripped to prevent header injection; SendGrid encodes
	// the header charset itself, so no RFC 2047 pre-encoding is applied here.
	payload := map[string]interface{}{
		"personalizations": []map[string]interface{}{
			{"to": []map[string]string{{"email": to}}},
		},
		"from":    map[string]string{"email": c.cfg.SendGridFrom},
		"subject": sanitizeHeader(subject),
		"content": []map[string]string{
			{"type": "text/plain", "value": textBody},
			{"type": "text/html", "value": htmlBody},
		},
	}
	// RFC 8058 one-click unsubscribe headers (#17). SendGrid forwards custom
	// headers verbatim; values are CR/LF-stripped to defeat header injection.
	if hdrs := unsubscribeHeaders(unsubURL); hdrs != nil {
		sgHeaders := make(map[string]string, len(hdrs))
		for k, v := range hdrs {
			sgHeaders[k] = sanitizeHeader(v)
		}
		payload["headers"] = sgHeaders
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal sendgrid payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.sendgrid.com/v3/mail/send", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create sendgrid request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.cfg.SendGridAPIKey)

	resp, err := sendgridHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("sendgrid request: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 400 {
		return fmt.Errorf("sendgrid returned status %d", resp.StatusCode)
	}
	return nil
}

func (c *EmailChannel) extractEmail(notif *model.Notification) string {
	if len(notif.Data) == 0 {
		return ""
	}
	var data map[string]interface{}
	if err := json.Unmarshal(notif.Data, &data); err != nil {
		return ""
	}
	if email, ok := data["email"].(string); ok {
		return email
	}
	if email, ok := data["user_email"].(string); ok {
		return email
	}
	return ""
}

// ExtractFromAddress extracts the email portion from a "Name <email>" format.
func ExtractFromAddress(from string) string {
	if idx := strings.Index(from, "<"); idx >= 0 {
		end := strings.Index(from, ">")
		if end > idx {
			return from[idx+1 : end]
		}
	}
	return from
}
