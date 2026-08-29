package topology

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/clario360/platform/internal/events"
)

// fakeApplier records the (stream, update) rollups the consumer drives, and can
// simulate "no edge carries this stream" (affected=0) and a persistence error.
type fakeApplier struct {
	calls    []rollupCall
	affected int64
	err      error
}

type rollupCall struct {
	streamID string
	update   HealthUpdate
}

func (f *fakeApplier) applyHealthSystem(_ context.Context, streamID string, u HealthUpdate) (int64, error) {
	f.calls = append(f.calls, rollupCall{streamID, u})
	if f.err != nil {
		return 0, f.err
	}
	return f.affected, nil
}

func progressEvent(t *testing.T, sample progressSample) *events.Event {
	t.Helper()
	data, err := json.Marshal(sample)
	if err != nil {
		t.Fatalf("marshal sample: %v", err)
	}
	return &events.Event{
		ID:       "evt-1",
		Type:     "com.clario360.datastream.dr.progress",
		TenantID: sample.TenantID,
		Subject:  sample.StreamID,
		Time:     time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC),
		Data:     data,
	}
}

func newTestConsumer(applier healthApplier) *Consumer {
	return newConsumer(applier, ConsumerConfig{
		Metrics: NewMetrics(nil),
		Now:     func() time.Time { return time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC) },
	})
}

// ---------------------------------------------------------------------------
// deriveHealth — pure health derivation rules
// ---------------------------------------------------------------------------

func TestDeriveHealth(t *testing.T) {
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name       string
		sample     progressSample
		wantHealth string
		wantLag    int64
	}{
		{
			name:       "within objective is healthy",
			sample:     progressSample{LagSeconds: 30, RPOObjectiveSeconds: 300, AppliedSeq: 10},
			wantHealth: HealthHealthy, wantLag: 30,
		},
		{
			name:       "over objective is degraded",
			sample:     progressSample{LagSeconds: 400, RPOObjectiveSeconds: 300},
			wantHealth: HealthDegraded, wantLag: 400,
		},
		{
			name:       "default objective applies when unset",
			sample:     progressSample{LagSeconds: 301}, // > default 300
			wantHealth: HealthDegraded, wantLag: 301,
		},
		{
			name:       "explicit error status is unhealthy regardless of lag",
			sample:     progressSample{LagSeconds: 1, Status: "error"},
			wantHealth: HealthUnhealthy, wantLag: 1,
		},
		{
			name:       "paused status is unhealthy",
			sample:     progressSample{LagSeconds: 1, Status: "paused"},
			wantHealth: HealthUnhealthy, wantLag: 1,
		},
		{
			name:       "fractional lag rounds up",
			sample:     progressSample{LagSeconds: 0.4, RPOObjectiveSeconds: 300},
			wantHealth: HealthHealthy, wantLag: 1,
		},
		{
			name:       "negative lag clamps to zero",
			sample:     progressSample{LagSeconds: -5, RPOObjectiveSeconds: 300},
			wantHealth: HealthHealthy, wantLag: 0,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := deriveHealth(tt.sample, now)
			if got.Health != tt.wantHealth {
				t.Errorf("health = %q, want %q", got.Health, tt.wantHealth)
			}
			if got.LagSeconds != tt.wantLag {
				t.Errorf("lag = %d, want %d", got.LagSeconds, tt.wantLag)
			}
			if !got.LastProgressAt.Equal(now) {
				t.Errorf("lastProgressAt = %v, want %v", got.LastProgressAt, now)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Handle — routing, skips, and error surfacing
// ---------------------------------------------------------------------------

func TestConsumer_Handle_RollsUp(t *testing.T) {
	applier := &fakeApplier{affected: 2}
	c := newTestConsumer(applier)
	evt := progressEvent(t, progressSample{
		TenantID: tenantA, StreamID: "stream-1", LagSeconds: 50, RPOObjectiveSeconds: 300, AppliedSeq: 77,
	})
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(applier.calls) != 1 {
		t.Fatalf("expected 1 rollup call, got %d", len(applier.calls))
	}
	call := applier.calls[0]
	if call.streamID != "stream-1" {
		t.Fatalf("streamID = %q, want stream-1", call.streamID)
	}
	if call.update.Health != HealthHealthy || call.update.LagSeconds != 50 || call.update.AppliedSeq != 77 {
		t.Fatalf("update = %+v, want healthy/50/77", call.update)
	}
}

func TestConsumer_Handle_StreamFromSubjectWhenPayloadMissing(t *testing.T) {
	applier := &fakeApplier{affected: 1}
	c := newTestConsumer(applier)
	// Payload omits stream_id; the consumer falls back to the event Subject.
	evt := progressEvent(t, progressSample{TenantID: tenantA, LagSeconds: 10})
	evt.Subject = "stream-from-subject"
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if len(applier.calls) != 1 || applier.calls[0].streamID != "stream-from-subject" {
		t.Fatalf("expected rollup keyed by subject; calls=%+v", applier.calls)
	}
}

func TestConsumer_Handle_NoStreamSkips(t *testing.T) {
	applier := &fakeApplier{}
	c := newTestConsumer(applier)
	evt := &events.Event{ID: "evt", Type: "com.clario360.datastream.dr.progress", Data: json.RawMessage(`{"lag_seconds":1}`)}
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("Handle of stream-less event should be a benign skip: %v", err)
	}
	if len(applier.calls) != 0 {
		t.Fatal("a stream-less event must not roll up")
	}
}

func TestConsumer_Handle_NoMatchingEdgeIsBenign(t *testing.T) {
	applier := &fakeApplier{affected: 0} // no edge carries the stream
	c := newTestConsumer(applier)
	evt := progressEvent(t, progressSample{TenantID: tenantA, StreamID: "orphan", LagSeconds: 1})
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("a stream with no edge must be benign: %v", err)
	}
	if len(applier.calls) != 1 {
		t.Fatal("the rollup is still attempted (affected=0 is the benign result)")
	}
}

func TestConsumer_Handle_PersistenceErrorIsReturned(t *testing.T) {
	applier := &fakeApplier{err: errors.New("db down")}
	c := newTestConsumer(applier)
	evt := progressEvent(t, progressSample{TenantID: tenantA, StreamID: "stream-1", LagSeconds: 1})
	if err := c.Handle(context.Background(), evt); err == nil {
		t.Fatal("a persistence error must be returned so the bus can redeliver")
	}
}

func TestConsumer_Handle_UndecodablePayloadSkips(t *testing.T) {
	applier := &fakeApplier{}
	c := newTestConsumer(applier)
	evt := &events.Event{ID: "evt", Type: "com.clario360.datastream.dr.progress", Subject: "s", Data: json.RawMessage(`not json`)}
	if err := c.Handle(context.Background(), evt); err != nil {
		t.Fatalf("an undecodable payload must be skipped, not errored: %v", err)
	}
	if len(applier.calls) != 0 {
		t.Fatal("an undecodable payload must not roll up")
	}
}

func TestConsumer_TopicsAndEventTypes(t *testing.T) {
	c := newTestConsumer(&fakeApplier{})
	topics := c.Topics()
	if len(topics) != 1 || topics[0] != events.Topics.DRProgress {
		t.Fatalf("Topics = %v, want [%s]", topics, events.Topics.DRProgress)
	}
	types := c.EventTypes()
	found := false
	for _, ty := range types {
		if ty == "com.clario360.datastream.dr.progress" {
			found = true
		}
	}
	if !found {
		t.Fatalf("EventTypes must include the progress type; got %v", types)
	}
}
