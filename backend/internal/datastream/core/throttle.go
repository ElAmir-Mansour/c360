package core

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// Clock abstracts time so the throttle is testable deterministically. The
// zero-cost production implementation is realClock.
type Clock interface {
	Now() time.Time
	Sleep(ctx context.Context, d time.Duration) error
}

type realClock struct{}

func (realClock) Now() time.Time { return time.Now() }

func (realClock) Sleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return nil
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// TokenBucket is a byte-rate limiter: it refills at RatePerSec bytes per second
// up to Burst bytes and blocks Wait until n bytes are available. A non-positive
// rate disables throttling (Wait returns immediately). It is concurrency-safe.
type TokenBucket struct {
	mu     sync.Mutex
	rate   float64 // bytes per second; <=0 means unlimited
	burst  float64 // max accumulated bytes
	tokens float64
	last   time.Time
	clock  Clock
}

// NewTokenBucket builds a byte token bucket at ratePerSec with the given burst
// (max bytes that can accumulate while idle). A ratePerSec <= 0 disables
// throttling. If burst <= 0 it defaults to one second of rate (or, for the
// unlimited case, is irrelevant). A nil clock uses the real clock.
func NewTokenBucket(ratePerSec, burst float64, clock Clock) *TokenBucket {
	if clock == nil {
		clock = realClock{}
	}
	if burst <= 0 {
		burst = ratePerSec
	}
	return &TokenBucket{
		rate:   ratePerSec,
		burst:  burst,
		tokens: burst, // start full so an initial burst is allowed
		last:   clock.Now(),
		clock:  clock,
	}
}

// Wait blocks until n byte-tokens are available, then consumes them. It returns
// promptly when throttling is disabled, and respects ctx cancellation. A single
// request larger than burst is permitted (it drains the bucket and waits the
// proportional time) so an oversized frame is never deadlocked.
func (b *TokenBucket) Wait(ctx context.Context, n int) error {
	if n <= 0 {
		return nil
	}
	b.mu.Lock()
	if b.rate <= 0 {
		b.mu.Unlock()
		return nil
	}

	need := float64(n)
	now := b.clock.Now()
	elapsed := now.Sub(b.last).Seconds()
	if elapsed > 0 {
		b.tokens += elapsed * b.rate
		if b.tokens > b.burst {
			b.tokens = b.burst
		}
		b.last = now
	}

	if b.tokens >= need {
		b.tokens -= need
		b.mu.Unlock()
		return nil
	}

	// Reserve future capacity before sleeping. This allows a single request larger
	// than burst without deadlocking while keeping concurrent callers rate-limited
	// behind the reservation.
	deficit := need - b.tokens
	b.tokens -= need
	b.last = now
	sleep := time.Duration(deficit / b.rate * float64(time.Second))
	if sleep <= 0 {
		sleep = time.Millisecond
	}
	b.mu.Unlock()

	if err := b.clock.Sleep(ctx, sleep); err != nil {
		b.mu.Lock()
		refundNow := b.clock.Now()
		refundElapsed := refundNow.Sub(b.last).Seconds()
		if refundElapsed > 0 {
			b.tokens += refundElapsed * b.rate
			if b.tokens > b.burst {
				b.tokens = b.burst
			}
			b.last = refundNow
		}
		b.tokens += need
		if b.tokens > b.burst {
			b.tokens = b.burst
		}
		b.mu.Unlock()

		return fmt.Errorf("core: throttle wait cancelled: %w", err)
	}
	return nil
}
