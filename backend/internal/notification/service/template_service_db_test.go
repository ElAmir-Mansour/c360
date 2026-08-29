package service

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/notification/model"
)

// fakeTemplateStore serves a canned template for configured (tenant, id) keys
// and reports found=false otherwise, so RenderEmail must fall back to the
// embedded Go const.
type fakeTemplateStore struct {
	byKey map[string]*model.TemplateConfig // key = tenant|id
	calls int
}

func (f *fakeTemplateStore) GetEmailTemplate(ctx context.Context, tenantID, templateID string) (*model.TemplateConfig, bool, error) {
	f.calls++
	if t, ok := f.byKey[tenantID+"|"+templateID]; ok {
		return t, true, nil
	}
	return nil, false, nil
}

// TestRenderEmail_DBTemplateOverride asserts a stored DB template for the tenant
// is used in place of the embedded const.
func TestRenderEmail_DBTemplateOverride(t *testing.T) {
	svc := newTestTemplateService()
	store := &fakeTemplateStore{byKey: map[string]*model.TemplateConfig{
		"t1|alert.created": {
			ID:       "alert.created",
			Channel:  model.ChannelEmail,
			BodyTmpl: `<h2>CUSTOM DB ALERT</h2><p>{{.body}}</p>`,
		},
	}}
	svc.SetStore(store)

	notif := &model.Notification{
		ID:       "n1",
		TenantID: "t1",
		Type:     model.NotifAlertCreated,
		Category: model.CategorySecurity,
		Priority: model.PriorityHigh,
		Title:    "Alert",
		Body:     "Ransomware detected",
		Data:     json.RawMessage(`{}`),
	}

	_, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("RenderEmail: %v", err)
	}
	if !strings.Contains(body, "CUSTOM DB ALERT") {
		t.Fatal("expected DB template body to be used")
	}
	if strings.Contains(body, "Security Alert") {
		t.Fatal("did not expect the embedded const heading when a DB override exists")
	}
	// Layout wrapping + escaping still apply.
	if !strings.Contains(body, "Clario 360") {
		t.Fatal("expected DB template to still be wrapped in the base layout")
	}
	if !strings.Contains(body, "Ransomware detected") {
		t.Fatal("expected the rendered body content")
	}
}

// TestRenderEmail_FallsBackToConstWhenNoDBRow asserts that when the store has no
// row for the (tenant, type) the embedded const template renders unchanged.
func TestRenderEmail_FallsBackToConstWhenNoDBRow(t *testing.T) {
	svc := newTestTemplateService()
	store := &fakeTemplateStore{byKey: map[string]*model.TemplateConfig{}} // empty
	svc.SetStore(store)

	notif := &model.Notification{
		ID:       "n2",
		TenantID: "t1",
		Type:     model.NotifAlertCreated,
		Category: model.CategorySecurity,
		Priority: model.PriorityHigh,
		Title:    "Alert",
		Body:     "Ransomware detected",
		Data:     json.RawMessage(`{}`),
	}

	_, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("RenderEmail: %v", err)
	}
	if store.calls == 0 {
		t.Fatal("expected the store to be consulted")
	}
	if !strings.Contains(body, "Security Alert") {
		t.Fatal("expected fall-back to the embedded const template heading")
	}
	if strings.Contains(body, "CUSTOM DB ALERT") {
		t.Fatal("did not expect any DB content when no row exists")
	}
}

// TestRenderEmail_NilStoreUsesConst asserts the const path is unchanged when no
// store is wired at all (backward compatibility).
func TestRenderEmail_NilStoreUsesConst(t *testing.T) {
	svc := newTestTemplateService() // no SetStore

	notif := &model.Notification{
		ID:       "n3",
		TenantID: "t1",
		Type:     model.NotifAlertCreated,
		Category: model.CategorySecurity,
		Priority: model.PriorityHigh,
		Title:    "Alert",
		Body:     "Ransomware detected",
		Data:     json.RawMessage(`{}`),
	}

	_, body, err := svc.RenderEmail(notif)
	if err != nil {
		t.Fatalf("RenderEmail: %v", err)
	}
	if !strings.Contains(body, "Security Alert") {
		t.Fatal("expected const template heading with a nil store")
	}
}
