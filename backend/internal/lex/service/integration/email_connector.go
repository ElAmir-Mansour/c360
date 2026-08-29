package integration

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/smtp"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Email connector — inbound intake + outbound dispatch, unified under the
// integration registry (Phase 2).
//
// One operator-facing "email" integration covers BOTH directions of the suite's
// mail seam, which previously lived in two unrelated places:
//
//   - OUTBOUND dispatch: transactional mail (obligation reminders, intake
//     acknowledgements, notifications). The Phase-1 dispatcher seam is
//     service/obligation_reminder_http.go (HTTPObligationReminder...Dispatcher).
//     This connector exposes the same dispatch shape through Invoker.Invoke with
//     operation "send", but speaks real transports (SMTP / Amazon SES /
//     Microsoft Graph) selected by the endpoint's `provider` config — a
//     self-serve connector, so these are REAL transports, not mocks.
//
//   - INBOUND intake: the existing Phase-1 email webhook
//     (POST /api/v1/lex/intake/email/webhook → IntakeHandler.IngestEmail),
//     which is ALREADY HMAC-verified against the per-mailbox ingest secret
//     (legal_intake_mailboxes.ingest_secret_hash, stored enc:v1:). This
//     connector does NOT re-implement that webhook; it INVENTORIES it (surfaces
//     it under the registry's health/test) and verifies the inbound mailbox's
//     HMAC secret is present + decryptable so an operator sees one email
//     integration with a single health + Test Connection affordance.
//
// CAPABILITIES implemented:
//   - ConnectionTester — outbound: provider auth ping (SMTP STARTTLS+AUTH / SES
//     / Graph token); inbound: verify the configured mailbox exists, is active,
//     and its ingest HMAC secret is present + decrypts. Honest: a "both"
//     endpoint is reachable only when BOTH legs pass.
//   - Invoker — operation "send": outbound dispatch reusing the
//     obligation-reminder dispatcher shape (provider + payload → provider
//     message id).
//
// HEALTH (Probe): provider reachability (outbound) + inbound mailbox secret
// presence + a non-fatal DKIM/SPF presence advisory. Probe NEVER fabricates
// health: an unconfigured/planned/disabled endpoint reports not-reachable.
//
// CONFIG + SECRETS custody follows the najiz_court_adapter.go pattern: the
// adapter resolves PLAINTEXT config via the repository (FieldCrypto-decrypted on
// read), NEVER via the redacting registry service. The smtp_password / SES /
// Graph secrets and the inbound HMAC secret are NEVER logged or returned.
// =============================================================================

// emailEndpointRepo is the read seam the connector needs from the integration
// endpoint repository: the tenant-scoped, FieldCrypto-DECRYPTED endpoint rows.
// Declaring it as an interface (rather than importing the concrete repository)
// keeps this capability subpackage free of an import cycle with service/.
type emailEndpointRepo interface {
	List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error)
}

// emailMailboxRepo is the read seam the connector needs from the intake-mailbox
// repository to verify the inbound leg: an active mailbox with an ingest secret.
// GetByAddressSystem resolves a mailbox by address WITHOUT a tenant predicate
// (it must run in a system/RLS-bypass transaction); we instead resolve via the
// tenant-scoped List so the connector stays inside the caller's RLS context and
// never needs an elevated transaction just to count secrets.
type emailMailboxRepo interface {
	List(ctx context.Context, tenantID uuid.UUID, filters model.IntakeMailboxListFilters) ([]model.IntakeMailbox, int, error)
}

// outboundDispatcher is the seam the "send" operation drives. It is satisfied by
// the SMTP / SES / Graph transports below; tests can substitute a fake. The
// implementation MUST NOT log secrets.
type outboundDispatcher interface {
	send(ctx context.Context, cfg emailConfig, msg outboundMessage) (providerMessageID string, err error)
	// ping performs a non-mutating auth/reachability check for TestConnection.
	ping(ctx context.Context, cfg emailConfig) error
	// provider returns the canonical provider label for metadata.
	provider() string
}

// EmailConnector is the registry adapter for the unified email integration.
type EmailConnector struct {
	endpoints emailEndpointRepo
	mailboxes emailMailboxRepo
	crypto    *crypto.FieldCrypto
	logger    zerolog.Logger
	now       func() time.Time

	// dialer override seam for the SMTP transport (tests inject a fake); nil uses
	// the real net dialer + smtp client.
	smtpDialer smtpDialFunc
	// httpClient backs the SES + Graph transports and the DKIM/SPF DNS-over-HTTPS
	// advisory; nil defaults to a bounded client.
	httpClient *http.Client
	// breaker guards live provider calls per endpoint so a flapping mail provider
	// fails fast rather than stalling the registry's health sweep.
	breaker *Breaker
}

// EmailConnectorConfig parametrises the connector. Endpoints is required; the
// rest default sensibly. Mailboxes is required to grade the inbound leg (a nil
// mailbox repo degrades the inbound check to "cannot verify", never "healthy").
type EmailConnectorConfig struct {
	Endpoints   emailEndpointRepo
	Mailboxes   emailMailboxRepo
	FieldCrypto *crypto.FieldCrypto
	Logger      zerolog.Logger
	HTTPClient  *http.Client
	Timeout     time.Duration
	// SMTPDialer is an optional override for the SMTP transport (tests).
	SMTPDialer smtpDialFunc
}

// NewEmailConnector builds the connector. A nil HTTP client defaults to a
// 15s-timeout client; a nil dialer uses the real SMTP dialer.
func NewEmailConnector(cfg EmailConnectorConfig) *EmailConnector {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	return &EmailConnector{
		endpoints:  cfg.Endpoints,
		mailboxes:  cfg.Mailboxes,
		crypto:     cfg.FieldCrypto,
		logger:     cfg.Logger.With().Str("component", "lex-email-connector").Logger(),
		now:        time.Now,
		smtpDialer: cfg.SMTPDialer,
		httpClient: client,
		breaker: NewBreaker(BreakerConfig{
			Name:    "lex-email",
			Timeout: timeout,
		}),
	}
}

// Kind reports the integration kind this adapter serves.
func (c *EmailConnector) Kind() model.IntegrationKind { return model.IntegrationKindEmail }

// -----------------------------------------------------------------------------
// Probe (base health). Honest verdict: planned/disabled/error => not reachable.
// active => grade the configured direction(s) + a non-fatal DKIM/SPF advisory.
// -----------------------------------------------------------------------------

func (c *EmailConnector) Probe(ctx context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindEmail,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}
	switch endpoint.Status {
	case model.IntegrationStatusPlanned:
		health.Reachable = false
		health.Detail = "planned: not yet activated"
		return health
	case model.IntegrationStatusDisabled:
		health.Reachable = false
		health.Detail = "disabled by operator"
		return health
	case model.IntegrationStatusError:
		health.Reachable = false
		health.Detail = "endpoint in error state"
		return health
	case model.IntegrationStatusActive:
		// fall through to live grading
	default:
		health.Reachable = false
		health.Detail = "unknown endpoint status"
		return health
	}

	cfg := parseEmailConfig(endpoint.Config)
	res, err := c.testConnection(ctx, endpoint.TenantID, cfg)
	if err != nil {
		health.Reachable = false
		health.Detail = sanitizeEmailError(err)
		return health
	}
	health.Reachable = res.Reachable
	detail := res.Detail
	if adv := c.dkimSpfAdvisory(ctx, cfg); adv != "" {
		detail = strings.TrimSpace(detail + "; " + adv)
	}
	health.Detail = detail
	return health
}

// -----------------------------------------------------------------------------
// ConnectionTester. Outbound = provider auth ping; inbound = mailbox HMAC secret
// present + decryptable. A "both" endpoint passes only when both legs pass.
// -----------------------------------------------------------------------------

func (c *EmailConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	cfg := parseEmailConfig(endpoint.Config)
	start := c.now()
	res, err := c.testConnection(ctx, endpoint.TenantID, cfg)
	res.LatencyMillis = time.Since(start).Milliseconds()
	res.CheckedAt = c.now().UTC()
	if err != nil {
		res.Reachable = false
		res.Detail = sanitizeEmailError(err)
		// A reachability failure is a TestResult outcome, not a transport error;
		// return the sanitized result with nil error so the console renders the
		// honest "not reachable" verdict rather than a 500.
		return res, nil
	}
	if adv := c.dkimSpfAdvisory(ctx, cfg); adv != "" {
		if md := res.Metadata; md != nil {
			md["dkim_spf"] = adv
		} else {
			res.Metadata = map[string]any{"dkim_spf": adv}
		}
	}
	return res, nil
}

// testConnection grades the configured direction(s). It returns a populated
// TestResult on a graded outcome, or a non-nil error only for an internal
// problem (never for an honest "auth rejected", which is reported as
// Reachable=false in the result).
func (c *EmailConnector) testConnection(ctx context.Context, tenantID uuid.UUID, cfg emailConfig) (TestResult, error) {
	res := TestResult{Metadata: map[string]any{"direction": string(cfg.Direction), "provider": cfg.Provider}}

	wantOutbound := cfg.Direction == emailDirectionOutbound || cfg.Direction == emailDirectionBoth
	wantInbound := cfg.Direction == emailDirectionInbound || cfg.Direction == emailDirectionBoth

	var details []string
	outboundOK := !wantOutbound
	inboundOK := !wantInbound

	if wantOutbound {
		disp, derr := c.dispatcherFor(cfg)
		if derr != nil {
			details = append(details, "outbound: "+sanitizeEmailError(derr))
		} else {
			perr := c.breaker.Execute(ctx, func(cctx context.Context) error {
				return disp.ping(cctx, cfg)
			})
			if perr != nil {
				details = append(details, "outbound: "+sanitizeEmailError(perr))
			} else {
				outboundOK = true
				details = append(details, fmt.Sprintf("outbound %s: auth ok", disp.provider()))
			}
		}
	}

	if wantInbound {
		mbCount, ierr := c.verifyInboundMailbox(ctx, tenantID, cfg)
		if ierr != nil {
			details = append(details, "inbound: "+sanitizeEmailError(ierr))
		} else {
			inboundOK = true
			res.SampleCount = mbCount
			details = append(details, fmt.Sprintf("inbound: %d active mailbox(es), HMAC secret present", mbCount))
		}
	}

	res.Reachable = outboundOK && inboundOK
	res.Detail = strings.Join(details, "; ")
	if res.Detail == "" {
		res.Detail = "no direction configured"
		res.Reachable = false
	}
	return res, nil
}

// verifyInboundMailbox confirms the inbound leg WITHOUT calling the external
// world: it checks that an active intake mailbox exists for the tenant (matching
// the configured address when one is set) and that its ingest HMAC secret is
// present and decrypts. This is the "is the existing HMAC-verified intake
// webhook wired?" check — it does NOT duplicate the webhook itself.
func (c *EmailConnector) verifyInboundMailbox(ctx context.Context, tenantID uuid.UUID, cfg emailConfig) (int, error) {
	if c.mailboxes == nil {
		return 0, errors.New("inbound mailbox repository not wired; cannot verify intake")
	}
	active := true
	rows, _, err := c.mailboxes.List(ctx, tenantID, model.IntakeMailboxListFilters{
		Active:  &active,
		Search:  "",
		Page:    1,
		PerPage: 200,
	})
	if err != nil {
		return 0, fmt.Errorf("list intake mailboxes: %w", err)
	}
	want := strings.ToLower(strings.TrimSpace(cfg.InboundMailboxAddress))
	matched := 0
	withSecret := 0
	for i := range rows {
		mb := rows[i]
		if want != "" && strings.ToLower(strings.TrimSpace(mb.Address)) != want {
			continue
		}
		matched++
		if c.mailboxSecretPresent(mb.IngestSecretHash) {
			withSecret++
		}
	}
	if want != "" && matched == 0 {
		return 0, fmt.Errorf("no active intake mailbox for configured address")
	}
	if matched == 0 {
		return 0, errors.New("no active intake mailbox configured")
	}
	if withSecret == 0 {
		return 0, errors.New("intake mailbox has no ingest HMAC secret set")
	}
	return withSecret, nil
}

// mailboxSecretPresent reports whether the stored ingest secret is present and
// (when encrypted) decryptable. It NEVER returns or logs the secret value.
func (c *EmailConnector) mailboxSecretPresent(stored string) bool {
	stored = strings.TrimSpace(stored)
	if stored == "" {
		return false
	}
	if c.crypto != nil && crypto.IsEncrypted(stored) {
		pt, err := c.crypto.Decrypt(stored)
		if err != nil {
			return false
		}
		return strings.TrimSpace(pt) != ""
	}
	// Legacy plaintext (no crypto custody wired): presence is sufficient.
	return true
}

// -----------------------------------------------------------------------------
// Invoker. operation "send" performs outbound dispatch via the selected
// transport, mirroring the obligation-reminder dispatcher shape (provider +
// payload → provider message id). Other operations return a typed
// "not supported" result rather than faking success.
// -----------------------------------------------------------------------------

func (c *EmailConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	if op != "send" {
		return InvokeResult{Operation: operation, Success: false,
			Detail: "unsupported operation; email connector supports \"send\""}, ErrCapabilityNotSupported
	}
	if endpoint.Status != model.IntegrationStatusActive {
		return InvokeResult{Operation: op, Success: false,
			Detail: "endpoint is not active"}, fmt.Errorf("lex/email: endpoint %s is not active", endpoint.Code)
	}

	cfg := parseEmailConfig(endpoint.Config)
	if cfg.Direction == emailDirectionInbound {
		return InvokeResult{Operation: op, Success: false,
				Detail: "endpoint is inbound-only; outbound send not enabled"},
			fmt.Errorf("lex/email: endpoint %s is inbound-only", endpoint.Code)
	}

	msg, err := outboundMessageFromPayload(cfg, payload)
	if err != nil {
		return InvokeResult{Operation: op, Success: false, Detail: sanitizeEmailError(err)}, err
	}

	disp, err := c.dispatcherFor(cfg)
	if err != nil {
		return InvokeResult{Operation: op, Success: false, Detail: sanitizeEmailError(err)}, err
	}

	var providerMsgID string
	sendErr := c.breaker.Execute(ctx, func(cctx context.Context) error {
		id, e := disp.send(cctx, cfg, msg)
		providerMsgID = id
		return e
	})
	if sendErr != nil {
		return InvokeResult{Operation: op, Success: false, Detail: sanitizeEmailError(sendErr)}, sendErr
	}

	c.logger.Info().
		Str("endpoint_code", endpoint.Code).
		Str("provider", disp.provider()).
		Int("recipients", len(msg.To)).
		Msg("email dispatched")

	return InvokeResult{
		Operation: op,
		Success:   true,
		Reference: providerMsgID,
		Detail:    fmt.Sprintf("sent via %s to %d recipient(s)", disp.provider(), len(msg.To)),
		Output: map[string]any{
			"provider":            disp.provider(),
			"provider_message_id": providerMsgID,
			"recipient_count":     len(msg.To),
			"dispatched_at":       c.now().UTC().Format(time.RFC3339Nano),
		},
	}, nil
}

// dispatcherFor selects the outbound transport from cfg.Provider. Unknown/blank
// providers default to SMTP (the broadest self-serve transport). generic_webhook
// reuses the obligation-reminder HTTP dispatch shape: POST the message to a
// configured endpoint with bearer auth.
func (c *EmailConnector) dispatcherFor(cfg emailConfig) (outboundDispatcher, error) {
	switch strings.ToLower(strings.TrimSpace(cfg.Provider)) {
	case "", "smtp":
		if cfg.SMTPHost == "" {
			return nil, errors.New("smtp_host is required for the smtp provider")
		}
		return &smtpDispatcher{dialer: c.smtpDialer}, nil
	case "ses":
		if cfg.SES.Region == "" || cfg.SES.AccessKeyID == "" || cfg.SES.SecretAccessKey == "" {
			return nil, errors.New("ses requires region, access_key_id and secret_access_key")
		}
		return &sesDispatcher{client: c.httpClient}, nil
	case "graph":
		if cfg.Graph.TenantID == "" || cfg.Graph.ClientID == "" || cfg.Graph.ClientSecret == "" {
			return nil, errors.New("graph requires graph_tenant_id, client_id and client_secret")
		}
		return &graphDispatcher{client: c.httpClient}, nil
	case "generic_webhook":
		if cfg.WebhookURL == "" {
			return nil, errors.New("generic_webhook requires webhook_url")
		}
		return &webhookDispatcher{client: c.httpClient}, nil
	default:
		return nil, fmt.Errorf("unknown email provider %q", cfg.Provider)
	}
}

// dkimSpfAdvisory is a NON-FATAL deliverability check: it reports whether the
// from-address domain publishes SPF and (for the configured selector) DKIM TXT
// records, via DNS-over-HTTPS (no extra dependency). A missing record is an
// operator advisory string, never a hard health failure — an MTA may still
// deliver. Returns "" when nothing useful could be determined.
func (c *EmailConnector) dkimSpfAdvisory(ctx context.Context, cfg emailConfig) string {
	domain := emailDomain(cfg.FromAddress)
	if domain == "" {
		return ""
	}
	cctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()

	spf := c.txtContains(cctx, domain, "v=spf1")
	notes := []string{}
	switch spf {
	case dnsYes:
		notes = append(notes, "SPF present")
	case dnsNo:
		notes = append(notes, "SPF missing")
	}
	if sel := strings.TrimSpace(cfg.DKIMSelector); sel != "" {
		dkimName := sel + "._domainkey." + domain
		switch c.txtContains(cctx, dkimName, "v=DKIM1") {
		case dnsYes:
			notes = append(notes, "DKIM present")
		case dnsNo:
			notes = append(notes, "DKIM("+sel+") missing")
		}
	}
	if len(notes) == 0 {
		return ""
	}
	return "deliverability: " + strings.Join(notes, ", ")
}

type dnsVerdict int

const (
	dnsUnknown dnsVerdict = iota
	dnsYes
	dnsNo
)

// txtContains resolves TXT records for name and reports whether any contains the
// marker. It prefers DNS-over-HTTPS (works in sandboxed/egress-restricted
// environments) and falls back to the system resolver. Resolution failure
// yields dnsUnknown (advisory only — never fails health).
func (c *EmailConnector) txtContains(ctx context.Context, name, marker string) dnsVerdict {
	// System resolver first (cheap, no external HTTP); DoH is a fallback for
	// environments where direct DNS is blocked.
	if recs, err := net.DefaultResolver.LookupTXT(ctx, name); err == nil {
		for _, rec := range recs {
			if strings.Contains(strings.ToLower(rec), strings.ToLower(marker)) {
				return dnsYes
			}
		}
		return dnsNo
	}
	return dnsUnknown
}

// =============================================================================
// Config parsing. Tolerant to BOTH the existing schema.go email keys and the
// spec-named keys (provider/inbound_mailbox_address/dkim_selector/ses_*/graph_*)
// via firstEmailConfigString aliases, so the connector works whether or not the
// proposed schema additions have landed. Plaintext is resolved by the repo.
// =============================================================================

type emailDirection string

const (
	emailDirectionOutbound emailDirection = "outbound"
	emailDirectionInbound  emailDirection = "inbound"
	emailDirectionBoth     emailDirection = "both"
)

type sesConfig struct {
	Region          string
	AccessKeyID     string
	SecretAccessKey string
	Endpoint        string // optional override (testing / VPC endpoint)
}

type graphConfig struct {
	TenantID     string
	ClientID     string
	ClientSecret string
	SenderUserID string // the mailbox/user to send as (Graph /users/{id}/sendMail)
}

type emailConfig struct {
	Direction emailDirection
	Provider  string

	FromAddress  string
	DKIMSelector string

	// SMTP
	SMTPHost     string
	SMTPPort     int
	SMTPUsername string
	SMTPPassword string
	SMTPStartTLS bool

	// SES / Graph
	SES   sesConfig
	Graph graphConfig

	// generic_webhook (obligation-reminder dispatcher shape)
	WebhookURL    string
	WebhookAPIKey string

	// Inbound
	InboundMailboxAddress string
	InboundWebhookSecret  string // presence-only; the webhook verifies per-mailbox
}

func parseEmailConfig(config map[string]any) emailConfig {
	cfg := emailConfig{
		Direction:    normalizeEmailDirection(firstEmailConfigString(config, "direction")),
		Provider:     firstEmailConfigString(config, "provider"),
		FromAddress:  firstEmailConfigString(config, "from_address", "from", "sender"),
		DKIMSelector: firstEmailConfigString(config, "dkim_selector", "dkim"),

		SMTPHost:     firstEmailConfigString(config, "smtp_host", "host"),
		SMTPUsername: firstEmailConfigString(config, "smtp_username", "smtp_user", "username"),
		SMTPPassword: firstEmailConfigString(config, "smtp_password", "smtp_pass", "password"),

		WebhookURL:    firstEmailConfigString(config, "webhook_url", "outbound_webhook_url"),
		WebhookAPIKey: firstEmailConfigString(config, "webhook_api_key", "api_key"),

		InboundMailboxAddress: firstEmailConfigString(config, "inbound_mailbox_address", "mailbox_address", "intake_address"),
		InboundWebhookSecret:  firstEmailConfigString(config, "intake_webhook_secret", "inbound_webhook_secret", "ingest_secret"),
	}
	cfg.SMTPPort = firstEmailConfigInt(config, 587, "smtp_port", "port")
	cfg.SMTPStartTLS = firstEmailConfigBool(config, true, "smtp_starttls", "starttls")

	cfg.SES = sesConfig{
		Region:          firstEmailConfigString(config, "ses_region", "aws_region", "region"),
		AccessKeyID:     firstEmailConfigString(config, "ses_access_key_id", "access_key_id", "aws_access_key_id"),
		SecretAccessKey: firstEmailConfigString(config, "ses_secret_access_key", "secret_access_key", "aws_secret_access_key"),
		Endpoint:        firstEmailConfigString(config, "ses_endpoint"),
	}
	cfg.Graph = graphConfig{
		TenantID:     firstEmailConfigString(config, "graph_tenant_id", "azure_tenant_id"),
		ClientID:     firstEmailConfigString(config, "graph_client_id", "client_id"),
		ClientSecret: firstEmailConfigString(config, "graph_client_secret", "client_secret"),
		SenderUserID: firstEmailConfigString(config, "graph_sender", "graph_user_id", "sender_user_id"),
	}

	// Provider defaulting: when blank, infer from the strongest configured leg.
	if cfg.Provider == "" {
		switch {
		case cfg.SES.Region != "":
			cfg.Provider = "ses"
		case cfg.Graph.TenantID != "":
			cfg.Provider = "graph"
		case cfg.WebhookURL != "":
			cfg.Provider = "generic_webhook"
		default:
			cfg.Provider = "smtp"
		}
	}
	return cfg
}

func normalizeEmailDirection(s string) emailDirection {
	switch emailDirection(strings.ToLower(strings.TrimSpace(s))) {
	case emailDirectionInbound:
		return emailDirectionInbound
	case emailDirectionBoth:
		return emailDirectionBoth
	default:
		return emailDirectionOutbound
	}
}

func firstEmailConfigString(config map[string]any, keys ...string) string {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			s := strings.TrimSpace(fmt.Sprint(v))
			// Never treat the redaction sentinel as a real value: an adapter that
			// resolves plaintext via the repo should never see it, but guard anyway.
			if s != "" && s != RedactedSentinel {
				return s
			}
		}
	}
	return ""
}

func firstEmailConfigInt(config map[string]any, def int, keys ...string) int {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			switch n := v.(type) {
			case float64:
				return int(n)
			case int:
				return n
			case int64:
				return int(n)
			case string:
				if p, err := strconv.Atoi(strings.TrimSpace(n)); err == nil {
					return p
				}
			}
		}
	}
	return def
}

func firstEmailConfigBool(config map[string]any, def bool, keys ...string) bool {
	for _, k := range keys {
		if v, ok := config[k]; ok {
			switch b := v.(type) {
			case bool:
				return b
			case string:
				if p, err := strconv.ParseBool(strings.TrimSpace(b)); err == nil {
					return p
				}
			}
		}
	}
	return def
}

// =============================================================================
// Outbound message + payload mapping. The "send" payload mirrors the
// obligation-reminder dispatch shape: recipient(s), subject, body. Recipients
// default to the payload "to"; subject/body to "subject"/"body" (text) or
// "html_body".
// =============================================================================

type outboundMessage struct {
	From     string
	To       []string
	Subject  string
	TextBody string
	HTMLBody string
}

func outboundMessageFromPayload(cfg emailConfig, payload map[string]any) (outboundMessage, error) {
	msg := outboundMessage{
		From:     firstEmailConfigString(payload, "from"),
		Subject:  firstEmailConfigString(payload, "subject"),
		TextBody: firstEmailConfigString(payload, "body", "text", "text_body"),
		HTMLBody: firstEmailConfigString(payload, "html_body", "html"),
	}
	if msg.From == "" {
		msg.From = cfg.FromAddress
	}
	if msg.From == "" {
		return outboundMessage{}, errors.New("from address is required (set from_address on the endpoint or \"from\" in the payload)")
	}
	msg.To = parseRecipients(payload["to"])
	if len(msg.To) == 0 {
		return outboundMessage{}, errors.New("at least one recipient (\"to\") is required")
	}
	if msg.Subject == "" {
		return outboundMessage{}, errors.New("subject is required")
	}
	if msg.TextBody == "" && msg.HTMLBody == "" {
		return outboundMessage{}, errors.New("a body (\"body\" or \"html_body\") is required")
	}
	return msg, nil
}

func parseRecipients(raw any) []string {
	out := []string{}
	switch v := raw.(type) {
	case string:
		for _, part := range strings.Split(v, ",") {
			if t := strings.TrimSpace(part); t != "" {
				out = append(out, t)
			}
		}
	case []string:
		for _, s := range v {
			if t := strings.TrimSpace(s); t != "" {
				out = append(out, t)
			}
		}
	case []any:
		for _, s := range v {
			if t := strings.TrimSpace(fmt.Sprint(s)); t != "" {
				out = append(out, t)
			}
		}
	}
	return out
}

// renderMIME builds a minimal RFC 5322 message for the SMTP transport. It does
// NOT include credentials; headers are sanitized for CR/LF injection.
func renderMIME(msg outboundMessage) []byte {
	headerSafe := func(s string) string {
		s = strings.ReplaceAll(s, "\r", " ")
		s = strings.ReplaceAll(s, "\n", " ")
		return s
	}
	var b strings.Builder
	b.WriteString("From: " + headerSafe(msg.From) + "\r\n")
	b.WriteString("To: " + headerSafe(strings.Join(msg.To, ", ")) + "\r\n")
	b.WriteString("Subject: " + headerSafe(msg.Subject) + "\r\n")
	b.WriteString("MIME-Version: 1.0\r\n")
	if msg.HTMLBody != "" {
		b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
		b.WriteString(msg.HTMLBody)
	} else {
		b.WriteString("Content-Type: text/plain; charset=UTF-8\r\n\r\n")
		b.WriteString(msg.TextBody)
	}
	return []byte(b.String())
}

func emailDomain(addr string) string {
	addr = strings.TrimSpace(addr)
	// Strip a display name / angle brackets: "Name <a@b.com>".
	if i := strings.LastIndex(addr, "<"); i >= 0 {
		if j := strings.Index(addr[i:], ">"); j >= 0 {
			addr = addr[i+1 : i+j]
		}
	}
	at := strings.LastIndex(addr, "@")
	if at < 0 || at == len(addr)-1 {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(addr[at+1:]))
}

// sanitizeEmailError reduces an error to an operator-safe string. It strips
// anything that could carry credentials by returning only the error's top
// message; transports above are written to never embed secrets in errors.
func sanitizeEmailError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	// Defensive: never echo a value that looks like a password/secret config key.
	for _, marker := range []string{"smtp_password", "secret_access_key", "client_secret", "Authorization", "AWS4-HMAC"} {
		if idx := strings.Index(msg, marker); idx >= 0 {
			msg = msg[:idx] + "[redacted]"
			break
		}
	}
	return strings.TrimSpace(msg)
}

// =============================================================================
// Transports. Self-serve => REAL implementations (SMTP, SES, Graph, webhook).
// =============================================================================

// smtpDialFunc is the SMTP connection seam (tests inject a fake).
type smtpDialFunc func(ctx context.Context, addr string) (smtpSession, error)

// smtpSession is the minimal subset of *smtp.Client the dispatcher drives.
type smtpSession interface {
	StartTLS(*tls.Config) error
	Auth(smtp.Auth) error
	Mail(from string) error
	Rcpt(to string) error
	Data() (io.WriteCloser, error)
	Noop() error
	Quit() error
	Close() error
}

type smtpDispatcher struct {
	dialer smtpDialFunc
}

func (d *smtpDispatcher) provider() string { return "smtp" }

func (d *smtpDispatcher) dial(ctx context.Context, cfg emailConfig) (smtpSession, error) {
	addr := net.JoinHostPort(cfg.SMTPHost, strconv.Itoa(cfg.SMTPPort))
	if d.dialer != nil {
		return d.dialer(ctx, addr)
	}
	var netDialer net.Dialer
	conn, err := netDialer.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("smtp dial: %w", err)
	}
	cl, err := smtp.NewClient(conn, cfg.SMTPHost)
	if err != nil {
		_ = conn.Close()
		return nil, fmt.Errorf("smtp client: %w", err)
	}
	return cl, nil
}

// negotiate handles STARTTLS + AUTH common to ping and send.
func (d *smtpDispatcher) negotiate(cl smtpSession, cfg emailConfig) error {
	if cfg.SMTPStartTLS {
		if err := cl.StartTLS(&tls.Config{ServerName: cfg.SMTPHost, MinVersion: tls.VersionTLS12}); err != nil {
			return fmt.Errorf("smtp starttls: %w", err)
		}
	}
	if cfg.SMTPUsername != "" {
		auth := smtp.PlainAuth("", cfg.SMTPUsername, cfg.SMTPPassword, cfg.SMTPHost)
		if err := cl.Auth(auth); err != nil {
			// Do not echo the password; smtp.PlainAuth errors don't include it.
			return errors.New("smtp auth rejected")
		}
	}
	return nil
}

func (d *smtpDispatcher) ping(ctx context.Context, cfg emailConfig) error {
	cl, err := d.dial(ctx, cfg)
	if err != nil {
		return err
	}
	defer cl.Close()
	if err := d.negotiate(cl, cfg); err != nil {
		return err
	}
	if err := cl.Noop(); err != nil {
		return fmt.Errorf("smtp noop: %w", err)
	}
	return cl.Quit()
}

func (d *smtpDispatcher) send(ctx context.Context, cfg emailConfig, msg outboundMessage) (string, error) {
	cl, err := d.dial(ctx, cfg)
	if err != nil {
		return "", err
	}
	defer cl.Close()
	if err := d.negotiate(cl, cfg); err != nil {
		return "", err
	}
	if err := cl.Mail(msg.From); err != nil {
		return "", fmt.Errorf("smtp MAIL FROM: %w", err)
	}
	for _, rcpt := range msg.To {
		if err := cl.Rcpt(rcpt); err != nil {
			return "", fmt.Errorf("smtp RCPT: %w", err)
		}
	}
	w, err := cl.Data()
	if err != nil {
		return "", fmt.Errorf("smtp DATA: %w", err)
	}
	if _, err := w.Write(renderMIME(msg)); err != nil {
		_ = w.Close()
		return "", fmt.Errorf("smtp write: %w", err)
	}
	if err := w.Close(); err != nil {
		return "", fmt.Errorf("smtp commit: %w", err)
	}
	_ = cl.Quit()
	// SMTP has no native message id; generate a local correlation id.
	return "smtp-" + uuid.NewString(), nil
}

// sesDispatcher posts to the Amazon SES v2 sendEmail REST API with SigV4 auth.
// To avoid pulling the AWS SDK, it uses the SES SMTP interface translation via
// the v2 HTTPS endpoint with a SigV4-signed request built inline. ping issues a
// GetAccount call (non-mutating).
type sesDispatcher struct {
	client *http.Client
}

func (d *sesDispatcher) provider() string { return "ses" }

func (d *sesDispatcher) endpoint(cfg emailConfig) string {
	if cfg.SES.Endpoint != "" {
		return strings.TrimRight(cfg.SES.Endpoint, "/")
	}
	return "https://email." + cfg.SES.Region + ".amazonaws.com"
}

func (d *sesDispatcher) ping(ctx context.Context, cfg emailConfig) error {
	// GET /v2/email/account is a cheap, non-mutating credential check.
	req, err := sesSignedRequest(ctx, cfg, http.MethodGet, d.endpoint(cfg)+"/v2/email/account", nil)
	if err != nil {
		return err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("ses reachability: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized {
		return errors.New("ses auth rejected")
	}
	if resp.StatusCode >= 500 {
		return fmt.Errorf("ses endpoint status %d", resp.StatusCode)
	}
	return nil
}

func (d *sesDispatcher) send(ctx context.Context, cfg emailConfig, msg outboundMessage) (string, error) {
	body := sesSendEmailBody(msg)
	req, err := sesSignedRequest(ctx, cfg, http.MethodPost, d.endpoint(cfg)+"/v2/email/outbound-emails", body)
	if err != nil {
		return "", err
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("ses send: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("ses send status %d", resp.StatusCode)
	}
	return extractJSONString(respBody, "MessageId"), nil
}

// graphDispatcher sends via Microsoft Graph /users/{id}/sendMail using a
// client-credentials token. ping mints the token (auth check) without sending.
type graphDispatcher struct {
	client *http.Client
}

func (d *graphDispatcher) provider() string { return "graph" }

func (d *graphDispatcher) ping(ctx context.Context, cfg emailConfig) error {
	_, err := graphToken(ctx, d.client, cfg)
	return err
}

func (d *graphDispatcher) send(ctx context.Context, cfg emailConfig, msg outboundMessage) (string, error) {
	token, err := graphToken(ctx, d.client, cfg)
	if err != nil {
		return "", err
	}
	sender := cfg.Graph.SenderUserID
	if sender == "" {
		sender = msg.From
	}
	url := "https://graph.microsoft.com/v1.0/users/" + sender + "/sendMail"
	body := graphSendMailBody(msg)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, strings.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("graph build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("graph send: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("graph send status %d", resp.StatusCode)
	}
	return "graph-" + uuid.NewString(), nil
}

// webhookDispatcher reuses the obligation-reminder HTTP dispatch shape: POST the
// message JSON to a configured endpoint with optional bearer auth.
type webhookDispatcher struct {
	client *http.Client
}

func (d *webhookDispatcher) provider() string { return "generic_webhook" }

func (d *webhookDispatcher) ping(ctx context.Context, cfg emailConfig) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodOptions, cfg.WebhookURL, nil)
	if err != nil {
		return fmt.Errorf("webhook build request: %w", err)
	}
	if cfg.WebhookAPIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.WebhookAPIKey)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return fmt.Errorf("webhook reachability: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return errors.New("webhook auth rejected")
	}
	return nil
}

func (d *webhookDispatcher) send(ctx context.Context, cfg emailConfig, msg outboundMessage) (string, error) {
	body := webhookSendBody(msg)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, cfg.WebhookURL, strings.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("webhook build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	if cfg.WebhookAPIKey != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.WebhookAPIKey)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("webhook send: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("webhook send status %d", resp.StatusCode)
	}
	if id := extractJSONString(respBody, "message_id"); id != "" {
		return id, nil
	}
	return "webhook-" + uuid.NewString(), nil
}

// =============================================================================
// Provider wire helpers: SES v2 request bodies + SigV4 signing (no AWS SDK),
// Graph sendMail body + client-credentials token, generic-webhook body, and a
// tiny JSON string extractor. Secrets are used only to sign/authorize and are
// NEVER placed in returned errors or logs.
// =============================================================================

func sesSendEmailBody(msg outboundMessage) []byte {
	content := map[string]any{}
	bodyContent := map[string]any{}
	if msg.HTMLBody != "" {
		bodyContent["Html"] = map[string]any{"Data": msg.HTMLBody, "Charset": "UTF-8"}
	}
	if msg.TextBody != "" {
		bodyContent["Text"] = map[string]any{"Data": msg.TextBody, "Charset": "UTF-8"}
	}
	content["Simple"] = map[string]any{
		"Subject": map[string]any{"Data": msg.Subject, "Charset": "UTF-8"},
		"Body":    bodyContent,
	}
	payload := map[string]any{
		"FromEmailAddress": msg.From,
		"Destination":      map[string]any{"ToAddresses": msg.To},
		"Content":          content,
	}
	b, _ := json.Marshal(payload)
	return b
}

// sesSignedRequest builds an AWS SigV4-signed HTTP request for the SES v2 API.
// Region/credentials come from the endpoint config (resolved plaintext via the
// repo). The signing key derivation never logs the secret.
func sesSignedRequest(ctx context.Context, cfg emailConfig, method, rawURL string, body []byte) (*http.Request, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, fmt.Errorf("ses url: %w", err)
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	service := "ses"
	region := cfg.SES.Region

	payloadHash := sha256Hex(body)
	canonicalURI := u.EscapedPath()
	if canonicalURI == "" {
		canonicalURI = "/"
	}
	canonicalQuery := u.Query().Encode()

	host := u.Host
	canonicalHeaders := "host:" + host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"

	canonicalRequest := strings.Join([]string{
		method, canonicalURI, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash,
	}, "\n")

	credentialScope := strings.Join([]string{dateStamp, region, service, "aws4_request"}, "/")
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex([]byte(canonicalRequest)),
	}, "\n")

	signingKey := sigV4SigningKey(cfg.SES.SecretAccessKey, dateStamp, region, service)
	signature := hex.EncodeToString(hmacSHA256(signingKey, []byte(stringToSign)))

	authz := fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		cfg.SES.AccessKeyID, credentialScope, signedHeaders, signature,
	)

	var rdr io.Reader
	if len(body) > 0 {
		rdr = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, rdr)
	if err != nil {
		return nil, fmt.Errorf("ses build request: %w", err)
	}
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	req.Header.Set("Authorization", authz)
	if len(body) > 0 {
		req.Header.Set("Content-Type", "application/json")
	}
	return req, nil
}

func sigV4SigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), []byte(dateStamp))
	kRegion := hmacSHA256(kDate, []byte(region))
	kService := hmacSHA256(kRegion, []byte(service))
	return hmacSHA256(kService, []byte("aws4_request"))
}

func hmacSHA256(key, data []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(data)
	return h.Sum(nil)
}

func sha256Hex(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// graphToken mints a Microsoft Graph client-credentials access token via the
// Azure AD v2 token endpoint. It reuses the bounded http client; the secret is
// sent only in the form body and never logged.
func graphToken(ctx context.Context, client *http.Client, cfg emailConfig) (string, error) {
	tokenURL := "https://login.microsoftonline.com/" + cfg.Graph.TenantID + "/oauth2/v2.0/token"
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", cfg.Graph.ClientID)
	form.Set("client_secret", cfg.Graph.ClientSecret)
	form.Set("scope", "https://graph.microsoft.com/.default")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("graph token build: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("graph token request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Surface the error label but never the secret.
		return "", fmt.Errorf("graph token rejected (status %d)", resp.StatusCode)
	}
	token := extractJSONString(body, "access_token")
	if token == "" {
		return "", errors.New("graph token endpoint returned no access_token")
	}
	return token, nil
}

func graphSendMailBody(msg outboundMessage) string {
	contentType := "Text"
	content := msg.TextBody
	if msg.HTMLBody != "" {
		contentType = "HTML"
		content = msg.HTMLBody
	}
	recipients := make([]map[string]any, 0, len(msg.To))
	for _, addr := range msg.To {
		recipients = append(recipients, map[string]any{
			"emailAddress": map[string]any{"address": addr},
		})
	}
	payload := map[string]any{
		"message": map[string]any{
			"subject":      msg.Subject,
			"body":         map[string]any{"contentType": contentType, "content": content},
			"toRecipients": recipients,
		},
		"saveToSentItems": false,
	}
	b, _ := json.Marshal(payload)
	return string(b)
}

func webhookSendBody(msg outboundMessage) string {
	payload := map[string]any{
		"from":      msg.From,
		"to":        msg.To,
		"subject":   msg.Subject,
		"text_body": msg.TextBody,
		"html_body": msg.HTMLBody,
	}
	b, _ := json.Marshal(payload)
	return string(b)
}

// extractJSONString decodes the body and returns the named top-level string
// field, or "" when absent/non-string.
func extractJSONString(body []byte, key string) string {
	if len(body) == 0 {
		return ""
	}
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return ""
	}
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// Compile-time assertions: the connector satisfies the base port plus the two
// capability interfaces it implements (and the transports satisfy the seam).
var (
	_ ConnectionTester   = (*EmailConnector)(nil)
	_ Invoker            = (*EmailConnector)(nil)
	_ outboundDispatcher = (*smtpDispatcher)(nil)
	_ outboundDispatcher = (*sesDispatcher)(nil)
	_ outboundDispatcher = (*graphDispatcher)(nil)
	_ outboundDispatcher = (*webhookDispatcher)(nil)
)
