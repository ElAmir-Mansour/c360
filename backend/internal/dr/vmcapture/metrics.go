package vmcapture

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the workload-capture SLO series. A nil *Metrics is safe: every
// method is a no-op, so components not wired with metrics (e.g. unit tests) need
// no changes. Per the platform rule, NewMetrics uses a per-instance registry.
type Metrics struct {
	// captures counts completed capture passes, by source kind and epoch kind
	// (base|incremental) — proving the capturers are producing real epochs.
	captures *prometheus.CounterVec
	// changedUnits sums the changed units (blocks for VM, resources for K8s)
	// emitted, by source kind — the headline "how much moved" series.
	changedUnits *prometheus.CounterVec
	// framesEmitted sums the frames shipped into the pipeline, by source kind.
	framesEmitted *prometheus.CounterVec
	// payloadBytes sums the raw payload bytes captured, by source kind.
	payloadBytes *prometheus.CounterVec
	// failures counts capture-pass failures, by source kind.
	failures *prometheus.CounterVec
	// totalUnits records the latest full unit count of a source's workload, by
	// source kind and source id — the protected-surface gauge.
	totalUnits *prometheus.GaugeVec
}

// NewMetrics registers the workload-capture metrics on reg. A nil reg registers
// on a private registry so construction never panics on duplicate registration.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		captures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_workload_captures_total",
			Help: "Completed workload capture passes, by source kind and epoch kind.",
		}, []string{"source_kind", "epoch_kind"}),
		changedUnits: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_workload_capture_changed_units_total",
			Help: "Changed units captured (blocks for vm_disk, resources for k8s_workload), by source kind.",
		}, []string{"source_kind"}),
		framesEmitted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_workload_capture_frames_total",
			Help: "Frames emitted into the replication pipeline by workload capturers, by source kind.",
		}, []string{"source_kind"}),
		payloadBytes: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_workload_capture_payload_bytes_total",
			Help: "Raw payload bytes captured by workload capturers, by source kind.",
		}, []string{"source_kind"}),
		failures: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_workload_capture_failures_total",
			Help: "Failed workload capture passes, by source kind.",
		}, []string{"source_kind"}),
		totalUnits: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_workload_capture_total_units",
			Help: "Full unit count of a source's protected workload (blocks/resources), by source kind and source id.",
		}, []string{"source_kind", "source_id"}),
	}
	reg.MustRegister(m.captures, m.changedUnits, m.framesEmitted, m.payloadBytes, m.failures, m.totalUnits)
	return m
}

// ObserveCapture records a completed capture pass for a source.
func (m *Metrics) ObserveCapture(sourceKind, sourceID string, e Epoch) {
	if m == nil {
		return
	}
	m.captures.WithLabelValues(sourceKind, e.EpochKind).Inc()
	if e.ChangedUnits > 0 {
		m.changedUnits.WithLabelValues(sourceKind).Add(float64(e.ChangedUnits))
	}
	if e.FrameCount > 0 {
		m.framesEmitted.WithLabelValues(sourceKind).Add(float64(e.FrameCount))
	}
	if e.PayloadBytes > 0 {
		m.payloadBytes.WithLabelValues(sourceKind).Add(float64(e.PayloadBytes))
	}
	m.totalUnits.WithLabelValues(sourceKind, sourceID).Set(float64(e.TotalUnits))
}

// IncFailure records a failed capture pass for a source kind.
func (m *Metrics) IncFailure(sourceKind string) {
	if m == nil {
		return
	}
	m.failures.WithLabelValues(sourceKind).Inc()
}
