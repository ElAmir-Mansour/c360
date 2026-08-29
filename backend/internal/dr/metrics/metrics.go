// Package metrics exposes the ClarioDR SLO board metrics (DESIGN §11). These
// are the series the Prometheus recording/alert rules and the Grafana DR
// dashboard consume: RPO, failover RTO, recovery-point validation ratio, and
// per-stream status. They are emitted by the RPO monitor, the failover driver,
// and the recovery-point validator at the points where those values are
// actually computed.
//
// A nil *Metrics is safe: every method is a no-op, so components that are not
// wired with metrics (e.g. unit tests) need no changes.
package metrics

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the DR SLO gauges/histogram. Construct once per process with
// New and inject into the monitor, failover driver, and recovery-point service.
type Metrics struct {
	rpoSeconds      *prometheus.GaugeVec     // dr_rpo_seconds{group}
	failoverRTO     *prometheus.HistogramVec // dr_failover_rto_seconds{mode}
	validationRatio *prometheus.GaugeVec     // dr_recovery_point_validation_ratio{group}
	streamStatus    *prometheus.GaugeVec     // dr_stream_status{stream,status}
}

// New registers the DR SLO metrics on reg. A nil reg registers on a private
// registry (useful in tests), so construction never panics on duplicate
// registration; production passes the service's registry so the series are
// scraped at /metrics.
func New(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		rpoSeconds: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_rpo_seconds",
			Help: "Live recovery point objective (seconds of unreplicated change) per consistency group. SLO <= 300.",
		}, []string{"group"}),
		failoverRTO: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "dr_failover_rto_seconds",
			Help:    "Observed failover recovery time (initiated to completed) in seconds, by mode. SLO <= 900.",
			Buckets: []float64{30, 60, 120, 300, 600, 900, 1800, 3600},
		}, []string{"mode"}),
		validationRatio: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_recovery_point_validation_ratio",
			Help: "Recovery-point validation match ratio per consistency group. SLO >= 0.999.",
		}, []string{"group"}),
		streamStatus: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_stream_status",
			Help: "Replication stream status as a one-hot gauge: 1 marks the stream's current status label.",
		}, []string{"stream", "status"}),
	}
	reg.MustRegister(m.rpoSeconds, m.failoverRTO, m.validationRatio, m.streamStatus)
	return m
}

// SetRPO records the live RPO (seconds) for a consistency group.
func (m *Metrics) SetRPO(group string, seconds float64) {
	if m == nil {
		return
	}
	m.rpoSeconds.WithLabelValues(group).Set(seconds)
}

// ObserveRTO records an observed failover recovery time (seconds) for a mode
// (real or drill).
func (m *Metrics) ObserveRTO(mode string, seconds float64) {
	if m == nil {
		return
	}
	m.failoverRTO.WithLabelValues(mode).Observe(seconds)
}

// SetValidationRatio records the validation match ratio for a group's latest
// validated recovery point.
func (m *Metrics) SetValidationRatio(group string, ratio float64) {
	if m == nil {
		return
	}
	m.validationRatio.WithLabelValues(group).Set(ratio)
}

// SetStreamStatus emits a one-hot status gauge for a stream: the current
// status is set to 1 and the other known statuses to 0, so PromQL can select
// the active status without stale series lingering at 1.
func (m *Metrics) SetStreamStatus(stream, current string) {
	if m == nil {
		return
	}
	for _, s := range streamStatuses {
		v := 0.0
		if s == current {
			v = 1.0
		}
		m.streamStatus.WithLabelValues(stream, s).Set(v)
	}
}

// streamStatuses mirrors replication_stream.status CHECK values so the one-hot
// gauge clears the previous status when a stream transitions.
var streamStatuses = []string{"pending", "seeding", "streaming", "paused", "degraded", "error"}
