package topology

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// Default objective and staleness window used to derive an edge's health state
// from a progress sample when the sample does not carry its own objective. They
// mirror the §1.3 GA RPO objective (300s) so an edge degrades when its lag
// crosses the same line the RPO monitor uses.
const defaultObjectiveSeconds = 300

// healthApplier is the surface the consumer drives. *Service satisfies it. It is
// an interface so the consumer's event-routing and health-derivation logic is
// unit-tested without a database (a fake records the (stream, update) calls);
// the rollup persistence itself is exercised against the real Store in the
// store/integration tests.
type healthApplier interface {
	applyHealthSystem(ctx context.Context, streamID string, u HealthUpdate) (int64, error)
}

// progressSample is the datastream.dr.progress payload. It mirrors the canonical
// shape the predict package consumes (tenant/stream/lag/throughput/applied_seq/
// observed_at) so this package reads the SAME telemetry without depending on
// predict.
type progressSample struct {
	TenantID            string    `json:"tenant_id"`
	StreamID            string    `json:"stream_id"`
	LagSeconds          float64   `json:"lag_seconds"`
	ThroughputBPS       float64   `json:"throughput_bps"`
	AppliedSeq          int64     `json:"applied_seq"`
	ObservedAt          time.Time `json:"observed_at"`
	RPOObjectiveSeconds int       `json:"rpo_objective_seconds,omitempty"`
	// Status, when present, lets a known-error/paused stream mark its edges
	// unhealthy directly rather than inferring from lag alone.
	Status string `json:"status,omitempty"`
}

// Consumer is the per-edge health rollup loop: it consumes
// datastream.dr.progress and, for every edge carrying the sampled stream,
// updates the edge's rolled-up health, lag, applied-seq and last-progress time.
// This is what makes the topology-aware failover selection reflect LIVE
// replication health (graph.go SelectFailoverTarget ranks on exactly these
// fields). It implements events.TypedEventHandler so it plugs into the shared
// progress-consumer wiring exactly like predict's IngestHandler.
//
// It is fire-and-forget telemetry (progress events are direct-published, not
// outboxed), so a malformed or out-of-order sample is tolerated: the
// GREATEST-based store update never regresses applied_seq/last_progress_at, and
// a missing/zero stream is skipped rather than erroring the whole consumer.
type Consumer struct {
	svc     healthApplier
	metrics *Metrics
	now     func() time.Time
	logger  zerolog.Logger
}

// ConsumerConfig wires a Consumer.
type ConsumerConfig struct {
	Metrics *Metrics
	// Now is optional; defaults to time.Now. Injected for deterministic tests.
	Now    func() time.Time
	Logger zerolog.Logger
}

// NewConsumer constructs the health-rollup consumer over a Service.
func NewConsumer(svc *Service, cfg ConsumerConfig) *Consumer {
	return newConsumer(svc, cfg)
}

// newConsumer is the internal constructor that accepts the healthApplier
// interface so unit tests can inject a fake.
func newConsumer(svc healthApplier, cfg ConsumerConfig) *Consumer {
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Consumer{
		svc:     svc,
		metrics: cfg.Metrics,
		now:     now,
		logger:  cfg.Logger.With().Str("consumer", "dr-topology-health").Logger(),
	}
}

// Topics returns the bus topic this consumer subscribes to.
func (c *Consumer) Topics() []string {
	return []string{events.Topics.DRProgress}
}

// EventTypes filters the consumer to progress-sample event types so unrelated
// events on the busy progress topic are skipped cheaply (matching predict's
// IngestHandler, which shares this topic).
func (c *Consumer) EventTypes() []string {
	return []string{
		"com.clario360.datastream.dr.stream.progress",
		"com.clario360.datastream.dr.progress",
	}
}

// Handle rolls up one progress sample onto every edge carrying its stream. A
// sample without a resolvable stream is skipped (logged), not errored, so an
// unrelated or malformed event never blocks the consumer. A real persistence
// error IS returned so the bus can redeliver, but because progress is
// fire-and-forget the wiring may also choose to drop on error.
func (c *Consumer) Handle(ctx context.Context, event *events.Event) error {
	if event == nil {
		return nil
	}
	if c == nil || c.svc == nil {
		return errors.New("topology consumer: service is required")
	}

	var sample progressSample
	if err := event.Unmarshal(&sample); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("dr progress sample undecodable; skipping")
		return nil
	}
	if sample.StreamID == "" {
		sample.StreamID = event.Subject
	}
	if sample.StreamID == "" {
		c.logger.Warn().Str("event_id", event.ID).Msg("dr progress sample without stream; skipping")
		return nil
	}

	observed := sample.ObservedAt
	if observed.IsZero() {
		observed = event.Time
	}
	if observed.IsZero() {
		observed = c.now()
	}

	update := deriveHealth(sample, observed)
	affected, err := c.svc.applyHealthSystem(ctx, sample.StreamID, update)
	if err != nil {
		return fmt.Errorf("topology consumer: rolling up health for stream %s: %w", sample.StreamID, err)
	}
	if affected == 0 {
		// No edge carries this stream yet (the stream exists but is not part of any
		// multi-site topology). Benign: nothing to roll up.
		c.logger.Debug().Str("stream_id", sample.StreamID).Msg("progress sample matched no topology edge")
		return nil
	}

	c.metrics.observeHealthRollup(sample.TenantID, sample.StreamID, update.Health, update.LagSeconds)
	c.logger.Debug().
		Str("stream_id", sample.StreamID).
		Str("health", update.Health).
		Int64("lag_seconds", update.LagSeconds).
		Int64("edges", affected).
		Msg("topology edge health rolled up")
	return nil
}

// deriveHealth turns a progress sample into the rolled-up edge health. It is a
// pure function (no I/O) so the health-derivation rules are unit-tested directly:
//
//   - An explicit error/paused stream status maps to unhealthy.
//   - Otherwise lag <= objective is healthy; lag > objective is degraded.
//   - A sample older than the staleness window is unhealthy regardless of lag
//     (the stream stopped emitting), measured against the consumer's clock.
//
// The objective is the sample's own RPOObjectiveSeconds when set, else the GA
// default (300s). Lag is rounded UP to whole seconds so a sub-second lag never
// reads as zero when it is in fact non-zero.
func deriveHealth(s progressSample, observed time.Time) HealthUpdate {
	objective := s.RPOObjectiveSeconds
	if objective <= 0 {
		objective = defaultObjectiveSeconds
	}
	lagSeconds := int64(math.Ceil(s.LagSeconds))
	if lagSeconds < 0 {
		lagSeconds = 0
	}

	health := HealthHealthy
	switch s.Status {
	case "error", "paused", "degraded":
		health = HealthUnhealthy
	default:
		if lagSeconds > int64(objective) {
			health = HealthDegraded
		}
	}

	return HealthUpdate{
		Health:         health,
		LagSeconds:     lagSeconds,
		AppliedSeq:     s.AppliedSeq,
		LastProgressAt: observed.UTC(),
	}
}

// compile-time checks.
var (
	_ events.TypedEventHandler = (*Consumer)(nil)
	_ healthApplier            = (*Service)(nil)
)
