package main

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	drconfig "github.com/clario360/platform/internal/dr/config"
	"github.com/clario360/platform/internal/leadership"
)

func TestMTLSIngestBlockedReason(t *testing.T) {
	cfg := drconfig.Default()

	require.Contains(t, mtlsIngestBlockedReason(cfg, true), "DR_MTLS_INGEST_ENABLED")

	t.Setenv("DR_MTLS_INGEST_ENABLED", "true")
	require.Contains(t, mtlsIngestBlockedReason(cfg, true), "DR_MTLS_CA_BUNDLE_PATH")

	cfg.MTLSCABundlePath = "/ca.pem"
	cfg.MTLSServerCertPath = "/server.pem"
	cfg.MTLSServerKeyPath = "/server-key.pem"
	require.Contains(t, mtlsIngestBlockedReason(cfg, false), "DEK manager")

	require.Empty(t, mtlsIngestBlockedReason(cfg, true))
}

func TestFailoverDriverBlockedReason(t *testing.T) {
	cfg := drconfig.Default()

	require.Contains(t, failoverDriverBlockedReason(cfg, true), "DR_FAILOVER_DRIVER_ENABLED")

	t.Setenv("DR_FAILOVER_DRIVER_ENABLED", "true")
	require.Contains(t, failoverDriverBlockedReason(cfg, false), "WORM recovery-point store")

	require.Empty(t, failoverDriverBlockedReason(cfg, true))
}

func TestRuntimeFeatureFlagInvalidValuesBlockStartup(t *testing.T) {
	cfg := drconfig.Default()

	t.Setenv("DR_MTLS_INGEST_ENABLED", "maybe")
	require.Contains(t, mtlsIngestBlockedReason(cfg, true), "invalid value")

	t.Setenv("DR_FAILOVER_DRIVER_ENABLED", "maybe")
	require.Contains(t, failoverDriverBlockedReason(cfg, true), "invalid value")
}

func TestRPOMonitorTwoInstancesElectSingleLeader(t *testing.T) {
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(mr.Close)

	logger := zerolog.Nop()
	newClient := func() *redis.Client {
		client := redis.NewClient(&redis.Options{Addr: mr.Addr()})
		t.Cleanup(func() { _ = client.Close() })
		return client
	}
	electorA := leadership.NewRedisElection(newClient(), "dr-rpo-monitor", "dr-a", 500*time.Millisecond, 80*time.Millisecond, &logger)
	electorB := leadership.NewRedisElection(newClient(), "dr-rpo-monitor", "dr-b", 500*time.Millisecond, 80*time.Millisecond, &logger)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	acquired := make(chan string, 2)
	var activeLoops atomic.Int32
	run := func(name string, elector leadership.Elector) {
		go func() {
			_ = elector.Run(ctx, leadership.RunOpts{
				OnAcquire: func(context.Context) {
					if n := activeLoops.Add(1); n > 1 {
						t.Errorf("RPO monitor active leaders = %d, want at most 1", n)
					}
					acquired <- name
				},
				OnLose: func() {
					activeLoops.Add(-1)
				},
			})
		}()
	}
	run("dr-a", electorA)
	run("dr-b", electorB)

	select {
	case <-acquired:
	case <-time.After(2 * time.Second):
		t.Fatal("no RPO monitor leader elected")
	}

	deadline := time.Now().Add(500 * time.Millisecond)
	for time.Now().Before(deadline) {
		leaders := 0
		if electorA.IsLeader() {
			leaders++
		}
		if electorB.IsLeader() {
			leaders++
		}
		require.Equal(t, 1, leaders, "exactly one RPO monitor instance should hold leadership")
		time.Sleep(30 * time.Millisecond)
	}
}
