package core

import (
	"context"
	"sync"
	"testing"
	"time"
)

// fakeClock is a deterministic Clock: Sleep advances virtual time instantly so
// throttle tests are fast and reproducible.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func newFakeClock() *fakeClock { return &fakeClock{now: time.Unix(0, 0)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Sleep(ctx context.Context, d time.Duration) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	c.mu.Lock()
	c.now = c.now.Add(d)
	c.mu.Unlock()
	return nil
}

func TestTokenBucket_CapsThroughput(t *testing.T) {
	t.Parallel()

	const rate = 1000.0 // bytes/sec
	clk := newFakeClock()
	// Burst == rate so only ~1s of data can go out instantly.
	b := NewTokenBucket(rate, rate, clk)

	ctx := context.Background()
	start := clk.Now()

	// Ship 10,000 bytes in 100-byte chunks. At 1000 B/s with a 1000 B burst,
	// this must take ~ (10000-1000)/1000 = 9 seconds of virtual time.
	totalBytes := 0
	for i := 0; i < 100; i++ {
		if err := b.Wait(ctx, 100); err != nil {
			t.Fatalf("Wait: %v", err)
		}
		totalBytes += 100
	}

	elapsed := clk.Now().Sub(start)
	effectiveRate := float64(totalBytes) / elapsed.Seconds()

	// Effective rate must not materially exceed the configured rate. Allow the
	// initial burst to inflate it slightly, but it must be well under 2x.
	if effectiveRate > rate*1.25 {
		t.Fatalf("effective rate %.1f B/s exceeds cap %.1f B/s (elapsed %s)", effectiveRate, rate, elapsed)
	}
	// And it must be close to the cap, not far below (the throttle should not
	// over-throttle): expect >= 0.8x.
	if effectiveRate < rate*0.8 {
		t.Fatalf("effective rate %.1f B/s far below cap %.1f B/s — over-throttling", effectiveRate, rate)
	}
}

func TestTokenBucket_DisabledWhenRateZero(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	b := NewTokenBucket(0, 0, clk)
	start := clk.Now()
	for i := 0; i < 1000; i++ {
		if err := b.Wait(context.Background(), 1_000_000); err != nil {
			t.Fatal(err)
		}
	}
	if clk.Now() != start {
		t.Fatalf("unlimited bucket should not advance the clock, advanced by %s", clk.Now().Sub(start))
	}
}

func TestTokenBucket_OversizedRequestNotDeadlocked(t *testing.T) {
	t.Parallel()
	clk := newFakeClock()
	b := NewTokenBucket(1000, 1000, clk) // burst 1000 < request 5000
	if err := b.Wait(context.Background(), 5000); err != nil {
		t.Fatalf("oversized Wait should succeed, got %v", err)
	}
}

func TestTokenBucket_RespectsCancellation(t *testing.T) {
	t.Parallel()
	// Real clock here so Sleep actually blocks until ctx cancels.
	b := NewTokenBucket(1, 1, nil) // 1 B/s, tiny burst
	// Drain the initial burst.
	_ = b.Wait(context.Background(), 1)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := b.Wait(ctx, 100); err == nil {
		t.Fatal("expected cancellation error from Wait, got nil")
	}
}
