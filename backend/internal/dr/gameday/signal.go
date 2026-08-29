package gameday

import (
	"context"
	"time"
)

// Signal is one platform-response observation the orchestrator polls for: did a
// predicted signal (a lag alert, predicted-breach, ransomware detection,
// topology degradation, …) fire for a given target, and when.
type Signal struct {
	// Kind is the signal type (matches an Expectation.Signal, e.g. "lag_alert").
	Kind string
	// Target is the entity the signal concerns (a stream id, a site id, …).
	Target string
	// ObservedAt is when the signal was raised. The orchestrator uses it together
	// with the fault-injection time to compute detection latency.
	ObservedAt time.Time
}

// SignalSource is the platform-response surface the orchestrator polls between
// steps. In integrate it is wired to the real DR alert/predict/ransomware/
// topology signal stores; here it is an interface so detection scoring is
// exercised against a scripted source in tests.
//
// LatestSignal returns the most recent signal of kind for target observed at or
// after `since`, or (zero, false) when none has fired yet. It MUST be safe for
// repeated polling (the orchestrator calls it on a short interval).
type SignalSource interface {
	LatestSignal(ctx context.Context, kind, target string, since time.Time) (Signal, bool, error)
}

// pollOutcome is the result of polling a SignalSource for a window.
type pollOutcome struct {
	// observed is true when the signal fired within the window.
	observed bool
	// signal is the observed signal (valid only when observed).
	signal Signal
	// latency is the measured time from `since` to the observation (valid only
	// when observed).
	latency time.Duration
}

// poller polls a SignalSource on a fixed interval until the signal fires or a
// deadline trips. It is injected with a clock and a sleep function so tests run
// deterministically without real time passing.
type poller struct {
	src      SignalSource
	now      func() time.Time
	sleep    func(ctx context.Context, d time.Duration) error
	interval time.Duration
}

// newPoller constructs a poller. interval defaults to a sane value when <= 0.
func newPoller(src SignalSource, now func() time.Time, sleep func(context.Context, time.Duration) error, interval time.Duration) *poller {
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	if sleep == nil {
		sleep = realSleep
	}
	if interval <= 0 {
		interval = 250 * time.Millisecond
	}
	return &poller{src: src, now: now, sleep: sleep, interval: interval}
}

// awaitSignal polls for a `kind`/`target` signal raised at or after `since`,
// giving up after `window`. It returns the measured detection latency relative to
// `since`. The first poll happens immediately (a signal that already fired is
// detected with ~0 latency); subsequent polls wait `interval` until the window
// is exhausted.
func (p *poller) awaitSignal(ctx context.Context, kind, target string, since time.Time, window time.Duration) (pollOutcome, error) {
	deadline := since.Add(window)
	for {
		sig, ok, err := p.src.LatestSignal(ctx, kind, target, since)
		if err != nil {
			return pollOutcome{}, err
		}
		if ok {
			latency := sig.ObservedAt.Sub(since)
			if latency < 0 {
				latency = 0
			}
			return pollOutcome{observed: true, signal: sig, latency: latency}, nil
		}
		now := p.now()
		if !now.Before(deadline) {
			return pollOutcome{observed: false}, nil
		}
		// Sleep until the next poll, but not past the deadline.
		wait := p.interval
		if remaining := deadline.Sub(now); remaining < wait {
			wait = remaining
		}
		if wait <= 0 {
			return pollOutcome{observed: false}, nil
		}
		if err := p.sleep(ctx, wait); err != nil {
			return pollOutcome{}, err
		}
	}
}

// awaitCleared polls until the signal STOPS firing (recovery): it returns the
// time from `since` to the first poll where no signal at/after `clearedAfter` is
// present, giving up after `window`. It is the recovery-latency measurement: a
// previously-firing signal that no longer fires means the platform recovered.
func (p *poller) awaitCleared(ctx context.Context, kind, target string, since, clearedAfter time.Time, window time.Duration) (pollOutcome, error) {
	deadline := since.Add(window)
	for {
		_, ok, err := p.src.LatestSignal(ctx, kind, target, clearedAfter)
		if err != nil {
			return pollOutcome{}, err
		}
		if !ok {
			latency := p.now().Sub(since)
			if latency < 0 {
				latency = 0
			}
			return pollOutcome{observed: true, latency: latency}, nil
		}
		now := p.now()
		if !now.Before(deadline) {
			return pollOutcome{observed: false}, nil
		}
		wait := p.interval
		if remaining := deadline.Sub(now); remaining < wait {
			wait = remaining
		}
		if wait <= 0 {
			return pollOutcome{observed: false}, nil
		}
		if err := p.sleep(ctx, wait); err != nil {
			return pollOutcome{}, err
		}
	}
}

// realSleep blocks for d or until ctx is cancelled.
func realSleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
