package metastore

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the Application Metastore's Prometheus series. A nil *Metrics is
// safe: every method is a no-op, so the registry/populator run unmetered in unit
// tests. Construct once per process with NewMetrics(reg) using the service's
// registry (never the global default — platform rule).
type Metrics struct {
	appWrites     *prometheus.CounterVec // recover_metastore_app_writes_total{op}
	populates     *prometheus.CounterVec // recover_metastore_populate_total{tier}
	populateTasks prometheus.Histogram   // recover_metastore_populate_tasks
	syncs         *prometheus.CounterVec // recover_metastore_sync_total{drifted}
}

// NewMetrics registers the metastore metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration
// (useful in tests); production passes the service's registry so the series are
// scraped at /metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		appWrites: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_metastore_app_writes_total",
			Help: "Application Metastore application writes, labelled by operation (create/update/delete).",
		}, []string{"op"}),
		populates: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_metastore_populate_total",
			Help: "Runbooks populated from Metastore application metadata, labelled by the application's recovery tier.",
		}, []string{"tier"}),
		populateTasks: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "recover_metastore_populate_tasks",
			Help:    "Number of tasks materialized when populating a runbook from an application's metadata.",
			Buckets: []float64{1, 3, 5, 8, 13, 21, 34},
		}),
		syncs: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_metastore_sync_total",
			Help: "Metastore sync (drift-detection) runs, labelled by whether drift was flagged.",
		}, []string{"drifted"}),
	}
	reg.MustRegister(m.appWrites, m.populates, m.populateTasks, m.syncs)
	return m
}

// observeApplicationWrite records an application create/update/delete.
func (m *Metrics) observeApplicationWrite(op string) {
	if m == nil {
		return
	}
	m.appWrites.WithLabelValues(op).Inc()
}

// observePopulate records a runbook population from application metadata.
func (m *Metrics) observePopulate(tier string, taskCount int) {
	if m == nil {
		return
	}
	m.populates.WithLabelValues(tier).Inc()
	m.populateTasks.Observe(float64(taskCount))
}

// observeSync records a sync run and whether it flagged drift.
func (m *Metrics) observeSync(drifted bool) {
	if m == nil {
		return
	}
	label := "false"
	if drifted {
		label = "true"
	}
	m.syncs.WithLabelValues(label).Inc()
}
