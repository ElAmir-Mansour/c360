package iacdr

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the IaC-DR Prometheus series. A nil *Metrics is safe: every
// method is a no-op, so the service runs unmetered in unit tests. Construct once
// per process with NewMetrics(reg) using the service's registry (never the
// global default — platform rule).
type Metrics struct {
	snapshotsIngested *prometheus.CounterVec // dr_iac_snapshots_ingested_total{source_kind}
	resourcesCaptured prometheus.Counter     // dr_iac_resources_captured_total
	parseErrors       *prometheus.CounterVec // dr_iac_parse_errors_total{source_kind}
	diffsComputed     prometheus.Counter     // dr_iac_diffs_computed_total
	driftResources    prometheus.Counter     // dr_iac_drift_resources_total
	plansBuilt        prometheus.Counter     // dr_iac_reconstitution_plans_total
	cyclesRejected    prometheus.Counter     // dr_iac_plan_cycles_rejected_total
}

// NewMetrics registers the IaC-DR metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		snapshotsIngested: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_iac_snapshots_ingested_total",
			Help: "IaC snapshots ingested, by source kind.",
		}, []string{"source_kind"}),
		resourcesCaptured: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_iac_resources_captured_total",
			Help: "IaC resources captured across all snapshots.",
		}),
		parseErrors: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_iac_parse_errors_total",
			Help: "IaC artifact parse errors, by source kind.",
		}, []string{"source_kind"}),
		diffsComputed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_iac_diffs_computed_total",
			Help: "IaC drift diffs computed between two snapshots.",
		}),
		driftResources: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_iac_drift_resources_total",
			Help: "Resources reported as added/removed/modified by drift diffs.",
		}),
		plansBuilt: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_iac_reconstitution_plans_total",
			Help: "Reconstitution plans built.",
		}),
		cyclesRejected: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_iac_plan_cycles_rejected_total",
			Help: "Reconstitution-plan attempts rejected because the dependency graph contains a cycle.",
		}),
	}
	reg.MustRegister(
		m.snapshotsIngested, m.resourcesCaptured, m.parseErrors,
		m.diffsComputed, m.driftResources, m.plansBuilt, m.cyclesRejected,
	)
	return m
}

func (m *Metrics) observeIngested(sourceKind string, resourceCount int) {
	if m == nil {
		return
	}
	m.snapshotsIngested.WithLabelValues(sourceKind).Inc()
	m.resourcesCaptured.Add(float64(resourceCount))
}

func (m *Metrics) observeParseError(sourceKind string) {
	if m == nil {
		return
	}
	m.parseErrors.WithLabelValues(sourceKind).Inc()
}

func (m *Metrics) observeDiff(added, removed, modified int) {
	if m == nil {
		return
	}
	m.diffsComputed.Inc()
	m.driftResources.Add(float64(added + removed + modified))
}

func (m *Metrics) observePlan() {
	if m == nil {
		return
	}
	m.plansBuilt.Inc()
}

func (m *Metrics) observeCycleRejected() {
	if m == nil {
		return
	}
	m.cyclesRejected.Inc()
}
