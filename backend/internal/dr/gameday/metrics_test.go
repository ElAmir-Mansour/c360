package gameday

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

func TestMetrics_NilIsSafe(t *testing.T) {
	var m *Metrics // nil
	// None of these must panic.
	m.observeRun(ScopeDrill, RunStatusPassed)
	m.observeStep(ActionPauseStream, true)
	m.observeDetectionLatency("lag_alert", 5)
	m.observeRecoveryLatency("lag_alert", 3)
	m.observeFaultReverted(ActionPauseStream)
	m.observeSafetyRejection()
}

func TestMetrics_RecordsCounters(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	m.observeRun(ScopeDrill, RunStatusPassed)
	m.observeStep(ActionPauseStream, true)
	m.observeStep(ActionBlockSite, false)
	m.observeSafetyRejection()
	m.observeFaultReverted(ActionPauseStream)

	families, err := reg.Gather()
	if err != nil {
		t.Fatalf("Gather: %v", err)
	}
	got := map[string]float64{}
	for _, f := range families {
		for _, metric := range f.GetMetric() {
			key := f.GetName() + labelsKey(metric)
			got[key] = counterValue(metric)
		}
	}

	assertCounter(t, got, "dr_gameday_runs_total{result=passed,scope=drill}", 1)
	assertCounter(t, got, "dr_gameday_step_results_total{action=pause_stream,result=passed}", 1)
	assertCounter(t, got, "dr_gameday_step_results_total{action=block_site,result=failed}", 1)
	assertCounter(t, got, "dr_gameday_safety_rejections_total", 1)
	assertCounter(t, got, "dr_gameday_faults_reverted_total{action=pause_stream}", 1)
}

func TestMetrics_NewWithNilRegistryDoesNotPanic(t *testing.T) {
	// A nil registry uses a private one — construction must not panic and the
	// returned metrics must be usable.
	m := NewMetrics(nil)
	m.observeRun(ScopeNonProd, RunStatusFailed)
}

func assertCounter(t *testing.T, got map[string]float64, key string, want float64) {
	t.Helper()
	if got[key] != want {
		t.Errorf("%s = %v, want %v (have: %v)", key, got[key], want, got)
	}
}

func counterValue(m *dto.Metric) float64 {
	if m.GetCounter() != nil {
		return m.GetCounter().GetValue()
	}
	return 0
}

func labelsKey(m *dto.Metric) string {
	if len(m.GetLabel()) == 0 {
		return ""
	}
	var parts []string
	for _, l := range m.GetLabel() {
		parts = append(parts, l.GetName()+"="+l.GetValue())
	}
	return "{" + strings.Join(parts, ",") + "}"
}
