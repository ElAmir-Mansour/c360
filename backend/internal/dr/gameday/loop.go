package gameday

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
)

// claimer atomically claims the next pending run across all tenants (FOR UPDATE
// SKIP LOCKED, §6.2 driver pattern). *Store satisfies it via SystemClaimRun.
type claimer interface {
	SystemClaimRun(ctx context.Context, db DBTX) (*Run, error)
	SystemGetScenario(ctx context.Context, db DBTX, id string) (*Scenario, error)
}

// Loop is the leader-singleton claim loop that executes pending game-day runs
// (DESIGN §6.2 driver pattern, reused from the failover driver). It is started in
// the leader-election OnAcquire callback and stopped in OnLose. Each tick claims
// one pending run, loads its scenario, and hands it to the Orchestrator, which
// runs the full inject -> observe -> score -> revert cycle. Because the
// orchestrator always reverts every injected fault (even on error/panic), a
// crashed tick never strands a fault.
//
// This complements the failover.Driver: that loop advances gated FAILOVER runs;
// this loop drives controlled-chaos GAME-DAY exercises. They are independent
// singletons over disjoint tables.
type Loop struct {
	pool         *pgxpool.Pool
	claimer      claimer
	orchestrator *Orchestrator
	logger       zerolog.Logger
	interval     time.Duration
}

// LoopConfig wires a Loop.
type LoopConfig struct {
	Pool         *pgxpool.Pool
	Claimer      claimer
	Orchestrator *Orchestrator
	Logger       zerolog.Logger
	Interval     time.Duration
}

// NewLoop constructs the claim loop.
func NewLoop(cfg LoopConfig) (*Loop, error) {
	if cfg.Pool == nil {
		return nil, errors.New("gameday loop: pool is required")
	}
	if cfg.Claimer == nil {
		return nil, errors.New("gameday loop: claimer is required")
	}
	if cfg.Orchestrator == nil {
		return nil, errors.New("gameday loop: orchestrator is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 2 * time.Second
	}
	return &Loop{
		pool:         cfg.Pool,
		claimer:      cfg.Claimer,
		orchestrator: cfg.Orchestrator,
		logger:       cfg.Logger,
		interval:     cfg.Interval,
	}, nil
}

// Run blocks until ctx is cancelled, executing claimed runs. It is intended to be
// launched in a goroutine from the leader-election OnAcquire callback.
func (l *Loop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		claimed, err := l.tick(ctx)
		if err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("gameday orchestrator tick failed")
		}
		// When a run was claimed and executed, try again immediately so a backlog
		// drains promptly; otherwise idle-poll.
		if claimed {
			timer.Reset(0)
		} else {
			timer.Reset(l.interval)
		}
	}
}

// tick claims at most one pending run and executes it. Returns whether a run was
// claimed. The claim runs in its own transaction (committing releases the FOR
// UPDATE SKIP LOCKED lock and stamps the run running) before the orchestrator
// executes — so the per-step writes cannot deadlock on the FK lock, exactly as
// the failover loop does.
func (l *Loop) tick(ctx context.Context) (bool, error) {
	var run *Run
	if err := database.RunSystemTx(ctx, l.pool, func(tx pgx.Tx) error {
		var cerr error
		run, cerr = l.claimer.SystemClaimRun(ctx, tx)
		return cerr
	}); err != nil {
		return false, err
	}
	if run == nil {
		return false, nil // nothing to claim
	}

	var scenario *Scenario
	if err := database.RunSystemRead(ctx, l.pool, func(tx pgx.Tx) error {
		var serr error
		scenario, serr = l.claimer.SystemGetScenario(ctx, tx, run.ScenarioID)
		return serr
	}); err != nil {
		return true, err
	}

	// Execute through the orchestrator. ErrProductionScope is an expected,
	// already-recorded terminal outcome (the run is aborted/rejected_production),
	// so it is not a tick error.
	if _, err := l.orchestrator.Execute(ctx, run, scenario); err != nil && !errors.Is(err, ErrProductionScope) {
		l.logger.Error().Err(err).Str("run_id", run.ID).Msg("gameday run execution failed")
		return true, err
	}
	l.logger.Debug().Str("run_id", run.ID).Str("scope", run.Scope).Msg("gameday run executed")
	return true, nil
}
