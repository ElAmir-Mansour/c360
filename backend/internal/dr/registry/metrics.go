package registry

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the Recovery Asset Registry's Prometheus series. A nil *Metrics
// is safe: every method is a no-op, so the generator/consumer run unmetered in
// unit tests. Construct once per process with NewMetrics(reg) using the
// service's registry (never the global default — platform rule).
type Metrics struct {
	regenerations *prometheus.CounterVec // dr_runbook_regenerations_total{trigger,changed}
	versions      *prometheus.GaugeVec   // dr_runbook_current_version{group}
	steps         *prometheus.GaugeVec   // dr_runbook_steps{group}
	reconcileErrs prometheus.Counter     // dr_runbook_reconcile_errors_total
}

// NewMetrics registers the registry metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration
// (useful in tests); production passes the service's registry so the series are
// scraped at /metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		regenerations: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_runbook_regenerations_total",
			Help: "Recovery runbook regenerations, labelled by trigger and whether the materialized steps actually changed.",
		}, []string{"trigger", "changed"}),
		versions: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_runbook_current_version",
			Help: "Current stored version number of each consistency group's recovery runbook.",
		}, []string{"group"}),
		steps: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_runbook_steps",
			Help: "Number of steps in the current recovery runbook of each consistency group.",
		}, []string{"group"}),
		reconcileErrs: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_runbook_reconcile_errors_total",
			Help: "Errors encountered by the runbook reconcile loop while processing datastream.dr.events.",
		}),
	}
	reg.MustRegister(m.regenerations, m.versions, m.steps, m.reconcileErrs)
	return m
}

// observeRegeneration records a regeneration outcome.
func (m *Metrics) observeRegeneration(trigger string, changed bool, groupID string, version, stepCount int) {
	if m == nil {
		return
	}
	changedLabel := "false"
	if changed {
		changedLabel = "true"
	}
	m.regenerations.WithLabelValues(trigger, changedLabel).Inc()
	if changed {
		m.versions.WithLabelValues(groupID).Set(float64(version))
		m.steps.WithLabelValues(groupID).Set(float64(stepCount))
	}
}

// observeReconcileError increments the reconcile error counter.
func (m *Metrics) observeReconcileError() {
	if m == nil {
		return
	}
	m.reconcileErrs.Inc()
}
