package consumer

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

type pauseCall struct {
	tenantID uuid.UUID
	reason   string
}

type fakePauser struct {
	calls  []pauseCall
	paused int64
	err    error
}

func (f *fakePauser) PauseTenantStreams(_ context.Context, tenantID uuid.UUID, reason string) (int64, error) {
	f.calls = append(f.calls, pauseCall{tenantID: tenantID, reason: reason})
	if f.err != nil {
		return 0, f.err
	}
	return f.paused, nil
}

func licenseEvent(t *testing.T, eventType string, tenantID uuid.UUID) *events.Event {
	t.Helper()
	event, err := events.NewEvent(eventType, "license-service", tenantID.String(), map[string]any{"status": "suspended"})
	if err != nil {
		t.Fatalf("NewEvent: %v", err)
	}
	return event
}

func TestConsumerLicenseSuspendedPausesTenantStreams(t *testing.T) {
	tenantID := uuid.New()
	pauser := &fakePauser{paused: 2}
	consumer := New(pauser, zerolog.Nop())

	if err := consumer.Handle(context.Background(), licenseEvent(t, "license.suspended", tenantID)); err != nil {
		t.Fatalf("Handle: %v", err)
	}

	if len(pauser.calls) != 1 {
		t.Fatalf("pause calls = %d, want 1", len(pauser.calls))
	}
	if pauser.calls[0].tenantID != tenantID {
		t.Fatalf("tenant id = %s, want %s", pauser.calls[0].tenantID, tenantID)
	}
	if pauser.calls[0].reason != EventLicenseSuspended {
		t.Fatalf("reason = %q, want %q", pauser.calls[0].reason, EventLicenseSuspended)
	}
}

func TestConsumerLicenseExpiredPausesTenantStreams(t *testing.T) {
	tenantID := uuid.New()
	pauser := &fakePauser{}
	consumer := New(pauser, zerolog.Nop())

	if err := consumer.Handle(context.Background(), licenseEvent(t, "license.expired", tenantID)); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(pauser.calls) != 1 || pauser.calls[0].reason != EventLicenseExpired {
		t.Fatalf("pause calls = %+v, want license expired pause", pauser.calls)
	}
}

func TestConsumerIgnoresUnknownAndMissingTenantEvents(t *testing.T) {
	tenantID := uuid.New()
	pauser := &fakePauser{}
	consumer := New(pauser, zerolog.Nop())

	if err := consumer.Handle(context.Background(), licenseEvent(t, "license.assigned", tenantID)); err != nil {
		t.Fatalf("Handle unknown: %v", err)
	}
	missingTenant := licenseEvent(t, "license.suspended", tenantID)
	missingTenant.TenantID = ""
	if err := consumer.Handle(context.Background(), missingTenant); err != nil {
		t.Fatalf("Handle missing tenant: %v", err)
	}
	if len(pauser.calls) != 0 {
		t.Fatalf("pause calls = %d, want 0", len(pauser.calls))
	}
}

func TestConsumerPropagatesPauseErrorsForRetry(t *testing.T) {
	tenantID := uuid.New()
	consumer := New(&fakePauser{err: errors.New("db down")}, zerolog.Nop())

	if err := consumer.Handle(context.Background(), licenseEvent(t, "license.suspended", tenantID)); err == nil {
		t.Fatal("expected pause error to propagate")
	}
}

func TestConsumerTopicsCoverLicenseEvents(t *testing.T) {
	consumer := New(&fakePauser{}, zerolog.Nop())
	topics := consumer.Topics()
	if len(topics) != 1 || topics[0] != events.Topics.LicenseEvents {
		t.Fatalf("Topics = %v, want [%s]", topics, events.Topics.LicenseEvents)
	}
	types := consumer.EventTypes()
	if len(types) != 2 || types[0] != EventLicenseSuspended || types[1] != EventLicenseExpired {
		t.Fatalf("EventTypes = %v", types)
	}
}
