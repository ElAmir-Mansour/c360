package integrations

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics holds the integrations observability series. Construct once per
// process with NewMetrics and inject into the Service. A nil *Metrics is safe:
// every method is a no-op, so components not wired with metrics (e.g. unit
// tests) need no changes.
//
// Per the platform rule these register on a per-instance registry via
// promauto.With(reg), never the global default, so constructing twice in a test
// never panics on duplicate registration.
type Metrics struct {
	tests *prometheus.CounterVec // by vendor + result: success | failure
}

// NewMetrics registers the integrations metrics on reg. A nil reg registers on a
// private registry (tests), so construction never panics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	f := promauto.With(reg)
	return &Metrics{
		tests: f.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_integration_tests_total",
			Help: "Total integration connectivity tests, by vendor and result (success|failure).",
		}, []string{"vendor", "result"}),
	}
}

// IncTest records one TestConnection outcome for vendor. success selects the
// "success" or "failure" result label.
func (m *Metrics) IncTest(vendor string, success bool) {
	if m == nil {
		return
	}
	result := "failure"
	if success {
		result = "success"
	}
	m.tests.WithLabelValues(vendor, result).Inc()
}
