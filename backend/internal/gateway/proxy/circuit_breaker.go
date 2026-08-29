package proxy

import (
	"sync"
	"time"
)

// CircuitState represents the state of a circuit breaker.
type CircuitState int

const (
	CircuitClosed   CircuitState = 0
	CircuitHalfOpen CircuitState = 1
	CircuitOpen     CircuitState = 2
)

func (s CircuitState) String() string {
	switch s {
	case CircuitClosed:
		return "closed"
	case CircuitHalfOpen:
		return "half-open"
	case CircuitOpen:
		return "open"
	default:
		return "unknown"
	}
}

// CircuitBreakerConfig holds circuit breaker settings.
type CircuitBreakerConfig struct {
	FailureThreshold   int           // Consecutive failures to open (default: 5)
	FailureRateWindow  time.Duration // Window for failure rate calculation (default: 10s)
	FailureRatePercent float64       // Failure rate % to open (default: 50)
	OpenTimeout        time.Duration // Duration to stay open before half-open (default: 30s)
	HalfOpenSuccesses  int           // Successes in half-open to close (default: 3)
}

// DefaultCircuitBreakerConfig returns sensible defaults.
func DefaultCircuitBreakerConfig() CircuitBreakerConfig {
	return CircuitBreakerConfig{
		FailureThreshold:   5,
		FailureRateWindow:  10 * time.Second,
		FailureRatePercent: 50,
		OpenTimeout:        30 * time.Second,
		HalfOpenSuccesses:  3,
	}
}

// CircuitBreaker implements the circuit breaker pattern for a single backend service.
type CircuitBreaker struct {
	mu                  sync.RWMutex
	state               CircuitState
	cfg                 CircuitBreakerConfig
	consecutiveFailures int
	consecutiveSuccess  int
	windowRequests      []requestResult
	lastStateChange     time.Time
	forced              bool // when true, automatic transitions are suppressed until Reset
	// onTransition is invoked (without holding the lock) after every state change.
	// It lets the gateway keep gw_circuit_breaker_state / _trips_total in sync.
	onTransition func(from, to CircuitState)
	// pending holds transitions recorded while the lock is held; flushTransitions
	// fires the onTransition callback for each after the lock is released.
	pending []stateTransition
}

type stateTransition struct {
	from CircuitState
	to   CircuitState
}

// CircuitSnapshot is a point-in-time read-only view of a breaker's internals,
// used by the gateway admin API (G18).
type CircuitSnapshot struct {
	State               CircuitState
	ConsecutiveFailures int
	LastStateChange     time.Time
	Forced              bool
}

type requestResult struct {
	at      time.Time
	success bool
}

// NewCircuitBreaker creates a new circuit breaker with the given config.
func NewCircuitBreaker(cfg CircuitBreakerConfig) *CircuitBreaker {
	return &CircuitBreaker{
		state:           CircuitClosed,
		cfg:             cfg,
		lastStateChange: time.Now(),
	}
}

// SetOnTransition registers a callback invoked after every state transition.
// The callback runs without the breaker lock held and must not call back into
// the breaker. Pass nil to clear.
func (cb *CircuitBreaker) SetOnTransition(fn func(from, to CircuitState)) {
	cb.mu.Lock()
	cb.onTransition = fn
	cb.mu.Unlock()
}

// State returns the current circuit state.
func (cb *CircuitBreaker) State() CircuitState {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return cb.state
}

// Snapshot returns a read-only view of the breaker's current internals.
func (cb *CircuitBreaker) Snapshot() CircuitSnapshot {
	cb.mu.RLock()
	defer cb.mu.RUnlock()
	return CircuitSnapshot{
		State:               cb.state,
		ConsecutiveFailures: cb.consecutiveFailures,
		LastStateChange:     cb.lastStateChange,
		Forced:              cb.forced,
	}
}

// ForceOpen forces the breaker Open and pins it there (no automatic half-open
// recovery) until Reset is called. Used by the gateway admin control API (G18).
func (cb *CircuitBreaker) ForceOpen() {
	cb.mu.Lock()
	cb.transitionTo(CircuitOpen)
	cb.forced = true
	cb.mu.Unlock()
	cb.flushTransitions()
}

// ForceClose forces the breaker Closed and pins it there until Reset is called.
func (cb *CircuitBreaker) ForceClose() {
	cb.mu.Lock()
	cb.transitionTo(CircuitClosed)
	cb.forced = true
	cb.mu.Unlock()
	cb.flushTransitions()
}

// Reset clears any forced state and returns the breaker to Closed, resuming
// automatic operation.
func (cb *CircuitBreaker) Reset() {
	cb.mu.Lock()
	cb.forced = false
	cb.transitionTo(CircuitClosed)
	cb.mu.Unlock()
	cb.flushTransitions()
}

// Allow checks if a request should be allowed through.
func (cb *CircuitBreaker) Allow() bool {
	cb.mu.Lock()
	state := cb.currentState()
	allowed := false
	switch state {
	case CircuitClosed:
		allowed = true
	case CircuitOpen:
		// Check if we should transition to half-open (suppressed when forced).
		if !cb.forced && time.Since(cb.lastStateChange) >= cb.cfg.OpenTimeout {
			cb.transitionTo(CircuitHalfOpen)
			allowed = true
		}
	case CircuitHalfOpen:
		allowed = true
	}
	cb.mu.Unlock()
	cb.flushTransitions()
	return allowed
}

// RecordSuccess records a successful request.
func (cb *CircuitBreaker) RecordSuccess() {
	cb.mu.Lock()
	cb.consecutiveFailures = 0
	cb.windowRequests = append(cb.windowRequests, requestResult{at: time.Now(), success: true})

	// When forced, the operator pins the state — don't auto-recover.
	if !cb.forced {
		state := cb.currentState()
		if state == CircuitHalfOpen {
			cb.consecutiveSuccess++
			if cb.consecutiveSuccess >= cb.cfg.HalfOpenSuccesses {
				cb.transitionTo(CircuitClosed)
			}
		}
	}
	cb.mu.Unlock()
	cb.flushTransitions()
}

// RecordProbeSuccess records a successful recovery probe. Unlike an ordinary
// request, a probe is deliberately allowed through an automatically-open
// circuit, so its success is direct evidence that the upstream can serve
// traffic again. Close the circuit immediately rather than waiting for the open
// timeout. An operator-forced state always wins.
func (cb *CircuitBreaker) RecordProbeSuccess() {
	cb.mu.Lock()
	cb.consecutiveFailures = 0
	cb.windowRequests = append(cb.windowRequests, requestResult{at: time.Now(), success: true})
	if !cb.forced && (cb.state == CircuitOpen || cb.state == CircuitHalfOpen) {
		cb.transitionTo(CircuitClosed)
	}
	cb.mu.Unlock()
	cb.flushTransitions()
}

// RecordFailure records a failed request.
func (cb *CircuitBreaker) RecordFailure() {
	cb.mu.Lock()
	cb.consecutiveFailures++
	cb.consecutiveSuccess = 0
	cb.windowRequests = append(cb.windowRequests, requestResult{at: time.Now(), success: false})

	// When forced, the operator pins the state — don't auto-trip/recover.
	if !cb.forced {
		state := cb.currentState()
		switch state {
		case CircuitClosed:
			if cb.consecutiveFailures >= cb.cfg.FailureThreshold || cb.failureRateExceeded() {
				cb.transitionTo(CircuitOpen)
			}
		case CircuitHalfOpen:
			cb.transitionTo(CircuitOpen)
		}
	}
	cb.mu.Unlock()
	cb.flushTransitions()
}

// currentState returns the effective state (may auto-transition open→half-open).
// The caller must hold cb.mu. Auto-recovery is suppressed while forced.
func (cb *CircuitBreaker) currentState() CircuitState {
	if !cb.forced && cb.state == CircuitOpen && time.Since(cb.lastStateChange) >= cb.cfg.OpenTimeout {
		cb.transitionTo(CircuitHalfOpen)
	}
	return cb.state
}

// transitionTo records a state change while the lock is held. It queues the
// transition for the onTransition callback (fired by flushTransitions after the
// lock is released) and is idempotent for same-state "transitions".
func (cb *CircuitBreaker) transitionTo(state CircuitState) {
	from := cb.state
	cb.state = state
	cb.lastStateChange = time.Now()
	if state == CircuitClosed {
		cb.consecutiveFailures = 0
		cb.consecutiveSuccess = 0
		cb.windowRequests = nil
	} else if state == CircuitHalfOpen {
		cb.consecutiveSuccess = 0
	}
	if from != state {
		cb.pending = append(cb.pending, stateTransition{from: from, to: state})
	}
}

// flushTransitions fires the onTransition callback for any transitions queued by
// transitionTo. It must be called WITHOUT the breaker lock held.
func (cb *CircuitBreaker) flushTransitions() {
	cb.mu.Lock()
	pending := cb.pending
	cb.pending = nil
	fn := cb.onTransition
	cb.mu.Unlock()
	if fn == nil {
		return
	}
	for _, t := range pending {
		fn(t.from, t.to)
	}
}

// failureRateExceeded checks if the failure rate in the window exceeds the threshold.
func (cb *CircuitBreaker) failureRateExceeded() bool {
	cutoff := time.Now().Add(-cb.cfg.FailureRateWindow)

	// Prune old entries
	recent := cb.windowRequests[:0]
	for _, r := range cb.windowRequests {
		if r.at.After(cutoff) {
			recent = append(recent, r)
		}
	}
	cb.windowRequests = recent

	if len(recent) < 5 {
		// Need at least 5 requests to evaluate rate
		return false
	}

	failures := 0
	for _, r := range recent {
		if !r.success {
			failures++
		}
	}

	rate := float64(failures) / float64(len(recent)) * 100
	return rate >= cb.cfg.FailureRatePercent
}
