package journal

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// retentionStore is the persistence surface the retention loop uses.
type retentionStore interface {
	PruneCandidates(ctx context.Context, db repository.DBTX, tenantID, streamID string, olderThan any, limit int) ([]Segment, error)
	MarkPruned(ctx context.Context, db repository.DBTX, in PruneInput) (bool, error)
}

// segmentReclaimer reclaims the durable bytes of a pruned segment (delete the
// WORM/frame-store object under GOVERNANCE retention break-glass, per DESIGN §5).
// The integration phase supplies an implementation; a nil reclaimer tombstones
// the index row only (the bytes are reclaimed by the object store's own
// lifecycle), which is the safe default for GOVERNANCE-mode buckets.
type segmentReclaimer interface {
	ReclaimSegment(ctx context.Context, tenantID uuid.UUID, streamID, objectKey string) error
}

// PruneTarget identifies a tenant's stream whose journal the retention loop
// should sweep. The PruneSource resolves these across tenants (system path).
type PruneTarget struct {
	TenantID uuid.UUID
	StreamID uuid.UUID
}

// PruneSource yields the streams that have journal segments to consider for
// retention. The integration phase supplies a DB-backed system query (distinct
// stream_id from dr_journal_segment WHERE pruned=false); this package defines
// only the seam so the loop is unit-testable and never edits the shared
// repository.
type PruneSource interface {
	StreamsWithJournal(ctx context.Context, limit int) ([]PruneTarget, error)
}

// RetentionLoop is the leader-singleton background reaper: each tick it sweeps
// streams with journal coverage and prunes segments whose entire wall-clock
// range is older than the retention window AND that no bookmark falls inside.
// It mirrors the RPO monitor / clean-room loop lifecycle: started in the
// leader-election OnAcquire callback, stopped on OnLose.
type RetentionLoop struct {
	runner    TenantRunner
	source    PruneSource
	store     retentionStore
	reclaimer segmentReclaimer
	metrics   *Metrics
	logger    zerolog.Logger
	retention time.Duration
	interval  time.Duration
	batch     int
	now       func() time.Time
}

// RetentionConfig wires a RetentionLoop.
type RetentionConfig struct {
	Runner    TenantRunner
	Source    PruneSource
	Store     retentionStore
	Reclaimer segmentReclaimer
	Metrics   *Metrics
	Logger    zerolog.Logger
	// Retention is the rolling window: segments whose max_ts is older than
	// now-Retention are eligible for pruning (unless bookmarked). Default 7 days
	// (DESIGN §5 "keep all points < 7 days").
	Retention time.Duration
	Interval  time.Duration
	Batch     int
	Now       func() time.Time
}

// NewRetentionLoop constructs the retention reaper. Runner, Source and Store are
// required; a nil reclaimer tombstones index rows without an explicit object
// delete (GOVERNANCE lifecycle reclaims the bytes).
func NewRetentionLoop(cfg RetentionConfig) (*RetentionLoop, error) {
	if cfg.Runner == nil {
		return nil, errors.New("journal retention: tenant runner is required")
	}
	if cfg.Source == nil {
		return nil, errors.New("journal retention: prune source is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("journal retention: store is required")
	}
	if cfg.Retention <= 0 {
		cfg.Retention = 7 * 24 * time.Hour
	}
	if cfg.Interval <= 0 {
		cfg.Interval = time.Minute
	}
	if cfg.Batch <= 0 {
		cfg.Batch = 64
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &RetentionLoop{
		runner:    cfg.Runner,
		source:    cfg.Source,
		store:     cfg.Store,
		reclaimer: cfg.Reclaimer,
		metrics:   cfg.Metrics,
		logger:    cfg.Logger.With().Str("loop", "dr-journal-retention").Logger(),
		retention: cfg.Retention,
		interval:  cfg.Interval,
		batch:     cfg.Batch,
		now:       now,
	}, nil
}

// Run blocks until ctx is cancelled, sweeping retention each tick. It is
// launched in a goroutine from the leader-election OnAcquire callback. When a
// tick pruned a full batch it retries immediately so a backlog drains; otherwise
// it idle-polls at the interval.
func (l *RetentionLoop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		pruned, err := l.tick(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("journal retention tick failed")
		}
		if pruned >= l.batch {
			timer.Reset(0)
		} else {
			timer.Reset(l.interval)
		}
	}
}

// tick sweeps one batch of streams and prunes eligible segments. It returns the
// number of segments pruned. A failure on one stream is logged and the sweep
// continues — one bad stream must not stall the reaper.
func (l *RetentionLoop) tick(ctx context.Context) (int, error) {
	targets, err := l.source.StreamsWithJournal(ctx, l.batch)
	if err != nil {
		return 0, err
	}
	horizon := l.now().Add(-l.retention)
	total := 0
	for _, t := range targets {
		if ctx.Err() != nil {
			return total, ctx.Err()
		}
		n, err := l.PruneStream(ctx, t.TenantID, t.StreamID, horizon)
		if err != nil {
			l.logger.Error().Err(err).
				Str("tenant_id", t.TenantID.String()).
				Str("stream_id", t.StreamID.String()).
				Msg("journal retention prune failed")
			continue
		}
		total += n
	}
	return total, nil
}

// PruneStream reclaims a single stream's eligible segments older than horizon.
// It is exported so it can be driven directly (tests, an admin endpoint) as well
// as by the loop. Each segment is reclaimed under its own tenant transaction so
// the index tombstone + prune event commit together; the bookmark guard is
// re-checked in the UPDATE so a freshly created bookmark still protects its
// segment (no TOCTOU).
func (l *RetentionLoop) PruneStream(ctx context.Context, tenantID, streamID uuid.UUID, horizon time.Time) (int, error) {
	var candidates []Segment
	if err := l.runner.RunReadWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		candidates, err = l.store.PruneCandidates(ctx, tx, tenantID.String(), streamID.String(), horizon, l.batch)
		return err
	}); err != nil {
		return 0, fmt.Errorf("loading prune candidates stream=%s: %w", streamID, err)
	}

	pruned := 0
	for _, seg := range candidates {
		if ctx.Err() != nil {
			return pruned, ctx.Err()
		}
		ok, err := l.pruneOne(ctx, tenantID, streamID, seg)
		if err != nil {
			return pruned, err
		}
		if ok {
			pruned++
		}
	}
	return pruned, nil
}

// pruneOne tombstones one segment (with the re-checked bookmark guard) and emits
// the prune event in one tx, then reclaims the durable bytes. The byte reclaim
// runs AFTER the index commit so a crash between them leaves a tombstoned row
// whose object is reclaimed on the next sweep (idempotent), never a live row
// pointing at deleted bytes.
func (l *RetentionLoop) pruneOne(ctx context.Context, tenantID, streamID uuid.UUID, seg Segment) (bool, error) {
	var marked bool
	err := l.runner.RunWithTenant(ctx, tenantID, func(tx repository.DBTX) error {
		ok, err := l.store.MarkPruned(ctx, tx, PruneInput{
			TenantID: tenantID.String(),
			StreamID: streamID.String(),
			ID:       seg.ID,
		})
		if err != nil {
			return err
		}
		marked = ok
		if !ok {
			// Became bookmarked between selection and update, or already pruned.
			return nil
		}
		evt, err := events.NewEvent(EventTypeSegmentPruned, eventSource, tenantID.String(), map[string]any{
			"stream_id":  streamID.String(),
			"segment_id": seg.ID,
			"min_seq":    seg.MinSeq,
			"max_seq":    seg.MaxSeq,
			"max_ts":     seg.MaxTS,
			"object_key": seg.ObjectKey,
		})
		if err != nil {
			return fmt.Errorf("building segment-pruned event: %w", err)
		}
		return outbox.Write(ctx, tx, drEventsTopic, evt)
	})
	if err != nil {
		return false, fmt.Errorf("pruning segment stream=%s id=%s: %w", streamID, seg.ID, err)
	}
	if !marked {
		return false, nil
	}

	if l.reclaimer != nil {
		if err := l.reclaimer.ReclaimSegment(ctx, tenantID, streamID.String(), seg.ObjectKey); err != nil {
			// The index is already tombstoned; a reclaim failure is logged and the
			// object is retried on a later sweep (the row stays pruned), so we do
			// not roll back — the data is already logically gone from APIT.
			l.logger.Warn().Err(err).
				Str("stream_id", streamID.String()).
				Str("object_key", seg.ObjectKey).
				Msg("journal segment bytes reclaim failed; will retry")
		}
	}

	l.metrics.IncSegmentPruned(streamID.String())
	l.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Str("stream_id", streamID.String()).
		Str("segment_id", seg.ID).
		Int64("min_seq", seg.MinSeq).
		Int64("max_seq", seg.MaxSeq).
		Msg("journal segment pruned")
	return true, nil
}
