package store

import (
	"github.com/prometheus/client_golang/prometheus"
)

// Metrics is the top-level Store-scope metric set. Subpackages register
// their own metrics through their own constructors; this struct only owns
// metrics that span subpackages (currently the PII schema hash gauge).
type Metrics struct {
	PIISchemaHash *prometheus.GaugeVec // labels: hash
	SelfTestRuns  *prometheus.CounterVec
}

// NewMetrics registers the top-level Store metrics into reg.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	piiHash := prometheus.NewGaugeVec(prometheus.GaugeOpts{
		Name: "siem_pii_schema_hash",
		Help: "PII schema YAML SHA-256, pinned to 1; label is the hash value.",
	}, []string{"hash"})
	selfTest := prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "siem_store_self_test_total",
		Help: "Outcome of Store.SelfTest invocations.",
	}, []string{"result"})
	if reg != nil {
		reg.MustRegister(piiHash, selfTest)
	}
	return &Metrics{PIISchemaHash: piiHash, SelfTestRuns: selfTest}
}
