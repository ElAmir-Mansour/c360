package selfdr

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the self-DR Prometheus series. A nil *Metrics is safe: every
// method is a no-op, so the service runs unmetered in unit tests. Construct once
// per process with NewMetrics(reg) using the service's registry (never the global
// default — platform rule).
type Metrics struct {
	assessments *prometheus.CounterVec // dr_selfdr_assessments_total{verdict}
	findings    *prometheus.GaugeVec   // dr_selfdr_findings{severity}
	artifacts   *prometheus.CounterVec // dr_selfdr_artifacts_total{kind}
}

// NewMetrics registers the self-DR metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		assessments: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_selfdr_assessments_total",
			Help: "Self-DR readiness assessments run, by overall verdict.",
		}, []string{"verdict"}),
		findings: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_selfdr_findings",
			Help: "Latest self-DR readiness finding count, by severity.",
		}, []string{"severity"}),
		artifacts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_selfdr_artifacts_total",
			Help: "Self-DR immutable artifacts sealed, by kind (control_plane_backup|offline_restore_bundle).",
		}, []string{"kind"}),
	}
	reg.MustRegister(m.assessments, m.findings, m.artifacts)
	return m
}

// ObserveAssessment records a completed readiness assessment: the run counter (by
// verdict) and the finding gauges split by severity. Severities absent from the
// assessment are reset to zero so a cleared finding does not leave a stale gauge.
func (m *Metrics) ObserveAssessment(a ReadinessAssessment) {
	if m == nil {
		return
	}
	m.assessments.WithLabelValues(string(a.Verdict)).Inc()

	counts := map[Severity]int{
		SeverityInfo:     0,
		SeverityWarning:  0,
		SeverityCritical: 0,
	}
	for _, f := range a.Findings {
		counts[f.Severity]++
	}
	for severity, n := range counts {
		m.findings.WithLabelValues(string(severity)).Set(float64(n))
	}
}

// ObserveArtifact records one sealed artifact by kind.
func (m *Metrics) ObserveArtifact(kind ArtifactKind) {
	if m == nil {
		return
	}
	m.artifacts.WithLabelValues(string(kind)).Inc()
}
