package gameday

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestPoller_AwaitSignal_MeasuresLatency(t *testing.T) {
	start := time.Date(2026, 6, 13, 0, 0, 0, 0, time.UTC)
	clock := newTestClock(start)
	src := &scriptedSignalSource{
		clock: clock,
		scripts: []scriptedSignal{{
			kind: "lag_alert", target: "s1", availableFrom: start.Add(3 * time.Second),
		}},
	}
	p := newPoller(src, clock.Now, clock.sleepFn, time.Second)

	out, err := p.awaitSignal(context.Background(), "lag_alert", "s1", start, 30*time.Second)
	if err != nil {
		t.Fatalf("awaitSignal: %v", err)
	}
	if !out.observed {
		t.Fatal("expected signal observed")
	}
	if out.latency != 3*time.Second {
		t.Fatalf("latency = %v, want 3s", out.latency)
	}
}

func TestPoller_AwaitSignal_WindowExpires(t *testing.T) {
	start := time.Now().UTC()
	clock := newTestClock(start)
	// Signal only fires after the window.
	src := &scriptedSignalSource{
		clock: clock,
		scripts: []scriptedSignal{{
			kind: "lag_alert", target: "s1", availableFrom: start.Add(time.Hour),
		}},
	}
	p := newPoller(src, clock.Now, clock.sleepFn, time.Second)
	out, err := p.awaitSignal(context.Background(), "lag_alert", "s1", start, 5*time.Second)
	if err != nil {
		t.Fatalf("awaitSignal: %v", err)
	}
	if out.observed {
		t.Fatal("signal should NOT be observed within the window")
	}
}

func TestPoller_AwaitSignal_ImmediateWhenAlreadyFiring(t *testing.T) {
	start := time.Now().UTC()
	clock := newTestClock(start)
	src := &scriptedSignalSource{
		clock: clock,
		scripts: []scriptedSignal{{
			kind: "lag_alert", target: "s1", availableFrom: start.Add(-time.Second), // already firing
		}},
	}
	p := newPoller(src, clock.Now, clock.sleepFn, time.Second)
	out, err := p.awaitSignal(context.Background(), "lag_alert", "s1", start, 30*time.Second)
	if err != nil {
		t.Fatalf("awaitSignal: %v", err)
	}
	if !out.observed || out.latency != 0 {
		t.Fatalf("want immediate observation with 0 latency, got observed=%v latency=%v", out.observed, out.latency)
	}
}

func TestPoller_AwaitCleared_DetectsRecovery(t *testing.T) {
	start := time.Now().UTC()
	clock := newTestClock(start)
	cleared := start.Add(4 * time.Second)
	src := &scriptedSignalSource{
		clock: clock,
		scripts: []scriptedSignal{{
			kind: "lag_alert", target: "s1",
			availableFrom: start.Add(-time.Minute), // firing at the start of recovery polling
			clearedFrom:   &cleared,
		}},
	}
	p := newPoller(src, clock.Now, clock.sleepFn, time.Second)
	out, err := p.awaitCleared(context.Background(), "lag_alert", "s1", start, start, 30*time.Second)
	if err != nil {
		t.Fatalf("awaitCleared: %v", err)
	}
	if !out.observed {
		t.Fatal("recovery (signal cleared) should be observed")
	}
	if out.latency != 4*time.Second {
		t.Fatalf("recovery latency = %v, want 4s", out.latency)
	}
}

func TestPoller_PropagatesSourceError(t *testing.T) {
	clock := newTestClock(time.Now().UTC())
	src := &scriptedSignalSource{clock: clock, err: errors.New("source down")}
	p := newPoller(src, clock.Now, clock.sleepFn, time.Second)
	if _, err := p.awaitSignal(context.Background(), "x", "y", clock.Now(), time.Second); err == nil {
		t.Fatal("expected error from signal source to propagate")
	}
}
