package instant

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
)

func TestMetrics_NilSafe(t *testing.T) {
	t.Parallel()
	var m *Metrics
	// All methods must be safe on a nil receiver (components without metrics).
	m.IncStarted()
	m.IncReady()
	m.IncFinalized()
	m.IncFailed()
	m.AddChunksHydrated(5)
	m.IncChunkWritten()
	m.SetHydrationProgress("s", 50)
	m.ClearHydrationProgress("s")
	m.ObserveTimeToReady(1)
	m.ObserveReadChunk("base", 0.01)
}

func TestMetrics_RegisterTwiceOnDistinctRegistries(t *testing.T) {
	t.Parallel()
	// Per the platform rule, metrics use a per-instance registry, so constructing
	// twice on distinct registries must not panic on duplicate registration.
	m1 := NewMetrics(prometheus.NewRegistry())
	m2 := NewMetrics(prometheus.NewRegistry())
	if m1 == nil || m2 == nil {
		t.Fatal("NewMetrics returned nil")
	}
	// nil registry falls back to a private one (also no panic).
	if NewMetrics(nil) == nil {
		t.Fatal("NewMetrics(nil) returned nil")
	}
}

func TestMetrics_Records(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)
	m.IncStarted()
	m.AddChunksHydrated(3)
	m.SetHydrationProgress("sess-1", 75)

	mfs, err := reg.Gather()
	if err != nil {
		t.Fatalf("Gather: %v", err)
	}
	found := map[string]bool{}
	for _, mf := range mfs {
		found[mf.GetName()] = true
	}
	for _, name := range []string{
		"dr_instant_sessions_started_total",
		"dr_instant_chunks_hydrated_total",
		"dr_instant_hydration_percent",
	} {
		if !found[name] {
			t.Errorf("expected metric %q to be registered/emitted", name)
		}
	}
}
