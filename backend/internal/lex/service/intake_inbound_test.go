package service

import (
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/dto"
)

func TestIntakeSourceProvider(t *testing.T) {
	if got := intakeSourceProvider("mailgun"); got != "provider:mailgun" {
		t.Fatalf("intakeSourceProvider(mailgun) = %q", got)
	}
	if got := intakeSourceProvider("  "); got != "provider" {
		t.Fatalf("intakeSourceProvider(blank) = %q", got)
	}
}

func TestIntakeMessageMetadata(t *testing.T) {
	// Webhook path carries the signing timestamp.
	md := intakeMessageMetadata(intakeSourceWebhook, "1700000000")
	if md["intake_source"] != intakeSourceWebhook {
		t.Fatalf("intake_source = %v", md["intake_source"])
	}
	if md["webhook_timestamp"] != "1700000000" {
		t.Fatalf("webhook_timestamp = %v", md["webhook_timestamp"])
	}
	// Simulated / provider paths omit the timestamp.
	md2 := intakeMessageMetadata(intakeSourceSimulated, "")
	if _, ok := md2["webhook_timestamp"]; ok {
		t.Fatalf("simulated metadata should not carry webhook_timestamp: %v", md2)
	}
	if md2["intake_source"] != intakeSourceSimulated {
		t.Fatalf("intake_source = %v", md2["intake_source"])
	}
}

func TestEmailIntakeRequestMetadataCarriesSource(t *testing.T) {
	sid := uuid.New()
	mbx := uuid.New()
	md := emailIntakeRequestMetadata(&sid, "CONTRACT_REVIEW", mbx, "keyword:review", "msg-1", intakeSourceProvider("ses"))
	if md["intake_source"] != "provider:ses" {
		t.Fatalf("intake_source = %v", md["intake_source"])
	}
	if md["intake_mailbox_id"] != mbx.String() {
		t.Fatalf("intake_mailbox_id = %v", md["intake_mailbox_id"])
	}
	if md["intake_channel"] != "email" {
		t.Fatalf("intake_channel = %v", md["intake_channel"])
	}
}

func TestIntakeSimulateRequestNormalize(t *testing.T) {
	req := dto.IntakeSimulateRequest{
		MessageID: "  msg-9  ",
		From:      "  Requester@Example.COM ",
		Subject:   "  hello  ",
	}
	req.Normalize()
	if req.MessageID != "msg-9" {
		t.Fatalf("MessageID = %q", req.MessageID)
	}
	if req.From != "requester@example.com" {
		t.Fatalf("From = %q", req.From)
	}
	if req.Subject != "hello" {
		t.Fatalf("Subject = %q", req.Subject)
	}
}
