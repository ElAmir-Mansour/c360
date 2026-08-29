package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

func digestSourceNotifs() []model.Notification {
	return []model.Notification{
		{Title: "Contract expiring", Body: "ACME MSA expires in 3 days", Data: json.RawMessage(`{"email":"ada@example.com","locale":"en"}`)},
		{Title: "Task assigned", Body: "Review the redline", Data: json.RawMessage(`{}`)},
	}
}

// TestBuildDigestNotification_DispatchesEmailWhenAddressPresent asserts the
// digest carries the resolved email (so it will be dispatched) and packs the
// count/items/dashboard payload the digest template consumes.
func TestBuildDigestNotification_DispatchesEmailWhenAddressPresent(t *testing.T) {
	svc := NewDigestService(nil, nil, nil, nil, 8, 1, "https://app.clario360.com/", zerolog.Nop())

	notif, hasEmail, err := svc.buildDigestNotification("t1", "u1", digestSourceNotifs(), "daily")
	if err != nil {
		t.Fatalf("buildDigestNotification: %v", err)
	}
	if !hasEmail {
		t.Fatal("expected email dispatch because a source notification carries an address")
	}
	if notif.Type != "digest" {
		t.Fatalf("digest notif type = %q, want digest (so the digest template is selected)", notif.Type)
	}

	var data map[string]interface{}
	if err := json.Unmarshal(notif.Data, &data); err != nil {
		t.Fatalf("unmarshal digest data: %v", err)
	}
	if data["email"] != "ada@example.com" {
		t.Fatalf("digest email = %v, want ada@example.com", data["email"])
	}
	if got := data["count"]; got != float64(2) {
		t.Fatalf("digest count = %v, want 2", got)
	}
	if url, _ := data["dashboard_url"].(string); !strings.HasPrefix(url, "https://app.clario360.com/notifications") {
		t.Fatalf("dashboard_url = %q, want app URL + /notifications", url)
	}
}

// TestBuildDigestNotification_NoEmailSkipsDispatch asserts that when no source
// notification has an address, the digest is in-app only (no email dispatch).
func TestBuildDigestNotification_NoEmailSkipsDispatch(t *testing.T) {
	svc := NewDigestService(nil, nil, nil, nil, 8, 1, "https://app.clario360.com", zerolog.Nop())

	notifs := []model.Notification{{Title: "x", Body: "y", Data: json.RawMessage(`{}`)}}
	_, hasEmail, err := svc.buildDigestNotification("t1", "u1", notifs, "weekly")
	if err != nil {
		t.Fatalf("buildDigestNotification: %v", err)
	}
	if hasEmail {
		t.Fatal("expected no email dispatch when no source notification carries an address")
	}
}

// TestDigestEmailRenders asserts the assembled digest notification renders into
// an HTML email whose body includes the unread count and each item title —
// verifying the digest email content the dispatcher sends.
func TestDigestEmailRenders(t *testing.T) {
	svc := NewDigestService(nil, nil, nil, nil, 8, 1, "https://app.clario360.com", zerolog.Nop())
	notif, _, err := svc.buildDigestNotification("t1", "u1", digestSourceNotifs(), "daily")
	if err != nil {
		t.Fatalf("buildDigestNotification: %v", err)
	}

	tmpl := NewTemplateService(zerolog.Nop())
	subject, body, err := tmpl.RenderEmail(notif)
	if err != nil {
		t.Fatalf("RenderEmail: %v", err)
	}
	if strings.TrimSpace(subject) == "" {
		t.Fatal("digest subject must be non-empty")
	}
	for _, want := range []string{"Contract expiring", "Task assigned"} {
		if !strings.Contains(body, want) {
			t.Fatalf("digest HTML body missing item title %q", want)
		}
	}
	// The digest template shows the unread count.
	if !strings.Contains(body, "2") {
		t.Fatal("digest HTML body should include the unread count")
	}

	text, err := tmpl.RenderEmailText(notif)
	if err != nil || strings.TrimSpace(text) == "" {
		t.Fatalf("digest text alternative should render: text=%q err=%v", text, err)
	}
}

// TestFirstNotificationEmail exercises the address/locale extraction helpers.
func TestFirstNotificationEmail(t *testing.T) {
	notifs := []model.Notification{
		{Data: json.RawMessage(`{}`)},
		{Data: json.RawMessage(`{"user_email":"bob@example.com"}`)},
	}
	if got := firstNotificationEmail(notifs); got != "bob@example.com" {
		t.Fatalf("firstNotificationEmail = %q, want bob@example.com", got)
	}
	if got := firstNotificationEmail([]model.Notification{{Data: json.RawMessage(`{}`)}}); got != "" {
		t.Fatalf("firstNotificationEmail = %q, want empty", got)
	}
}
