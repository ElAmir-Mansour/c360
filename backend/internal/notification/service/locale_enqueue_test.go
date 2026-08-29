package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

// TestResolveRecipientLocale_Precedence verifies the enqueue-time locale
// resolution order: explicit RecipientLocale, then a producer-provided Data
// key, else the KSA default — never the actor's request.
func TestResolveRecipientLocale_Precedence(t *testing.T) {
	cases := []struct {
		name string
		req  CreateNotificationRequest
		want string
	}{
		{
			name: "explicit recipient locale wins and normalizes",
			req:  CreateNotificationRequest{RecipientLocale: "ar-SA", Data: map[string]interface{}{"locale": "en"}},
			want: "ar",
		},
		{
			name: "producer data locale key",
			req:  CreateNotificationRequest{Data: map[string]interface{}{"locale": "en-US"}},
			want: "en",
		},
		{
			name: "preferred_locale data key",
			req:  CreateNotificationRequest{Data: map[string]interface{}{"preferred_locale": "ar"}},
			want: "ar",
		},
		{
			name: "no signal defaults to KSA Arabic",
			req:  CreateNotificationRequest{},
			want: defaultRecipientLocale,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveRecipientLocale(tc.req); got != tc.want {
				t.Fatalf("resolveRecipientLocale = %q, want %q", got, tc.want)
			}
		})
	}
	if defaultRecipientLocale != "ar" {
		t.Fatalf("KSA default recipient locale must be Arabic, got %q", defaultRecipientLocale)
	}
}

// TestRenderEmail_ArabicFontStackAndDir asserts the RTL layout carries both the
// dir="rtl" attribute and an Arabic-safe font stack (emitted verbatim, not
// mangled by html/template's CSS sanitizer) when the recipient locale is ar.
func TestRenderEmail_ArabicFontStackAndDir(t *testing.T) {
	svc := NewTemplateService(zerolog.Nop())
	notif := &model.Notification{
		ID:       "notif-font-ar",
		Type:     model.NotifAlertCreated,
		Category: model.CategorySecurity,
		Priority: model.PriorityHigh,
		Title:    "Security Alert",
		Body:     "Malware detected",
		Data:     json.RawMessage(`{"preferred_locale": "ar"}`),
	}

	_, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("RenderEmail: %v", err)
	}
	for _, want := range []string{`dir="rtl"`, "Noto Sans Arabic", "Tahoma"} {
		if !strings.Contains(body, want) {
			t.Fatalf("Arabic email body must contain %q; got:\n%s", want, body)
		}
	}
	if strings.Contains(body, "ZgotmplZ") {
		t.Fatal("font stack was rejected by html/template CSS sanitizer (ZgotmplZ)")
	}

	// The English default keeps its original Arial stack and LTR direction.
	en := &model.Notification{
		ID: "notif-font-en", Type: model.NotifAlertCreated, Category: model.CategorySecurity,
		Priority: model.PriorityHigh, Title: "Security Alert", Body: "Malware detected",
		Data: json.RawMessage(`{"locale": "en"}`),
	}
	_, enBody, err := svc.RenderEmail(en)
	if err != nil {
		t.Fatalf("RenderEmail(en): %v", err)
	}
	if !strings.Contains(enBody, `dir="ltr"`) || !strings.Contains(enBody, "Arial, sans-serif") {
		t.Fatal("English layout must remain LTR with the Arial stack")
	}
}
