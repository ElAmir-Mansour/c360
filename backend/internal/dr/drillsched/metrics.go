package drillsched

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the scheduled-drill Prometheus series. A nil *Metrics is safe:
// every method is a no-op, so the scheduler/service run unmetered in unit tests.
// Construct once per process with NewMetrics(reg) using the service's registry
// (never the global default — platform rule) so the series are scraped at
// /metrics.
type Metrics struct {
	drillsRequested *prometheus.CounterVec // dr_drill_scheduled_requested_total{group,profile}
	resultsIngested *prometheus.CounterVec // dr_drill_results_ingested_total{group,passed}
	driftDetected   *prometheus.CounterVec // dr_drill_diff_drift_total{group,kind}
	rtoDelta        *prometheus.GaugeVec   // dr_drill_rto_delta_seconds{group}
	rpoDelta        *prometheus.GaugeVec   // dr_drill_rpo_delta_seconds{group}
}

// NewMetrics registers the scheduled-drill metrics on reg. A nil reg registers
// on a private registry so construction never panics on duplicate registration
// (useful in tests).
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		drillsRequested: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_drill_scheduled_requested_total",
			Help: "Drills requested by the schedule firing loop, by group and network profile.",
		}, []string{"group", "profile"}),
		resultsIngested: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_drill_results_ingested_total",
			Help: "Drill results ingested, by group and pass/fail outcome.",
		}, []string{"group", "passed"}),
		driftDetected: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_drill_diff_drift_total",
			Help: "Drill-to-drill drift detections, by group and drift kind (rto|rpo|step|asset|outcome).",
		}, []string{"group", "kind"}),
		rtoDelta: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_drill_rto_delta_seconds",
			Help: "Latest drill RTO delta (current - previous) in seconds per group; positive = regression.",
		}, []string{"group"}),
		rpoDelta: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_drill_rpo_delta_seconds",
			Help: "Latest drill RPO delta (current - previous) in seconds per group; positive = regression.",
		}, []string{"group"}),
	}
	reg.MustRegister(m.drillsRequested, m.resultsIngested, m.driftDetected, m.rtoDelta, m.rpoDelta)
	return m
}

// IncDrillRequested counts a drill requested from a schedule.
func (m *Metrics) IncDrillRequested(group, profile string) {
	if m == nil {
		return
	}
	m.drillsRequested.WithLabelValues(group, profile).Inc()
}

// IncResultIngested counts a drill result ingested.
func (m *Metrics) IncResultIngested(group string, passed bool) {
	if m == nil {
		return
	}
	m.resultsIngested.WithLabelValues(group, boolLabel(passed)).Inc()
}

// ObserveDiff records the SLO-board view of a freshly computed diff: it emits the
// RTO/RPO delta gauges and increments the drift counter for each kind of drift
// the diff surfaced. A diff with no drift increments nothing beyond the gauges.
func (m *Metrics) ObserveDiff(group string, diff DrillDiff) {
	if m == nil {
		return
	}
	m.rtoDelta.WithLabelValues(group).Set(float64(diff.RTODeltaSeconds))
	m.rpoDelta.WithLabelValues(group).Set(float64(diff.RPODeltaSeconds))
	if diff.PassedChanged {
		m.driftDetected.WithLabelValues(group, "outcome").Inc()
	}
	if diff.RTORegressed {
		m.driftDetected.WithLabelValues(group, "rto").Inc()
	}
	if diff.RPORegressed {
		m.driftDetected.WithLabelValues(group, "rpo").Inc()
	}
	if len(diff.NewlyFailedSteps) > 0 || len(diff.NewlyPassedSteps) > 0 ||
		len(diff.AddedSteps) > 0 || len(diff.RemovedSteps) > 0 || len(diff.DurationDrift) > 0 {
		m.driftDetected.WithLabelValues(group, "step").Inc()
	}
	if diff.AssetDrift.HasChanges() {
		m.driftDetected.WithLabelValues(group, "asset").Inc()
	}
}

func boolLabel(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
