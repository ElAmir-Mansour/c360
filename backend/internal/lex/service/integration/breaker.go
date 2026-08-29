package integration

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/sony/gobreaker"
)

// Breaker wraps sony/gobreaker with a per-call timeout so a flapping upstream
// integration cannot stall a sync/test or exhaust connections. Connectors call
// Execute to run a network operation under the breaker; once the failure
// threshold trips, calls fail fast with ErrBreakerOpen until the breaker
// half-opens.

// ErrBreakerOpen is returned when the breaker is open (upstream considered down).
var ErrBreakerOpen = errors.New("lex/integration: circuit breaker open")

// BreakerConfig parametrises a Breaker.
type BreakerConfig struct {
	// Name identifies the breaker in logs/metrics (e.g. "lex-najiz-<tenant>").
	Name string
	// Timeout bounds a single Execute call. Defaults to 15s.
	Timeout time.Duration
	// MaxRequests is the number of probe calls allowed while half-open. Defaults to 1.
	MaxRequests uint32
	// Interval is the closed-state counting window. Defaults to 60s.
	Interval time.Duration
	// OpenTimeout is how long the breaker stays open before half-opening.
	// Defaults to 30s.
	OpenTimeout time.Duration
	// ConsecutiveFailures trips the breaker after this many consecutive failures.
	// Defaults to 5.
	ConsecutiveFailures uint32
}

// Breaker is a circuit breaker + per-call timeout wrapper.
type Breaker struct {
	cb      *gobreaker.CircuitBreaker
	timeout time.Duration
}

// NewBreaker builds a Breaker from cfg, applying sensible defaults.
func NewBreaker(cfg BreakerConfig) *Breaker {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 15 * time.Second
	}
	maxReq := cfg.MaxRequests
	if maxReq == 0 {
		maxReq = 1
	}
	interval := cfg.Interval
	if interval <= 0 {
		interval = 60 * time.Second
	}
	openTimeout := cfg.OpenTimeout
	if openTimeout <= 0 {
		openTimeout = 30 * time.Second
	}
	trip := cfg.ConsecutiveFailures
	if trip == 0 {
		trip = 5
	}
	settings := gobreaker.Settings{
		Name:        cfg.Name,
		MaxRequests: maxReq,
		Interval:    interval,
		Timeout:     openTimeout,
		ReadyToTrip: func(counts gobreaker.Counts) bool {
			return counts.ConsecutiveFailures >= trip
		},
	}
	return &Breaker{cb: gobreaker.NewCircuitBreaker(settings), timeout: timeout}
}

// Execute runs fn under the breaker with a per-call timeout derived from the
// breaker's timeout (the smaller of the breaker timeout and any deadline already
// on ctx applies). When the breaker is open the call fails fast with
// ErrBreakerOpen. fn must respect the passed ctx for the timeout to take effect.
func (b *Breaker) Execute(ctx context.Context, fn func(ctx context.Context) error) error {
	if b == nil || b.cb == nil {
		// No breaker configured: run directly with the timeout.
		cctx, cancel := context.WithTimeout(ctx, defaultTimeout(b))
		defer cancel()
		return fn(cctx)
	}
	_, err := b.cb.Execute(func() (interface{}, error) {
		cctx, cancel := context.WithTimeout(ctx, b.timeout)
		defer cancel()
		return nil, fn(cctx)
	})
	if errors.Is(err, gobreaker.ErrOpenState) || errors.Is(err, gobreaker.ErrTooManyRequests) {
		return fmt.Errorf("%w: %v", ErrBreakerOpen, err)
	}
	return err
}

func defaultTimeout(b *Breaker) time.Duration {
	if b != nil && b.timeout > 0 {
		return b.timeout
	}
	return 15 * time.Second
}

// State reports the breaker's current state name (closed/half-open/open) for
// health/metadata surfaces.
func (b *Breaker) State() string {
	if b == nil || b.cb == nil {
		return "closed"
	}
	return b.cb.State().String()
}
