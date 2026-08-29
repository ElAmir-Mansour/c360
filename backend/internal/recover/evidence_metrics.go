package recover

import "github.com/prometheus/client_golang/prometheus"

// EvidenceMetrics holds the regulatory-evidence Prometheus series. A nil
// *EvidenceMetrics is safe: every method is a no-op, so the service runs
// unmetered in unit tests. Construct once per process with NewEvidenceMetrics(reg)
// using the service's registry (never the global default — platform rule).
type EvidenceMetrics struct {
	reports   *prometheus.CounterVec // recover_evidence_reports_total{sub_solution}
	exports   *prometheus.CounterVec // recover_evidence_exports_total{format}
	auditRows prometheus.Counter     // recover_audit_events_total
}

// NewEvidenceMetrics registers the evidence metrics on reg. A nil reg registers on
// a private registry so construction never panics on duplicate registration
// (tests); production passes the service's registry so the series are scraped.
func NewEvidenceMetrics(reg prometheus.Registerer) *EvidenceMetrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &EvidenceMetrics{
		reports: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_evidence_reports_total",
			Help: "Regulatory evidence reports assembled, by originating sub-solution.",
		}, []string{"sub_solution"}),
		exports: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_evidence_exports_total",
			Help: "Regulatory evidence exports produced, by format (csv|pdf|json).",
		}, []string{"format"}),
		auditRows: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "recover_audit_events_total",
			Help: "Append-only Recover audit-trail rows written across all sub-solutions.",
		}),
	}
	reg.MustRegister(m.reports, m.exports, m.auditRows)
	return m
}

// observeReport records one assembled evidence report for a sub-solution.
func (m *EvidenceMetrics) observeReport(subSolution string) {
	if m == nil {
		return
	}
	if subSolution == "" {
		subSolution = "unknown"
	}
	m.reports.WithLabelValues(subSolution).Inc()
}

// observeExport records one produced export in the given format.
func (m *EvidenceMetrics) observeExport(format EvidenceFormat) {
	if m == nil {
		return
	}
	m.exports.WithLabelValues(string(format)).Inc()
}

// observeAuditWrite records one appended audit row.
func (m *EvidenceMetrics) observeAuditWrite() {
	if m == nil {
		return
	}
	m.auditRows.Inc()
}
