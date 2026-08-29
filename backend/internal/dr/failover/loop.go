package failover

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// Claimer atomically claims the next advanceable run across all tenants
// (FOR UPDATE SKIP LOCKED, §6.2). *repository.Repository satisfies it via
// SystemClaimFailoverRun. Returns (nil, nil) when there is nothing to claim.
type Claimer interface {
	SystemClaimFailoverRun(ctx context.Context, db repository.DBTX) (*model.FailoverRun, error)
}

// Loop is the leader-singleton claim loop that drives non-terminal,
// non-await failover/drill runs forward one durable state at a time
// (DESIGN_DataStream_DR.md §6.2). It is started in the leader-election
// OnAcquire callback and stopped in OnLose, mirroring the RPO monitor.
//
// Each tick claims one run and advances it by exactly one state inside a single
// system transaction, so the failover_step row, the failover_run status update,
// and the outbox event commit atomically. AWAITING_APPROVAL runs are never
// claimed (the §7 partial index excludes them), so a human gate parks the run
// without busy-looping; an external /approve transitions it and the next tick
// picks it up.
type Loop struct {
	pool    *pgxpool.Pool
	claimer Claimer
	driver  *Driver
	logger  zerolog.Logger
	// interval is the idle poll interval (when nothing was claimed). When a run
	// is advanced the loop immediately tries again so a multi-step run completes
	// promptly without waiting a full interval per gate.
	interval time.Duration
	// onComplete is an optional post-completion hook invoked AFTER a run reaches
	// COMPLETED (outside the advance transaction). It is how a drill's isolated
	// environment is torn down (WP-11) once the attestation has committed.
	onComplete func(ctx context.Context, run *model.FailoverRun)
}

// LoopConfig wires a Loop.
type LoopConfig struct {
	Pool     *pgxpool.Pool
	Claimer  Claimer
	Driver   *Driver
	Logger   zerolog.Logger
	Interval time.Duration
	// OnComplete is invoked (outside the advance transaction) after a run reaches
	// COMPLETED — used to tear down a drill's isolated environment (WP-11).
	OnComplete func(ctx context.Context, run *model.FailoverRun)
}

// NewLoop constructs the claim loop.
func NewLoop(cfg LoopConfig) (*Loop, error) {
	if cfg.Pool == nil {
		return nil, errors.New("failover loop: pool is required")
	}
	if cfg.Claimer == nil {
		return nil, errors.New("failover loop: claimer is required")
	}
	if cfg.Driver == nil {
		return nil, errors.New("failover loop: driver is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 2 * time.Second
	}
	return &Loop{
		pool:       cfg.Pool,
		claimer:    cfg.Claimer,
		driver:     cfg.Driver,
		logger:     cfg.Logger,
		interval:   cfg.Interval,
		onComplete: cfg.OnComplete,
	}, nil
}

// Run blocks until ctx is cancelled, advancing claimed runs. It is intended to
// be launched in a goroutine from the leader-election OnAcquire callback.
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
			l.logger.Error().Err(err).Msg("failover driver tick failed")
		}
		// When a run advanced, try again immediately so a multi-gate run
		// progresses without an interval wait per gate; otherwise idle-poll.
		if advanced {
			timer.Reset(0)
		} else {
			timer.Reset(l.interval)
		}
	}
}

// tick claims at most one run and advances it by one state. Returns whether a
// run was advanced (so the caller can re-tick immediately).
//
// Claim and advance run in SEPARATE transactions on purpose. The claim
// (SystemClaimFailoverRun) takes a FOR UPDATE SKIP LOCKED lock on the
// failover_run row; committing it immediately stamps claimed_at and RELEASES
// that lock. The advance then runs in its own transaction. This is required for
// the EXECUTING gate: the recovery executor records per-member boot steps in
// their own durable transactions (for crash-idempotency), and a failover_step
// insert takes a foreign-key SHARE lock on the parent failover_run row. If the
// claim's FOR UPDATE lock were still held across the advance, that FK lock would
// deadlock. Because this loop is a leader-singleton, no other driver competes
// for the same run between claim and advance.
func (l *Loop) tick(ctx context.Context) (bool, error) {
	var run *model.FailoverRun
	if err := database.RunSystemTx(ctx, l.pool, func(tx pgx.Tx) error {
		var cerr error
		run, cerr = l.claimer.SystemClaimFailoverRun(ctx, tx)
		return cerr
	}); err != nil {
		return false, err
	}
	if run == nil {
		return false, nil // nothing to claim
	}
	if run.IsTerminal() || run.Status == model.StatusAwaitingApproval {
		return false, nil // parked or done; nothing to advance
	}

	advErr := database.RunSystemTx(ctx, l.pool, func(tx pgx.Tx) error {
		if cerr := l.driver.Advance(ctx, tx, run); cerr != nil {
			if IsRecordedFailure(cerr) {
				// Gate failure already recorded (failed step + terminal status +
				// outbox) inside this tx; commit so the failure is durable.
				l.logger.Warn().Err(cerr).Str("run_id", run.ID).Str("status", run.Status).Msg("failover run advance returned recorded gate failure")
				return nil
			}
			// Persistence/programming failure while advancing or while recording a
			// gate failure: roll back the tx so the run can be retried cleanly.
			l.logger.Error().Err(cerr).Str("run_id", run.ID).Str("status", run.Status).Msg("failover run advance failed before durable terminal recording")
			return cerr
		}
		return nil
	})
	if advErr != nil {
		return false, advErr
	}

	l.logger.Debug().Str("run_id", run.ID).Str("status", run.Status).Str("mode", run.Mode).Msg("failover run advanced")
	// Post-completion hook (outside the advance tx): drill teardown. The
	// attestation has already committed, so the recovery point is untouched and
	// the isolated environment can now be discarded.
	if run.Status == model.StatusCompleted && l.onComplete != nil {
		l.onComplete(ctx, run)
	}
	return true, nil
}
