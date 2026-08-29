package gameday

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// StreamController is the real control surface the pause/resume fault drives. It
// is satisfied in the integrate phase by the DR replication manager (which
// pauses/resumes a replication_stream). Here it is an interface so the fault is
// unit-testable against a fake and so the package owns no shared-service code.
type StreamController interface {
	// PauseStream pauses replication for the stream. Reversible via ResumeStream.
	PauseStream(ctx context.Context, streamID string) error
	// ResumeStream resumes replication for a previously paused stream.
	ResumeStream(ctx context.Context, streamID string) error
}

// LagController sets and clears a SIMULATED lag/delay marker the RPO monitor
// observes — it does not actually delay real replication, it injects an
// observable lag signal into the (drill-scope) monitoring path so the platform's
// breach detection can be exercised. Wired to the real lag-marker store in
// integrate.
type LagController interface {
	// InduceLag sets a simulated lag of d for the stream. Reversible via ClearLag.
	InduceLag(ctx context.Context, streamID string, d time.Duration) error
	// ClearLag removes the simulated lag marker for the stream.
	ClearLag(ctx context.Context, streamID string) error
}

// SiteBlocker marks a site unreachable WITHIN A SANDBOX SCOPE ONLY (never
// production network). Wired to the drill-scope reachability sandbox in
// integrate. Reversible via UnblockSite.
type SiteBlocker interface {
	// BlockSite marks the site unreachable in the sandbox scope.
	BlockSite(ctx context.Context, siteID string) error
	// UnblockSite restores the site's reachability in the sandbox scope.
	UnblockSite(ctx context.Context, siteID string) error
}

// Revert tears down an injected fault. It is returned by FaultInjector.Inject
// and the orchestrator runs it via defer, so a fault is ALWAYS rolled back —
// even if a later step fails or panics. Implementations MUST be idempotent and
// safe to call once; the orchestrator guarantees exactly-once invocation, but a
// Revert that is accidentally called twice must not error or double-act.
type Revert func(ctx context.Context) error

// noopRevert is a Revert that does nothing (used when an injection failed before
// acquiring any resource to roll back).
func noopRevert(context.Context) error { return nil }

// FaultInjector injects a controlled, reversible fault and returns its teardown.
// Inject performs the side effect; the returned Revert undoes it. If Inject
// returns an error it MUST have left nothing to revert (it returns a no-op
// Revert), so the caller's defer is always safe to run.
type FaultInjector interface {
	// Action returns the fault action this injector handles (an Action* constant).
	Action() string
	// Observability reports whether this fault is system-observable (the platform
	// genuinely reacts and the scored signal is real) or harness-only (a self-test
	// nothing in the observation path reads). It is an Observability* constant and
	// is recorded on every step's scorecard row.
	Observability() string
	// Inject performs the fault for step and returns a Revert that undoes it.
	Inject(ctx context.Context, step Step) (Revert, error)
}

// onceRevert wraps a Revert so it runs AT MOST ONCE regardless of how many times
// it is invoked, and reports whether it actually ran. This is the mechanism that
// guarantees "every injected fault is reverted exactly once": the orchestrator's
// defer calls it, and any explicit early revert also calls it, but the
// underlying teardown side effect happens a single time.
type onceRevert struct {
	mu   sync.Mutex
	fn   Revert
	done bool
	err  error
}

func newOnceRevert(fn Revert) *onceRevert {
	if fn == nil {
		fn = noopRevert
	}
	return &onceRevert{fn: fn}
}

// run executes the wrapped Revert if it has not already run, returning whether
// this call performed the teardown and any error from it.
func (o *onceRevert) run(ctx context.Context) (ran bool, err error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.done {
		return false, o.err
	}
	o.done = true
	o.err = o.fn(ctx)
	return true, o.err
}

// reverted reports whether the teardown has run.
func (o *onceRevert) reverted() bool {
	o.mu.Lock()
	defer o.mu.Unlock()
	return o.done
}

// --- Real fault implementations -------------------------------------------

// PauseStreamFault pauses a replication stream and resumes it on revert. The
// pause is real (it calls the StreamController); the revert resumes the exact
// stream that was paused. The revert is registered as the deferred teardown so
// the stream is resumed even if a later step fails or the orchestrator panics.
type PauseStreamFault struct {
	ctrl StreamController
}

// NewPauseStreamFault constructs the pause/resume fault over a StreamController.
func NewPauseStreamFault(ctrl StreamController) *PauseStreamFault {
	return &PauseStreamFault{ctrl: ctrl}
}

// Action reports the action this injector handles.
func (f *PauseStreamFault) Action() string { return ActionPauseStream }

// Observability: pausing a stream is a real DB state change both the RPO monitor
// and the topology health rollup observe, so the scored signal is a real reaction.
func (f *PauseStreamFault) Observability() string { return ObservabilitySystemObservable }

// Inject pauses step.Target's stream and returns a Revert that resumes it.
func (f *PauseStreamFault) Inject(ctx context.Context, step Step) (Revert, error) {
	if f.ctrl == nil {
		return noopRevert, fmt.Errorf("%s: stream controller not configured", ActionPauseStream)
	}
	streamID := step.Target
	if streamID == "" {
		return noopRevert, fmt.Errorf("%s: step target (stream id) is required", ActionPauseStream)
	}
	if err := f.ctrl.PauseStream(ctx, streamID); err != nil {
		// Nothing was paused, so there is nothing to revert.
		return noopRevert, fmt.Errorf("%s: pausing stream %s: %w", ActionPauseStream, streamID, err)
	}
	return func(revertCtx context.Context) error {
		if err := f.ctrl.ResumeStream(revertCtx, streamID); err != nil {
			return fmt.Errorf("%s: resuming stream %s: %w", ActionPauseStream, streamID, err)
		}
		return nil
	}, nil
}

// InduceLagFault sets a simulated lag marker on a stream and clears it on revert.
// The lag is a marker the RPO monitor observes (drill-scope), not a real
// throttle of production replication.
type InduceLagFault struct {
	ctrl LagController
	// defaultLag is used when a step supplies no explicit lag.
	defaultLag time.Duration
}

// NewInduceLagFault constructs the induce-lag fault over a LagController. The
// defaultLag (e.g. 10m) applies when a step does not set params["lag"].
func NewInduceLagFault(ctrl LagController, defaultLag time.Duration) *InduceLagFault {
	if defaultLag <= 0 {
		defaultLag = 10 * time.Minute
	}
	return &InduceLagFault{ctrl: ctrl, defaultLag: defaultLag}
}

// Action reports the action this injector handles.
func (f *InduceLagFault) Action() string { return ActionInduceLag }

// Observability: the induced lag is written to the durable drill-scope lag marker
// the PREDICT forecaster honors (it adds the marker to each sampled lag), so an
// induced lag genuinely raises the smoothed lag and flips breach_forecast — the
// scored signal is a real platform reaction.
func (f *InduceLagFault) Observability() string { return ObservabilitySystemObservable }

// Inject sets a simulated lag on step.Target's stream and returns a Revert that
// clears it. The lag amount comes from step.Params["lag"] (a Go duration string
// or a number of seconds) and falls back to the configured default.
func (f *InduceLagFault) Inject(ctx context.Context, step Step) (Revert, error) {
	if f.ctrl == nil {
		return noopRevert, fmt.Errorf("%s: lag controller not configured", ActionInduceLag)
	}
	streamID := step.Target
	if streamID == "" {
		return noopRevert, fmt.Errorf("%s: step target (stream id) is required", ActionInduceLag)
	}
	lag := f.lagFor(step)
	if err := f.ctrl.InduceLag(ctx, streamID, lag); err != nil {
		return noopRevert, fmt.Errorf("%s: inducing %s lag on stream %s: %w", ActionInduceLag, lag, streamID, err)
	}
	return func(revertCtx context.Context) error {
		if err := f.ctrl.ClearLag(revertCtx, streamID); err != nil {
			return fmt.Errorf("%s: clearing lag on stream %s: %w", ActionInduceLag, streamID, err)
		}
		return nil
	}, nil
}

// lagFor resolves the lag amount for a step: an explicit params["lag"] (duration
// string like "10m" or a number interpreted as seconds), else the default.
func (f *InduceLagFault) lagFor(step Step) time.Duration {
	raw, ok := step.Params["lag"]
	if !ok {
		return f.defaultLag
	}
	switch v := raw.(type) {
	case string:
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	case float64:
		if v > 0 {
			return time.Duration(v) * time.Second
		}
	case int:
		if v > 0 {
			return time.Duration(v) * time.Second
		}
	case int64:
		if v > 0 {
			return time.Duration(v) * time.Second
		}
	}
	return f.defaultLag
}

// BlockSiteFault marks a site unreachable in the sandbox scope and unblocks it on
// revert. It NEVER touches a production network — the SiteBlocker is the
// drill-scope reachability sandbox.
type BlockSiteFault struct {
	blocker SiteBlocker
}

// NewBlockSiteFault constructs the block-site fault over a SiteBlocker.
func NewBlockSiteFault(blocker SiteBlocker) *BlockSiteFault {
	return &BlockSiteFault{blocker: blocker}
}

// Action reports the action this injector handles.
func (f *BlockSiteFault) Action() string { return ActionBlockSite }

// Observability: blocking a site flips its TOPOLOGY edges to 'unhealthy' through
// the real topology overlay, so dr_topology_edge.health genuinely changes and the
// topology_degraded signal fires — the scored signal is a real platform reaction.
func (f *BlockSiteFault) Observability() string { return ObservabilitySystemObservable }

// Inject marks step.Target's site unreachable and returns a Revert that unblocks it.
func (f *BlockSiteFault) Inject(ctx context.Context, step Step) (Revert, error) {
	if f.blocker == nil {
		return noopRevert, fmt.Errorf("%s: site blocker not configured", ActionBlockSite)
	}
	siteID := step.Target
	if siteID == "" {
		return noopRevert, fmt.Errorf("%s: step target (site id) is required", ActionBlockSite)
	}
	if err := f.blocker.BlockSite(ctx, siteID); err != nil {
		return noopRevert, fmt.Errorf("%s: blocking site %s: %w", ActionBlockSite, siteID, err)
	}
	return func(revertCtx context.Context) error {
		if err := f.blocker.UnblockSite(revertCtx, siteID); err != nil {
			return fmt.Errorf("%s: unblocking site %s: %w", ActionBlockSite, siteID, err)
		}
		return nil
	}, nil
}

// Registry resolves a fault action to its injector. The orchestrator looks up
// the injector for each step's action; a step whose action has no registered
// injector fails with ErrUnknownAction (the fault is never injected, so there is
// nothing to revert).
type Registry struct {
	injectors map[string]FaultInjector
}

// NewRegistry builds a fault-injector registry from the given injectors, keyed by
// each injector's Action(). A later injector for the same action wins.
func NewRegistry(injectors ...FaultInjector) *Registry {
	r := &Registry{injectors: make(map[string]FaultInjector, len(injectors))}
	for _, in := range injectors {
		if in == nil {
			continue
		}
		r.injectors[in.Action()] = in
	}
	return r
}

// Injector returns the injector for an action, or false.
func (r *Registry) Injector(action string) (FaultInjector, bool) {
	in, ok := r.injectors[action]
	return in, ok
}

// compile-time checks that the real faults satisfy the injector interface.
var (
	_ FaultInjector = (*PauseStreamFault)(nil)
	_ FaultInjector = (*InduceLagFault)(nil)
	_ FaultInjector = (*BlockSiteFault)(nil)
)
