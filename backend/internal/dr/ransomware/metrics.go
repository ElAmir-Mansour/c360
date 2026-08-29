package ransomware

import "github.com/prometheus/client_golang/prometheus"

// Metrics exposes the ransomware early-warning Prometheus series. A nil *Metrics
// is safe: every method is a no-op, so the detector runs without a registry in
// unit tests.
type Metrics struct {
	// signal is dr_ransomware_signal{stream,kind}: a counter of fired signals
	// by stream and kind. Alerting rules count rate() over this series.
	signal *prometheus.CounterVec
	// confirmed is dr_ransomware_confirmed{stream}: a counter of confirmed
	// anomalies (multi-signal corroboration) per stream.
	confirmed *prometheus.CounterVec
	// entropy is dr_ransomware_entropy_bits{stream}: the most recent sampled
	// payload entropy (bits/byte) per stream, for dashboards.
	entropy *prometheus.GaugeVec
	// curated is dr_ransomware_clean_point_curated_total: how many times a clean
	// recovery point was pinned in response to a confirmed anomaly.
	curated prometheus.Counter
}

// NewMetrics registers the ransomware metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration (the
// per-instance registry rule); production passes the service registry.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		signal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_ransomware_signal",
			Help: "Count of ransomware early-warning signals fired, by replication stream and signal kind (entropy|byte_rate|change_rate|delete_burst).",
		}, []string{"stream", "kind"}),
		confirmed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_ransomware_confirmed",
			Help: "Count of confirmed ransomware anomalies (multi-signal corroboration) per replication stream.",
		}, []string{"stream"}),
		entropy: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_ransomware_entropy_bits",
			Help: "Most recent sampled changed-payload Shannon entropy in bits/byte per replication stream (8.0 = uniformly random, e.g. ciphertext).",
		}, []string{"stream"}),
		curated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_ransomware_clean_point_curated_total",
			Help: "Count of last-known-clean recovery points pinned (legal-held) in response to a confirmed ransomware anomaly.",
		}),
	}
	reg.MustRegister(m.signal, m.confirmed, m.entropy, m.curated)
	return m
}

// IncSignal increments the dr_ransomware_signal{stream,kind} counter.
func (m *Metrics) IncSignal(stream, kind string) {
	if m == nil {
		return
	}
	m.signal.WithLabelValues(stream, kind).Inc()
}

// IncConfirmed increments the dr_ransomware_confirmed{stream} counter.
func (m *Metrics) IncConfirmed(stream string) {
	if m == nil {
		return
	}
	m.confirmed.WithLabelValues(stream).Inc()
}

// SetEntropy records the latest sampled entropy for a stream.
func (m *Metrics) SetEntropy(stream string, bits float64) {
	if m == nil {
		return
	}
	m.entropy.WithLabelValues(stream).Set(bits)
}

// IncCurated increments the clean-point curation counter.
func (m *Metrics) IncCurated() {
	if m == nil {
		return
	}
	m.curated.Inc()
}
