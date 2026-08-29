package monitor

import (
	"context"
	"sync"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/leadership"
)

// =============================================================================
// Leader-safety for the integration background monitors.
//
// The integration sync + rotation monitors are CROSS-TENANT, MUTATING tickers:
// the sync monitor dispatches IntegrationRegistryService.SyncNow (which can
// create/update/deactivate mapped org entities) and the rotation monitor can
// AUTO-ROTATE secrets. Running their bare .Run(ctx) on every replica means N
// replicas each fire the same scheduled sync/rotation concurrently — duplicate
// upstream pulls, racing watermarks, and (worst) N simultaneous secret
// rotations against one provider. They MUST run on exactly one replica at a time.
//
// RunLeader wraps the monitor's existing Run loop behind a leadership.Elector:
// the loop is (re)started in a fresh child context each time leadership is
// ACQUIRED and that context is cancelled each time leadership is LOST, so at
// most one replica's ticker is live. It mirrors workflow.RunLeaderSingleton's
// contract but lives here so the lex monitor package owns its own leader seam
// (no import cycle, unit-testable with a fake elector).
//
// Wiring (integrator, in cmd/lex-service/main.go): replace
//
//	go runBackground(ctx, logger, "lex-integration-sync-monitor", integrationSyncMonitor.Run)
//	go runBackground(ctx, logger, "lex-integration-rotation-monitor", integrationRotationMonitor.Run)
//
// with the leader-gated form when a leadership.Elector is available:
//
//	go runBackground(ctx, logger, "lex-integration-sync-monitor",
//	    func(ctx context.Context) error { return integrationSyncMonitor.RunLeader(ctx, syncElector, instanceID) })
//	go runBackground(ctx, logger, "lex-integration-rotation-monitor",
//	    func(ctx context.Context) error { return integrationRotationMonitor.RunLeader(ctx, rotateElector, instanceID) })
//
// Each monitor needs its OWN elector instance (its own lock key, e.g.
// "lex:integration-sync" / "lex:integration-rotation"); a nil elector falls
// back to the un-gated Run (single-replica / dev), so the existing wiring keeps
// working unchanged until the integrator opts in.
// =============================================================================

// leaderLoop is the minimal contract a monitor exposes to runLeaderGated: a
// ticker loop driven purely by ctx (returns when ctx is cancelled). Both the
// sync and rotation monitors' Run satisfy it.
type leaderLoop func(ctx context.Context) error

// runLeaderGated runs loop as a leader-elected singleton over the given elector.
// loop is started in a fresh child context each time leadership is acquired and
// that context is cancelled when leadership is lost, so exactly one replica's
// ticker is live at a time. It blocks until the parent ctx is cancelled (clean
// shutdown ⇒ nil) or the elector returns an unrecoverable error. A nil elector
// degrades to running loop directly (single-replica / dev), preserving the
// pre-leader behaviour so existing wiring is unaffected until opted in.
//
// loop MUST honour ctx cancellation and return promptly when ctx is done; it is
// invoked on its own goroutine and may be (re)invoked across leadership flaps,
// so it must be safe to start from a clean state each time (the integration
// tickers are stateless pollers, which they are).
func runLeaderGated(ctx context.Context, elector leadership.Elector, role, instanceID string, logger zerolog.Logger, loop leaderLoop) error {
	if elector == nil {
		// No elector wired: run the loop un-gated (single replica / dev). This
		// preserves the exact pre-leader behaviour. A clean ctx cancellation
		// (graceful shutdown) is normalised to nil, mirroring the leader path.
		err := loop(ctx)
		if err == context.Canceled || ctx.Err() != nil {
			return nil
		}
		return err
	}

	lg := logger.With().
		Str("component", "lex-integration-leader").
		Str("role", role).
		Str("instance", instanceID).
		Logger()

	// mu guards stopFn + wg so OnAcquire/OnLose (invoked from the elector loop)
	// and the final teardown never race.
	var (
		mu     sync.Mutex
		stopFn context.CancelFunc
		wg     sync.WaitGroup
	)

	start := func(parent context.Context) {
		mu.Lock()
		defer mu.Unlock()
		if stopFn != nil {
			// Already running (defensive: OnAcquire fired twice without an
			// intervening OnLose). Leave the existing invocation in place.
			return
		}
		loopCtx, cancel := context.WithCancel(parent)
		stopFn = cancel
		wg.Add(1)
		go func() {
			defer wg.Done()
			lg.Info().Msg("leadership acquired: starting integration monitor loop")
			if err := loop(loopCtx); err != nil && loopCtx.Err() == nil {
				lg.Error().Err(err).Msg("integration monitor loop exited with error while leader")
			}
		}()
	}

	stop := func() {
		mu.Lock()
		cancel := stopFn
		stopFn = nil
		mu.Unlock()
		if cancel != nil {
			lg.Info().Msg("leadership lost: stopping integration monitor loop")
			cancel()
		}
	}

	err := elector.Run(ctx, leadership.RunOpts{
		OnAcquire: func(acquireCtx context.Context) { start(acquireCtx) },
		OnLose:    func() { stop() },
	})

	// Teardown: ensure any active loop is cancelled and drained before returning.
	stop()
	wg.Wait()

	if err == nil || ctx.Err() != nil || err == context.Canceled {
		return nil
	}
	return err
}

// RunLeader runs the sync monitor's ticker as a leader-elected singleton over
// the given elector, so only one replica fans out scheduled syncs at a time. A
// nil elector degrades to the un-gated Run (single-replica / dev). See the
// package leader-safety note for wiring.
func (m *IntegrationSyncMonitor) RunLeader(ctx context.Context, elector leadership.Elector, instanceID string) error {
	return runLeaderGated(ctx, elector, "lex:integration-sync", instanceID, m.logger, m.Run)
}

// RunLeader runs the rotation monitor's ticker as a leader-elected singleton
// over the given elector, so only one replica performs scheduled rotations /
// reminders at a time — critical because AUTO-ROTATE mutates provider secrets. A
// nil elector degrades to the un-gated Run (single-replica / dev).
func (m *IntegrationRotationMonitor) RunLeader(ctx context.Context, elector leadership.Elector, instanceID string) error {
	return runLeaderGated(ctx, elector, "lex:integration-rotation", instanceID, m.logger, m.Run)
}
