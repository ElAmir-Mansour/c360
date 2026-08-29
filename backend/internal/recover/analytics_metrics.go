package recover

import "github.com/prometheus/client_golang/prometheus"

// AnalyticsMetrics holds the cross-sub-solution analytics Prometheus series. A
// nil *AnalyticsMetrics is safe: every method is a no-op, so the service runs
// unmetered in unit tests. Construct once per process with NewAnalyticsMetrics(reg)
// using the service's registry (never the global default — platform rule).
type AnalyticsMetrics struct {
	requests     prometheus.Counter   // recover_analytics_requests_total
	applications prometheus.Histogram // recover_analytics_applications
	atRisk       prometheus.Gauge     // recover_analytics_at_risk_applications
	portfolio    prometheus.Gauge     // recover_analytics_portfolio_readiness
}

// NewAnalyticsMetrics registers the analytics metrics on reg. A nil reg registers
// on a private registry so construction never panics on duplicate registration
// (useful in tests); production passes the service's registry so the series are
// scraped at /metrics.
func NewAnalyticsMetrics(reg prometheus.Registerer) *AnalyticsMetrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &AnalyticsMetrics{
		requests: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "recover_analytics_requests_total",
			Help: "Cross-sub-solution Recover analytics computations served.",
		}),
		applications: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "recover_analytics_applications",
			Help:    "Number of applications scanned per analytics computation.",
			Buckets: []float64{1, 5, 10, 25, 50, 100, 200},
		}),
		atRisk: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "recover_analytics_at_risk_applications",
			Help: "Applications whose latest RTA breached their RTO target at the last analytics computation.",
		}),
		portfolio: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "recover_analytics_portfolio_readiness",
			Help: "Portfolio readiness score (0..100) at the last analytics computation.",
		}),
	}
	reg.MustRegister(m.requests, m.applications, m.atRisk, m.portfolio)
	return m
}

// observeAnalytics records one analytics computation: the applications scanned,
// the at-risk (RTO-breaching) count, and the portfolio readiness score.
func (m *AnalyticsMetrics) observeAnalytics(applications, atRisk, portfolio int) {
	if m == nil {
		return
	}
	m.requests.Inc()
	m.applications.Observe(float64(applications))
	m.atRisk.Set(float64(atRisk))
	m.portfolio.Set(float64(portfolio))
}
