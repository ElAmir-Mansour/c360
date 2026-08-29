package topology

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the replication-topology Prometheus series. A nil *Metrics is
// safe: every method is a no-op, so the service/consumer run unmetered in unit
// tests. Construct once per process with NewMetrics(reg) using the service's
// registry (never the global default — platform rule) so the series are scraped
// at /metrics.
type Metrics struct {
	edgesAdded     prometheus.Counter   // dr_topology_edges_added_total
	cyclesRejected prometheus.Counter   // dr_topology_cycles_rejected_total
	edgeLag        *prometheus.GaugeVec // dr_topology_edge_lag_seconds{group,stream}
	edgeHealth     *prometheus.GaugeVec // dr_topology_edge_health{group,stream,health}
	healthRollups  prometheus.Counter   // dr_topology_health_rollups_total
	rollupErrs     prometheus.Counter   // dr_topology_health_rollup_errors_total
}

// NewMetrics registers the topology metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration
// (useful in tests).
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		edgesAdded: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_topology_edges_added_total",
			Help: "Replication topology edges successfully added.",
		}),
		cyclesRejected: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_topology_cycles_rejected_total",
			Help: "Edge-add attempts rejected because they would create a cycle.",
		}),
		edgeLag: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_topology_edge_lag_seconds",
			Help: "Live replication lag (seconds) per topology edge, rolled up from datastream.dr.progress.",
		}, []string{"group", "stream"}),
		edgeHealth: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_topology_edge_health",
			Help: "One-hot edge health per topology edge (1 for the current state).",
		}, []string{"group", "stream", "health"}),
		healthRollups: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_topology_health_rollups_total",
			Help: "Edge-health rollups applied from datastream.dr.progress samples.",
		}),
		rollupErrs: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_topology_health_rollup_errors_total",
			Help: "Errors while rolling up edge health from datastream.dr.progress.",
		}),
	}
	reg.MustRegister(m.edgesAdded, m.cyclesRejected, m.edgeLag, m.edgeHealth, m.healthRollups, m.rollupErrs)
	return m
}

func (m *Metrics) observeEdgeAdded() {
	if m == nil {
		return
	}
	m.edgesAdded.Inc()
}

func (m *Metrics) observeCycleRejected() {
	if m == nil {
		return
	}
	m.cyclesRejected.Inc()
}

// observeHealthRollup records a rollup: the per-edge lag gauge and a one-hot
// health gauge (clearing the other states for the same group/stream so only the
// current health reads 1).
func (m *Metrics) observeHealthRollup(group, stream, health string, lagSeconds int64) {
	if m == nil {
		return
	}
	m.healthRollups.Inc()
	m.edgeLag.WithLabelValues(group, stream).Set(float64(lagSeconds))
	for _, h := range []string{HealthHealthy, HealthDegraded, HealthUnhealthy, HealthUnknown} {
		v := 0.0
		if h == health {
			v = 1.0
		}
		m.edgeHealth.WithLabelValues(group, stream, h).Set(v)
	}
}

func (m *Metrics) observeRollupError() {
	if m == nil {
		return
	}
	m.rollupErrs.Inc()
}
