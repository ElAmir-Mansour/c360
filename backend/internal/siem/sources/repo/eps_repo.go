package repo

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/sources"
)

// EPSRepo is the data-access layer for siem.source_eps_samples.
type EPSRepo struct {
	db Querier
}

// NewEPSRepo constructs an EPSRepo.
func NewEPSRepo(db Querier) *EPSRepo {
	return &EPSRepo{db: db}
}

// Insert writes a new EPS sample. Bound by primary key (source_id, ts);
// duplicate ts within a second is rejected.
func (r *EPSRepo) Insert(ctx context.Context, s sources.EPSSample) error {
	if r == nil || r.db == nil {
		return errors.New("eps_repo: nil db")
	}
	const q = `
INSERT INTO siem.source_eps_samples
  (source_id, ts, eps_1min, eps_5min, parser_errors_1min, dropped_1min, queue_depth, collector_version)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
ON CONFLICT (source_id, ts) DO NOTHING`
	tag, err := r.db.Exec(ctx, q,
		s.SourceID, s.TS, s.EPS1Min, s.EPS5Min,
		s.ParserErrors1Min, s.Dropped1Min, s.QueueDepth, nullableString(s.CollectorVersion),
	)
	if err != nil {
		return fmt.Errorf("eps insert: %w", err)
	}
	_ = tag
	return nil
}

// Latest returns the most recent sample for sourceID or nil if none
// exist within the lookback window.
func (r *EPSRepo) Latest(ctx context.Context, sourceID uuid.UUID, lookback time.Duration) (*sources.EPSSample, error) {
	if r == nil || r.db == nil {
		return nil, errors.New("eps_repo: nil db")
	}
	const q = `
SELECT source_id, ts, eps_1min, eps_5min, parser_errors_1min, dropped_1min, queue_depth, COALESCE(collector_version,'')
FROM siem.source_eps_samples
WHERE source_id = $1 AND ts >= $2
ORDER BY ts DESC
LIMIT 1`
	row := r.db.QueryRow(ctx, q, sourceID, time.Now().UTC().Add(-lookback))
	var s sources.EPSSample
	if err := row.Scan(&s.SourceID, &s.TS, &s.EPS1Min, &s.EPS5Min, &s.ParserErrors1Min, &s.Dropped1Min, &s.QueueDepth, &s.CollectorVersion); err != nil {
		return nil, nil //nolint:nilerr // absence is not an error here
	}
	return &s, nil
}

// AggregateLastHour returns parser_errors_1h and dropped_1h totals.
func (r *EPSRepo) AggregateLastHour(ctx context.Context, sourceID uuid.UUID) (parserErrors, dropped int, err error) {
	if r == nil || r.db == nil {
		return 0, 0, errors.New("eps_repo: nil db")
	}
	const q = `
SELECT COALESCE(SUM(parser_errors_1min),0), COALESCE(SUM(dropped_1min),0)
FROM siem.source_eps_samples
WHERE source_id = $1 AND ts >= now() - interval '1 hour'`
	row := r.db.QueryRow(ctx, q, sourceID)
	if err := row.Scan(&parserErrors, &dropped); err != nil {
		return 0, 0, fmt.Errorf("eps aggregate: %w", err)
	}
	return parserErrors, dropped, nil
}

// PruneOlderThan removes samples older than the cutoff. Returns the
// row count.
func (r *EPSRepo) PruneOlderThan(ctx context.Context, cutoff time.Time) (int64, error) {
	if r == nil || r.db == nil {
		return 0, errors.New("eps_repo: nil db")
	}
	const q = `DELETE FROM siem.source_eps_samples WHERE ts < $1`
	tag, err := r.db.Exec(ctx, q, cutoff)
	if err != nil {
		return 0, fmt.Errorf("eps prune: %w", err)
	}
	return tag.RowsAffected(), nil
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}
