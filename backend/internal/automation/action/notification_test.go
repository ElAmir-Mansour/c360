package action

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

func TestNotification_PublishesExactEvent(t *testing.T) {
	t.Parallel()

	pub := &fakePublisher{}
	exec, err := NewNotificationExecutor(pub)
	if err != nil {
		t.Fatalf("NewNotificationExecutor: %v", err)
	}

	step := actionStep(model.ActionNotification, map[string]any{
		"event_type": "automation.runbook.completed",
		"payload": map[string]any{
			"severity": "critical",
			"title":    "Runbook done",
		},
	})
	out, err := exec.Execute(tenantCtx(), step)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	if pub.count() != 1 {
		t.Fatalf("published %d, want 1", pub.count())
	}
	got, _ := pub.last()
	if got.topic != events.Topics.NotificationEvents {
		t.Errorf("topic = %q, want %q", got.topic, events.Topics.NotificationEvents)
	}
	wantType := "com.clario360.automation.runbook.completed"
	if got.event.Type != wantType {
		t.Errorf("event type = %q, want %q", got.event.Type, wantType)
	}
	if got.event.TenantID != testTenant {
		t.Errorf("tenant = %q, want %q", got.event.TenantID, testTenant)
	}
	var data map[string]any
	if err := json.Unmarshal(got.event.Data, &data); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if data["severity"] != "critical" || data["title"] != "Runbook done" {
		t.Errorf("data = %v", data)
	}
	if out.Data["published"] != true || out.Data["topic"] != events.Topics.NotificationEvents {
		t.Errorf("output = %v", out.Data)
	}
}

func TestNotification_MissingEventType(t *testing.T) {
	t.Parallel()
	exec, _ := NewNotificationExecutor(&fakePublisher{})
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionNotification, map[string]any{"payload": map[string]any{"x": 1}}))
	if err == nil || !strings.Contains(err.Error(), "event_type") {
		t.Fatalf("want event_type error, got %v", err)
	}
}

func TestNotification_PublishErrorIsRetryable(t *testing.T) {
	t.Parallel()
	pub := &fakePublisher{err: permanentErr("bus unreachable")}
	exec, _ := NewNotificationExecutor(pub)
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionNotification, map[string]any{"event_type": "x"}))
	if err == nil || !IsRetryable(err) {
		t.Fatalf("publish failure must be retryable, got %v", err)
	}
}

func TestNotification_MissingTenant(t *testing.T) {
	t.Parallel()
	pub := &fakePublisher{}
	exec, _ := NewNotificationExecutor(pub)
	_, err := exec.Execute(t.Context(), actionStep(model.ActionNotification, map[string]any{"event_type": "x"}))
	if err == nil || !strings.Contains(err.Error(), "tenant") {
		t.Fatalf("want tenant error, got %v", err)
	}
	if pub.count() != 0 {
		t.Errorf("must not publish without a tenant")
	}
}

func TestNewNotificationExecutor_NilPublisher(t *testing.T) {
	t.Parallel()
	if _, err := NewNotificationExecutor(nil); err == nil {
		t.Error("expected error for nil publisher")
	}
}
