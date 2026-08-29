package bcm

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the BCM compliance-pack Prometheus series. A nil *Metrics is
// safe: every method is a no-op, so the service runs unmetered in unit tests.
// Construct once per process with NewMetrics(reg) using the service's registry
// (never the global default — platform rule) so the series are scraped at
// /metrics.
type Metrics struct {
	assessmentsRun  *prometheus.CounterVec // dr_bcm_assessments_total{pack,compliant}
	complianceScore *prometheus.GaugeVec   // dr_bcm_compliance_score{pack,group}
	openGaps        *prometheus.GaugeVec   // dr_bcm_open_gaps{pack,group,severity}
}

// NewMetrics registers the BCM metrics on reg. A nil reg registers on a private
// registry so construction never panics on duplicate registration (useful in
// tests).
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		assessmentsRun: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_bcm_assessments_total",
			Help: "BCM compliance-pack assessments run, by pack and overall compliant outcome.",
		}, []string{"pack", "compliant"}),
		complianceScore: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_bcm_compliance_score",
			Help: "Latest BCM compliance score (0-100) per pack and consistency group.",
		}, []string{"pack", "group"}),
		openGaps: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_bcm_open_gaps",
			Help: "Latest count of unmet controls per pack and group, by severity (mandatory|advisory).",
		}, []string{"pack", "group", "severity"}),
	}
	reg.MustRegister(m.assessmentsRun, m.complianceScore, m.openGaps)
	return m
}

// ObserveAssessment records a completed assessment: the run counter, the score
// gauge, and the open-gap gauges split by mandatory vs advisory severity.
func (m *Metrics) ObserveAssessment(pack, group string, a Assessment) {
	if m == nil {
		return
	}
	m.assessmentsRun.WithLabelValues(pack, boolLabel(a.Compliant)).Inc()
	m.complianceScore.WithLabelValues(pack, group).Set(a.Score)

	var mandatory, advisory int
	for _, g := range a.Gaps {
		if g.Mandatory {
			mandatory++
		} else {
			advisory++
		}
	}
	m.openGaps.WithLabelValues(pack, group, "mandatory").Set(float64(mandatory))
	m.openGaps.WithLabelValues(pack, group, "advisory").Set(float64(advisory))
}

func boolLabel(b bool) string {
	if b {
		return "true"
	}
	return "false"
}
