package cleanroom

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the clean-room SLO series. A nil *Metrics is safe: every method
// is a no-op, so components not wired with metrics (e.g. unit tests) need no
// changes.
type Metrics struct {
	// verdict counts terminal clean-room verdicts by group and result, so the
	// DR dashboard can alert on a rising dirty rate. This is the
	// dr_cleanroom_verdict{group,result} series the prompt requires.
	verdict *prometheus.CounterVec
	// chunksScanned counts restored chunks put through scanning, proving the
	// validator is doing real work (not vacuously passing empty points).
	chunksScanned prometheus.Counter
}

// NewMetrics registers the clean-room metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration;
// production passes the service's registry so the series are scraped at
// /metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		verdict: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_cleanroom_verdict",
			Help: "Clean-room recovery-validation verdicts by consistency group and result (clean|malware|integrity_failed|error).",
		}, []string{"group", "result"}),
		chunksScanned: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_cleanroom_chunks_scanned_total",
			Help: "Total recovery-point chunks restored into the sandbox and scanned.",
		}),
	}
	reg.MustRegister(m.verdict, m.chunksScanned)
	return m
}

// IncVerdict records a terminal verdict for a group.
func (m *Metrics) IncVerdict(group, result string) {
	if m == nil {
		return
	}
	m.verdict.WithLabelValues(group, result).Inc()
}

// AddChunksScanned records the number of chunks scanned in one run.
func (m *Metrics) AddChunksScanned(n int) {
	if m == nil || n <= 0 {
		return
	}
	m.chunksScanned.Add(float64(n))
}
