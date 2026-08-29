package consumer

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/license/model"
	licservice "github.com/clario360/platform/internal/license/service"
)

type meterCall struct {
	tenantID string
	key      string
	delta    int64
	enforce  bool
}

type fakeMeterer struct {
	mu       sync.Mutex
	calls    []meterCall
	decision *model.Decision
	err      error
}

func (f *fakeMeterer) Consume(_ context.Context, tenantID, key string, delta int64, enforce bool) (*model.Decision, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, meterCall{tenantID: tenantID, key: key, delta: delta, enforce: enforce})
	if f.err != nil {
		return nil, f.err
	}
	if f.decision != nil {
		return f.decision, nil
	}
	return &model.Decision{Allowed: true, Key: key}, nil
}

func meteringEvent(t *testing.T, eventType, tenantID string) *events.Event {
	t.Helper()
	event, err := events.NewEvent(eventType, "iam-service", tenantID, map[string]string{"user_id": "u-1"})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	return event
}

func TestMetering_UserCreatedConsumesSeat(t *testing.T) {
	svc := &fakeMeterer{}
	consumer := NewMeteringConsumer(svc, zerolog.Nop())

	event := meteringEvent(t, "iam.user.created", "tenant-1")
	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}

	if len(svc.calls) != 1 {
		t.Fatalf("Consume calls = %d, want 1", len(svc.calls))
	}
	call := svc.calls[0]
	if call.tenantID != "tenant-1" || call.key != licservice.SeatsKey || call.delta != 1 {
		t.Fatalf("Consume call = %+v, want seat +1 for tenant-1", call)
	}
	if call.enforce {
		t.Fatal("metering must not enforce — it records the truth")
	}
}

func TestMetering_UserDeletedReleasesSeat(t *testing.T) {
	svc := &fakeMeterer{}
	consumer := NewMeteringConsumer(svc, zerolog.Nop())

	if err := consumer.Handle(context.Background(), meteringEvent(t, "iam.user.deleted", "tenant-1")); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(svc.calls) != 1 || svc.calls[0].delta != -1 {
		t.Fatalf("Consume calls = %+v, want one seat release", svc.calls)
	}
}

func TestMetering_UnknownEventTypeIgnored(t *testing.T) {
	svc := &fakeMeterer{}
	consumer := NewMeteringConsumer(svc, zerolog.Nop())

	if err := consumer.Handle(context.Background(), meteringEvent(t, "iam.role.created", "tenant-1")); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(svc.calls) != 0 {
		t.Fatalf("Consume calls = %d, want 0 for unmapped event type", len(svc.calls))
	}
}

func TestMetering_MissingTenantSkipped(t *testing.T) {
	svc := &fakeMeterer{}
	consumer := NewMeteringConsumer(svc, zerolog.Nop())

	event := meteringEvent(t, "iam.user.created", "tenant-1")
	event.TenantID = ""
	if err := consumer.Handle(context.Background(), event); err != nil {
		t.Fatalf("Handle() error = %v", err)
	}
	if len(svc.calls) != 0 {
		t.Fatalf("Consume calls = %d, want 0 without tenant", len(svc.calls))
	}
}

func TestMetering_UnlicensedTenantIsNoOp(t *testing.T) {
	svc := &fakeMeterer{decision: &model.Decision{Allowed: false, Reason: "no license assigned"}}
	consumer := NewMeteringConsumer(svc, zerolog.Nop())

	if err := consumer.Handle(context.Background(), meteringEvent(t, "iam.user.created", "tenant-1")); err != nil {
		t.Fatalf("Handle() error = %v — usage before licensing must not dead-letter the event", err)
	}
}

func TestMetering_ServiceErrorPropagatesForRetry(t *testing.T) {
	svc := &fakeMeterer{err: errors.New("database down")}
	consumer := NewMeteringConsumer(svc, zerolog.Nop())

	if err := consumer.Handle(context.Background(), meteringEvent(t, "iam.user.created", "tenant-1")); err == nil {
		t.Fatal("expected error to propagate so consumer middleware retries / dead-letters")
	}
}

func TestMetering_TopicsCoverIAM(t *testing.T) {
	consumer := NewMeteringConsumer(&fakeMeterer{}, zerolog.Nop())
	topics := consumer.Topics()
	if len(topics) != 1 || topics[0] != events.Topics.IAMEvents {
		t.Fatalf("Topics() = %v, want [%s]", topics, events.Topics.IAMEvents)
	}
}
