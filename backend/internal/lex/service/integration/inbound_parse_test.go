package integration

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"testing"
)

func mailgunBody(secret, timestamp, token string, extra url.Values) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte(token))
	sig := hex.EncodeToString(mac.Sum(nil))
	form := url.Values{}
	form.Set("timestamp", timestamp)
	form.Set("token", token)
	form.Set("signature", sig)
	for k, vs := range extra {
		for _, v := range vs {
			form.Add(k, v)
		}
	}
	return []byte(form.Encode())
}

func formHeader() http.Header {
	h := http.Header{}
	h.Set("Content-Type", "application/x-www-form-urlencoded")
	return h
}

func TestParseInboundProvider(t *testing.T) {
	for _, name := range []string{"mailgun", "SendGrid", " postmark ", "SES"} {
		if _, ok := ParseInboundProvider(name); !ok {
			t.Fatalf("ParseInboundProvider(%q) = not ok, want ok", name)
		}
	}
	if _, ok := ParseInboundProvider("gmail"); ok {
		t.Fatalf("ParseInboundProvider(gmail) = ok, want not ok")
	}
}

func TestVerifyAndNormalizeMailgun(t *testing.T) {
	secret := "mg-signing-key"
	body := mailgunBody(secret, "1700000000", "tok-123", url.Values{
		"sender":     {"Requester@Example.com"},
		"recipient":  {"legal@othaim.demo"},
		"subject":    {"Contract review please"},
		"body-plain": {"Body text"},
		"Message-Id": {"<abc@mg>"},
	})
	msg, err := VerifyAndNormalizeInbound(InboundProviderMailgun, secret, formHeader(), body)
	if err != nil {
		t.Fatalf("VerifyAndNormalizeInbound() error = %v", err)
	}
	if msg.MessageID != "<abc@mg>" || msg.To != "legal@othaim.demo" || msg.Subject != "Contract review please" {
		t.Fatalf("normalized message = %+v", msg)
	}
	if !strings.EqualFold(msg.From, "Requester@Example.com") {
		t.Fatalf("from = %q", msg.From)
	}
}

func TestVerifyAndNormalizeMailgunBadSignature(t *testing.T) {
	body := mailgunBody("the-real-secret", "1700000000", "tok-123", nil)
	_, err := VerifyAndNormalizeInbound(InboundProviderMailgun, "a-different-secret", formHeader(), body)
	if !errors.Is(err, ErrInboundSignatureInvalid) {
		t.Fatalf("err = %v, want ErrInboundSignatureInvalid", err)
	}
}

func TestVerifyAndNormalizeEmptySecretFailsClosed(t *testing.T) {
	body := mailgunBody("s", "1700000000", "t", nil)
	if _, err := VerifyAndNormalizeInbound(InboundProviderMailgun, "", formHeader(), body); !errors.Is(err, ErrInboundSignatureInvalid) {
		t.Fatalf("empty secret err = %v, want ErrInboundSignatureInvalid", err)
	}
}

func TestVerifyAndNormalizePostmarkSharedSecret(t *testing.T) {
	secret := "pm-inbound-secret"
	raw := []byte(`{
		"MessageID":"pm-1",
		"From":"requester@example.com",
		"To":"legal@othaim.demo",
		"Subject":"NDA",
		"TextBody":"please review",
		"Attachments":[{"Name":"nda.pdf","ContentType":"application/pdf","Content":"` +
		base64.StdEncoding.EncodeToString([]byte("PDFDATA")) + `"}]
	}`)
	h := http.Header{}
	h.Set("X-Clario-Inbound-Secret", secret)
	msg, err := VerifyAndNormalizeInbound(InboundProviderPostmark, secret, h, raw)
	if err != nil {
		t.Fatalf("postmark error = %v", err)
	}
	if msg.MessageID != "pm-1" || msg.Body != "please review" || len(msg.Attachments) != 1 {
		t.Fatalf("postmark msg = %+v", msg)
	}
	if msg.Attachments[0].Filename != "nda.pdf" {
		t.Fatalf("attachment = %+v", msg.Attachments[0])
	}

	// Wrong secret fails closed.
	bad := http.Header{}
	bad.Set("X-Clario-Inbound-Secret", "nope")
	if _, err := VerifyAndNormalizeInbound(InboundProviderPostmark, secret, bad, raw); !errors.Is(err, ErrInboundSignatureInvalid) {
		t.Fatalf("wrong secret err = %v, want ErrInboundSignatureInvalid", err)
	}
}

func TestVerifyAndNormalizePostmarkBasicAuth(t *testing.T) {
	secret := "pm-secret"
	raw := []byte(`{"MessageID":"pm-2","To":"legal@othaim.demo"}`)
	h := http.Header{}
	h.Set("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte("intake:"+secret)))
	if _, err := VerifyAndNormalizeInbound(InboundProviderPostmark, secret, h, raw); err != nil {
		t.Fatalf("basic-auth postmark error = %v", err)
	}
}

func TestVerifyAndNormalizeSendgridForm(t *testing.T) {
	secret := "sg-secret"
	form := url.Values{
		"from":    {"requester@example.com"},
		"to":      {"legal@othaim.demo"},
		"subject": {"Litigation support"},
		"text":    {"details"},
		"headers": {"Received: from x\nMessage-ID: <sg-42@sendgrid>\nSubject: Litigation support"},
	}
	h := formHeader()
	h.Set("X-Clario-Inbound-Secret", secret)
	msg, err := VerifyAndNormalizeInbound(InboundProviderSendgrid, secret, h, []byte(form.Encode()))
	if err != nil {
		t.Fatalf("sendgrid error = %v", err)
	}
	if msg.MessageID != "<sg-42@sendgrid>" || msg.To != "legal@othaim.demo" || msg.Body != "details" {
		t.Fatalf("sendgrid msg = %+v", msg)
	}
}

func TestVerifyAndNormalizeSES(t *testing.T) {
	secret := "ses-secret"
	inner := `{"mail":{"messageId":"ses-9","commonHeaders":{"from":["requester@example.com"],"to":["legal@othaim.demo"],"subject":"Consultation"}}}`
	// SNS carries the SES notification as a JSON string in Message.
	raw := []byte(`{"Type":"Notification","Message":` + strconvQuote(inner) + `}`)
	h := http.Header{}
	h.Set("X-Inbound-Secret", secret)
	msg, err := VerifyAndNormalizeInbound(InboundProviderSES, secret, h, raw)
	if err != nil {
		t.Fatalf("ses error = %v", err)
	}
	if msg.MessageID != "ses-9" || msg.From != "requester@example.com" || msg.Subject != "Consultation" {
		t.Fatalf("ses msg = %+v", msg)
	}
}

func TestVerifyAndNormalizeUnsupportedProvider(t *testing.T) {
	if _, err := VerifyAndNormalizeInbound(InboundProvider("gmail"), "s", http.Header{}, []byte("{}")); !errors.Is(err, ErrInboundProviderUnsupported) {
		t.Fatalf("err = %v, want ErrInboundProviderUnsupported", err)
	}
}

// strconvQuote JSON-quotes a string for embedding as a nested SNS Message.
func strconvQuote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '"':
			b.WriteString(`\"`)
		case '\\':
			b.WriteString(`\\`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}
