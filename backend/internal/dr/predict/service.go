package predict

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// PredictionStore is the subset of *Store the forecaster service needs. An
// interface lets unit tests substitute an in-memory store so the forecaster's
// decision logic is testable without PostgreSQL while the real Store is
// exercised in the store/handler integration tests.
type PredictionStore interface {
	SystemListStreamStates(ctx context.Context, db repository.DBTX, sampleWindow int) ([]StreamPredictionState, error)
	UpsertPrediction(ctx context.Context, db repository.DBTX, p *Prediction) error
}

// EventSink stages an alert event. Production wires OutboxSink (writes to the
// transactional outbox); tests use a recorder.
type EventSink interface {
	Stage(ctx context.Context, db repository.DBTX, topic string, event *events.Event) error
}

// OutboxSink stages forecaster events in event_outbox via the caller's tx.
type OutboxSink struct{}

// Stage writes event to the transactional outbox using the caller's DB handle.
func (OutboxSink) Stage(ctx context.Context, db repository.DBTX, topic string, event *events.Event) error {
	return outbox.Write(ctx, db, topic, event)
}

// TransactionRunner runs the prediction upsert and outbox write in one
// transaction so a staged alert and the persisted breach flag commit together
// (no dual-write). Tests can omit it; the service then runs against its db
// handle directly.
type TransactionRunner interface {
	RunInTx(ctx context.Context, fn func(tx repository.DBTX) error) error
}

// PGXTxRunner adapts a pgx pool to TransactionRunner.
type PGXTxRunner struct{ Pool *pgxpool.Pool }

// RunInTx executes fn inside a PostgreSQL transaction.
func (r PGXTxRunner) RunInTx(ctx context.Context, fn func(tx repository.DBTX) error) error {
	if r.Pool == nil {
		return fmt.Errorf("predict: nil transaction pool")
	}
	return database.RunInTx(ctx, r.Pool, func(tx pgx.Tx) error { return fn(tx) })
}

// ServiceConfig wires the forecaster service.
type ServiceConfig struct {
	Topic        string
	Source       string
	SampleWindow int // samples per stream pulled for each forecast (default 256)
	Now          func() time.Time
	Forecaster   *Forecaster
	TxRunner     TransactionRunner
	Metrics      *Metrics
}

// Service recomputes per-stream forecasts and stages DR alert events on a
// breach-forecast or throughput-collapse state flip. The state that makes
// alerts edge-triggered (the previous breach/collapse flags) lives in
// dr_predictions, so the service is restart-safe: after a restart it reads the
// persisted flags and only re-fires when the boolean actually changes.
type Service struct {
	db           repository.DBTX
	store        PredictionStore
	sink         EventSink
	topic        string
	source       string
	sampleWindow int
	now          func() time.Time
	forecaster   *Forecaster
	txRunner     TransactionRunner
	metrics      *Metrics
}

// NewService constructs the forecaster service. A nil sink is valid (RunOnce
// still computes and persists forecasts and returns the events it would stage).
func NewService(db repository.DBTX, store PredictionStore, sink EventSink, cfg ServiceConfig) *Service {
	topic := cfg.Topic
	if topic == "" {
		topic = events.Topics.DRAlerts
	}
	source := cfg.Source
	if source == "" {
		source = defaultSource
	}
	window := cfg.SampleWindow
	if window <= 0 {
		window = 256
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	fc := cfg.Forecaster
	if fc == nil {
		fc = NewForecaster(Config{})
	}
	return &Service{
		db:           db,
		store:        store,
		sink:         sink,
		topic:        topic,
		source:       source,
		sampleWindow: window,
		now:          now,
		forecaster:   fc,
		txRunner:     cfg.TxRunner,
		metrics:      cfg.Metrics,
	}
}

// Result summarizes one forecasting scan.
type Result struct {
	Scanned          int
	BreachForecasts  int // streams that flipped into a breach forecast
	BreachCleared    int // streams that flipped out of a breach forecast
	CollapseDetected int // streams that flipped into throughput collapse
	Events           []*events.Event
}

// RunOnce recomputes every active stream's forecast, persists it, updates the
// gauges, and stages an alert event whenever the breach or collapse boolean
// flips versus the last persisted forecast. Repeated scans with no change stage
// no events, which makes the loop idempotent.
func (s *Service) RunOnce(ctx context.Context) (*Result, error) {
	if s.store == nil {
		return nil, fmt.Errorf("predict: forecaster store is required")
	}
	now := s.now().UTC()

	states, err := s.store.SystemListStreamStates(ctx, s.db, s.sampleWindow)
	if err != nil {
		return nil, err
	}

	result := &Result{Scanned: len(states)}
	for i := range states {
		st := states[i]
		fc := s.forecaster.Forecast(st.Samples, st.RPOObjectiveSeconds)

		group := st.GroupLabel
		if group == "" {
			group = st.StreamID
		}
		s.metrics.ObserveForecast(st.StreamID, fc)

		pred := fc.ToPrediction(st.TenantID, st.StreamID, group, now)

		// Edge-triggered alerting: compare to the previously persisted flags.
		breachFlip := fc.BreachForecast && !st.PrevBreachForecast
		breachClear := !fc.BreachForecast && st.PrevBreachForecast
		collapseFlip := fc.ThroughputCollapse && !st.PrevThroughputCollapse

		var staged []*events.Event
		if breachFlip {
			staged = append(staged, s.breachEvent(st, fc, now))
		}
		if breachClear {
			staged = append(staged, s.clearedEvent(st, fc, now))
		}
		if collapseFlip {
			staged = append(staged, s.collapseEvent(st, fc, now))
		}

		if err := s.persist(ctx, &pred, staged); err != nil {
			return result, err
		}

		if breachFlip {
			result.BreachForecasts++
			s.metrics.IncBreachForecast(st.StreamID)
		}
		if breachClear {
			result.BreachCleared++
		}
		if collapseFlip {
			result.CollapseDetected++
		}
		result.Events = append(result.Events, staged...)
	}
	return result, nil
}

// persist upserts the prediction and stages any events in one transaction so
// the new breach/collapse flag and its alert commit atomically.
func (s *Service) persist(ctx context.Context, pred *Prediction, staged []*events.Event) error {
	run := func(db repository.DBTX) error {
		if err := s.store.UpsertPrediction(ctx, db, pred); err != nil {
			return err
		}
		if s.sink == nil {
			return nil
		}
		for _, evt := range staged {
			if err := s.sink.Stage(ctx, db, s.topic, evt); err != nil {
				return err
			}
		}
		return nil
	}
	if s.txRunner != nil {
		return s.txRunner.RunInTx(ctx, run)
	}
	return run(s.db)
}

// AlertPayload is the JSON body of the staged DR prediction alert events.
type AlertPayload struct {
	TenantID                  string    `json:"tenant_id"`
	StreamID                  string    `json:"stream_id"`
	GroupLabel                string    `json:"group_label"`
	RPOObjectiveSeconds       int       `json:"rpo_objective_seconds"`
	SmoothedLagSeconds        float64   `json:"smoothed_lag_seconds"`
	LagTrendSlope             float64   `json:"lag_trend_slope"`
	ThroughputTrendSlope      float64   `json:"throughput_trend_slope"`
	SmoothedThroughputBPS     float64   `json:"smoothed_throughput_bps"`
	PeakSmoothedThroughputBPS float64   `json:"peak_smoothed_throughput_bps"`
	PredictedBreachSeconds    *float64  `json:"predicted_breach_seconds,omitempty"`
	AlreadyBreached           bool      `json:"already_breached"`
	SampleCount               int       `json:"sample_count"`
	ObservedAt                time.Time `json:"observed_at"`
	Reason                    string    `json:"reason"`
	Message                   string    `json:"message"`
}

func (s *Service) breachEvent(st StreamPredictionState, fc Forecast, now time.Time) *events.Event {
	horizon := math.NaN()
	if fc.PredictedBreachSeconds != nil {
		horizon = *fc.PredictedBreachSeconds
	}
	msg := fmt.Sprintf(
		"RPO breach forecast for stream %s: smoothed lag %.1fs rising at %.4fs/s toward %ds objective; predicted breach in %.0fs",
		st.StreamID, fc.SmoothedLagSeconds, fc.LagTrendSlope, fc.RPOObjectiveSeconds, horizon,
	)
	reason := "rpo_breach_forecast"
	if fc.AlreadyBreached {
		reason = "rpo_breach_imminent"
	}
	return s.newEvent(EventTypeRPOBreachForecast, st, fc, now, reason, msg)
}

func (s *Service) clearedEvent(st StreamPredictionState, fc Forecast, now time.Time) *events.Event {
	msg := fmt.Sprintf(
		"RPO breach forecast cleared for stream %s: smoothed lag %.1fs, trend %.4fs/s within %ds objective",
		st.StreamID, fc.SmoothedLagSeconds, fc.LagTrendSlope, fc.RPOObjectiveSeconds,
	)
	return s.newEvent(EventTypeRPOForecastCleared, st, fc, now, "rpo_forecast_cleared", msg)
}

func (s *Service) collapseEvent(st StreamPredictionState, fc Forecast, now time.Time) *events.Event {
	msg := fmt.Sprintf(
		"throughput collapse for stream %s: smoothed throughput %.0f B/s (peak %.0f) falling at %.0f B/s per second; likely source failure",
		st.StreamID, fc.SmoothedThroughputBPS, fc.PeakSmoothedThroughputBPS, fc.ThroughputTrendSlope,
	)
	return s.newEvent(EventTypeThroughputCollapse, st, fc, now, "throughput_collapse", msg)
}

func (s *Service) newEvent(eventType string, st StreamPredictionState, fc Forecast, now time.Time, reason, message string) *events.Event {
	payload := AlertPayload{
		TenantID:                  st.TenantID,
		StreamID:                  st.StreamID,
		GroupLabel:                st.GroupLabel,
		RPOObjectiveSeconds:       fc.RPOObjectiveSeconds,
		SmoothedLagSeconds:        fc.SmoothedLagSeconds,
		LagTrendSlope:             fc.LagTrendSlope,
		ThroughputTrendSlope:      fc.ThroughputTrendSlope,
		SmoothedThroughputBPS:     fc.SmoothedThroughputBPS,
		PeakSmoothedThroughputBPS: fc.PeakSmoothedThroughputBPS,
		PredictedBreachSeconds:    fc.PredictedBreachSeconds,
		AlreadyBreached:           fc.AlreadyBreached,
		SampleCount:               fc.SampleCount,
		ObservedAt:                now,
		Reason:                    reason,
		Message:                   message,
	}
	data, _ := json.Marshal(payload)

	return &events.Event{
		ID:              events.GenerateUUID(),
		Source:          s.source,
		SpecVersion:     "1.0",
		Type:            normalizeType(eventType),
		DataContentType: "application/json",
		Subject:         st.StreamID,
		Time:            now,
		Timestamp:       now,
		TenantID:        st.TenantID,
		CorrelationID:   events.GenerateUUID(),
		Data:            data,
		Metadata: map[string]string{
			"group_label": st.GroupLabel,
			"reason":      reason,
		},
	}
}

// normalizeType mirrors events.normalizeType (unexported there) so the staged
// event type carries the com.clario360. prefix the bus expects.
func normalizeType(eventType string) string {
	const prefix = "com.clario360."
	if len(eventType) >= len(prefix) && eventType[:len(prefix)] == prefix {
		return eventType
	}
	return prefix + eventType
}
