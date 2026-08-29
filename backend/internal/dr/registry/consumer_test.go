package registry

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// fakeRegenerator records regenerateSystem calls so the consumer's event-routing
// logic (group extraction, trigger mapping, skip behaviour) is asserted without
// a database. The generator's actual regeneration logic is covered against the
// real persistence semantics in generator_test.go and against Postgres in the
// integration phase, so this is not a mock-only test of the core behaviour.
type fakeRegenerator struct {
	calls  []regenCall
	result RegenerateResult
	err    error
}

type regenCall struct {
	tenantID string
	groupID  string
	profile  string
	trigger  string
}

func (f *fakeRegenerator) regenerateSystem(_ context.Context, tenantID, groupID, profile, trigger string) (RegenerateResult, error) {
	f.calls = append(f.calls, regenCall{tenantID, groupID, profile, trigger})
	if f.err != nil {
		return RegenerateResult{}, f.err
	}
	return f.result, nil
}

func newTestConsumer(reg regenerator) *Consumer {
	return newConsumer(reg, NewMetrics(nil), zerolog.Nop())
}

func TestConsumer_TriggerMapping(t *testing.T) {
	tests := []struct {
		eventType   string
		wantTrigger string
	}{
		{evtGroupMemberAdded, TriggerMembership},
		{evtGroupMemberRemoved, TriggerMembership},
		{evtGroupCreated, TriggerGroup},
		{evtSiteUpdated, TriggerSite},
		{evtNetworkMappingCreated, TriggerNetworkMapping},
		{evtNetworkMappingUpdated, TriggerNetworkMapping},
		{evtRecoveryPointCreated, TriggerRecoveryPoint},
		{evtRecoveryPointSealed, TriggerRecoveryPoint},
		{evtRecoveryPointValid, TriggerRecoveryPoint},
		{evtRecoveryPointRecorded, TriggerRecoveryPoint},
	}
	for _, tc := range tests {
		t.Run(tc.eventType, func(t *testing.T) {
			fake := &fakeRegenerator{result: RegenerateResult{Version: &RunbookVersion{Version: 2}, Changed: true}}
			c := newTestConsumer(fake)
			evt := &events.Event{
				ID:       "e1",
				Type:     tc.eventType,
				TenantID: "tenant-1",
				Data:     []byte(`{"group_id":"group-1"}`),
			}
			if err := c.Handle(context.Background(), evt); err != nil {
				t.Fatalf("Handle: %v", err)
			}
			if len(fake.calls) != 1 {
				t.Fatalf("expected 1 regenerate call, got %d", len(fake.calls))
			}
			got := fake.calls[0]
			if got.trigger != tc.wantTrigger {
				t.Errorf("trigger = %q, want %q", got.trigger, tc.wantTrigger)
			}
			if got.groupID != "group-1" {
				t.Errorf("groupID = %q, want group-1", got.groupID)
			}
			if got.tenantID != "tenant-1" {
				t.Errorf("tenantID = %q, want tenant-1", got.tenantID)
			}
		})
	}
}

func TestConsumer_IgnoresUnrelatedEventType(t *testing.T) {
	fake := &fakeRegenerator{}
	c := newTestConsumer(fake)
	// Its own runbook.generated event must NOT trigger a regeneration (feedback
	// loop guard), even though it lands on the same topic.
	evt := &events.Event{
		ID:       "e1",
		Type:     "com.clario360.datastream.dr.runbook.generated",
		TenantID: "tenant-1",
		Data:     []byte(`{"group_id":"group-1"}`),
	}
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(fake.calls) != 0 {
		t.Errorf("runbook.generated must not trigger a regeneration, got %d calls", len(fake.calls))
	}
}

func TestConsumer_GroupFromSubjectFallback(t *testing.T) {
	fake := &fakeRegenerator{result: RegenerateResult{Version: &RunbookVersion{Version: 1}, Changed: true}}
	c := newTestConsumer(fake)
	evt := &events.Event{
		ID:       "e1",
		Type:     evtGroupCreated,
		TenantID: "tenant-1",
		Subject:  "group-from-subject",
		// no data
	}
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].groupID != "group-from-subject" {
		t.Fatalf("expected group resolved from subject, got %+v", fake.calls)
	}
}

func TestConsumer_SkipsEventWithoutGroup(t *testing.T) {
	fake := &fakeRegenerator{}
	c := newTestConsumer(fake)
	evt := &events.Event{ID: "e1", Type: evtSiteUpdated, TenantID: "tenant-1", Data: []byte(`{}`)}
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle should ack (not error) when no group is resolvable: %v", err)
	}
	if len(fake.calls) != 0 {
		t.Errorf("expected no regeneration when group is unresolvable, got %d", len(fake.calls))
	}
}

func TestConsumer_SkipsEventWithoutTenant(t *testing.T) {
	fake := &fakeRegenerator{}
	c := newTestConsumer(fake)
	evt := &events.Event{ID: "e1", Type: evtGroupCreated, Data: []byte(`{"group_id":"g"}`)}
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle should ack when tenant is missing: %v", err)
	}
	if len(fake.calls) != 0 {
		t.Errorf("expected no regeneration without a tenant, got %d", len(fake.calls))
	}
}

func TestConsumer_NoAssetsIsAckedNotErrored(t *testing.T) {
	fake := &fakeRegenerator{err: ErrNoAssets}
	c := newTestConsumer(fake)
	evt := &events.Event{ID: "e1", Type: evtGroupMemberRemoved, TenantID: "t", Data: []byte(`{"group_id":"g"}`)}
	// A group whose last member was removed (no assets) should be acked, not
	// redelivered forever.
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("ErrNoAssets must be acked, got error: %v", err)
	}
}

func TestConsumer_PersistenceErrorIsReturnedForRedelivery(t *testing.T) {
	wantErr := errors.New("db down")
	fake := &fakeRegenerator{err: wantErr}
	c := newTestConsumer(fake)
	evt := &events.Event{ID: "e1", Type: evtGroupMemberAdded, TenantID: "t", Data: []byte(`{"group_id":"g"}`)}
	err := c.Handle(context.Background(), evt)
	if err == nil || !errors.Is(err, wantErr) {
		t.Fatalf("a genuine persistence error must be returned for redelivery, got %v", err)
	}
}

func TestConsumer_IsolatedProfileHonored(t *testing.T) {
	fake := &fakeRegenerator{result: RegenerateResult{Version: &RunbookVersion{Version: 1}, Changed: true}}
	c := newTestConsumer(fake)
	evt := &events.Event{ID: "e1", Type: evtNetworkMappingCreated, TenantID: "t", Data: []byte(`{"group_id":"g","profile":"isolated"}`)}
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(fake.calls) != 1 || fake.calls[0].profile != "isolated" {
		t.Fatalf("expected isolated profile honored, got %+v", fake.calls)
	}
}

func TestConsumer_TopicsAndEventTypes(t *testing.T) {
	c := newTestConsumer(&fakeRegenerator{})
	topics := c.Topics()
	if len(topics) != 1 || topics[0] != events.Topics.DREvents {
		t.Errorf("Topics = %v, want [%s]", topics, events.Topics.DREvents)
	}
	if len(c.EventTypes()) != 10 {
		t.Errorf("expected 10 reacted event types, got %d", len(c.EventTypes()))
	}
	// The consumer must satisfy the typed handler interface used by events.Consumer.
	var _ events.TypedEventHandler = c
}

func TestConsumer_HandlesServiceEmittedEventTypes(t *testing.T) {
	tests := []struct {
		rawType     string
		wantTrigger string
	}{
		{"dr.group.created", TriggerGroup},
		{"dr.group.member_added", TriggerMembership},
		{"dr.network_mapping.created", TriggerNetworkMapping},
		{"dr.recovery_point.created", TriggerRecoveryPoint},
		{"dr.recovery_point.sealed", TriggerRecoveryPoint},
		{"dr.recovery_point.validated", TriggerRecoveryPoint},
		{"dr.recovery_point.validation_recorded", TriggerRecoveryPoint},
	}
	for _, tc := range tests {
		t.Run(tc.rawType, func(t *testing.T) {
			fake := &fakeRegenerator{result: RegenerateResult{Version: &RunbookVersion{Version: 1}, Changed: true}}
			c := newTestConsumer(fake)
			evt, err := events.NewEvent(tc.rawType, "clario-dr-service", "tenant-1", map[string]any{"group_id": "group-1"})
			if err != nil {
				t.Fatalf("NewEvent: %v", err)
			}
			if err := c.Handle(context.Background(), evt); err != nil {
				t.Fatalf("Handle: %v", err)
			}
			if len(fake.calls) != 1 {
				t.Fatalf("expected service event to trigger regeneration, got %d calls", len(fake.calls))
			}
			if fake.calls[0].trigger != tc.wantTrigger {
				t.Fatalf("trigger = %q, want %q", fake.calls[0].trigger, tc.wantTrigger)
			}
		})
	}
}
