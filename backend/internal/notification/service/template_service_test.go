package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

func newTestTemplateService() *TemplateService {
	return NewTemplateService(zerolog.Nop())
}

func TestTemplateService_RenderEmail_AlertCreated(t *testing.T) {
	svc := newTestTemplateService()

	notif := &model.Notification{
		ID:       "notif-1",
		Type:     model.NotifAlertCreated,
		Category: model.CategorySecurity,
		Priority: model.PriorityCritical,
		Title:    "Critical Alert",
		Body:     "Ransomware detected on server-01",
		Data:     json.RawMessage(`{"action_url": "/cyber/alerts/123"}`),
	}

	subject, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if subject == "" {
		t.Error("expected non-empty subject")
	}
	if !strings.Contains(body, "Security Alert") {
		t.Error("expected body to contain 'Security Alert'")
	}
	if !strings.Contains(body, "Clario 360") {
		t.Error("expected body to contain layout branding")
	}
}

func TestTemplateService_RenderEmail_Generic(t *testing.T) {
	svc := newTestTemplateService()

	notif := &model.Notification{
		ID:       "notif-2",
		Type:     model.NotifPasswordExpiring,
		Category: model.CategorySystem,
		Priority: model.PriorityMedium,
		Title:    "Password Expiring",
		Body:     "Your password will expire in 7 days.",
		Data:     json.RawMessage(`{}`),
	}

	subject, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if subject != "Password Expiring" {
		t.Errorf("expected subject 'Password Expiring', got %q", subject)
	}
	if !strings.Contains(body, "Password Expiring") {
		t.Error("expected generic template to contain title")
	}
	if !strings.Contains(body, `lang="en" dir="ltr"`) {
		t.Error("expected English layout direction by default")
	}
}

func TestTemplateService_RenderEmail_UsesClarioBrandPalette(t *testing.T) {
	svc := newTestTemplateService()
	notif := &model.Notification{
		ID:       "notif-brand-palette",
		Type:     model.NotifPasswordExpiring,
		Category: model.CategorySystem,
		Priority: model.PriorityMedium,
		Title:    "Password Expiring",
		Body:     "Your password will expire soon.",
		Data:     json.RawMessage(`{"action_url":"/settings/security"}`),
	}

	_, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, want := range []string{"#005E5E", "#06352F", "#FDFFF6", "#6C7874", "#D1D8D5"} {
		if !strings.Contains(body, want) {
			t.Errorf("expected rendered email to contain Clario palette color %s", want)
		}
	}
	for _, legacy := range []string{"#1B5E20", "#C6A962"} {
		if strings.Contains(body, legacy) {
			t.Errorf("rendered email contains legacy brand color %s", legacy)
		}
	}

	notif.Type = model.NotifContractExpiring
	_, body, err = svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("unexpected contract email error: %v", err)
	}
	if !strings.Contains(body, "#ABB705") {
		t.Error("expected contract email to contain the La Rioja accent")
	}
}

func TestTemplateService_RenderEmail_SubjectKeepsRenderedTitleWithPayloadTitle(t *testing.T) {
	svc := newTestTemplateService()

	notif := &model.Notification{
		ID:       "notif-title-1",
		Type:     model.NotifPipelineFailed,
		Category: model.CategoryData,
		Priority: model.PriorityHigh,
		Title:    "Pipeline Failed: Daily Sync",
		Body:     "Pipeline Daily Sync failed.",
		Data:     json.RawMessage(`{"title": "Daily Sync", "pipeline_name": "Daily Sync"}`),
	}

	subject, _, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if subject != "Pipeline Failed: Daily Sync" {
		t.Fatalf("expected rendered notification title to remain subject, got %q", subject)
	}
}

func TestTemplateService_RenderEmail_ArabicLocale(t *testing.T) {
	svc := newTestTemplateService()

	notif := &model.Notification{
		ID:       "notif-ar-1",
		Type:     model.NotifAlertCreated,
		Category: model.CategorySecurity,
		Priority: model.PriorityHigh,
		Title:    "Security Alert",
		Body:     "Malware was detected on server-01",
		Data: json.RawMessage(`{
			"locale": "ar-SA",
			"title_ar": "تنبيه أمني",
			"body_ar": "تم اكتشاف برمجية خبيثة على الخادم server-01",
			"action_url": "/cyber/alerts/123"
		}`),
	}

	subject, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if subject != "تنبيه أمني" {
		t.Fatalf("expected Arabic subject, got %q", subject)
	}
	for _, want := range []string{
		`lang="ar" dir="rtl"`,
		"تنبيه أمني",
		"الأولوية",
		"تم اكتشاف برمجية خبيثة",
		"عرض التنبيه",
		"جميع الحقوق محفوظة",
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("expected Arabic email body to contain %q", want)
		}
	}
}

func TestTemplateService_RenderEmail_ArabicLocalizedMaps(t *testing.T) {
	svc := newTestTemplateService()

	notif := &model.Notification{
		ID:       "notif-ar-2",
		Type:     model.NotifPasswordExpiring,
		Category: model.CategorySystem,
		Priority: model.PriorityMedium,
		Title:    "Password Expiring",
		Body:     "Your password will expire soon.",
		Data: json.RawMessage(`{
			"locale": "ar",
			"title": {"en": "Password Expiring", "ar": "انتهاء صلاحية كلمة المرور"},
			"body": {"en": "Your password will expire soon.", "ar": "ستنتهي صلاحية كلمة المرور قريبًا."},
			"action_url": "/settings/security"
		}`),
	}

	subject, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if subject != "انتهاء صلاحية كلمة المرور" {
		t.Fatalf("expected Arabic subject from localized map, got %q", subject)
	}
	if !strings.Contains(body, "ستنتهي صلاحية كلمة المرور قريبًا.") {
		t.Fatal("expected Arabic body from localized map")
	}
	if !strings.Contains(body, "عرض التفاصيل") {
		t.Fatal("expected Arabic generic action label")
	}
}

func TestTemplateService_RenderText(t *testing.T) {
	svc := newTestTemplateService()

	result, err := svc.RenderText("Hello {{.name}}, your task is {{.task}}", map[string]interface{}{
		"name": "Alice",
		"task": "Review Q4 Report",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if result != "Hello Alice, your task is Review Q4 Report" {
		t.Errorf("unexpected result: %s", result)
	}
}

func TestTemplateService_RenderText_MissingKey(t *testing.T) {
	svc := newTestTemplateService()

	// Missing keys in Go templates render as <no value> by default.
	result, err := svc.RenderText("Hello {{.name}}", map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if result == "" {
		t.Error("expected non-empty result even with missing key")
	}
}
