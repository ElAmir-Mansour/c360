package outbox

import "github.com/prometheus/client_golang/prometheus"

// Metrics captures relay-level observability for the outbox.
type Metrics struct {
	PublishedTotal  *prometheus.CounterVec
	RetriedTotal    *prometheus.CounterVec
	FailedTotal     *prometheus.CounterVec
	PublishDuration prometheus.Histogram
	ClaimBatchSize  prometheus.Histogram
	PendingRows     prometheus.Gauge
	ReapedTotal     prometheus.Counter
	PurgedTotal     prometheus.Counter
}

// NewMetrics registers outbox metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration;
// production callers pass their service registry.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}

	m := &Metrics{
		PublishedTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "outbox_events_published_total",
				Help: "Total outbox events successfully published to the bus.",
			},
			[]string{"topic"},
		),
		RetriedTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "outbox_events_retried_total",
				Help: "Total outbox publish attempts that were rescheduled for retry.",
			},
			[]string{"topic"},
		),
		FailedTotal: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "outbox_events_failed_total",
				Help: "Total outbox events parked as terminally failed.",
			},
			[]string{"topic"},
		),
		PublishDuration: prometheus.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "outbox_publish_duration_seconds",
				Help:    "Latency of a single outbox publish call to the bus.",
				Buckets: prometheus.DefBuckets,
			},
		),
		ClaimBatchSize: prometheus.NewHistogram(
			prometheus.HistogramOpts{
				Name:    "outbox_claim_batch_size",
				Help:    "Number of rows claimed per relay pass.",
				Buckets: []float64{1, 5, 10, 25, 50, 100, 250, 500},
			},
		),
		PendingRows: prometheus.NewGauge(
			prometheus.GaugeOpts{
				Name: "outbox_pending_rows",
				Help: "Outbox rows currently pending publication.",
			},
		),
		ReapedTotal: prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "outbox_rows_reaped_total",
				Help: "Total stuck publishing rows returned to pending by the reaper.",
			},
		),
		PurgedTotal: prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "outbox_rows_purged_total",
				Help: "Total published rows deleted after the retention period.",
			},
		),
	}

	reg.MustRegister(
		m.PublishedTotal,
		m.RetriedTotal,
		m.FailedTotal,
		m.PublishDuration,
		m.ClaimBatchSize,
		m.PendingRows,
		m.ReapedTotal,
		m.PurgedTotal,
	)

	return m
}
