package channel

import (
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/unsubscribe"
)

const testUnsubSecret = "unit-test-unsubscribe-secret-abcdefghij"

// TestUnsubscribeHeaders asserts the RFC 8058 headers are emitted only when a
// URL is present, in the correct one-click form.
func TestUnsubscribeHeaders(t *testing.T) {
	if got := unsubscribeHeaders(""); got != nil {
		t.Fatalf("expected no headers for empty URL, got %v", got)
	}
	got := unsubscribeHeaders("https://app.example.com/api/v1/notifications/unsubscribe?token=abc")
	if got["List-Unsubscribe"] != "<https://app.example.com/api/v1/notifications/unsubscribe?token=abc>" {
		t.Fatalf("unexpected List-Unsubscribe: %q", got["List-Unsubscribe"])
	}
	if got["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Fatalf("unexpected List-Unsubscribe-Post: %q", got["List-Unsubscribe-Post"])
	}
}

// TestBuildMIMEMessageWithHeaders_IncludesUnsubscribe asserts the headers land
// in the message header block (before MIME-Version) and the legacy no-header
// builder is unaffected.
func TestBuildMIMEMessageWithHeaders_IncludesUnsubscribe(t *testing.T) {
	raw := string(buildMIMEMessageWithHeaders(
		"a@b.com", "c@d.com", "Subj", "text", "<p>html</p>",
		map[string]string{
			"List-Unsubscribe":      "<https://x/unsub?token=t>",
			"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
		},
	))
	if !strings.Contains(raw, "List-Unsubscribe: <https://x/unsub?token=t>\r\n") {
		t.Fatalf("List-Unsubscribe header missing:\n%s", raw)
	}
	if !strings.Contains(raw, "List-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n") {
		t.Fatalf("List-Unsubscribe-Post header missing:\n%s", raw)
	}
	// Header must appear before the MIME-Version line (i.e. in the header block).
	if strings.Index(raw, "List-Unsubscribe:") > strings.Index(raw, "MIME-Version:") {
		t.Fatal("List-Unsubscribe must precede MIME-Version (be in the header block)")
	}

	// Legacy builder emits no such header.
	legacy := string(buildMIMEMessage("a@b.com", "c@d.com", "Subj", "text", "<p>html</p>"))
	if strings.Contains(legacy, "List-Unsubscribe") {
		t.Fatal("legacy buildMIMEMessage should not emit List-Unsubscribe")
	}
}

// TestEmailChannel_UnsubscribeURL asserts the signed URL is produced only when
// configured and that the embedded token verifies back to the recipient.
func TestEmailChannel_UnsubscribeURL(t *testing.T) {
	notif := &model.Notification{TenantID: "t1", UserID: "u1", Type: model.NotifAlertCreated}

	// Unconfigured → empty.
	unconfigured := NewEmailChannel(EmailConfig{Provider: "smtp"}, nil, zerolog.Nop())
	if url := unconfigured.unsubscribeURL(notif); url != "" {
		t.Fatalf("expected empty URL when unconfigured, got %q", url)
	}

	// Configured → signed URL whose token verifies.
	configured := NewEmailChannel(EmailConfig{
		Provider:           "smtp",
		UnsubscribeBaseURL: "https://app.example.com/api/v1/notifications/unsubscribe",
		UnsubscribeSecret:  testUnsubSecret,
	}, nil, zerolog.Nop())

	url := configured.unsubscribeURL(notif)
	if !strings.HasPrefix(url, "https://app.example.com/api/v1/notifications/unsubscribe?token=") {
		t.Fatalf("unexpected unsubscribe URL: %q", url)
	}
	token := url[strings.Index(url, "token=")+len("token="):]
	claims, err := unsubscribe.Verify(testUnsubSecret, token)
	if err != nil {
		t.Fatalf("token from URL failed to verify: %v", err)
	}
	if claims.TenantID != "t1" || claims.UserID != "u1" || claims.Type != string(model.NotifAlertCreated) {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}
