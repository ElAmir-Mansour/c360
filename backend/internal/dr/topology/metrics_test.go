package topology

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetrics_NilIsSafe(t *testing.T) {
	var m *Metrics
	// None of these must panic on a nil receiver (unit tests run unmetered).
	m.observeEdgeAdded()
	m.observeCycleRejected()
	m.observeHealthRollup("g", "s", HealthHealthy, 5)
	m.observeRollupError()
}

func TestMetrics_RecordsCountersAndGauges(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	m.observeEdgeAdded()
	m.observeEdgeAdded()
	m.observeCycleRejected()
	m.observeHealthRollup("group-1", "stream-1", HealthDegraded, 42)
	m.observeRollupError()

	if got := testutil.ToFloat64(m.edgesAdded); got != 2 {
		t.Errorf("edges_added = %v, want 2", got)
	}
	if got := testutil.ToFloat64(m.cyclesRejected); got != 1 {
		t.Errorf("cycles_rejected = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.healthRollups); got != 1 {
		t.Errorf("health_rollups = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.rollupErrs); got != 1 {
		t.Errorf("rollup_errors = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.edgeLag.WithLabelValues("group-1", "stream-1")); got != 42 {
		t.Errorf("edge_lag = %v, want 42", got)
	}

	// The one-hot health gauge: degraded reads 1, every other state reads 0.
	if got := testutil.ToFloat64(m.edgeHealth.WithLabelValues("group-1", "stream-1", HealthDegraded)); got != 1 {
		t.Errorf("edge_health[degraded] = %v, want 1", got)
	}
	for _, h := range []string{HealthHealthy, HealthUnhealthy, HealthUnknown} {
		if got := testutil.ToFloat64(m.edgeHealth.WithLabelValues("group-1", "stream-1", h)); got != 0 {
			t.Errorf("edge_health[%s] = %v, want 0", h, got)
		}
	}

	// The series must be registered under their documented names.
	mfs, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	want := map[string]bool{
		"dr_topology_edges_added_total":          false,
		"dr_topology_cycles_rejected_total":      false,
		"dr_topology_edge_lag_seconds":           false,
		"dr_topology_edge_health":                false,
		"dr_topology_health_rollups_total":       false,
		"dr_topology_health_rollup_errors_total": false,
	}
	for _, mf := range mfs {
		if _, ok := want[mf.GetName()]; ok {
			want[mf.GetName()] = true
		}
	}
	for name, seen := range want {
		if !seen {
			t.Errorf("metric %q not registered", name)
		}
	}
}

func TestMetrics_NewWithNilRegistererDoesNotPanic(t *testing.T) {
	// A nil registerer must register on a private registry (used by every unit
	// test via NewMetrics(nil)).
	m := NewMetrics(nil)
	if m == nil {
		t.Fatal("NewMetrics(nil) returned nil")
	}
	m.observeEdgeAdded() // must not panic
}

// guard against a metric name typo drifting from the documented SLO board.
func TestMetrics_NamesStable(t *testing.T) {
	reg := prometheus.NewRegistry()
	NewMetrics(reg)
	mfs, _ := reg.Gather()
	for _, mf := range mfs {
		if !strings.HasPrefix(mf.GetName(), "dr_topology_") {
			t.Errorf("unexpected metric prefix: %q", mf.GetName())
		}
	}
}
