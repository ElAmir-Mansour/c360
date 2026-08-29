package runbookstudio

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog"
)

// activeRunLister returns the non-terminal runs across all tenants for the
// projection loop. *Store satisfies it via SystemListActiveRuns.
//
// SYSTEM PATH — background-loop only; bypasses tenant RLS by design (dr_db §7).
type activeRunLister interface {
	SystemListActiveRuns(ctx context.Context, db DBTX) ([]Run, error)
}

// runReconciler reconciles a single run (fails it if stalled). *Service satisfies
// it via ReconcileRun.
type runReconciler interface {
	ReconcileRun(ctx context.Context, run Run) (bool, error)
}

// systemReader runs a read-only system (RLS-bypass) transaction so the loop can
// scan runs across tenants. PGXRunner satisfies it (it wraps the pool); tests
// substitute fakeRunner. This keeps the loop free of a direct pool dependency and
// fully unit-testable.
type systemReader interface {
	RunSystemRead(ctx context.Context, fn func(DBTX) error) error
}

// Loop is the leader-singleton reconciliation loop for Runbook Studio runs. It
// periodically scans non-terminal runs across all tenants and FAILS any that have
// STALLED — no runnable frontier, no work in flight, required tasks outstanding
// (the symptom of a required task having failed and blocked the rest without an
// operator explicitly failing the run). It complements the request-driven
// ActOnTask path: that path completes/fails a run synchronously on the action
// that decides it, while the loop is the safety net for runs that became
// un-progressable between actions. It does NOT auto-complete runs (completion is
// an operator/automation outcome) — it only resolves stalls into a durable FAILED
// status with a reason, mirroring the failover.Loop singleton pattern.
//
// The loop is started in the leader-election OnAcquire callback and stopped in
// OnLose. It holds no per-run lock beyond the reconciler's own transaction; being
// a singleton, no other instance competes.
type Loop struct {
	reader     systemReader
	lister     activeRunLister
	reconciler runReconciler
	logger     zerolog.Logger
	interval   time.Duration
}

// LoopConfig wires a Loop. Reader is a system-read transaction runner (PGXRunner
// in production); Lister + Reconciler are typically the *Store and *Service.
type LoopConfig struct {
	Reader     systemReader
	Lister     activeRunLister
	Reconciler runReconciler
	Logger     zerolog.Logger
	Interval   time.Duration
}

// NewLoop constructs the reconciliation loop.
func NewLoop(cfg LoopConfig) (*Loop, error) {
	if cfg.Reader == nil {
		return nil, errors.New("studio loop: reader is required")
	}
	if cfg.Lister == nil {
		return nil, errors.New("studio loop: lister is required")
	}
	if cfg.Reconciler == nil {
		return nil, errors.New("studio loop: reconciler is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = 15 * time.Second
	}
	return &Loop{
		reader:     cfg.Reader,
		lister:     cfg.Lister,
		reconciler: cfg.Reconciler,
		logger:     cfg.Logger,
		interval:   cfg.Interval,
	}, nil
}

// Run blocks until ctx is cancelled, scanning and reconciling active runs each
// interval. It is intended to be launched in a goroutine from leader election.
func (l *Loop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if err := l.tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("studio reconciliation tick failed")
		}
		timer.Reset(l.interval)
	}
}

// tick scans every active run and reconciles it. Listing runs across tenants is a
// system-path read; each run's reconciliation runs in its own system transaction
// inside the reconciler so a single bad run does not abort the whole scan.
func (l *Loop) tick(ctx context.Context) error {
	var runs []Run
	if err := l.reader.RunSystemRead(ctx, func(tx DBTX) error {
		var lerr error
		runs, lerr = l.lister.SystemListActiveRuns(ctx, tx)
		return lerr
	}); err != nil {
		return err
	}
	for _, run := range runs {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		changed, err := l.reconciler.ReconcileRun(ctx, run)
		if err != nil {
			l.logger.Error().Err(err).Str("run_id", run.ID).Msg("studio run reconciliation failed")
			continue
		}
		if changed {
			l.logger.Info().Str("run_id", run.ID).Msg("studio run failed by reconciliation loop (stalled)")
		}
	}
	return nil
}

// compile-time checks.
var (
	_ activeRunLister = (*Store)(nil)
	_ runReconciler   = (*Service)(nil)
	_ systemReader    = PGXRunner{}
)
