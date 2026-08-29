package handler

import (
	"net/http"
	"strings"
	"testing"
)

func TestDecodeIntakeEmailWebhookRequestSingleObjectAndSizeGuard(t *testing.T) {
	body := `{"message_id":"m-1","from":"sender@example.com","to":"legal@example.com","subject":"Contract","body":"Please review."}`
	raw, req, err := decodeIntakeEmailWebhookRequest(newIntakeWebhookRequest(body))
	if err != nil {
		t.Fatalf("decodeIntakeEmailWebhookRequest() error = %v", err)
	}
	if string(raw) != body || req.MessageID != "m-1" || req.To != "legal@example.com" {
		t.Fatalf("decoded raw=%q req=%+v, want original body and request", string(raw), req)
	}

	if _, _, err := decodeIntakeEmailWebhookRequest(newIntakeWebhookRequest(body + body)); err == nil {
		t.Fatal("decodeIntakeEmailWebhookRequest(two objects) error = nil, want error")
	}

	tooLarge := strings.Repeat("x", intakeWebhookMaxBody+1)
	if _, _, err := decodeIntakeEmailWebhookRequest(newIntakeWebhookRequest(tooLarge)); err == nil {
		t.Fatal("decodeIntakeEmailWebhookRequest(too large) error = nil, want error")
	}
}

func newIntakeWebhookRequest(body string) *http.Request {
	req, _ := http.NewRequest(http.MethodPost, "/api/v1/lex/intake/email/webhook", strings.NewReader(body))
	return req
}
