package minio

import "github.com/prometheus/client_golang/prometheus"

// Metrics is the per-instance metric set for the MinIO wrapper.
type Metrics struct {
	SealTotal           *prometheus.CounterVec   // labels: tenant, class, result
	SealBytes           *prometheus.CounterVec   // labels: tenant, class
	SealDuration        *prometheus.HistogramVec // labels: tenant
	GetTotal            *prometheus.CounterVec   // labels: result
	WORMSelfTestTotal   *prometheus.CounterVec   // labels: result
	BucketHealthyStatus *prometheus.GaugeVec     // labels: bucket
}

// NewMetrics constructs and registers the metric set.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	m := &Metrics{
		SealTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_minio_seal_total",
			Help: "Number of SealIndex calls.",
		}, []string{"tenant", "class", "result"}),
		SealBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_minio_seal_bytes_total",
			Help: "Bytes written by SealIndex.",
		}, []string{"tenant", "class"}),
		SealDuration: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "siem_minio_seal_duration_seconds",
			Help:    "Duration of SealIndex calls.",
			Buckets: prometheus.DefBuckets,
		}, []string{"tenant"}),
		GetTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_minio_get_total",
			Help: "Number of Get/Stat calls.",
		}, []string{"result"}),
		WORMSelfTestTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "siem_minio_worm_self_test_total",
			Help: "Number of WORM self-test runs.",
		}, []string{"result"}),
		BucketHealthyStatus: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "siem_minio_bucket_healthy",
			Help: "1 when the bucket passed the last BucketHealthy probe, 0 otherwise.",
		}, []string{"bucket"}),
	}
	if reg != nil {
		reg.MustRegister(
			m.SealTotal, m.SealBytes, m.SealDuration, m.GetTotal,
			m.WORMSelfTestTotal, m.BucketHealthyStatus,
		)
	}
	return m
}
