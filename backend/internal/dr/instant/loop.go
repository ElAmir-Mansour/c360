package instant

import (
	"context"
	"errors"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
)

// loopDriver is the subset of *Service the HydrateLoop drives. Declared as an
// interface so the loop's claim/dispatch logic is unit-tested without a DB.
type loopDriver interface {
	HydrateOnce(ctx context.Context, sess *Session) (HydrateResult, error)
	FinalizeSession(ctx context.Context, sess *Session) error
	failSession(ctx context.Context, sess *Session, cause error)
}

// loopStore is the claim surface the loop reads through (satisfied by *Store).
type loopStore interface {
	ClaimActiveSessions(ctx context.Context, db repository.DBTX, limit int) ([]*Session, error)
}

// loopSystemRunner runs the cross-tenant claim on the system (RLS-bypass) path.
type loopSystemRunner interface {
	RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error
}

// HydrateLoop is the leader-singleton background loop that drives lazy
// hydration and deferred finalization for every active instant-recovery session.
// On each tick it claims the sessions still HYDRATING or FINALIZING (across
// tenants, on the system path) and advances each one: a HYDRATING session gets a
// throttled hydration pass (which itself transitions to READY when complete); a
// FINALIZING session gets its standalone-copy assembly completed. It mirrors the
// failover Driver and the copilot PruneLoop: launch it from the leader-election
// OnAcquire callback so exactly one process runs it.
type HydrateLoop struct {
	driver   loopDriver
	store    loopStore
	system   loopSystemRunner
	logger   zerolog.Logger
	interval time.Duration
	batch    int
}

// HydrateLoopConfig wires a HydrateLoop.
type HydrateLoopConfig struct {
	Driver   loopDriver
	Store    loopStore
	System   loopSystemRunner
	Logger   zerolog.Logger
	Interval time.Duration // tick cadence; <= 0 defaults to defaultLoopInterval
	Batch    int           // sessions advanced per tick; <= 0 defaults to defaultLoopBatch
}

const (
	defaultLoopInterval = 2 * time.Second
	defaultLoopBatch    = 16
)

// NewHydrateLoop constructs the hydration loop.
func NewHydrateLoop(cfg HydrateLoopConfig) (*HydrateLoop, error) {
	if cfg.Driver == nil {
		return nil, errors.New("instant hydrate loop: driver is required")
	}
	if cfg.Store == nil {
		return nil, errors.New("instant hydrate loop: store is required")
	}
	if cfg.System == nil {
		return nil, errors.New("instant hydrate loop: system runner is required")
	}
	if cfg.Interval <= 0 {
		cfg.Interval = defaultLoopInterval
	}
	if cfg.Batch <= 0 {
		cfg.Batch = defaultLoopBatch
	}
	return &HydrateLoop{
		driver:   cfg.Driver,
		store:    cfg.Store,
		system:   cfg.System,
		logger:   cfg.Logger.With().Str("component", "dr_instant_loop").Logger(),
		interval: cfg.Interval,
		batch:    cfg.Batch,
	}, nil
}

// Run blocks until ctx is cancelled, ticking every interval. Launch it from the
// leader-election OnAcquire callback so a single instance drives hydration.
func (l *HydrateLoop) Run(ctx context.Context) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		if err := l.Tick(ctx); err != nil && !errors.Is(err, context.Canceled) {
			l.logger.Error().Err(err).Msg("instant recovery hydrate tick failed")
		}
		timer.Reset(l.interval)
	}
}

// Tick advances one batch of active sessions. It claims the sessions on the
// system write path, then advances each one outside the claim (hydration and
// finalize manage their own transactions), so a slow session does not hold the
// claim lock. Per-session errors are isolated: one failing session is marked
// FAILED and the rest still progress. Tick is exported so tests drive it deterministically.
func (l *HydrateLoop) Tick(ctx context.Context) error {
	var sessions []*Session
	if err := l.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		var cerr error
		sessions, cerr = l.store.ClaimActiveSessions(ctx, db, l.batch)
		return cerr
	}); err != nil {
		return err
	}

	for _, sess := range sessions {
		if err := ctx.Err(); err != nil {
			return err
		}
		l.advance(ctx, sess)
	}
	return nil
}

// advance progresses one session by its current state. HYDRATING -> a hydration
// pass; FINALIZING -> complete the standalone copy. A failure marks the session
// FAILED and is logged, never propagated, so the batch continues.
func (l *HydrateLoop) advance(ctx context.Context, sess *Session) {
	switch sess.State {
	case StateHydrating:
		if _, err := l.driver.HydrateOnce(ctx, sess); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			l.driver.failSession(ctx, sess, err)
		}
	case StateFinalizing:
		if err := l.driver.FinalizeSession(ctx, sess); err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			l.driver.failSession(ctx, sess, err)
		}
	default:
		// Claimed but no longer actionable (e.g. transitioned between claim and
		// dispatch); skip.
	}
}
