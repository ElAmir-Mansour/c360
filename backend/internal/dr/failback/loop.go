package failback

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// Claimer atomically claims the next advanceable failback run across all tenants
// (FOR UPDATE SKIP LOCKED, §6.2). *Store satisfies it via SystemClaimRun. Returns
// (nil, nil) when there is nothing to claim.
type Claimer interface {
	SystemClaimRun(ctx context.Context, db repository.DBTX) (*FailbackRun, error)
}

// systemTxRunner runs fn inside a system (RLS-bypassing) transaction. Each call
// is a distinct transaction boundary, which is how the loop keeps the claim and
// the advance in SEPARATE transactions. *pgxpool.Pool is adapted to this via
// poolSystemTxRunner (database.RunSystemTx); a test runner records boundaries.
type systemTxRunner interface {
	RunSystemTx(ctx context.Context, fn func(db repository.DBTX) error) error
}

type poolSystemTxRunner struct {
	pool *pgxpool.Pool
}

func (r poolSystemTxRunner) RunSystemTx(ctx context.Context, fn func(db repository.DBTX) error) error {
	return database.RunSystemTx(ctx, r.pool, func(tx pgx.Tx) error { return fn(tx) })
}

// Loop is the leader-singleton claim loop that drives non-terminal, non-await
// failback runs forward one durable state at a time (DESIGN §6.2, mirroring the
// failover Loop). It is started in the leader-election OnAcquire callback and
// stopped in OnLose, like the RPO monitor and the failover driver.
//
// Each tick claims one run in one system transaction and advances it by exactly
// one state in a SEPARATE system transaction, so the dr_failback_step row, the
// dr_failback_run status update, and the outbox event commit atomically.
// AWAITING_CUTBACK_APPROVAL runs are never claimed (the §7 partial index excludes
// them), so the human cutback gate parks the run without busy-looping; an external
// /approve-cutback transitions it to CUTTING_BACK and the next tick picks it up.
type Loop struct {
	runner   systemTxRunner
	claimer  Claimer
	driver   *Driver
	logger   zerolog.Logger
	interval time.Duration
}

// LoopConfig wires a Loop.
type LoopConfig struct {
	Pool     *pgxpool.Pool
	Claimer  Claimer
	Driver   *Driver
	Logger   zerolog.Logger
	Interval time.Duration
	// runner overrides the pool-backed system-tx runner; set only in tests to
	// assert the claim/advance separate-transaction discipline without a database.
	runner systemTxRunner
}

// NewLoop constructs the failback claim loop.
func NewLoop(cfg LoopConfig) (*Loop, error) {
	runner := cfg.runner
	if runner == nil {
		if cfg.Pool == nil {
			return nil, errors.New("failback loop: pool is required")
		}
		runner = poolSystemTxRunner{pool: cfg.Pool}
	}
	if cfg.Claimer == nil {
		return nil, errors.New("failback loop: claimer is required")
	}
	if cfg.Driver == nil {
		return nil, errors.New("failback loop: driver is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 2 * time.Second
	}
	return &Loop{
		runner:   runner,
		claimer:  cfg.Claimer,
		driver:   cfg.Driver,
		logger:   cfg.Logger,
		interval: cfg.Interval,
	}, nil
}

// Run blocks until ctx is cancelled, advancing claimed runs. Launch it in a
// goroutine from the leader-election OnAcquire callback.
func (l *Loop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		advanced, err := l.tick(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("failback driver tick failed")
		}
		// When a run advanced, retry immediately so a multi-state run progresses
		// without an interval wait per gate; otherwise idle-poll.
		if advanced {
			timer.Reset(0)
		} else {
			timer.Reset(l.interval)
		}
	}
}

// tick claims at most one run and advances it by one state. Returns whether a run
// was advanced (so the caller can re-tick immediately).
//
// Claim and advance run in SEPARATE transactions on purpose, mirroring the
// failover loop. The claim (SystemClaimRun) takes a FOR UPDATE SKIP LOCKED lock on
// the dr_failback_run row; committing it immediately stamps claimed_at and
// RELEASES that lock. The advance then runs in its own transaction. This matters
// because a dr_failback_step insert takes a foreign-key SHARE lock on the parent
// dr_failback_run row; if the claim's FOR UPDATE lock were still held across the
// advance, that FK lock would deadlock. Because this loop is a leader-singleton,
// no other driver competes for the same run between claim and advance.
func (l *Loop) tick(ctx context.Context) (bool, error) {
	var run *FailbackRun
	if err := l.runner.RunSystemTx(ctx, func(db repository.DBTX) error {
		var cerr error
		run, cerr = l.claimer.SystemClaimRun(ctx, db)
		return cerr
	}); err != nil {
		return false, err
	}
	if run == nil {
		return false, nil // nothing to claim
	}
	if run.IsTerminal() || run.Status == StatusAwaitingCutbackApproval {
		return false, nil // parked or done; nothing to advance
	}

	prevStatus := run.Status
	advErr := l.runner.RunSystemTx(ctx, func(db repository.DBTX) error {
		if cerr := l.driver.Advance(ctx, db, run); cerr != nil {
			if IsRecordedFailure(cerr) {
				// Step failure already recorded (failed step + FAILED status +
				// outbox) inside this tx; commit so the failure is durable.
				l.logger.Warn().Err(cerr).Str("run_id", run.ID).Str("status", prevStatus).Msg("failback run advance returned recorded failure")
				return nil
			}
			// Persistence/programming failure: roll back so the run retries cleanly.
			l.logger.Error().Err(cerr).Str("run_id", run.ID).Str("status", prevStatus).Msg("failback run advance failed before durable terminal recording")
			return cerr
		}
		return nil
	})
	if advErr != nil {
		return false, advErr
	}

	l.logger.Debug().Str("run_id", run.ID).Str("from_status", prevStatus).Str("to_status", run.Status).Msg("failback run advanced")
	return true, nil
}
