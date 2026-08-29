package service

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
	"github.com/clario360/platform/internal/database"
)

// Claimer atomically claims runnable runs across all tenants for the leader
// driver (FOR UPDATE SKIP LOCKED, §6). *repository.Repository satisfies it via
// SystemClaimRunnableRuns. The predicate is PENDING|RUNNING only — an approval
// gate never auto-advances, so AWAITING_APPROVAL/ESCALATED and terminal runs are
// excluded.
type Claimer interface {
	SystemClaimRunnableRuns(ctx context.Context, db repository.DBTX, limit int) ([]*model.Run, error)
}

// GateLister lists OPEN gates past their deadline across all tenants for the
// leader timeout sweeper. *repository.Repository satisfies it via
// SystemListExpiredGates.
type GateLister interface {
	SystemListExpiredGates(ctx context.Context, db repository.DBTX, limit int) ([]*model.ApprovalGate, error)
}

// RunbookReader resolves a runbook step's timeout policy for the sweeper. The
// gate row records only the step index, so the sweeper loads the runbook to find
// the step's TimeoutAction. *repository.Repository satisfies it via GetRunbook.
type RunbookReader interface {
	GetRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Run, error)
	GetRunbook(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.Runbook, error)
}

// Driver is the run-advance surface the loop needs; *RunbookOrchestrator
// satisfies it. Advance owns its OWN transaction boundaries through the supplied
// TxRunner so an action step's Execute runs strictly OUTSIDE any DB transaction
// (the §4.6 integrate-phase contract). It advances the run by AT MOST one step
// and reports whether the run made durable progress (so the loop re-ticks
// immediately to drain a multi-step run without an interval wait per step).
type Driver interface {
	Advance(ctx context.Context, run *model.Run, txRun TxRunner) (bool, error)
}

// gateApplier is the timeout-resolution surface the sweeper needs; *GateService
// satisfies it via ApplyTimeout.
type gateApplier interface {
	ApplyTimeout(ctx context.Context, db repository.DBTX, gate *model.ApprovalGate, timeoutAction string) error
}

// txRunner runs fn inside a single transaction and commits on nil / rolls back
// on error. The default (systemTxRunner) wraps database.RunSystemTx; tests
// substitute an in-memory runner so the claim/advance separation is exercised
// without a live database. fn receives a repository.DBTX (pgx.Tx satisfies it).
// It is an alias of the orchestrator's exported TxRunner so the loop can pass
// its own runner straight through to Driver.Advance (the orchestrator owns its
// sub-transactions through it, keeping an action's Execute outside any tx).
type txRunner = TxRunner

// readRunner is the read-only counterpart (database.RunSystemRead by default).
type readRunner func(ctx context.Context, fn func(db repository.DBTX) error) error

// Loop is the leader-singleton claim loop that drives runnable automation runs
// forward one durable step at a time, and (on the same cadence) sweeps timed-out
// approval gates. It is started from the leadership-election OnAcquire callback
// and stopped when its context is cancelled (OnLose), exactly mirroring the DR
// failover loop.
//
// Each driver tick claims a batch of runnable runs in ONE system transaction
// (which immediately commits and releases the FOR UPDATE locks), then advances
// each claimed run by one step in its OWN system transaction — so the run step,
// the run status update, and the outbox event commit atomically while the
// FK-share lock the step insert takes can never deadlock against a still-held
// claim lock. AWAITING_APPROVAL/ESCALATED runs are never claimed (the §7 partial
// index excludes them), so a human gate parks the run without busy-looping; an
// external ApproveGate (or the sweeper) transitions it back to RUNNING and the
// next tick advances it.
type Loop struct {
	claimer   Claimer
	driver    Driver
	gates     GateLister
	runbooks  RunbookReader
	applier   gateApplier
	txRun     txRunner
	readRun   readRunner
	logger    zerolog.Logger
	pollEvery time.Duration
	batch     int
	// sweepEvery is the gate-timeout sweep cadence; the sweep runs at most this
	// often regardless of the (typically faster) driver poll.
	sweepEvery time.Duration
}

// LoopConfig wires a Loop.
type LoopConfig struct {
	// Pool is the database pool the default system-transaction runners use.
	// Required unless TxRunner and ReadRunner are both supplied (tests).
	Pool          *pgxpool.Pool
	Claimer       Claimer
	Driver        Driver
	Gates         GateLister
	Runbooks      RunbookReader
	GateApplier   gateApplier
	Logger        zerolog.Logger
	PollInterval  time.Duration
	BatchSize     int
	SweepInterval time.Duration

	// TxRunner / ReadRunner override the default database.RunSystemTx /
	// RunSystemRead wrappers. Production leaves them nil (the pool-backed
	// system-transaction runners are used); unit tests inject in-memory runners
	// so the claim/advance separate-transaction discipline is exercised without a
	// live database.
	TxRunner   txRunner
	ReadRunner readRunner
}

// NewLoop constructs the leader driver/sweeper loop.
func NewLoop(cfg LoopConfig) (*Loop, error) {
	if cfg.Pool == nil && (cfg.TxRunner == nil || cfg.ReadRunner == nil) {
		return nil, errors.New("automation loop: pool is required (or both TxRunner and ReadRunner)")
	}
	if cfg.Claimer == nil {
		return nil, errors.New("automation loop: claimer is required")
	}
	if cfg.Driver == nil {
		return nil, errors.New("automation loop: driver is required")
	}
	if cfg.Gates == nil {
		return nil, errors.New("automation loop: gate lister is required")
	}
	if cfg.Runbooks == nil {
		return nil, errors.New("automation loop: runbook reader is required")
	}
	if cfg.GateApplier == nil {
		return nil, errors.New("automation loop: gate applier is required")
	}
	if cfg.PollInterval <= 0 {
		cfg.PollInterval = 2 * time.Second
	}
	if cfg.BatchSize < 1 {
		cfg.BatchSize = 10
	}
	if cfg.SweepInterval <= 0 {
		cfg.SweepInterval = 30 * time.Second
	}
	pool := cfg.Pool
	txRun := cfg.TxRunner
	if txRun == nil {
		txRun = func(ctx context.Context, fn func(db repository.DBTX) error) error {
			return database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error { return fn(tx) })
		}
	}
	readRun := cfg.ReadRunner
	if readRun == nil {
		readRun = func(ctx context.Context, fn func(db repository.DBTX) error) error {
			return database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error { return fn(tx) })
		}
	}
	return &Loop{
		claimer:    cfg.Claimer,
		driver:     cfg.Driver,
		gates:      cfg.Gates,
		runbooks:   cfg.Runbooks,
		applier:    cfg.GateApplier,
		txRun:      txRun,
		readRun:    readRun,
		logger:     cfg.Logger,
		pollEvery:  cfg.PollInterval,
		batch:      cfg.BatchSize,
		sweepEvery: cfg.SweepInterval,
	}, nil
}

// Run blocks until ctx is cancelled, driving runs and sweeping gates. Launch it
// in a goroutine from the leader-election OnAcquire callback.
func (l *Loop) Run(ctx context.Context) {
	driveTimer := time.NewTimer(0)
	defer driveTimer.Stop()
	sweepTimer := time.NewTimer(l.sweepEvery)
	defer sweepTimer.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-driveTimer.C:
			advanced, err := l.driveOnce(ctx)
			if err != nil && !errors.Is(err, context.Canceled) {
				l.logger.Error().Err(err).Msg("automation driver tick failed")
			}
			// When work was done, re-tick immediately so a multi-step run
			// progresses without an interval wait per step; otherwise idle-poll.
			if advanced {
				driveTimer.Reset(0)
			} else {
				driveTimer.Reset(l.pollEvery)
			}
		case <-sweepTimer.C:
			if err := l.sweepGates(ctx); err != nil && !errors.Is(err, context.Canceled) {
				l.logger.Error().Err(err).Msg("automation gate sweep failed")
			}
			sweepTimer.Reset(l.sweepEvery)
		}
	}
}

// driveOnce claims a batch of runnable runs and advances each by one step.
// Returns whether any run was advanced (so the caller can re-tick immediately).
//
// Claim and advance run in SEPARATE transactions on purpose (the §6 rule copied
// from the DR loop): the claim takes FOR UPDATE SKIP LOCKED on the run rows and
// committing it (via the claim's own txRun) releases those locks BEFORE any
// advance runs. The advance then drives the run through the orchestrator, which
// owns its OWN transaction boundaries (prepare tx -> Execute outside any tx ->
// persist tx) so an action's external I/O never holds a DB transaction open and
// a rollback can never un-send an external action. Holding the claim lock across
// the advance would also deadlock against the FK-share lock the run-step insert
// takes; the separate claim tx prevents that. Because this loop is
// leader-singleton, no other driver competes for a claimed run between claim and
// advance.
func (l *Loop) driveOnce(ctx context.Context) (bool, error) {
	var runs []*model.Run
	if err := l.txRun(ctx, func(db repository.DBTX) error {
		var cerr error
		runs, cerr = l.claimer.SystemClaimRunnableRuns(ctx, db, l.batch)
		return cerr
	}); err != nil {
		return false, err
	}
	if len(runs) == 0 {
		return false, nil
	}

	advancedAny := false
	for _, run := range runs {
		if run.IsTerminal() || !run.IsRunnable() {
			// Defensive: the claim predicate already excludes these, but never
			// advance a parked/terminal run.
			continue
		}
		// The orchestrator owns each sub-transaction through l.txRun; the action's
		// Execute runs strictly between two committed transactions (never inside
		// one). The claim above already committed and released its locks.
		progressed, advErr := l.driver.Advance(ctx, run, l.txRun)
		if advErr != nil {
			if IsRecordedFailure(advErr) {
				// Terminal failure already recorded durably (failed step + failed
				// run + outbox event committed in the orchestrator's persist tx).
				l.logger.Warn().Err(advErr).Str("run_id", run.ID).Msg("automation run advance recorded a terminal failure")
				continue
			}
			// Persistence/programming failure: the run was left unchanged (or rolled
			// back) so it stays claimable and retries cleanly on the next tick. One
			// run's failure must not stall the batch; log and continue.
			l.logger.Error().Err(advErr).Str("run_id", run.ID).Str("status", run.Status).Msg("automation run advance failed before durable terminal recording")
			continue
		}
		if progressed {
			advancedAny = true
			l.logger.Debug().Str("run_id", run.ID).Str("status", run.Status).Msg("automation run advanced")
		}
	}
	return advancedAny, nil
}

// sweepGates lists OPEN gates past their deadline and applies each gate step's
// TimeoutAction policy (abort/escalate/auto_approve, §4.5). Each gate is resolved
// in its OWN system transaction so one gate's failure does not roll back others.
func (l *Loop) sweepGates(ctx context.Context) error {
	var gates []*model.ApprovalGate
	if err := l.readRun(ctx, func(db repository.DBTX) error {
		var lerr error
		gates, lerr = l.gates.SystemListExpiredGates(ctx, db, l.batch)
		return lerr
	}); err != nil {
		return err
	}
	for _, gate := range gates {
		policy, err := l.resolveTimeoutAction(ctx, gate)
		if err != nil {
			l.logger.Error().Err(err).Str("run_id", gate.RunID).Int("step_index", gate.StepIndex).Msg("resolving gate timeout policy failed")
			continue
		}
		applyErr := l.txRun(ctx, func(db repository.DBTX) error {
			return l.applier.ApplyTimeout(ctx, db, gate, policy)
		})
		if applyErr != nil {
			l.logger.Error().Err(applyErr).Str("run_id", gate.RunID).Int("step_index", gate.StepIndex).Msg("applying gate timeout failed")
			continue
		}
		l.logger.Info().Str("run_id", gate.RunID).Int("step_index", gate.StepIndex).Str("policy", policy).Msg("automation gate timeout applied")
	}
	return nil
}

// resolveTimeoutAction loads the runbook step that opened a gate and returns its
// TimeoutAction policy. It reads through the system path (cross-tenant leader
// loop). An unknown policy defaults to escalate (the safe, non-destructive
// choice) via ApplyTimeout, so a missing step here returns escalate.
func (l *Loop) resolveTimeoutAction(ctx context.Context, gate *model.ApprovalGate) (string, error) {
	policy := model.TimeoutActionEscalate
	err := l.readRun(ctx, func(db repository.DBTX) error {
		run, rerr := l.runbooks.GetRun(ctx, db, gate.TenantID, gate.RunID)
		if rerr != nil {
			return rerr
		}
		rb, rerr := l.runbooks.GetRunbook(ctx, db, gate.TenantID, run.RunbookID)
		if rerr != nil {
			return rerr
		}
		for _, s := range rb.Steps {
			if s.Index == gate.StepIndex && s.Type == model.StepTypeApprovalGate {
				if s.TimeoutAction != "" {
					policy = s.TimeoutAction
				}
				return nil
			}
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return policy, nil
}
