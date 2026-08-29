package service

import (
	"github.com/prometheus/client_golang/prometheus"

	"github.com/clario360/platform/internal/observability/metrics"
	"github.com/clario360/platform/internal/siem/internal/buildinfo"
)

// SIEMMetrics is the per-instance metric collection required by
// §4.8 of the prompt. Metrics are registered on the per-service
// Prometheus registry exposed by *metrics.Metrics.
type SIEMMetrics struct {
	Up                  *prometheus.GaugeVec
	StartTime           prometheus.Gauge
	BuildInfo           *prometheus.GaugeVec
	HTTPRequestsTotal   *prometheus.CounterVec
	HTTPDurationSeconds *prometheus.HistogramVec
	DBPoolAcquireSecs   prometheus.Observer // single-series histogram
	DBPoolInUse         prometheus.Gauge
	KafkaProducerMsgs   *prometheus.CounterVec
	KafkaConsumerLag    *prometheus.GaugeVec
	AuditEmitTotal      *prometheus.CounterVec
	Readiness           *prometheus.GaugeVec
}

// NewSIEMMetrics builds and registers every metric declared in the
// SIEM-01 spec on the supplied *metrics.Metrics instance. Calling
// twice with the same instance is safe — Counter/Gauge/Histogram
// memoize by name.
func NewSIEMMetrics(m *metrics.Metrics) *SIEMMetrics {
	sm := &SIEMMetrics{
		Up:                  m.Gauge("up", "1 when siem-service is up", []string{"version", "commit"}),
		BuildInfo:           m.Gauge("build_info", "siem-service build metadata", []string{"version", "commit", "build_time", "go"}),
		HTTPRequestsTotal:   m.Counter("http_requests_total", "Total HTTP requests handled by siem-service", []string{"method", "route", "status"}),
		HTTPDurationSeconds: m.Histogram("http_request_duration_seconds", "HTTP request duration in seconds", []string{"method", "route"}, prometheus.DefBuckets),
		KafkaProducerMsgs:   m.Counter("kafka_producer_messages_total", "Kafka messages produced by siem-service", []string{"topic", "result"}),
		KafkaConsumerLag:    m.Gauge("kafka_consumer_lag", "Kafka consumer lag in messages", []string{"topic", "partition"}),
		AuditEmitTotal:      m.Counter("audit_emit_total", "Audit entries emitted by siem-service", []string{"result"}),
		Readiness:           m.Gauge("readiness", "Component readiness (1=ok, 0=down)", []string{"component"}),
	}

	// Single-series histogram + gauge for the self-reported pool stats.
	sm.DBPoolAcquireSecs = m.Histogram("db_pool_acquire_seconds_self", "Time spent acquiring a DB connection (self-reported)", []string{}, prometheus.DefBuckets).WithLabelValues()
	sm.DBPoolInUse = m.Gauge("db_pool_in_use_self", "Number of in-use DB connections (self-reported)", []string{}).WithLabelValues()
	sm.StartTime = m.Gauge("start_time_seconds", "Unix seconds at process start", []string{}).WithLabelValues()

	// Seed value-bearing metrics so dashboards have something to render.
	sm.Up.WithLabelValues(buildinfo.Version, buildinfo.Commit).Set(1)
	sm.BuildInfo.WithLabelValues(buildinfo.Version, buildinfo.Commit, buildinfo.BuildTime, buildinfo.GoVersion()).Set(1)

	// Pre-create zero-value lines so the metrics catalogue is complete.
	sm.Readiness.WithLabelValues("postgres").Set(0)
	sm.Readiness.WithLabelValues("redis").Set(0)
	sm.Readiness.WithLabelValues("kafka").Set(0)

	return sm
}

// SetReadiness updates the component readiness gauge.
func (s *SIEMMetrics) SetReadiness(component string, ok bool) {
	v := 0.0
	if ok {
		v = 1.0
	}
	s.Readiness.WithLabelValues(component).Set(v)
}
