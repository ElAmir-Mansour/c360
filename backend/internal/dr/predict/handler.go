package predict

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
)

// SampleStore is the subset of the store the ingest handler needs. Defining it
// as an interface lets unit tests substitute an in-memory recorder without a
// database (no fake-only test: the real Store satisfies it and is exercised in
// the store's own integration tests).
type SampleStore interface {
	InsertSample(ctx context.Context, db repository.DBTX, s Sample) (bool, error)
	PruneSamples(ctx context.Context, db repository.DBTX, tenantID, streamID string, keep int) (int64, error)
}

// IngestHandler consumes datastream.dr.progress telemetry and appends each
// sample to the rolling series, then prunes the series to a bounded window. It
// is a fire-and-forget telemetry path (progress events are direct-published,
// not outboxed), so a single malformed or duplicate sample is tolerated rather
// than fatal. It implements events.EventHandler and events.TypedEventHandler.
type IngestHandler struct {
	store      SampleStore
	db         repository.DBTX
	keepWindow int
	now        func() time.Time
}

// IngestConfig wires the handler. DB is the pool the handler writes through;
// KeepWindow bounds the per-stream series after each insert (<=0 → 1024).
type IngestConfig struct {
	DB         repository.DBTX
	KeepWindow int
	Now        func() time.Time
}

// NewIngestHandler builds the progress-sample ingest handler.
func NewIngestHandler(store SampleStore, cfg IngestConfig) *IngestHandler {
	keep := cfg.KeepWindow
	if keep <= 0 {
		keep = 1024
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &IngestHandler{store: store, db: cfg.DB, keepWindow: keep, now: now}
}

// EventTypes filters the handler to progress-sample event types so unrelated
// events on a shared subscription are skipped cheaply.
func (h *IngestHandler) EventTypes() []string {
	return []string{
		"com.clario360.datastream.dr.stream.progress",
		"com.clario360.datastream.dr.progress",
	}
}

// Handle parses one progress event into a ProgressSample and appends it. A
// duplicate (same observed instant) is a successful no-op so Kafka
// at-least-once redelivery never errors the consumer.
func (h *IngestHandler) Handle(ctx context.Context, event *events.Event) error {
	if event == nil {
		return errors.New("predict: nil event")
	}
	if h.store == nil {
		return errors.New("predict: ingest handler has no store")
	}

	var sample ProgressSample
	if err := event.Unmarshal(&sample); err != nil {
		return fmt.Errorf("predict: decoding progress sample (event %s): %w", event.ID, err)
	}

	if sample.TenantID == "" {
		sample.TenantID = event.TenantID
	}
	if sample.StreamID == "" {
		sample.StreamID = event.Subject
	}
	if sample.TenantID == "" || sample.StreamID == "" {
		return fmt.Errorf("predict: progress sample missing tenant/stream (event %s)", event.ID)
	}
	if sample.LagSeconds < 0 || sample.ThroughputBPS < 0 {
		return fmt.Errorf("predict: progress sample for stream %s has negative lag/throughput", sample.StreamID)
	}

	observed := sample.ObservedAt
	if observed.IsZero() {
		observed = event.Time
	}
	if observed.IsZero() {
		observed = h.now()
	}

	row := Sample{
		TenantID:      sample.TenantID,
		StreamID:      sample.StreamID,
		ObservedAt:    observed.UTC(),
		LagSeconds:    sample.LagSeconds,
		ThroughputBPS: sample.ThroughputBPS,
		AppliedSeq:    sample.AppliedSeq,
	}

	inserted, err := h.store.InsertSample(ctx, h.db, row)
	if err != nil {
		return fmt.Errorf("predict: appending sample for stream %s: %w", sample.StreamID, err)
	}
	if !inserted {
		// Duplicate redelivery; nothing more to do.
		return nil
	}

	// Bound the series. A prune failure is logged by the caller via the returned
	// error path, but we do not fail the whole event for it — the sample is
	// already durably stored.
	if _, err := h.store.PruneSamples(ctx, h.db, sample.TenantID, sample.StreamID, h.keepWindow); err != nil {
		return fmt.Errorf("predict: pruning series for stream %s: %w", sample.StreamID, err)
	}
	return nil
}
