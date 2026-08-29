package producer_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/clario360/platform/internal/siem/producer"
)

func TestProducer_PublishEvent_OK(t *testing.T) {
	t.Parallel()
	fake := producer.NewFakeProducer()
	p := producer.New(fake, "")

	if err := p.PublishEvent(context.Background(), "test.topic", "siem.test.fired", "tenant-1", map[string]any{"k": 1}); err != nil {
		t.Fatalf("PublishEvent: %v", err)
	}
	if fake.Len() != 1 {
		t.Fatalf("Len=%d, want 1", fake.Len())
	}
	msg := fake.Messages[0]
	if msg.Topic != "test.topic" {
		t.Errorf("topic=%s, want test.topic", msg.Topic)
	}
	if !strings.HasPrefix(msg.Event.Type, "com.clario360.") {
		t.Errorf("event type %q must carry CloudEvents prefix", msg.Event.Type)
	}
	if !strings.HasPrefix(msg.Event.Source, "clario360/") {
		t.Errorf("event source %q must carry clario360/ prefix", msg.Event.Source)
	}
	if msg.Event.TenantID != "tenant-1" {
		t.Errorf("tenantID=%s, want tenant-1", msg.Event.TenantID)
	}
}

func TestProducer_PublishEvent_RejectsEmptyTenant(t *testing.T) {
	t.Parallel()
	p := producer.New(producer.NewFakeProducer(), "")
	err := p.PublishEvent(context.Background(), "t.topic", "siem.test", "", nil)
	if !errors.Is(err, producer.ErrMissingTenantID) {
		t.Fatalf("want ErrMissingTenantID, got %v", err)
	}
}

func TestProducer_PublishEvent_PropagatesInnerError(t *testing.T) {
	t.Parallel()
	fake := producer.NewFakeProducer()
	want := errors.New("kafka boom")
	fake.FailNext(want)

	p := producer.New(fake, "")
	err := p.PublishEvent(context.Background(), "t", "siem.x", "tenant-1", nil)
	if !errors.Is(err, want) {
		t.Fatalf("got %v, want wrap of %v", err, want)
	}
}

func TestProducer_DefaultSource(t *testing.T) {
	t.Parallel()
	p := producer.New(producer.NewFakeProducer(), "")
	if p.Source() != "clario360/siem-service" {
		t.Errorf("default Source=%q", p.Source())
	}
}

func TestProducer_CustomSource(t *testing.T) {
	t.Parallel()
	p := producer.New(producer.NewFakeProducer(), "clario360/custom")
	if p.Source() != "clario360/custom" {
		t.Errorf("Source=%q", p.Source())
	}
}

func TestProducer_NilInner(t *testing.T) {
	t.Parallel()
	p := producer.New(nil, "")
	if err := p.PublishEvent(context.Background(), "t", "siem.x", "t1", nil); err == nil {
		t.Error("expected error with nil inner")
	}
	// Close must not panic.
	if err := p.Close(); err != nil {
		t.Errorf("Close with nil inner = %v", err)
	}
}

func TestProducer_CloseFakeRejectsPublish(t *testing.T) {
	t.Parallel()
	fake := producer.NewFakeProducer()
	p := producer.New(fake, "")
	if err := p.Close(); err != nil {
		t.Fatal(err)
	}
	if err := p.PublishEvent(context.Background(), "t", "siem.x", "t1", nil); err == nil {
		t.Error("publish on closed producer should error")
	}
}
