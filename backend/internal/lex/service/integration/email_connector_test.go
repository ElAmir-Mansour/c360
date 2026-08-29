package integration

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net/smtp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// CAP-174 — Email connector self-serve SMTP path.
//
// The UAT harness for this connector is Mailpit (an SMTP sink with STARTTLS +
// optional AUTH). These tests round-trip a FAKE smtpDialer that records the
// SMTP conversation exactly as a real *smtp.Client would drive it, so we can
// prove TestConnection (a non-mutating NOOP ping) and the "send" op without a
// live MTA. They also assert the honest-health invariant (D4): an UNCONFIGURED
// connector reports NOT reachable — it never fabricates a healthy verdict.
// =============================================================================

// fakeSMTPSession is a recording in-memory smtpSession (the minimal subset of
// *smtp.Client the dispatcher drives). It mirrors a Mailpit-style sink: it
// accepts STARTTLS/AUTH/MAIL/RCPT/DATA and captures the written message so the
// test can assert the round-trip. A failAuth flag simulates a credential
// rejection so the honest "auth rejected" path is exercised.
type fakeSMTPSession struct {
	startTLS   bool
	authCalled bool
	failAuth   bool
	noopCalled bool
	quit       bool
	closed     bool

	mailFrom string
	rcpts    []string
	data     bytes.Buffer
}

func (s *fakeSMTPSession) StartTLS(_ *tls.Config) error { s.startTLS = true; return nil }

func (s *fakeSMTPSession) Auth(_ smtp.Auth) error {
	s.authCalled = true
	if s.failAuth {
		return errors.New("535 authentication failed")
	}
	return nil
}

func (s *fakeSMTPSession) Mail(from string) error { s.mailFrom = from; return nil }

func (s *fakeSMTPSession) Rcpt(to string) error { s.rcpts = append(s.rcpts, to); return nil }

// nopWriteCloser adapts the recording buffer to the io.WriteCloser the DATA
// phase expects.
type nopWriteCloser struct{ w io.Writer }

func (n nopWriteCloser) Write(p []byte) (int, error) { return n.w.Write(p) }
func (n nopWriteCloser) Close() error                { return nil }

func (s *fakeSMTPSession) Data() (io.WriteCloser, error) { return nopWriteCloser{w: &s.data}, nil }

func (s *fakeSMTPSession) Noop() error  { s.noopCalled = true; return nil }
func (s *fakeSMTPSession) Quit() error  { s.quit = true; return nil }
func (s *fakeSMTPSession) Close() error { s.closed = true; return nil }

// recordingDialer hands out a single fakeSMTPSession and records the dialed
// address, so a test can both inject behaviour and inspect the conversation.
type recordingDialer struct {
	session *fakeSMTPSession
	dialed  string
	dialErr error
	dialCnt int
}

func (d *recordingDialer) dial(_ context.Context, addr string) (smtpSession, error) {
	d.dialCnt++
	d.dialed = addr
	if d.dialErr != nil {
		return nil, d.dialErr
	}
	return d.session, nil
}

// stubMailboxRepo is a minimal emailMailboxRepo: it returns a single active
// inbound mailbox (with an ingest secret) so a "both"/inbound endpoint can grade
// its inbound leg without a database. The crypto is left nil in these tests, so
// the connector treats a non-empty IngestSecretHash as a present (legacy
// plaintext) secret.
type stubMailboxRepo struct {
	rows []model.IntakeMailbox
	err  error
}

func (r *stubMailboxRepo) List(_ context.Context, _ uuid.UUID, _ model.IntakeMailboxListFilters) ([]model.IntakeMailbox, int, error) {
	if r.err != nil {
		return nil, 0, r.err
	}
	return r.rows, len(r.rows), nil
}

// newSMTPTestConnector builds an EmailConnector wired to the recording dialer.
// No endpoint repo is needed (the connector reads config off the passed
// endpoint, not via List), and the mailbox repo is optional per-test.
func newSMTPTestConnector(dialer smtpDialFunc, mailboxes emailMailboxRepo) *EmailConnector {
	return NewEmailConnector(EmailConnectorConfig{
		Mailboxes:  mailboxes,
		Logger:     zerolog.Nop(),
		SMTPDialer: dialer,
	})
}

func smtpEndpoint(status model.IntegrationStatus, config map[string]any) model.IntegrationEndpoint {
	return model.IntegrationEndpoint{
		ID:       uuid.New(),
		TenantID: uuid.New(),
		Kind:     model.IntegrationKindEmail,
		Code:     "email-smtp-test",
		Status:   status,
		Config:   config,
	}
}

// outboundSMTPConfig is a self-serve SMTP outbound endpoint config (Mailpit
// shape: host/port + STARTTLS + AUTH).
func outboundSMTPConfig() map[string]any {
	return map[string]any{
		"direction":     "outbound",
		"provider":      "smtp",
		"smtp_host":     "127.0.0.1",
		"smtp_port":     1025,
		"smtp_username": "uat",
		"smtp_password": "uat-secret",
		"smtp_starttls": true,
		"from_address":  "legal@aalothaim.test",
	}
}

// -----------------------------------------------------------------------------
// TestConnection — outbound SMTP ping drives the real STARTTLS+AUTH+NOOP+QUIT
// conversation against the fake (Mailpit) session and reports reachable.
// -----------------------------------------------------------------------------

func TestEmailTestConnection_SMTPOutboundReachable(t *testing.T) {
	sess := &fakeSMTPSession{}
	dialer := &recordingDialer{session: sess}
	conn := newSMTPTestConnector(dialer.dial, nil)

	ep := smtpEndpoint(model.IntegrationStatusActive, outboundSMTPConfig())

	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection returned transport error: %v", err)
	}
	if !res.Reachable {
		t.Fatalf("expected reachable outbound SMTP, got not reachable: %q", res.Detail)
	}
	if dialer.dialed != "127.0.0.1:1025" {
		t.Fatalf("expected dial to 127.0.0.1:1025, got %q", dialer.dialed)
	}
	// The ping must be a NON-mutating check: STARTTLS + AUTH + NOOP + QUIT, and
	// it must NOT send any mail (no MAIL/RCPT/DATA).
	if !sess.startTLS {
		t.Fatalf("expected STARTTLS to be negotiated")
	}
	if !sess.authCalled {
		t.Fatalf("expected AUTH to be attempted")
	}
	if !sess.noopCalled {
		t.Fatalf("expected NOOP probe")
	}
	if sess.mailFrom != "" || len(sess.rcpts) != 0 || sess.data.Len() != 0 {
		t.Fatalf("ping must not send mail; saw MAIL=%q RCPT=%v DATA=%d", sess.mailFrom, sess.rcpts, sess.data.Len())
	}
	if !strings.Contains(res.Detail, "auth ok") {
		t.Fatalf("expected outbound auth ok detail, got %q", res.Detail)
	}
}

// TestConnection must report the honest "auth rejected" verdict (Reachable=false,
// nil error) when the provider refuses the credentials — not a 500.
func TestEmailTestConnection_SMTPAuthRejected_HonestNotReachable(t *testing.T) {
	sess := &fakeSMTPSession{failAuth: true}
	dialer := &recordingDialer{session: sess}
	conn := newSMTPTestConnector(dialer.dial, nil)

	ep := smtpEndpoint(model.IntegrationStatusActive, outboundSMTPConfig())

	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("auth rejection should be a result, not a transport error: %v", err)
	}
	if res.Reachable {
		t.Fatalf("expected NOT reachable on auth rejection, got reachable: %q", res.Detail)
	}
	if !strings.Contains(res.Detail, "auth rejected") {
		t.Fatalf("expected sanitized 'auth rejected' detail, got %q", res.Detail)
	}
	// The sanitized detail must NEVER echo the password.
	if strings.Contains(res.Detail, "uat-secret") {
		t.Fatalf("detail leaked the smtp password: %q", res.Detail)
	}
}

// -----------------------------------------------------------------------------
// Invoke "send" — drives the full SMTP conversation (MAIL/RCPT/DATA) against the
// fake session and asserts the message round-trips, with a provider message id.
// -----------------------------------------------------------------------------

func TestEmailInvokeSend_SMTPRoundTrip(t *testing.T) {
	sess := &fakeSMTPSession{}
	dialer := &recordingDialer{session: sess}
	conn := newSMTPTestConnector(dialer.dial, nil)

	ep := smtpEndpoint(model.IntegrationStatusActive, outboundSMTPConfig())

	res, err := conn.Invoke(context.Background(), ep, "send", map[string]any{
		"to":      []string{"counsel@aalothaim.test", "ops@aalothaim.test"},
		"subject": "Obligation reminder",
		"body":    "Renewal due in 7 days.",
	})
	if err != nil {
		t.Fatalf("Invoke send: %v", err)
	}
	if !res.Success {
		t.Fatalf("expected send success, got %+v", res)
	}
	if !strings.HasPrefix(res.Reference, "smtp-") {
		t.Fatalf("expected smtp- provider message id, got %q", res.Reference)
	}
	if res.Output["recipient_count"] != 2 {
		t.Fatalf("expected recipient_count 2, got %v", res.Output["recipient_count"])
	}

	// The SMTP envelope must have been driven correctly.
	if sess.mailFrom != "legal@aalothaim.test" {
		t.Fatalf("MAIL FROM = %q, want legal@aalothaim.test", sess.mailFrom)
	}
	if len(sess.rcpts) != 2 || sess.rcpts[0] != "counsel@aalothaim.test" || sess.rcpts[1] != "ops@aalothaim.test" {
		t.Fatalf("RCPT list = %v, want both recipients", sess.rcpts)
	}
	wire := sess.data.String()
	for _, want := range []string{
		"From: legal@aalothaim.test",
		"To: counsel@aalothaim.test, ops@aalothaim.test",
		"Subject: Obligation reminder",
		"Renewal due in 7 days.",
	} {
		if !strings.Contains(wire, want) {
			t.Fatalf("rendered message missing %q; got:\n%s", want, wire)
		}
	}
	if !sess.quit {
		t.Fatalf("expected QUIT after send")
	}
}

// A send with a missing required field (no subject) is a validation error, not a
// dial — the connector must reject before opening an SMTP session.
func TestEmailInvokeSend_ValidationFailsBeforeDial(t *testing.T) {
	dialer := &recordingDialer{session: &fakeSMTPSession{}}
	conn := newSMTPTestConnector(dialer.dial, nil)

	ep := smtpEndpoint(model.IntegrationStatusActive, outboundSMTPConfig())

	res, err := conn.Invoke(context.Background(), ep, "send", map[string]any{
		"to":   "counsel@aalothaim.test",
		"body": "no subject here",
	})
	if err == nil || res.Success {
		t.Fatalf("expected validation failure for missing subject, got %+v", res)
	}
	if dialer.dialCnt != 0 {
		t.Fatalf("validation must fail before dialing; dialCnt=%d", dialer.dialCnt)
	}
}

// -----------------------------------------------------------------------------
// Honest health (D4). An UNCONFIGURED connector reports NOT reachable. Two
// shapes: (a) a "planned" endpoint never probes; (b) an "active" endpoint with
// no transport config cannot build a dispatcher and grades not-reachable —
// never a fabricated healthy verdict.
// -----------------------------------------------------------------------------

func TestEmailProbe_PlannedEndpointNotReachable(t *testing.T) {
	dialer := &recordingDialer{session: &fakeSMTPSession{}}
	conn := newSMTPTestConnector(dialer.dial, nil)

	ep := smtpEndpoint(model.IntegrationStatusPlanned, outboundSMTPConfig())

	h := conn.Probe(context.Background(), ep, time.Unix(1_700_000_000, 0).UTC())
	if h.Reachable {
		t.Fatalf("a planned endpoint must report NOT reachable")
	}
	if dialer.dialCnt != 0 {
		t.Fatalf("a planned endpoint must not be probed over the wire; dialCnt=%d", dialer.dialCnt)
	}
	if !strings.Contains(h.Detail, "planned") {
		t.Fatalf("expected 'planned' detail, got %q", h.Detail)
	}
}

func TestEmailTestConnection_UnconfiguredNotReachable(t *testing.T) {
	dialer := &recordingDialer{session: &fakeSMTPSession{}}
	conn := newSMTPTestConnector(dialer.dial, nil)

	// Active but with NO transport config: an outbound SMTP endpoint with no
	// smtp_host cannot build a dispatcher. This is the honest "unconfigured"
	// case — it must grade not-reachable, not healthy.
	ep := smtpEndpoint(model.IntegrationStatusActive, map[string]any{
		"direction": "outbound",
		"provider":  "smtp",
	})

	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("unconfigured probe should be a result, not a transport error: %v", err)
	}
	if res.Reachable {
		t.Fatalf("an unconfigured connector must report NOT reachable, got reachable: %q", res.Detail)
	}
	if dialer.dialCnt != 0 {
		t.Fatalf("an unconfigured endpoint must not dial; dialCnt=%d", dialer.dialCnt)
	}
	if !strings.Contains(res.Detail, "smtp_host is required") {
		t.Fatalf("expected 'smtp_host is required' detail, got %q", res.Detail)
	}
}

// -----------------------------------------------------------------------------
// Inbound leg (the existing HMAC-verified intake webhook is INVENTORIED, not
// re-implemented). A "both" endpoint is reachable only when BOTH legs pass: the
// outbound SMTP ping AND an active intake mailbox with an ingest secret.
// -----------------------------------------------------------------------------

func TestEmailTestConnection_BothLegsPass(t *testing.T) {
	sess := &fakeSMTPSession{}
	dialer := &recordingDialer{session: sess}
	mailboxes := &stubMailboxRepo{rows: []model.IntakeMailbox{{
		ID:               uuid.New(),
		Address:          "intake@aalothaim.test",
		IngestSecretHash: "shared-ingest-secret",
		Active:           true,
	}}}
	conn := newSMTPTestConnector(dialer.dial, mailboxes)

	cfg := outboundSMTPConfig()
	cfg["direction"] = "both"
	cfg["inbound_mailbox_address"] = "intake@aalothaim.test"
	ep := smtpEndpoint(model.IntegrationStatusActive, cfg)

	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if !res.Reachable {
		t.Fatalf("expected reachable when both legs pass, got %q", res.Detail)
	}
	if res.SampleCount != 1 {
		t.Fatalf("expected 1 active mailbox with secret, got SampleCount=%d", res.SampleCount)
	}
	if !strings.Contains(res.Detail, "HMAC secret present") {
		t.Fatalf("expected inbound HMAC secret confirmation, got %q", res.Detail)
	}
}

// When the inbound leg is unconfigured (no mailbox repo wired), a "both"
// endpoint must NOT be reachable even though the outbound leg is fine — honest
// health requires both legs.
func TestEmailTestConnection_BothLeg_InboundUnverifiableNotReachable(t *testing.T) {
	sess := &fakeSMTPSession{}
	dialer := &recordingDialer{session: sess}
	conn := newSMTPTestConnector(dialer.dial, nil) // nil mailbox repo

	cfg := outboundSMTPConfig()
	cfg["direction"] = "both"
	ep := smtpEndpoint(model.IntegrationStatusActive, cfg)

	res, err := conn.TestConnection(context.Background(), ep)
	if err != nil {
		t.Fatalf("TestConnection: %v", err)
	}
	if res.Reachable {
		t.Fatalf("a 'both' endpoint with an unverifiable inbound leg must NOT be reachable: %q", res.Detail)
	}
	if !strings.Contains(res.Detail, "inbound") {
		t.Fatalf("expected an inbound failure detail, got %q", res.Detail)
	}
}

// Kind sanity: the connector self-reports the email kind.
func TestEmailConnector_Kind(t *testing.T) {
	conn := newSMTPTestConnector((&recordingDialer{session: &fakeSMTPSession{}}).dial, nil)
	if conn.Kind() != model.IntegrationKindEmail {
		t.Fatalf("Kind() = %q, want email", conn.Kind())
	}
}
