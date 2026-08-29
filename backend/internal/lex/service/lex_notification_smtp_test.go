package service

import (
	"bytes"
	"context"
	"crypto/tls"
	"io"
	"net/smtp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// fakeSMTPSession records the SMTP conversation the dispatcher drives so the test
// can assert envelope + rendered message without a live mail server.
type fakeSMTPSession struct {
	startTLS  bool
	authTried bool
	from      string
	rcpts     []string
	data      bytes.Buffer
	quit      bool
	closed    bool
}

func (f *fakeSMTPSession) StartTLS(*tls.Config) error { f.startTLS = true; return nil }
func (f *fakeSMTPSession) Auth(smtp.Auth) error       { f.authTried = true; return nil }
func (f *fakeSMTPSession) Mail(from string) error     { f.from = from; return nil }
func (f *fakeSMTPSession) Rcpt(to string) error       { f.rcpts = append(f.rcpts, to); return nil }
func (f *fakeSMTPSession) Data() (io.WriteCloser, error) {
	return nopWriteCloser{&f.data}, nil
}
func (f *fakeSMTPSession) Quit() error  { f.quit = true; return nil }
func (f *fakeSMTPSession) Close() error { f.closed = true; return nil }

type nopWriteCloser struct{ io.Writer }

func (nopWriteCloser) Close() error { return nil }

func newTestInboxItem() model.NotificationInboxItem {
	action := "/lex/contracts/abc"
	return model.NotificationInboxItem{
		ID:        uuid.New(),
		TenantID:  uuid.New(),
		Category:  model.NotificationCategoryContract,
		Title:     forms.LocalizedText{EN: "Contract expiry", AR: "انتهاء صلاحية العقد"},
		Body:      forms.LocalizedText{EN: "A contract is approaching its expiry date.", AR: "يقترب أحد العقود من تاريخ انتهائه."},
		ActionURL: &action,
	}
}

func TestSMTPLexEmailDispatcherSendsBilingualMessage(t *testing.T) {
	var session *fakeSMTPSession
	disp, err := NewSMTPLexEmailDispatcher(SMTPLexEmailDispatcherConfig{
		Host: "localhost",
		Port: 1025,
		From: "lex@clario360.sa",
		Dialer: func(_ context.Context, _ string) (smtpLexSession, error) {
			session = &fakeSMTPSession{}
			return session, nil
		},
	})
	if err != nil {
		t.Fatalf("NewSMTPLexEmailDispatcher() error = %v", err)
	}

	item := newTestInboxItem()
	tenantID := uuid.New()
	recipientID := uuid.New()
	now := time.Date(2026, 7, 18, 9, 0, 0, 0, time.UTC)

	proof, err := disp.DispatchNotificationEmail(context.Background(), tenantID, item, recipientID, "Owner@Example.com", now)
	if err != nil {
		t.Fatalf("DispatchNotificationEmail() error = %v", err)
	}
	if session == nil {
		t.Fatal("dialer was not invoked")
	}
	if session.from != "lex@clario360.sa" {
		t.Fatalf("MAIL FROM = %q, want lex@clario360.sa", session.from)
	}
	if len(session.rcpts) != 1 || session.rcpts[0] != "Owner@Example.com" {
		t.Fatalf("RCPT = %v, want [Owner@Example.com]", session.rcpts)
	}
	if session.authTried {
		t.Fatal("Auth attempted without a username configured")
	}
	if !session.quit {
		t.Fatal("session was not gracefully QUIT")
	}

	raw := session.data.String()
	if !strings.Contains(raw, "multipart/alternative") {
		t.Error("message is not multipart/alternative")
	}
	if !strings.Contains(raw, "A contract is approaching its expiry date.") {
		t.Error("EN body missing from message")
	}
	if !strings.Contains(raw, "يقترب أحد العقود من تاريخ انتهائه.") {
		t.Error("AR body missing from message")
	}
	if !strings.Contains(raw, "dir=\"rtl\"") {
		t.Error("AR HTML block is not marked dir=\"rtl\"")
	}
	if !strings.Contains(raw, "To: Owner@Example.com") {
		t.Error("To header missing recipient address")
	}
	for _, want := range []string{"#005E5E", "#06352F", "#FDFFF6", "#D1D8D5"} {
		if !strings.Contains(raw, want) {
			t.Errorf("message is missing Clario palette color %s", want)
		}
	}
	if strings.Contains(raw, "#1B5E20") {
		t.Error("message contains the legacy CTA color")
	}

	if proof["delivery_status"] != "sent" {
		t.Errorf("delivery_status = %v, want sent", proof["delivery_status"])
	}
	if proof["recipient_email"] != "Owner@Example.com" {
		t.Errorf("recipient_email = %v, want Owner@Example.com", proof["recipient_email"])
	}
	if proof["provider_adapter"] != "smtp" {
		t.Errorf("provider_adapter = %v, want smtp", proof["provider_adapter"])
	}
}

func TestSMTPLexEmailDispatcherAuthAndStartTLS(t *testing.T) {
	var session *fakeSMTPSession
	disp, err := NewSMTPLexEmailDispatcher(SMTPLexEmailDispatcherConfig{
		Host:     "smtp.relay.example",
		Port:     587,
		From:     "lex@clario360.sa",
		Username: "apikey",
		Password: "secret",
		StartTLS: true,
		Dialer: func(_ context.Context, _ string) (smtpLexSession, error) {
			session = &fakeSMTPSession{}
			return session, nil
		},
	})
	if err != nil {
		t.Fatalf("NewSMTPLexEmailDispatcher() error = %v", err)
	}
	if _, err := disp.DispatchNotificationEmail(context.Background(), uuid.New(), newTestInboxItem(), uuid.New(), "u@example.com", time.Now()); err != nil {
		t.Fatalf("DispatchNotificationEmail() error = %v", err)
	}
	if !session.startTLS {
		t.Error("STARTTLS was not negotiated when TLS enabled")
	}
	if !session.authTried {
		t.Error("Auth was not attempted with a username configured")
	}
}

func TestSMTPLexEmailDispatcherRejectsEmptyRecipient(t *testing.T) {
	disp, err := NewSMTPLexEmailDispatcher(SMTPLexEmailDispatcherConfig{
		Host: "localhost",
		From: "lex@clario360.sa",
		Dialer: func(_ context.Context, _ string) (smtpLexSession, error) {
			t.Fatal("dialer must not be called for an empty recipient")
			return nil, nil
		},
	})
	if err != nil {
		t.Fatalf("NewSMTPLexEmailDispatcher() error = %v", err)
	}
	if _, err := disp.DispatchNotificationEmail(context.Background(), uuid.New(), newTestInboxItem(), uuid.New(), "  ", time.Now()); err == nil {
		t.Fatal("expected error for empty recipient email, got nil")
	}
}

func TestNewSMTPLexEmailDispatcherRequiresHostAndFrom(t *testing.T) {
	if _, err := NewSMTPLexEmailDispatcher(SMTPLexEmailDispatcherConfig{From: "a@b.c"}); err == nil {
		t.Error("expected error when host is empty")
	}
	if _, err := NewSMTPLexEmailDispatcher(SMTPLexEmailDispatcherConfig{Host: "localhost"}); err == nil {
		t.Error("expected error when from is empty")
	}
}
