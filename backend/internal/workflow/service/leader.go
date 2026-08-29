package service

import (
	"context"
	"errors"
	"sync"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/leadership"
)

// RunLeaderSingleton runs fn as a leader-elected singleton: it is started in a
// fresh child context exactly once each time leadership is acquired, and that
// context is cancelled each time leadership is lost. This is the single wrapper
// the integrate phase uses to make the scheduler timer/SLA loops, the recovery
// service, and the cron-trigger scheduler run on exactly one replica at a time.
//
// fn MUST honour ctx cancellation and return promptly when ctx is done; it is
// invoked on its own goroutine. fn may be (re)invoked multiple times over the
// lifetime of a process — every leadership re-acquisition starts a brand-new
// invocation with a brand-new context, so fn must be safe to start from a clean
// state each time (the underlying loops here are stateless pollers, which is).
//
// RunLeaderSingleton blocks until the elector's Run returns, which happens when
// the parent ctx is cancelled (graceful shutdown) or the elector hits an
// unrecoverable error (e.g. ErrInvalidConfig). On return the active fn context,
// if any, is cancelled so fn is guaranteed to be stopping. The error from the
// elector is returned, except context.Canceled which is treated as a clean
// shutdown and reported as nil.
//
// The role is the leadership lock identity (one logical loop per role across the
// fleet); instanceID uniquely identifies this replica. A nil elector is a
// programming error and returns leadership.ErrInvalidConfig without running fn.
func RunLeaderSingleton(
	ctx context.Context,
	elector leadership.Elector,
	role, instanceID string,
	logger zerolog.Logger,
	fn func(ctx context.Context),
) error {
	if elector == nil {
		return leadership.ErrInvalidConfig
	}
	if fn == nil {
		return errors.New("workflow: RunLeaderSingleton requires a non-nil fn")
	}

	lg := logger.With().
		Str("component", "workflow-leader-singleton").
		Str("role", role).
		Str("instance", instanceID).
		Logger()

	// mu guards stopFn and wg so OnAcquire/OnLose (which the elector may invoke
	// from its loop) and the final teardown never race.
	var (
		mu     sync.Mutex
		stopFn context.CancelFunc
		wg     sync.WaitGroup
	)

	// cancelActive cancels and clears the currently-running fn, if any, and waits
	// for it to return. Callers must NOT hold mu (it is taken internally) so the
	// wg.Wait happens without blocking concurrent OnAcquire/OnLose.
	cancelActive := func() {
		mu.Lock()
		cancel := stopFn
		stopFn = nil
		mu.Unlock()
		if cancel != nil {
			cancel()
			wg.Wait()
		}
	}

	err := elector.Run(ctx, leadership.RunOpts{
		OnAcquire: func(parent context.Context) {
			// Defensively stop any prior invocation before starting a new one so
			// we never run two copies of fn simultaneously on this replica.
			cancelActive()

			leaderCtx, cancel := context.WithCancel(parent)
			mu.Lock()
			stopFn = cancel
			wg.Add(1)
			mu.Unlock()

			lg.Info().Msg("leadership acquired; starting singleton loop")
			go func() {
				defer wg.Done()
				fn(leaderCtx)
			}()
		},
		OnLose: func() {
			lg.Warn().Msg("leadership lost; stopping singleton loop")
			cancelActive()
		},
	})

	// Guaranteed teardown: whatever caused Run to return, ensure fn is stopped.
	cancelActive()

	if err != nil && !errors.Is(err, context.Canceled) {
		return err
	}
	return nil
}
