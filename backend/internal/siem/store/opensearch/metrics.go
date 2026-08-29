package opensearch

import "github.com/prometheus/client_golang/prometheus"

// Metrics is the per-instance metric set for the OpenSearch wrapper.
// All metrics are registered into the prometheus.Registerer passed at
// construction; the wrapper never touches prometheus.DefaultRegisterer.
type Metrics struct {
	BulkDocsTotal  *prometheus.CounterVec   // labels: tenant, result
	BulkDuration   *prometheus.HistogramVec // labels: tenant
	SearchTotal    *prometheus.CounterVec   // labels: tenant, result
	SearchDuration *prometheus.HistogramVec // labels: tenant
	TemplateHash   *prometheus.GaugeVec     // labels: tenant, hash
	RolloverTotal  *prometheus.CounterVec   // labels: tenant, result
	FreezeTotal    *prometheus.CounterVec   // labels: tenant, result
	HealthStatus   *prometheus.GaugeVec     // labels: status (green/yellow/red)
}

// NewMetrics constructs and registers the metric set.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		BulkDocsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_opensearch_bulk_docs_total",
			Help: "Number of documents submitted to _bulk, by outcome.",
		}, []string{"tenant", "result"}),
		BulkDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "siem_opensearch_bulk_duration_seconds",
			Help:    "Duration of _bulk requests.",
			Buckets: prometheus.DefBuckets,
		}, []string{"tenant"}),
		SearchTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_opensearch_search_total",
			Help: "Number of _search requests, by outcome.",
		}, []string{"tenant", "result"}),
		SearchDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "siem_opensearch_search_duration_seconds",
			Help:    "Duration of _search requests.",
			Buckets: prometheus.DefBuckets,
		}, []string{"tenant"}),
		TemplateHash: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_opensearch_template_hash",
			Help: "Pinned to 1 with template SHA-256 as the hash label.",
		}, []string{"tenant", "hash"}),
		RolloverTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_opensearch_rollover_total",
			Help: "Number of rollover_hot calls, by outcome.",
		}, []string{"tenant", "result"}),
		FreezeTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_opensearch_freeze_total",
			Help: "Number of freeze_warm calls, by outcome.",
		}, []string{"tenant", "result"}),
		HealthStatus: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_opensearch_health_status",
			Help: "Cluster health status pinned to 1 by colour label.",
		}, []string{"status"}),
	}
	if reg != nil {
		reg.MustRegister(
			m.BulkDocsTotal, m.BulkDuration, m.SearchTotal, m.SearchDuration,
			m.TemplateHash, m.RolloverTotal, m.FreezeTotal, m.HealthStatus,
		)
	}
	return m
}
