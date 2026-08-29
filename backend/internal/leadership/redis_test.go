package leadership

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

func newRedis(t *testing.T) (*miniredis.Miniredis, *redis.Client) {
	t.Helper()
	mr, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis: %v", err)
	}
	t.Cleanup(mr.Close)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })
	return mr, rdb
}

func TestRedisElection_AcquireAndIsLeader(t *testing.T) {
	t.Parallel()
	_, rdb := newRedis(t)
	logger := zerolog.Nop()
	e := NewRedisElection(rdb, "siem-detector", "inst-1", 300*time.Millisecond, 50*time.Millisecond, &logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	acquired := make(chan struct{}, 1)
	var lost atomic.Int32
	go func() {
		_ = e.Run(ctx, RunOpts{
			OnAcquire: func(context.Context) { acquired <- struct{}{} },
			OnLose:    func() { lost.Add(1) },
		})
	}()

	select {
	case <-acquired:
	case <-time.After(2 * time.Second):
		t.Fatal("never acquired leadership")
	}
	if !e.IsLeader() {
		t.Fatal("expected IsLeader=true after acquire")
	}
	cancel()
	// Wait a moment for goroutine teardown.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !e.IsLeader() {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if e.IsLeader() {
		t.Fatal("IsLeader still true after ctx cancel")
	}
}

func TestRedisElection_ExactlyOneLeader_50Instances(t *testing.T) {
	mr, _ := newRedis(t)
	const n = 50
	logger := zerolog.Nop()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	electors := make([]Elector, n)
	for i := 0; i < n; i++ {
		rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
		t.Cleanup(func() { _ = rdb.Close() })
		electors[i] = NewRedisElection(rdb, "concurrent-role", fmt.Sprintf("inst-%d", i), 800*time.Millisecond, 150*time.Millisecond, &logger)
	}
	var wg sync.WaitGroup
	for _, e := range electors {
		wg.Add(1)
		go func(el Elector) {
			defer wg.Done()
			_ = el.Run(ctx, RunOpts{})
		}(e)
	}
	// Wait for at least one elector to acquire.
	deadline := time.Now().Add(3 * time.Second)
	leaderFound := false
	for time.Now().Before(deadline) {
		count := 0
		for _, e := range electors {
			if e.IsLeader() {
				count++
			}
		}
		if count == 1 {
			leaderFound = true
			break
		}
		if count > 1 {
			t.Fatalf("found %d concurrent leaders", count)
		}
		time.Sleep(30 * time.Millisecond)
	}
	if !leaderFound {
		t.Fatal("no leader elected within deadline")
	}
	// Now invariant: exactly one leader across multiple sampling moments.
	for i := 0; i < 15; i++ {
		count := 0
		for _, e := range electors {
			if e.IsLeader() {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("invariant violation: %d concurrent leaders at sample %d", count, i)
		}
		time.Sleep(40 * time.Millisecond)
	}
	cancel()
	wg.Wait()
}

func TestRedisElection_RenewKeepsLeadership(t *testing.T) {
	t.Parallel()
	_, rdb := newRedis(t)
	logger := zerolog.Nop()
	// TTL must exceed renew interval; we ride wall-clock so use values that survive
	// multiple renew ticks before TTL would expire if we did nothing.
	e := NewRedisElection(rdb, "renew-role", "inst-1", 800*time.Millisecond, 100*time.Millisecond, &logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	acquired := make(chan struct{}, 1)
	go func() {
		_ = e.Run(ctx, RunOpts{OnAcquire: func(context.Context) { acquired <- struct{}{} }})
	}()
	<-acquired

	// Hold leadership across several full TTL intervals — only possible if renew works.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if !e.IsLeader() {
			t.Fatal("lost leadership during renew loop")
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func TestRedisElection_CloseReleasesLock(t *testing.T) {
	t.Parallel()
	mr, rdb := newRedis(t)
	logger := zerolog.Nop()
	e := NewRedisElection(rdb, "close-role", "inst-A", 300*time.Millisecond, 60*time.Millisecond, &logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	acquired := make(chan struct{}, 1)
	go func() {
		_ = e.Run(ctx, RunOpts{OnAcquire: func(context.Context) { acquired <- struct{}{} }})
	}()
	<-acquired

	if err := e.Close(context.Background()); err != nil {
		t.Fatalf("Close: %v", err)
	}
	// Close is idempotent.
	if err := e.Close(context.Background()); err != nil {
		t.Fatalf("Close idempotent: %v", err)
	}
	// Cancel before checking miniredis key state — Run will also try a final release.
	cancel()

	// Lock should be gone.
	if mr.Exists("leadership:close-role") {
		t.Errorf("lock key still present after Close")
	}
}

func TestRedisElection_InvalidConfig(t *testing.T) {
	t.Parallel()
	logger := zerolog.Nop()
	cases := []struct {
		name string
		rdb  *redis.Client
		role string
		inst string
		ttl  time.Duration
		ren  time.Duration
	}{
		{"nil_client", nil, "r", "i", time.Second, 100 * time.Millisecond},
		{"empty_role", &redis.Client{}, "", "i", time.Second, 100 * time.Millisecond},
		{"empty_instance", &redis.Client{}, "r", "", time.Second, 100 * time.Millisecond},
		{"zero_ttl", &redis.Client{}, "r", "i", 0, 100 * time.Millisecond},
		{"zero_renew", &redis.Client{}, "r", "i", time.Second, 0},
		{"renew_gt_ttl", &redis.Client{}, "r", "i", time.Second, 2 * time.Second},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			// nil_client case must use nil, not &redis.Client{}.
			var client *redis.Client
			if tc.name == "nil_client" {
				client = nil
			} else {
				client = tc.rdb
			}
			e := NewRedisElection(client, tc.role, tc.inst, tc.ttl, tc.ren, &logger)
			err := e.Run(context.Background(), RunOpts{})
			if err == nil || !errors.Is(err, ErrInvalidConfig) {
				t.Errorf("expected ErrInvalidConfig, got %v", err)
			}
		})
	}
}

func TestRedisElection_LoseAndReacquire(t *testing.T) {
	t.Parallel()
	mr, rdb := newRedis(t)
	logger := zerolog.Nop()
	e := NewRedisElection(rdb, "flap-role", "inst-1", 200*time.Millisecond, 50*time.Millisecond, &logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	acquired := make(chan struct{}, 4)
	var lost atomic.Int32
	go func() {
		_ = e.Run(ctx, RunOpts{
			OnAcquire: func(context.Context) { acquired <- struct{}{} },
			OnLose:    func() { lost.Add(1) },
		})
	}()
	<-acquired

	// Simulate lock theft: delete the key from underneath.
	mr.Del("leadership:flap-role")
	// Then have another instance grab it.
	mr.Set("leadership:flap-role", "stranger")
	mr.SetTTL("leadership:flap-role", 5*time.Second)
	// Wait for renew tick to notice (within ~2 ttl intervals).
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if lost.Load() > 0 {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if lost.Load() == 0 {
		t.Fatal("OnLose never fired after lock theft")
	}
	if e.IsLeader() {
		t.Fatal("IsLeader still true after losing the lock")
	}
}

func TestRegisterMetrics(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	if err := RegisterMetrics(reg); err != nil {
		t.Fatalf("RegisterMetrics: %v", err)
	}
	// Re-register: AlreadyRegisteredError swallowed.
	if err := RegisterMetrics(reg); err != nil {
		t.Fatalf("RegisterMetrics second time: %v", err)
	}
	// Nil reg is tolerated.
	if err := RegisterMetrics(nil); err != nil {
		t.Fatalf("RegisterMetrics nil: %v", err)
	}
	setLeader("role-x", "inst-x", true)
	setLeader("role-x", "inst-x", false)
}
