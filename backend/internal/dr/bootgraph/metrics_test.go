package bootgraph

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetrics_NilIsSafe(t *testing.T) {
	var m *Metrics
	// None of these must panic on a nil receiver (unit tests run unmetered).
	m.observeServicesDefined(3)
	m.observeCycleRejected()
	m.observeRunStarted()
	m.observeRunCompleted()
	m.observeRunFailed()
	m.observeRunRolledBack()
	m.observeTierHealthy()
	m.observeTierFailed()
	m.observeServiceHealthy()
	m.observeServiceRolledBack()
	m.observeProbeFailure()
	m.observeBootError()
}

func TestMetrics_RecordsCounters(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	m.observeServicesDefined(4)
	m.observeCycleRejected()
	m.observeRunStarted()
	m.observeRunCompleted()
	m.observeTierHealthy()
	m.observeTierHealthy()
	m.observeTierFailed()
	m.observeServiceHealthy()
	m.observeServiceRolledBack()
	m.observeProbeFailure()
	m.observeBootError()
	m.observeRunRolledBack()
	m.observeRunFailed()

	cases := []struct {
		name string
		c    prometheus.Counter
		want float64
	}{
		{"services_defined", m.servicesDefined, 4},
		{"cycles_rejected", m.cyclesRejected, 1},
		{"runs_started", m.runsStarted, 1},
		{"runs_completed", m.runsCompleted, 1},
		{"runs_failed", m.runsFailed, 1},
		{"runs_rolled_back", m.runsRolledBack, 1},
		{"tiers_healthy", m.tiersHealthy, 2},
		{"tiers_failed", m.tiersFailed, 1},
		{"services_healthy", m.servicesHealthy, 1},
		{"services_rolled", m.servicesRolled, 1},
		{"probe_failures", m.probeFailures, 1},
		{"boot_errors", m.bootErrors, 1},
	}
	for _, tc := range cases {
		if got := testutil.ToFloat64(tc.c); got != tc.want {
			t.Errorf("%s = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestNewMetrics_NilRegistryDoesNotPanic(t *testing.T) {
	m := NewMetrics(nil)
	m.observeRunStarted()
	if got := testutil.ToFloat64(m.runsStarted); got != 1 {
		t.Fatalf("runs_started = %v, want 1", got)
	}
}
