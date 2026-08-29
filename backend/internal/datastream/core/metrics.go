package core

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the replication-core Prometheus instruments (§11). Counters are
// labelled by stream so the SLO board can break out per-stream throughput, and
// the lag gauge tracks now - Frame.EmittedAt at apply.
type Metrics struct {
	// BytesShipped counts raw payload bytes shipped per stream.
	BytesShipped *prometheus.CounterVec
	// FramesShipped counts frames shipped per stream and kind.
	FramesShipped *prometheus.CounterVec
	// ReplicationLag is the most recent apply lag (now - EmittedAt) per stream.
	ReplicationLag *prometheus.GaugeVec
	// TransportResumes counts transport resume events per transport backend.
	TransportResumes *prometheus.CounterVec
}

// NewMetrics registers the core metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration
// (following the platform's per-instance-registry rule); production callers
// pass their service registry.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}

	m := &Metrics{
		BytesShipped: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "dr_bytes_shipped_total",
				Help: "Total raw payload bytes shipped through the replication transport.",
			},
			[]string{"stream"},
		),
		FramesShipped: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "dr_frames_shipped_total",
				Help: "Total frames shipped through the replication transport.",
			},
			[]string{"stream", "kind"},
		),
		ReplicationLag: prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "dr_replication_lag_seconds",
				Help: "Most recent replication lag (now - Frame.EmittedAt) observed at apply.",
			},
			[]string{"stream"},
		),
		TransportResumes: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "dr_transport_resumes_total",
				Help: "Total transport resume events (reconnect after disconnect).",
			},
			[]string{"transport"},
		),
	}

	reg.MustRegister(
		m.BytesShipped,
		m.FramesShipped,
		m.ReplicationLag,
		m.TransportResumes,
	)

	return m
}
