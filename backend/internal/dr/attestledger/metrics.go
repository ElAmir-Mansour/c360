package attestledger

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the attestation-ledger series. A nil *Metrics is safe: every
// method is a no-op, so components not wired with metrics (unit tests) need no
// changes.
type Metrics struct {
	// appended counts ledger entries appended by type, proving the chain grows.
	appended *prometheus.CounterVec
	// verifyResult counts chain verifications by outcome (intact|broken), so the
	// DR dashboard can alert on a detected tamper.
	verifyResult *prometheus.CounterVec
	// anchored counts Merkle checkpoints sealed to WORM.
	anchored prometheus.Counter
	// anchoredEntries counts entries covered by anchoring (the checkpoint span).
	anchoredEntries prometheus.Counter
}

// NewMetrics registers the ledger metrics on reg. A nil reg uses a private
// registry so construction never panics on duplicate registration; production
// passes the service's registry so the series are scraped at /metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		appended: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_attestation_ledger_appended_total",
			Help: "Attestation-ledger entries appended, by entry_type.",
		}, []string{"entry_type"}),
		verifyResult: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_attestation_ledger_verify_total",
			Help: "Attestation-ledger chain verifications, by result (intact|broken).",
		}, []string{"result"}),
		anchored: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_attestation_ledger_anchored_checkpoints_total",
			Help: "Merkle checkpoints sealed to WORM.",
		}),
		anchoredEntries: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_attestation_ledger_anchored_entries_total",
			Help: "Ledger entries covered by an anchored checkpoint.",
		}),
	}
	reg.MustRegister(m.appended, m.verifyResult, m.anchored, m.anchoredEntries)
	return m
}

// IncAppended records an appended entry of the given type.
func (m *Metrics) IncAppended(entryType string) {
	if m == nil {
		return
	}
	m.appended.WithLabelValues(entryType).Inc()
}

// IncVerify records a chain verification outcome ("intact" or "broken").
func (m *Metrics) IncVerify(intact bool) {
	if m == nil {
		return
	}
	result := "intact"
	if !intact {
		result = "broken"
	}
	m.verifyResult.WithLabelValues(result).Inc()
}

// IncAnchored records a sealed checkpoint covering n entries.
func (m *Metrics) IncAnchored(n int) {
	if m == nil {
		return
	}
	m.anchored.Inc()
	if n > 0 {
		m.anchoredEntries.Add(float64(n))
	}
}
