package assurance

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the recovery-assurance Prometheus series. A nil *Metrics is safe:
// every method is a no-op, so the service runs unmetered in unit tests. Construct
// once per process with NewMetrics(reg) using the service's registry (never the
// global default — platform rule) so the series are scraped at /metrics.
type Metrics struct {
	evaluations *prometheus.CounterVec // dr_assurance_evaluations_total{verdict}
	score       *prometheus.GaugeVec   // dr_assurance_score{group}
	findings    *prometheus.GaugeVec   // dr_assurance_findings{group,severity}
}

// NewMetrics registers the assurance metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration
// (useful in tests).
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		evaluations: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_assurance_evaluations_total",
			Help: "Recovery-assurance evaluations run, by overall verdict.",
		}, []string{"verdict"}),
		score: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_assurance_score",
			Help: "Latest recovery-assurance score (0-100) per consistency group.",
		}, []string{"group"}),
		findings: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_assurance_findings",
			Help: "Latest count of unmet/partial assurance controls per group, by finding severity.",
		}, []string{"group", "severity"}),
	}
	reg.MustRegister(m.evaluations, m.score, m.findings)
	return m
}

// ObserveEvaluation records a completed evaluation: the run counter (by verdict),
// the score gauge, and the finding gauges split by severity. Severities not
// present in the evaluation are reset to zero so a cleared finding does not leave
// a stale gauge.
func (m *Metrics) ObserveEvaluation(group string, a AssuranceAssessment) {
	if m == nil {
		return
	}
	m.evaluations.WithLabelValues(string(a.Verdict)).Inc()
	m.score.WithLabelValues(group).Set(a.Score)

	counts := map[Severity]int{
		SeverityWarning:  0,
		SeverityHigh:     0,
		SeverityCritical: 0,
	}
	for _, f := range a.Findings {
		counts[f.Severity]++
	}
	for severity, n := range counts {
		m.findings.WithLabelValues(group, string(severity)).Set(float64(n))
	}
}
