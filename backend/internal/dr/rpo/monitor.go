// Package rpo implements the ClarioDR live-RPO monitor.
package rpo

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/database"
	drmetrics "github.com/clario360/platform/internal/dr/metrics"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const (
	EventTypeRPOBreached  = "rpo.breached"
	EventTypeRPORecovered = "rpo.recovered"

	defaultSource = "clario360/clario-dr-service/rpo-monitor"
)

// Repository is the data-access surface required by the monitor.
type Repository interface {
	SystemListStreamsForMonitor(ctx context.Context, db repository.DBTX) ([]*model.StreamMonitorSnapshot, error)
	SystemUpdateStreamStatusForMonitor(ctx context.Context, db repository.DBTX, tenantID, id, expectedStatus, status string, lastError *string) (bool, error)
}

// EventSink stages an alert event. Implementations can write to the
// transactional outbox, a test recorder, or another durable event bus adapter.
type EventSink interface {
	Stage(ctx context.Context, db repository.DBTX, topic string, event *events.Event) error
}

// TransactionRunner lets production wiring run the status transition and
// outbox write inside one transaction. Tests can omit it and use in-memory
// fakes without Kafka or PostgreSQL.
type TransactionRunner interface {
	RunInTx(ctx context.Context, fn func(tx repository.DBTX) error) error
}

// PGXTxRunner adapts a pgx pool to TransactionRunner.
type PGXTxRunner struct {
	Pool *pgxpool.Pool
}

// RunInTx executes fn inside a PostgreSQL transaction.
func (r PGXTxRunner) RunInTx(ctx context.Context, fn func(tx repository.DBTX) error) error {
	if r.Pool == nil {
		return fmt.Errorf("rpo monitor: nil transaction pool")
	}
	return database.RunInTx(ctx, r.Pool, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// OutboxSink stages monitor events in event_outbox.
type OutboxSink struct{}

// Stage writes event to the transactional outbox using the caller's DB handle.
func (OutboxSink) Stage(ctx context.Context, db repository.DBTX, topic string, event *events.Event) error {
	return outbox.Write(ctx, db, topic, event)
}

// Config controls monitor wiring and time sources.
type Config struct {
	Topic    string
	Source   string
	Now      func() time.Time
	TxRunner TransactionRunner
	// Metrics, when set, receives the dr_rpo_seconds and dr_stream_status SLO
	// gauges on every scan. Nil disables emission (e.g. in unit tests).
	Metrics *drmetrics.Metrics
}

// Monitor scans stream ledgers, transitions unhealthy streams, and stages DR
// alert events for RPO breach/recovery.
type Monitor struct {
	db       repository.DBTX
	repo     Repository
	sink     EventSink
	topic    string
	source   string
	now      func() time.Time
	txRunner TransactionRunner
	metrics  *drmetrics.Metrics
}

// NewMonitor constructs a monitor. A nil sink is valid; RunOnce still returns
// the events it would have staged.
func NewMonitor(db repository.DBTX, repo Repository, sink EventSink, cfg Config) *Monitor {
	topic := cfg.Topic
	if topic == "" {
		topic = events.Topics.DRAlerts
	}
	source := cfg.Source
	if source == "" {
		source = defaultSource
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}

	return &Monitor{
		db:       db,
		repo:     repo,
		sink:     sink,
		topic:    topic,
		source:   source,
		now:      now,
		txRunner: cfg.TxRunner,
		metrics:  cfg.Metrics,
	}
}

// Result summarizes one monitor scan.
type Result struct {
	Checked   int
	Breached  int
	Recovered int
	Unchanged int
	Events    []*events.Event
}

// RunOnce performs one scan. It emits events only after a guarded status
// transition succeeds, which makes repeated scans idempotent.
func (m *Monitor) RunOnce(ctx context.Context) (*Result, error) {
	if m.repo == nil {
		return nil, fmt.Errorf("rpo monitor: repository is required")
	}

	now := m.now().UTC()
	streams, err := m.repo.SystemListStreamsForMonitor(ctx, m.db)
	if err != nil {
		return nil, err
	}

	result := &Result{Checked: len(streams)}
	for _, stream := range streams {
		// Emit SLO gauges for every stream each scan (DESIGN §11): live RPO per
		// consistency group and the one-hot stream status. This is independent
		// of whether the stream transitions.
		m.emitStreamMetrics(stream, now)

		decision := Evaluate(stream, now)
		if !decision.ShouldTransition() {
			result.Unchanged++
			continue
		}

		event, changed, err := m.transition(ctx, decision)
		if err != nil {
			return result, err
		}
		if !changed {
			result.Unchanged++
			continue
		}

		result.Events = append(result.Events, event)
		switch decision.EventType {
		case EventTypeRPOBreached:
			result.Breached++
		case EventTypeRPORecovered:
			result.Recovered++
		}
	}

	return result, nil
}

// sourceLagGroupSuffix labels the true source-to-target lag series so it lives
// on the existing dr_rpo_seconds gauge without colliding with the apply-side RPO
// series for the same group. A reviewer graphs dr_rpo_seconds{group="X"} for
// apply-side staleness and dr_rpo_seconds{group="X/source-lag"} for the
// end-to-end data-loss window. (The integrator may instead add a dedicated
// dr_source_lag_seconds gauge — see the wiring spec.)
const sourceLagGroupSuffix = "/source-lag"

// emitStreamMetrics records the dr_rpo_seconds (per group) and dr_stream_status
// SLO gauges for one stream. It emits both the apply-side live RPO
// (now - applied_at) and, when the source commit timestamp is available, the
// TRUE source-to-target lag (applied_at - source_committed_at) under a distinct
// group label. No-op when metrics are not wired.
func (m *Monitor) emitStreamMetrics(stream *model.StreamMonitorSnapshot, now time.Time) {
	if m.metrics == nil || stream == nil {
		return
	}
	m.metrics.SetStreamStatus(stream.ID, stream.Status)

	group := stream.GroupName
	if group == "" {
		group = stream.SiteName
	}
	if rpo, ok := stream.ReplicationStream.LiveRPO(now); ok {
		m.metrics.SetRPO(group, rpo.Seconds())
	} else {
		// No applied checkpoint yet: RPO is the unprotected age since creation.
		m.metrics.SetRPO(group, now.Sub(stream.CreatedAt).Seconds())
	}
	// True end-to-end data-loss window since the source committed. Only emitted
	// when source_committed_at is present (post-000046 rows on paths that carry
	// the frame emit time); legacy/streaming rows without it fall back to the
	// apply-side series above so no false zero is published.
	if lag, ok := stream.ReplicationStream.SourceLagRPO(); ok {
		m.metrics.SetRPO(group+sourceLagGroupSuffix, lag.Seconds())
	}
}

func (m *Monitor) transition(ctx context.Context, decision Decision) (*events.Event, bool, error) {
	event, err := m.newEvent(decision)
	if err != nil {
		return nil, false, err
	}

	var changed bool
	run := func(db repository.DBTX) error {
		changed, err = m.repo.SystemUpdateStreamStatusForMonitor(
			ctx,
			db,
			decision.Stream.TenantID,
			decision.Stream.ID,
			decision.PreviousStatus,
			decision.NextStatus,
			decision.LastError,
		)
		if err != nil || !changed || m.sink == nil {
			return err
		}
		return m.sink.Stage(ctx, db, m.topic, event)
	}

	if m.txRunner != nil {
		if err := m.txRunner.RunInTx(ctx, run); err != nil {
			return nil, false, err
		}
	} else if err := run(m.db); err != nil {
		return nil, false, err
	}

	return event, changed, nil
}

func (m *Monitor) newEvent(decision Decision) (*events.Event, error) {
	payload := EventPayload{
		TenantID:            decision.Stream.TenantID,
		StreamID:            decision.Stream.ID,
		SiteID:              decision.Stream.SiteID,
		SiteName:            decision.Stream.SiteName,
		SiteKind:            decision.Stream.SiteKind,
		PreviousStatus:      decision.PreviousStatus,
		Status:              decision.NextStatus,
		RPOObjectiveSeconds: decision.ObjectiveSeconds,
		LiveRPOSeconds:      decision.LiveRPOSeconds,
		SourceLagSeconds:    decision.SourceLagSeconds,
		NoCheckpointSeconds: decision.NoCheckpointSeconds,
		AppliedSeq:          decision.Stream.AppliedSeq,
		SourceLSN:           decision.Stream.SourceLSN,
		AppliedAt:           decision.Stream.AppliedAt,
		ObservedAt:          decision.ObservedAt,
		Reason:              decision.Reason,
		Message:             decision.Message,
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshaling RPO event payload: %w", err)
	}

	return &events.Event{
		ID:              events.GenerateUUID(),
		Source:          m.source,
		SpecVersion:     "1.0",
		Type:            decision.EventType,
		DataContentType: "application/json",
		Subject:         decision.Stream.ID,
		Time:            decision.ObservedAt,
		Timestamp:       decision.ObservedAt,
		TenantID:        decision.Stream.TenantID,
		CorrelationID:   events.GenerateUUID(),
		Data:            data,
		Metadata: map[string]string{
			"site_id": decision.Stream.SiteID,
		},
	}, nil
}

// Decision is the monitor's pure evaluation result for one stream snapshot.
type Decision struct {
	Stream              *model.StreamMonitorSnapshot
	PreviousStatus      string
	NextStatus          string
	EventType           string
	ObjectiveSeconds    int
	LiveRPOSeconds      *int64
	SourceLagSeconds    *int64
	NoCheckpointSeconds *int64
	ObservedAt          time.Time
	Reason              string
	Message             string
	LastError           *string
}

// ShouldTransition reports whether the decision should update stream state and
// emit an event.
func (d Decision) ShouldTransition() bool {
	return d.Stream != nil && d.NextStatus != "" && d.NextStatus != d.PreviousStatus && d.EventType != ""
}

// Evaluate computes breach/recovery for one stream snapshot.
func Evaluate(stream *model.StreamMonitorSnapshot, now time.Time) Decision {
	if stream == nil {
		return Decision{ObservedAt: now.UTC()}
	}

	now = now.UTC()
	objectiveSeconds := stream.RPOObjectiveSeconds
	if objectiveSeconds <= 0 {
		objectiveSeconds = 1
	}
	objective := time.Duration(objectiveSeconds) * time.Second
	decision := Decision{
		Stream:           stream,
		PreviousStatus:   stream.Status,
		ObjectiveSeconds: objectiveSeconds,
		ObservedAt:       now,
	}

	if stream.AppliedAt == nil {
		age := durationSince(now, stream.CreatedAt)
		if age <= objective {
			return decision
		}
		seconds := ceilSeconds(age)
		decision.NoCheckpointSeconds = &seconds
		decision.NextStatus = model.StreamStatusError
		decision.EventType = EventTypeRPOBreached
		decision.Reason = "no_applied_checkpoint"
		decision.Message = fmt.Sprintf("no applied checkpoint for %ds; RPO objective is %ds", seconds, objectiveSeconds)
		decision.LastError = stringPtr(decision.Message)
		return decision
	}

	liveRPO, _ := stream.ReplicationStream.LiveRPO(now)
	liveSeconds := ceilSeconds(liveRPO)
	decision.LiveRPOSeconds = &liveSeconds

	// True source-to-target data-loss window (applied_at - source_committed_at),
	// when the source commit timestamp is carried on the checkpoint. It is
	// reported for observability alongside the apply-side live RPO; the
	// breach/recovery decision itself stays on live RPO so the objective
	// semantics are unchanged.
	if lag, ok := stream.ReplicationStream.SourceLagRPO(); ok {
		lagSeconds := ceilSeconds(lag)
		decision.SourceLagSeconds = &lagSeconds
	}

	if liveRPO > objective {
		if stream.Status == model.StreamStatusDegraded || stream.Status == model.StreamStatusError {
			return decision
		}
		decision.NextStatus = model.StreamStatusDegraded
		decision.EventType = EventTypeRPOBreached
		decision.Reason = "rpo_objective_exceeded"
		decision.Message = fmt.Sprintf("live RPO is %ds; RPO objective is %ds", liveSeconds, objectiveSeconds)
		decision.LastError = stringPtr(decision.Message)
		return decision
	}

	if stream.Status == model.StreamStatusDegraded || stream.Status == model.StreamStatusError {
		decision.NextStatus = model.StreamStatusStreaming
		decision.EventType = EventTypeRPORecovered
		decision.Reason = "within_rpo_objective"
		decision.Message = fmt.Sprintf("live RPO recovered to %ds within %ds objective", liveSeconds, objectiveSeconds)
		return decision
	}

	return decision
}

func durationSince(now, then time.Time) time.Duration {
	d := now.Sub(then)
	if d < 0 {
		return 0
	}
	return d
}

func ceilSeconds(d time.Duration) int64 {
	if d <= 0 {
		return 0
	}
	return int64(math.Ceil(d.Seconds()))
}

func stringPtr(s string) *string {
	return &s
}

// EventPayload is the JSON body for rpo.breached and rpo.recovered events.
type EventPayload struct {
	TenantID            string `json:"tenant_id"`
	StreamID            string `json:"stream_id"`
	SiteID              string `json:"site_id"`
	SiteName            string `json:"site_name"`
	SiteKind            string `json:"site_kind"`
	PreviousStatus      string `json:"previous_status"`
	Status              string `json:"status"`
	RPOObjectiveSeconds int    `json:"rpo_objective_seconds"`
	LiveRPOSeconds      *int64 `json:"live_rpo_seconds,omitempty"`
	// SourceLagSeconds is the true source-to-target data-loss window in whole
	// seconds (applied_at - source_committed_at). Omitted when the source commit
	// timestamp is not carried on the checkpoint (legacy rows), in which case
	// consumers should read live_rpo_seconds.
	SourceLagSeconds    *int64     `json:"source_lag_seconds,omitempty"`
	NoCheckpointSeconds *int64     `json:"no_checkpoint_seconds,omitempty"`
	AppliedSeq          int64      `json:"applied_seq"`
	SourceLSN           *string    `json:"source_lsn,omitempty"`
	AppliedAt           *time.Time `json:"applied_at,omitempty"`
	ObservedAt          time.Time  `json:"observed_at"`
	Reason              string     `json:"reason"`
	Message             string     `json:"message"`
}
