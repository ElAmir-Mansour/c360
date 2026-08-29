package predict

import (
	"context"
	"testing"
	"time"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
)

// fakePredictionStore is an in-memory PredictionStore. It returns a fixed set of
// stream states and records every upserted prediction so a test can assert what
// the forecaster persisted. It satisfies PredictionStore over repository.DBTX.
type fakePredictionStore struct {
	states    []StreamPredictionState
	upserted  []*Prediction
	upsertErr error
}

func (f *fakePredictionStore) SystemListStreamStates(_ context.Context, _ repository.DBTX, _ int) ([]StreamPredictionState, error) {
	return f.states, nil
}

func (f *fakePredictionStore) UpsertPrediction(_ context.Context, _ repository.DBTX, p *Prediction) error {
	if f.upsertErr != nil {
		return f.upsertErr
	}
	cp := *p
	cp.ID = "pred-" + p.StreamID
	p.ID = cp.ID
	f.upserted = append(f.upserted, &cp)
	return nil
}

// recorderSink captures staged events instead of writing to Kafka/Postgres.
type recorderSink struct {
	events []*events.Event
	topics []string
}

func (r *recorderSink) Stage(_ context.Context, _ repository.DBTX, topic string, e *events.Event) error {
	r.topics = append(r.topics, topic)
	r.events = append(r.events, e)
	return nil
}

func risingState(streamID string, prevBreach bool) StreamPredictionState {
	// Lag climbs from 200 to 295 at 1.0/s under a 300 objective — horizon falls
	// inside a 120s window so the forecaster should fire on the flip.
	samples := series(20, 5*time.Second, func(i int) float64 { return 200 + float64(i)*5 }, nil)
	for i := range samples {
		samples[i].StreamID = streamID
	}
	return StreamPredictionState{
		TenantID:            "t1",
		StreamID:            streamID,
		GroupLabel:          "group-a",
		RPOObjectiveSeconds: 300,
		PrevBreachForecast:  prevBreach,
		Samples:             samples,
	}
}

func steadyState(streamID string) StreamPredictionState {
	samples := series(20, 30*time.Second, func(i int) float64 { return 30 }, nil)
	for i := range samples {
		samples[i].StreamID = streamID
	}
	return StreamPredictionState{
		TenantID:            "t1",
		StreamID:            streamID,
		GroupLabel:          "group-b",
		RPOObjectiveSeconds: 300,
		Samples:             samples,
	}
}

func newTestService(store PredictionStore, sink EventSink) *Service {
	return NewService(nil, store, sink, ServiceConfig{
		Forecaster: NewForecaster(Config{BreachWindow: 120 * time.Second}),
		Now:        func() time.Time { return base },
	})
}

func TestRunOnce_FiresBreachForecastOnFlip(t *testing.T) {
	t.Parallel()
	store := &fakePredictionStore{states: []StreamPredictionState{risingState("s-rising", false)}}
	sink := &recorderSink{}
	svc := newTestService(store, sink)

	res, err := svc.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.Scanned != 1 || res.BreachForecasts != 1 {
		t.Fatalf("expected 1 scanned + 1 breach forecast, got %+v", res)
	}
	if len(sink.events) != 1 {
		t.Fatalf("expected exactly one staged event, got %d", len(sink.events))
	}
	evt := sink.events[0]
	if evt.Type != normalizeType(EventTypeRPOBreachForecast) {
		t.Fatalf("wrong event type: %s", evt.Type)
	}
	if sink.topics[0] != events.Topics.DRAlerts {
		t.Fatalf("breach event must be staged to DRAlerts, got %s", sink.topics[0])
	}
	if evt.TenantID != "t1" || evt.Subject != "s-rising" {
		t.Fatalf("event identity wrong: tenant=%s subject=%s", evt.TenantID, evt.Subject)
	}
	var payload AlertPayload
	if err := evt.Unmarshal(&payload); err != nil {
		t.Fatalf("decode payload: %v", err)
	}
	if payload.PredictedBreachSeconds == nil || *payload.PredictedBreachSeconds > 120 {
		t.Fatalf("payload horizon should be within the 120s window: %v", payload.PredictedBreachSeconds)
	}
	// The persisted prediction must carry the breach flag so a restart sees it.
	if len(store.upserted) != 1 || !store.upserted[0].BreachForecast {
		t.Fatalf("prediction must be persisted with breach_forecast=true: %+v", store.upserted)
	}
}

func TestRunOnce_StaysSilentWhenSafe(t *testing.T) {
	t.Parallel()
	store := &fakePredictionStore{states: []StreamPredictionState{steadyState("s-steady")}}
	sink := &recorderSink{}
	svc := newTestService(store, sink)

	res, err := svc.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.BreachForecasts != 0 || res.CollapseDetected != 0 {
		t.Fatalf("steady stream must raise no signals, got %+v", res)
	}
	if len(sink.events) != 0 {
		t.Fatalf("steady stream must stage no events, got %d", len(sink.events))
	}
	if len(store.upserted) != 1 || store.upserted[0].BreachForecast {
		t.Fatalf("steady prediction must persist with breach_forecast=false: %+v", store.upserted)
	}
}

func TestRunOnce_IdempotentWhenBreachAlreadyForecast(t *testing.T) {
	t.Parallel()
	// PrevBreachForecast=true: the breach was already reported, so a re-scan
	// that still forecasts a breach must NOT re-fire (edge-triggered).
	store := &fakePredictionStore{states: []StreamPredictionState{risingState("s-rising", true)}}
	sink := &recorderSink{}
	svc := newTestService(store, sink)

	res, err := svc.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.BreachForecasts != 0 {
		t.Fatalf("a still-breaching stream must not re-fire, got %+v", res)
	}
	if len(sink.events) != 0 {
		t.Fatalf("no event on a repeated breach, got %d", len(sink.events))
	}
	// But the prediction is still refreshed (persisted with breach_forecast=true).
	if len(store.upserted) != 1 || !store.upserted[0].BreachForecast {
		t.Fatalf("prediction should still be persisted as breaching: %+v", store.upserted)
	}
}

func TestRunOnce_ClearsBreachWhenRecovered(t *testing.T) {
	t.Parallel()
	// Previously breaching, now steady/safe → must fire a "cleared" event.
	st := steadyState("s-recovered")
	st.PrevBreachForecast = true
	store := &fakePredictionStore{states: []StreamPredictionState{st}}
	sink := &recorderSink{}
	svc := newTestService(store, sink)

	res, err := svc.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.BreachCleared != 1 {
		t.Fatalf("expected one cleared transition, got %+v", res)
	}
	if len(sink.events) != 1 || sink.events[0].Type != normalizeType(EventTypeRPOForecastCleared) {
		t.Fatalf("expected one cleared event, got %+v", sink.events)
	}
}

func TestRunOnce_FiresThroughputCollapseOnFlip(t *testing.T) {
	t.Parallel()
	n := 30
	samples := series(n, 10*time.Second,
		func(i int) float64 { return 40 },
		func(i int) float64 {
			if i < n/2 {
				return 1_000_000
			}
			frac := float64(n-1-i) / float64(n-1-n/2)
			if frac < 0 {
				frac = 0
			}
			return 1_000_000 * frac
		},
	)
	for i := range samples {
		samples[i].StreamID = "s-collapse"
	}
	st := StreamPredictionState{
		TenantID:            "t1",
		StreamID:            "s-collapse",
		GroupLabel:          "group-c",
		RPOObjectiveSeconds: 300,
		Samples:             samples,
	}
	store := &fakePredictionStore{states: []StreamPredictionState{st}}
	sink := &recorderSink{}
	svc := newTestService(store, sink)

	res, err := svc.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.CollapseDetected != 1 {
		t.Fatalf("expected throughput collapse detection, got %+v", res)
	}
	found := false
	for _, e := range sink.events {
		if e.Type == normalizeType(EventTypeThroughputCollapse) {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected a throughput_collapse event, got %+v", sink.events)
	}
}

func TestRunOnce_NilSinkStillPersistsAndReturnsEvents(t *testing.T) {
	t.Parallel()
	store := &fakePredictionStore{states: []StreamPredictionState{risingState("s-rising", false)}}
	svc := newTestService(store, nil) // nil sink

	res, err := svc.RunOnce(context.Background())
	if err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if res.BreachForecasts != 1 {
		t.Fatalf("breach should still be counted with a nil sink: %+v", res)
	}
	if len(res.Events) != 1 {
		t.Fatalf("RunOnce must return the events it would have staged, got %d", len(res.Events))
	}
	if len(store.upserted) != 1 {
		t.Fatalf("prediction must persist even with a nil sink")
	}
}

func TestRunOnce_TransactionRunnerWrapsPersist(t *testing.T) {
	t.Parallel()
	store := &fakePredictionStore{states: []StreamPredictionState{risingState("s-rising", false)}}
	sink := &recorderSink{}
	tr := &countingTxRunner{}
	svc := NewService(nil, store, sink, ServiceConfig{
		Forecaster: NewForecaster(Config{BreachWindow: 120 * time.Second}),
		Now:        func() time.Time { return base },
		TxRunner:   tr,
	})

	if _, err := svc.RunOnce(context.Background()); err != nil {
		t.Fatalf("RunOnce: %v", err)
	}
	if tr.calls != 1 {
		t.Fatalf("expected the persist to run inside one transaction, got %d", tr.calls)
	}
}

type countingTxRunner struct{ calls int }

func (c *countingTxRunner) RunInTx(ctx context.Context, fn func(tx repository.DBTX) error) error {
	c.calls++
	return fn(nil)
}
