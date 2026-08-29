package integration

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
)

// =============================================================================
// Provider inbound-parse receiver — normalizers + edge authentication.
//
// This is the TRUSTED-edge half of the email-intake bridge's provider ingress:
// a mail provider (Mailgun route / SendGrid Inbound Parse / Postmark inbound /
// Amazon SES-via-SNS) POSTs a parsed inbound email to the public receiver route,
// and this package (a) verifies the PROVIDER'S OWN authenticity and (b) normalizes
// the provider-specific body into a neutral NormalizedInboundMessage the intake
// service maps onto its pipeline. Because provider auth happens HERE, the intake
// service's per-mailbox HMAC is bypassed downstream — so verification MUST fail
// CLOSED: an empty/unset provider secret disables the provider (the handler 404s
// before calling), and any verification failure returns ErrInboundSignatureInvalid.
//
// Going LIVE end-to-end additionally needs external, operator-owned config that is
// NOT a code concern: the provider inbound route + DNS MX record pointing the
// intake domain at the provider, and the provider's inbound signing secret set via
// LEX_INBOUND_EMAIL_<PROVIDER>_SECRET. For Amazon SES specifically, full SNS
// message-signature verification (SigningCertURL + certificate chain) is the
// go-live gate; the code here fails closed on a shared secret so a misconfigured
// deployment never ingests forged mail, and the SNS-signature upgrade slots in at
// verifySES without touching the pipeline.
// =============================================================================

// Inbound-parse cost/abuse bounds. The HTTP handler already caps the request body
// (8 MiB); these bound the fan-out AFTER a body is accepted.
const (
	maxInboundAttachments   = 50
	inboundSecretHeaderName = "X-Clario-Inbound-Secret"
	inboundSecretHeaderAlt  = "X-Inbound-Secret"
)

// ErrInboundSignatureInvalid is returned when the provider's authenticity check
// (HMAC signature or shared secret) does not verify. The handler maps it to a
// uniform 401 without leaking which mailbox/provider exists.
var ErrInboundSignatureInvalid = errors.New("inbound-parse: provider authentication failed")

// ErrInboundProviderUnsupported is returned for an unknown {provider} path
// segment. The handler maps it to 404 (the receiver for that provider is not a
// thing), never revealing configured state.
var ErrInboundProviderUnsupported = errors.New("inbound-parse: unsupported provider")

// InboundProvider identifies the upstream mail provider whose inbound-parse body
// shape + authentication scheme this receiver understands.
type InboundProvider string

const (
	InboundProviderMailgun  InboundProvider = "mailgun"
	InboundProviderSendgrid InboundProvider = "sendgrid"
	InboundProviderPostmark InboundProvider = "postmark"
	InboundProviderSES      InboundProvider = "ses"
)

// ParseInboundProvider validates and canonicalizes a {provider} path segment.
func ParseInboundProvider(raw string) (InboundProvider, bool) {
	switch InboundProvider(strings.ToLower(strings.TrimSpace(raw))) {
	case InboundProviderMailgun:
		return InboundProviderMailgun, true
	case InboundProviderSendgrid:
		return InboundProviderSendgrid, true
	case InboundProviderPostmark:
		return InboundProviderPostmark, true
	case InboundProviderSES:
		return InboundProviderSES, true
	default:
		return "", false
	}
}

// NormalizedInboundAttachment is one attachment lifted from a provider body,
// carried as base64 content to match the intake pipeline's attachment DTO.
type NormalizedInboundAttachment struct {
	Filename    string
	ContentType string
	ContentB64  string
}

// NormalizedInboundMessage is the provider-neutral projection of an inbound email
// that the intake service maps onto dto.IntakeEmailWebhookRequest. It is also the
// shared shape the IMAP poller emits, so both trusted-ingress paths converge.
type NormalizedInboundMessage struct {
	MessageID   string
	From        string
	To          string
	Subject     string
	Body        string
	Attachments []NormalizedInboundAttachment
}

// VerifyAndNormalizeInbound authenticates the provider POST and, on success,
// returns the neutral message. It fails CLOSED: an empty secret or any auth
// mismatch yields ErrInboundSignatureInvalid, and an unknown provider yields
// ErrInboundProviderUnsupported. rawBody is the exact bytes received (the HMAC /
// signature is computed over provider-specific fields parsed from it).
func VerifyAndNormalizeInbound(provider InboundProvider, secret string, header http.Header, rawBody []byte) (NormalizedInboundMessage, error) {
	if strings.TrimSpace(secret) == "" {
		// Defence in depth: the handler 404s a provider with no configured secret
		// BEFORE reaching here, so an empty secret is never an allow-all.
		return NormalizedInboundMessage{}, ErrInboundSignatureInvalid
	}
	switch provider {
	case InboundProviderMailgun:
		return normalizeMailgun(secret, header, rawBody)
	case InboundProviderSendgrid:
		return normalizeSendgrid(secret, header, rawBody)
	case InboundProviderPostmark:
		return normalizePostmark(secret, header, rawBody)
	case InboundProviderSES:
		return normalizeSES(secret, header, rawBody)
	default:
		return NormalizedInboundMessage{}, ErrInboundProviderUnsupported
	}
}

// --- Mailgun (form body, HMAC-SHA256 over timestamp+token) --------------------

func normalizeMailgun(secret string, header http.Header, rawBody []byte) (NormalizedInboundMessage, error) {
	form, attachments, err := parseFormBody(header, rawBody)
	if err != nil {
		return NormalizedInboundMessage{}, err
	}
	timestamp := form.Get("timestamp")
	token := form.Get("token")
	signature := form.Get("signature")
	if !verifyMailgunSignature(secret, timestamp, token, signature) {
		return NormalizedInboundMessage{}, ErrInboundSignatureInvalid
	}
	return NormalizedInboundMessage{
		MessageID:   firstNonEmpty(form.Get("Message-Id"), form.Get("message-id"), form.Get("Message-ID")),
		From:        firstNonEmpty(form.Get("sender"), form.Get("from"), form.Get("From")),
		To:          firstNonEmpty(form.Get("recipient"), form.Get("to"), form.Get("To")),
		Subject:     firstNonEmpty(form.Get("subject"), form.Get("Subject")),
		Body:        firstNonEmpty(form.Get("body-plain"), form.Get("stripped-text"), form.Get("body-html")),
		Attachments: attachments,
	}, nil
}

// verifyMailgunSignature checks Mailgun's documented webhook signature: a hex
// HMAC-SHA256 over the concatenation of timestamp + token, keyed by the route's
// signing key. Constant-time comparison bounds timing oracles.
func verifyMailgunSignature(secret, timestamp, token, signature string) bool {
	timestamp = strings.TrimSpace(timestamp)
	token = strings.TrimSpace(token)
	signature = strings.TrimSpace(signature)
	if secret == "" || timestamp == "" || token == "" || signature == "" {
		return false
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte(token))
	expected := hex.EncodeToString(mac.Sum(nil))
	return subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(signature))) == 1
}

// --- SendGrid Inbound Parse (multipart/urlencoded form + shared secret) -------

func normalizeSendgrid(secret string, header http.Header, rawBody []byte) (NormalizedInboundMessage, error) {
	if !verifySharedSecret(header, secret) {
		return NormalizedInboundMessage{}, ErrInboundSignatureInvalid
	}
	form, attachments, err := parseFormBody(header, rawBody)
	if err != nil {
		return NormalizedInboundMessage{}, err
	}
	messageID := firstNonEmpty(
		form.Get("Message-Id"), form.Get("message-id"),
		parseRawHeaderField(form.Get("headers"), "Message-ID"),
	)
	return NormalizedInboundMessage{
		MessageID:   messageID,
		From:        firstNonEmpty(form.Get("from"), form.Get("From")),
		To:          firstNonEmpty(form.Get("to"), form.Get("To")),
		Subject:     firstNonEmpty(form.Get("subject"), form.Get("Subject")),
		Body:        firstNonEmpty(form.Get("text"), form.Get("html")),
		Attachments: attachments,
	}, nil
}

// --- Postmark inbound (JSON + shared secret) ----------------------------------

func normalizePostmark(secret string, header http.Header, rawBody []byte) (NormalizedInboundMessage, error) {
	// Postmark posts JSON; the shared secret rides an inbound header (or a URL
	// query the operator configures upstream, surfaced as a header at the edge).
	if !verifySharedSecret(header, secret) {
		return NormalizedInboundMessage{}, ErrInboundSignatureInvalid
	}
	var payload struct {
		MessageID   string `json:"MessageID"`
		From        string `json:"From"`
		To          string `json:"To"`
		Subject     string `json:"Subject"`
		TextBody    string `json:"TextBody"`
		HTMLBody    string `json:"HtmlBody"`
		Attachments []struct {
			Name        string `json:"Name"`
			ContentType string `json:"ContentType"`
			Content     string `json:"Content"`
		} `json:"Attachments"`
	}
	if err := json.Unmarshal(rawBody, &payload); err != nil {
		return NormalizedInboundMessage{}, err
	}
	attachments := make([]NormalizedInboundAttachment, 0, len(payload.Attachments))
	for _, a := range payload.Attachments {
		if len(attachments) >= maxInboundAttachments {
			break
		}
		attachments = append(attachments, NormalizedInboundAttachment{
			Filename:    a.Name,
			ContentType: a.ContentType,
			ContentB64:  strings.TrimSpace(a.Content),
		})
	}
	return NormalizedInboundMessage{
		MessageID:   payload.MessageID,
		From:        payload.From,
		To:          payload.To,
		Subject:     payload.Subject,
		Body:        firstNonEmpty(payload.TextBody, payload.HTMLBody),
		Attachments: attachments,
	}, nil
}

// --- Amazon SES via SNS (JSON envelope + shared secret) -----------------------

func normalizeSES(secret string, header http.Header, rawBody []byte) (NormalizedInboundMessage, error) {
	// Shared-secret gate keeps the receiver fail-closed with only stdlib. Full SNS
	// message-signature verification (Signature + SigningCertURL cert chain) is the
	// documented go-live gate and slots in here without touching the pipeline.
	if !verifySharedSecret(header, secret) {
		return NormalizedInboundMessage{}, ErrInboundSignatureInvalid
	}
	var envelope struct {
		Type    string `json:"Type"`
		Message string `json:"Message"`
	}
	if err := json.Unmarshal(rawBody, &envelope); err != nil {
		return NormalizedInboundMessage{}, err
	}
	// The SES receipt notification rides SNS as a JSON STRING in Message.
	var receipt struct {
		Mail struct {
			MessageID     string `json:"messageId"`
			CommonHeaders struct {
				From    []string `json:"from"`
				To      []string `json:"to"`
				Subject string   `json:"subject"`
			} `json:"commonHeaders"`
		} `json:"mail"`
		Content string `json:"content"`
	}
	if strings.TrimSpace(envelope.Message) != "" {
		if err := json.Unmarshal([]byte(envelope.Message), &receipt); err != nil {
			return NormalizedInboundMessage{}, err
		}
	}
	return NormalizedInboundMessage{
		MessageID: receipt.Mail.MessageID,
		From:      firstSlice(receipt.Mail.CommonHeaders.From),
		To:        firstSlice(receipt.Mail.CommonHeaders.To),
		Subject:   receipt.Mail.CommonHeaders.Subject,
		Body:      receipt.Content,
	}, nil
}

// --- shared helpers -----------------------------------------------------------

// verifySharedSecret accepts the provider secret either as the HTTP Basic-auth
// password (username ignored) or as an inbound secret header, compared in
// constant time. Fails closed on any absence.
func verifySharedSecret(header http.Header, secret string) bool {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return false
	}
	candidates := []string{
		strings.TrimSpace(header.Get(inboundSecretHeaderName)),
		strings.TrimSpace(header.Get(inboundSecretHeaderAlt)),
	}
	if _, pass, ok := basicAuthFromHeader(header.Get("Authorization")); ok {
		candidates = append(candidates, pass)
	}
	for _, c := range candidates {
		if c != "" && subtle.ConstantTimeCompare([]byte(c), []byte(secret)) == 1 {
			return true
		}
	}
	return false
}

// basicAuthFromHeader decodes a "Basic base64(user:pass)" Authorization header.
func basicAuthFromHeader(authHeader string) (user, pass string, ok bool) {
	authHeader = strings.TrimSpace(authHeader)
	const prefix = "Basic "
	if len(authHeader) < len(prefix) || !strings.EqualFold(authHeader[:len(prefix)], prefix) {
		return "", "", false
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(authHeader[len(prefix):]))
	if err != nil {
		return "", "", false
	}
	user, pass, found := strings.Cut(string(decoded), ":")
	if !found {
		return "", "", false
	}
	return user, pass, true
}

// parseFormBody parses either an application/x-www-form-urlencoded or a
// multipart/form-data body into url.Values (text fields) plus any file parts as
// attachments (base64-encoded, bounded). An unrecognized content type is parsed
// as urlencoded (the tolerant default).
func parseFormBody(header http.Header, rawBody []byte) (url.Values, []NormalizedInboundAttachment, error) {
	contentType := header.Get("Content-Type")
	mediaType, params, err := mime.ParseMediaType(contentType)
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		values, perr := url.ParseQuery(string(rawBody))
		if perr != nil {
			return nil, nil, perr
		}
		return values, nil, nil
	}
	boundary := params["boundary"]
	if boundary == "" {
		return nil, nil, errors.New("inbound-parse: multipart body missing boundary")
	}
	reader := multipart.NewReader(bytes.NewReader(rawBody), boundary)
	values := url.Values{}
	attachments := make([]NormalizedInboundAttachment, 0, 4)
	for {
		part, perr := reader.NextPart()
		if perr == io.EOF {
			break
		}
		if perr != nil {
			return nil, nil, perr
		}
		content, rerr := io.ReadAll(part)
		_ = part.Close()
		if rerr != nil {
			return nil, nil, rerr
		}
		if filename := part.FileName(); filename != "" {
			if len(attachments) < maxInboundAttachments {
				attachments = append(attachments, NormalizedInboundAttachment{
					Filename:    filename,
					ContentType: part.Header.Get("Content-Type"),
					ContentB64:  base64.StdEncoding.EncodeToString(content),
				})
			}
			continue
		}
		values.Add(part.FormName(), string(content))
	}
	return values, attachments, nil
}

// parseRawHeaderField extracts a single header value (first match) from a raw
// RFC-5322 header block, case-insensitively. Used to recover Message-ID from a
// provider's verbatim `headers` field when it is not a first-class form value.
func parseRawHeaderField(rawHeaders, name string) string {
	if strings.TrimSpace(rawHeaders) == "" {
		return ""
	}
	prefix := strings.ToLower(name) + ":"
	for _, line := range strings.Split(rawHeaders, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(trimmed), prefix) {
			return strings.TrimSpace(trimmed[len(prefix):])
		}
	}
	return ""
}

func firstSlice(values []string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}
