package action

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

func TestIntegration_PublishesExactEvent(t *testing.T) {
	t.Parallel()

	pub := &fakePublisher{}
	exec, err := NewIntegrationExecutor(pub)
	if err != nil {
		t.Fatalf("NewIntegrationExecutor: %v", err)
	}

	step := actionStep(model.ActionIntegration, map[string]any{
		"event_type": "integration.outbound.requested",
		"payload":    map[string]any{"channel": "slack", "text": "deploy done"},
	})
	out, err := exec.Execute(tenantCtx(), step)
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}

	if pub.count() != 1 {
		t.Fatalf("published %d events, want 1", pub.count())
	}
	got, _ := pub.last()
	if got.topic != events.Topics.IntegrationEvents {
		t.Errorf("topic = %q, want %q", got.topic, events.Topics.IntegrationEvents)
	}
	// NewEvent prefixes the type with com.clario360.
	wantType := "com.clario360.integration.outbound.requested"
	if got.event.Type != wantType {
		t.Errorf("event type = %q, want %q", got.event.Type, wantType)
	}
	if got.event.TenantID != testTenant {
		t.Errorf("event tenant = %q, want %q", got.event.TenantID, testTenant)
	}
	var data map[string]any
	if err := json.Unmarshal(got.event.Data, &data); err != nil {
		t.Fatalf("decode event data: %v", err)
	}
	if data["channel"] != "slack" || data["text"] != "deploy done" {
		t.Errorf("event data = %v, want {channel: slack, text: deploy done}", data)
	}
	if out.Data["event_type"] != wantType || out.Data["published"] != true {
		t.Errorf("output = %v", out.Data)
	}
	if out.Data["event_id"] != got.event.ID {
		t.Errorf("output event_id %v != published id %v", out.Data["event_id"], got.event.ID)
	}
}

func TestIntegration_CustomTopic(t *testing.T) {
	t.Parallel()
	pub := &fakePublisher{}
	exec, _ := NewIntegrationExecutor(pub)
	step := actionStep(model.ActionIntegration, map[string]any{
		"event_type": "alert.raised",
		"topic":      events.Topics.AlertEvents,
		"payload":    map[string]any{"severity": "high"},
	})
	if _, err := exec.Execute(tenantCtx(), step); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	got, _ := pub.last()
	if got.topic != events.Topics.AlertEvents {
		t.Errorf("topic = %q, want %q", got.topic, events.Topics.AlertEvents)
	}
}

func TestIntegration_EmptyPayloadAllowed(t *testing.T) {
	t.Parallel()
	pub := &fakePublisher{}
	exec, _ := NewIntegrationExecutor(pub)
	step := actionStep(model.ActionIntegration, map[string]any{"event_type": "ping"})
	if _, err := exec.Execute(tenantCtx(), step); err != nil {
		t.Fatalf("Execute: %v", err)
	}
	got, _ := pub.last()
	var data map[string]any
	if err := json.Unmarshal(got.event.Data, &data); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(data) != 0 {
		t.Errorf("data = %v, want empty object", data)
	}
}

func TestIntegration_MissingEventType(t *testing.T) {
	t.Parallel()
	exec, _ := NewIntegrationExecutor(&fakePublisher{})
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionIntegration, map[string]any{}))
	if err == nil || !strings.Contains(err.Error(), "event_type") {
		t.Fatalf("want event_type error, got %v", err)
	}
}

func TestIntegration_PublishErrorIsRetryable(t *testing.T) {
	t.Parallel()
	pub := &fakePublisher{err: permanentErr("kafka down")}
	exec, _ := NewIntegrationExecutor(pub)
	_, err := exec.Execute(tenantCtx(), actionStep(model.ActionIntegration, map[string]any{"event_type": "x"}))
	if err == nil || !IsRetryable(err) {
		t.Fatalf("publish failure must be retryable, got %v", err)
	}
}

func TestNewIntegrationExecutor_NilPublisher(t *testing.T) {
	t.Parallel()
	if _, err := NewIntegrationExecutor(nil); err == nil {
		t.Error("expected error for nil publisher")
	}
}
