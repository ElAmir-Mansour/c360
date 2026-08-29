package copilot

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// pruneStore is the persistence surface the retention loop needs (satisfied by
// *Store). Declared as an interface so the loop is unit-testable without a DB.
type pruneStore interface {
	PruneSessionsOlderThan(ctx context.Context, db repository.DBTX, cutoff time.Time) (int64, error)
}

// SystemRunner runs a function on the cross-tenant system path (RLS bypassed),
// as the leader-singleton background loops do everywhere in dr_db. The DR
// service's PGXSystemRunner satisfies it; tests inject a fake.
type SystemRunner interface {
	RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error
}

// PruneLoop is the leader-singleton retention loop: it periodically deletes
// copilot sessions (and, via ON DELETE CASCADE, their messages) older than the
// retention window so the audit log does not grow unbounded. It runs on the
// system path so it sweeps every tenant in one pass, mirroring the failover
// driver and RPO monitor loops.
type PruneLoop struct {
	runner    SystemRunner
	store     pruneStore
	metrics   *Metrics
	logger    zerolog.Logger
	retention time.Duration
	interval  time.Duration
	now       func() time.Time
}

// PruneLoopConfig wires a PruneLoop.
type PruneLoopConfig struct {
	Runner    SystemRunner
	Store     pruneStore
	Metrics   *Metrics
	Logger    zerolog.Logger
	Retention time.Duration // session age after last activity before pruning
	Interval  time.Duration // sweep interval
	Now       func() time.Time
}

// Default retention/sweep cadence for the copilot audit log.
const (
	defaultPruneRetention = 90 * 24 * time.Hour
	defaultPruneInterval  = 6 * time.Hour
)

// NewPruneLoop constructs the retention loop.
func NewPruneLoop(cfg PruneLoopConfig) (*PruneLoop, error) {
	if cfg.Runner == nil {
		return nil, errors.New("copilot prune loop: system runner is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("copilot prune loop: store is required")
	}
	if cfg.Retention <= 0 {
		cfg.Retention = defaultPruneRetention
	}
	if cfg.Interval <= 0 {
		cfg.Interval = defaultPruneInterval
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &PruneLoop{
		runner:    cfg.Runner,
		store:     cfg.Store,
		metrics:   cfg.Metrics,
		logger:    cfg.Logger.With().Str("component", "dr_copilot_prune").Logger(),
		retention: cfg.Retention,
		interval:  cfg.Interval,
		now:       now,
	}, nil
}

// Run blocks until ctx is cancelled, sweeping expired sessions each interval.
// Launch it from the leader-election OnAcquire callback.
func (l *PruneLoop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if pruned, err := l.Sweep(ctx); err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("copilot session prune sweep failed")
		} else if pruned > 0 {
			l.logger.Info().Int64("pruned", pruned).Msg("pruned expired copilot sessions")
		}
		timer.Reset(l.interval)
	}
}

// Sweep deletes sessions older than the retention window in one system
// transaction and records the count. It is exported so it can be exercised
// directly in tests and invoked on demand.
func (l *PruneLoop) Sweep(ctx context.Context) (int64, error) {
	cutoff := l.now().Add(-l.retention)
	var pruned int64
	err := l.runner.RunSystemTx(ctx, func(db repository.DBTX) error {
		n, perr := l.store.PruneSessionsOlderThan(ctx, db, cutoff)
		if perr != nil {
			return perr
		}
		pruned = n
		return nil
	})
	if err != nil {
		return 0, err
	}
	l.metrics.AddSessionsPruned(pruned)
	return pruned, nil
}
