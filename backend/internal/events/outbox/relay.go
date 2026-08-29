package outbox

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// Publisher publishes events to the bus. *events.Producer satisfies it.
type Publisher interface {
	Publish(ctx context.Context, topic string, event *events.Event) error
}

// DB is the subset of *pgxpool.Pool the relay needs.
type DB interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Config tunes the relay. Zero values are replaced with production defaults.
type Config struct {
	// PollInterval is how often the relay looks for due pending rows.
	PollInterval time.Duration
	// BatchSize is the maximum rows claimed per poll.
	BatchSize int
	// MaxAttempts is the number of publish attempts before a row is parked
	// as failed for operator triage.
	MaxAttempts int
	// RetryBackoffBase is the delay before the second attempt; subsequent
	// attempts double it up to RetryBackoffCap.
	RetryBackoffBase time.Duration
	// RetryBackoffCap bounds the exponential backoff.
	RetryBackoffCap time.Duration
	// PublishTimeout bounds a single publish call to the bus.
	PublishTimeout time.Duration
	// ClaimTimeout is the visibility timeout: rows stuck in 'publishing'
	// longer than this (relay crash mid-batch) are returned to 'pending'.
	ClaimTimeout time.Duration
	// RetentionPeriod is how long published rows are kept before purge.
	RetentionPeriod time.Duration
	// MaintenanceInterval is the cadence of the reap + purge + gauge pass.
	MaintenanceInterval time.Duration
}

func (c Config) withDefaults() Config {
	if c.PollInterval <= 0 {
		c.PollInterval = time.Second
	}
	if c.BatchSize <= 0 {
		c.BatchSize = 100
	}
	if c.MaxAttempts <= 0 {
		c.MaxAttempts = 10
	}
	if c.RetryBackoffBase <= 0 {
		c.RetryBackoffBase = 2 * time.Second
	}
	if c.RetryBackoffCap <= 0 {
		c.RetryBackoffCap = 5 * time.Minute
	}
	if c.PublishTimeout <= 0 {
		c.PublishTimeout = 10 * time.Second
	}
	if c.ClaimTimeout <= 0 {
		c.ClaimTimeout = time.Minute
	}
	if c.RetentionPeriod <= 0 {
		c.RetentionPeriod = 24 * time.Hour
	}
	if c.MaintenanceInterval <= 0 {
		c.MaintenanceInterval = time.Minute
	}
	return c
}

// Relay claims staged outbox rows and publishes them to the bus.
//
// Multiple relay instances are safe against the same table: the claim
// statement uses FOR UPDATE SKIP LOCKED and flips rows to 'publishing', so
// no two instances ever hold the same row. No leader election is required.
type Relay struct {
	db         DB
	publisher  Publisher
	serializer *events.Serializer
	cfg        Config
	logger     zerolog.Logger
	metrics    *Metrics
}

// NewRelay constructs a relay. metrics may be nil, in which case metrics are
// registered on a private registry (useful in tests); pass the service's
// registry in production.
func NewRelay(db DB, publisher Publisher, cfg Config, logger zerolog.Logger, metrics *Metrics) *Relay {
	if metrics == nil {
		metrics = NewMetrics(nil)
	}
	return &Relay{
		db:         db,
		publisher:  publisher,
		serializer: events.NewSerializer(),
		cfg:        cfg.withDefaults(),
		logger:     logger.With().Str("component", "outbox-relay").Logger(),
		metrics:    metrics,
	}
}

// Run polls until ctx is cancelled, draining due rows every PollInterval and
// running maintenance (reap, purge, gauges) every MaintenanceInterval.
// It returns nil on graceful shutdown.
func (r *Relay) Run(ctx context.Context) error {
	poll := time.NewTicker(r.cfg.PollInterval)
	defer poll.Stop()
	maintenance := time.NewTicker(r.cfg.MaintenanceInterval)
	defer maintenance.Stop()

	r.logger.Info().
		Dur("poll_interval", r.cfg.PollInterval).
		Int("batch_size", r.cfg.BatchSize).
		Int("max_attempts", r.cfg.MaxAttempts).
		Msg("outbox relay started")

	for {
		select {
		case <-ctx.Done():
			r.logger.Info().Msg("outbox relay stopped")
			return nil
		case <-poll.C:
			r.drain(ctx)
		case <-maintenance.C:
			r.maintain(ctx)
		}
	}
}

// drain claims and publishes batches until the table is caught up.
func (r *Relay) drain(ctx context.Context) {
	for {
		claimed, err := r.RunOnce(ctx)
		if err != nil {
			r.logger.Error().Err(err).Msg("outbox drain pass failed")
			return
		}
		// A short batch means the backlog is cleared.
		if claimed < r.cfg.BatchSize || ctx.Err() != nil {
			return
		}
	}
}

const claimSQL = `
UPDATE event_outbox SET status = 'publishing', attempts = attempts + 1, claimed_at = now()
WHERE id IN (
    SELECT id FROM event_outbox
    WHERE status = 'pending' AND next_attempt_at <= now()
    ORDER BY created_at
    LIMIT $1
    FOR UPDATE SKIP LOCKED
)
RETURNING id, event_id, tenant_id, topic, event_type, payload, attempts`

// RunOnce claims one batch of due rows and processes each, returning the
// number of rows claimed. Exported so callers can drive the relay from their
// own scheduler and so tests can step it deterministically.
func (r *Relay) RunOnce(ctx context.Context) (int, error) {
	rows, err := r.claim(ctx)
	if err != nil {
		return 0, err
	}
	if len(rows) == 0 {
		return 0, nil
	}

	r.metrics.ClaimBatchSize.Observe(float64(len(rows)))

	for i := range rows {
		if ctx.Err() != nil {
			// Remaining claimed rows are recovered by the reaper after
			// ClaimTimeout — shutdown must not block on the bus.
			return len(rows), nil
		}
		r.process(ctx, &rows[i])
	}
	return len(rows), nil
}

func (r *Relay) claim(ctx context.Context) ([]Row, error) {
	result, err := r.db.Query(ctx, claimSQL, r.cfg.BatchSize)
	if err != nil {
		return nil, fmt.Errorf("claiming outbox rows: %w", err)
	}
	defer result.Close()

	var rows []Row
	for result.Next() {
		var row Row
		if err := result.Scan(&row.ID, &row.EventID, &row.TenantID, &row.Topic, &row.EventType, &row.Payload, &row.Attempts); err != nil {
			return nil, fmt.Errorf("scanning outbox row: %w", err)
		}
		rows = append(rows, row)
	}
	if err := result.Err(); err != nil {
		return nil, fmt.Errorf("reading outbox rows: %w", err)
	}
	return rows, nil
}

// process publishes one claimed row and records the outcome. DB errors while
// recording an outcome leave the row in 'publishing'; the reaper returns it
// to 'pending' after ClaimTimeout, which is where at-least-once comes from.
func (r *Relay) process(ctx context.Context, row *Row) {
	event, err := r.serializer.Deserialize(row.Payload)
	if err != nil {
		// A payload that cannot deserialize will never publish — park it
		// immediately rather than burning retries.
		r.fail(ctx, row, fmt.Sprintf("payload deserialization: %v", err))
		return
	}

	publishCtx, cancel := context.WithTimeout(ctx, r.cfg.PublishTimeout)
	defer cancel()

	start := time.Now()
	err = r.publisher.Publish(publishCtx, row.Topic, event)
	r.metrics.PublishDuration.Observe(time.Since(start).Seconds())

	switch {
	case err == nil:
		r.markPublished(ctx, row)
	case row.Attempts >= r.cfg.MaxAttempts:
		r.fail(ctx, row, fmt.Sprintf("attempt %d/%d: %v", row.Attempts, r.cfg.MaxAttempts, err))
	default:
		r.scheduleRetry(ctx, row, err)
	}
}

const markPublishedSQL = `UPDATE event_outbox SET status = 'published', published_at = now(), last_error = NULL WHERE id = $1`

func (r *Relay) markPublished(ctx context.Context, row *Row) {
	if _, err := r.db.Exec(ctx, markPublishedSQL, row.ID); err != nil {
		r.logger.Error().Err(err).Str("outbox_id", row.ID).Str("event_id", row.EventID).
			Msg("published event could not be marked; row will be reaped and republished")
		return
	}
	r.metrics.PublishedTotal.WithLabelValues(row.Topic).Inc()
	r.logger.Debug().Str("event_id", row.EventID).Str("topic", row.Topic).Int("attempts", row.Attempts).
		Msg("outbox event published")
}

const scheduleRetrySQL = `UPDATE event_outbox SET status = 'pending', claimed_at = NULL, next_attempt_at = $2, last_error = $3 WHERE id = $1`

func (r *Relay) scheduleRetry(ctx context.Context, row *Row, cause error) {
	nextAttempt := time.Now().UTC().Add(r.backoff(row.Attempts))
	if _, err := r.db.Exec(ctx, scheduleRetrySQL, row.ID, nextAttempt, cause.Error()); err != nil {
		r.logger.Error().Err(err).Str("outbox_id", row.ID).Msg("scheduling outbox retry failed")
		return
	}
	r.metrics.RetriedTotal.WithLabelValues(row.Topic).Inc()
	r.logger.Warn().Err(cause).Str("event_id", row.EventID).Str("topic", row.Topic).
		Int("attempts", row.Attempts).Time("next_attempt_at", nextAttempt).
		Msg("outbox publish failed; retry scheduled")
}

const failSQL = `UPDATE event_outbox SET status = 'failed', claimed_at = NULL, last_error = $2 WHERE id = $1`

func (r *Relay) fail(ctx context.Context, row *Row, reason string) {
	if _, err := r.db.Exec(ctx, failSQL, row.ID, reason); err != nil {
		r.logger.Error().Err(err).Str("outbox_id", row.ID).Msg("parking failed outbox row failed")
		return
	}
	r.metrics.FailedTotal.WithLabelValues(row.Topic).Inc()
	r.logger.Error().Str("event_id", row.EventID).Str("topic", row.Topic).Str("reason", reason).
		Msg("outbox event parked as failed; operator action required")
}

// backoff returns the delay before the next attempt: base doubled per failed
// attempt, bounded by the cap. attempts is the count already consumed.
func (r *Relay) backoff(attempts int) time.Duration {
	d := r.cfg.RetryBackoffBase
	for i := 1; i < attempts; i++ {
		d *= 2
		if d >= r.cfg.RetryBackoffCap {
			return r.cfg.RetryBackoffCap
		}
	}
	if d > r.cfg.RetryBackoffCap {
		return r.cfg.RetryBackoffCap
	}
	return d
}

// maintain runs one reap + purge + gauge pass.
func (r *Relay) maintain(ctx context.Context) {
	if n, err := r.ReapStuck(ctx); err != nil {
		r.logger.Error().Err(err).Msg("outbox reap failed")
	} else if n > 0 {
		r.logger.Warn().Int64("rows", n).Msg("requeued outbox rows stuck in publishing")
	}

	if n, err := r.PurgePublished(ctx); err != nil {
		r.logger.Error().Err(err).Msg("outbox purge failed")
	} else if n > 0 {
		r.logger.Debug().Int64("rows", n).Msg("purged published outbox rows")
	}

	if err := r.updatePendingGauge(ctx); err != nil {
		r.logger.Error().Err(err).Msg("outbox pending gauge update failed")
	}
}

const reapSQL = `UPDATE event_outbox SET status = 'pending', claimed_at = NULL, next_attempt_at = now() WHERE status = 'publishing' AND claimed_at < $1`

// ReapStuck returns rows stuck in 'publishing' beyond ClaimTimeout to
// 'pending' so another relay pass can claim them.
func (r *Relay) ReapStuck(ctx context.Context) (int64, error) {
	cutoff := time.Now().UTC().Add(-r.cfg.ClaimTimeout)
	tag, err := r.db.Exec(ctx, reapSQL, cutoff)
	if err != nil {
		return 0, fmt.Errorf("reaping stuck outbox rows: %w", err)
	}
	n := tag.RowsAffected()
	if n > 0 {
		r.metrics.ReapedTotal.Add(float64(n))
	}
	return n, nil
}

const purgeSQL = `DELETE FROM event_outbox WHERE status = 'published' AND published_at < $1`

// PurgePublished deletes published rows older than RetentionPeriod.
func (r *Relay) PurgePublished(ctx context.Context) (int64, error) {
	cutoff := time.Now().UTC().Add(-r.cfg.RetentionPeriod)
	tag, err := r.db.Exec(ctx, purgeSQL, cutoff)
	if err != nil {
		return 0, fmt.Errorf("purging published outbox rows: %w", err)
	}
	n := tag.RowsAffected()
	if n > 0 {
		r.metrics.PurgedTotal.Add(float64(n))
	}
	return n, nil
}

const pendingCountSQL = `SELECT count(*) FROM event_outbox WHERE status = 'pending'`

func (r *Relay) updatePendingGauge(ctx context.Context) error {
	rows, err := r.db.Query(ctx, pendingCountSQL)
	if err != nil {
		return fmt.Errorf("counting pending outbox rows: %w", err)
	}
	defer rows.Close()

	var pending int64
	if rows.Next() {
		if err := rows.Scan(&pending); err != nil {
			return fmt.Errorf("scanning pending outbox count: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("reading pending outbox count: %w", err)
	}
	r.metrics.PendingRows.Set(float64(pending))
	return nil
}
