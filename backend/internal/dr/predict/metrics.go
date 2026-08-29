package predict

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the predictive-failure Prometheus series (DESIGN §11 SLO
// board extension). A nil *Metrics is safe: every method is a no-op, so
// components not wired with metrics (unit tests) need no changes.
type Metrics struct {
	// dr_predicted_breach_seconds{stream}: forecast horizon to an RPO breach.
	// A large value (or the absence of the series) means "no breach forecast";
	// a small value means a breach is imminent.
	predictedBreach *prometheus.GaugeVec
	// dr_predicted_lag_trend_slope{stream}: smoothed lag trend (seconds-of-lag
	// per second). Positive = lag rising toward breach.
	lagTrendSlope *prometheus.GaugeVec
	// dr_predicted_throughput_collapse{stream}: 1 when throughput collapse is
	// currently detected, else 0.
	throughputCollapse *prometheus.GaugeVec
	// dr_prediction_breach_forecasts_total{stream}: count of forecast → breach
	// transitions (edge-triggered alerts staged).
	breachForecasts *prometheus.CounterVec
}

// NewMetrics registers the predictive-failure metrics on reg. A nil reg uses a
// private registry so construction never panics on duplicate registration in
// tests; production passes the service registry so the series are scraped.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		predictedBreach: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_predicted_breach_seconds",
			Help: "Forecast horizon in seconds until a stream's replication lag breaches its RPO objective (lower is more urgent).",
		}, []string{"stream"}),
		lagTrendSlope: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_predicted_lag_trend_slope",
			Help: "Smoothed replication-lag trend slope (seconds of lag per second of wall clock); positive means lag is rising.",
		}, []string{"stream"}),
		throughputCollapse: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_predicted_throughput_collapse",
			Help: "1 when apply-throughput collapse is currently detected for a stream (early source-failure signal), else 0.",
		}, []string{"stream"}),
		breachForecasts: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_prediction_breach_forecasts_total",
			Help: "Number of times a stream transitioned into a forecast RPO breach (an alert was staged).",
		}, []string{"stream"}),
	}
	reg.MustRegister(m.predictedBreach, m.lagTrendSlope, m.throughputCollapse, m.breachForecasts)
	return m
}

// ObserveForecast records the gauge series for one stream's forecast. When the
// forecast predicts no finite breach, the breach gauge is cleared to avoid a
// stale "imminent" reading lingering.
func (m *Metrics) ObserveForecast(stream string, fc Forecast) {
	if m == nil {
		return
	}
	if fc.PredictedBreachSeconds != nil {
		m.predictedBreach.WithLabelValues(stream).Set(*fc.PredictedBreachSeconds)
	} else {
		m.predictedBreach.DeleteLabelValues(stream)
	}
	m.lagTrendSlope.WithLabelValues(stream).Set(fc.LagTrendSlope)
	collapse := 0.0
	if fc.ThroughputCollapse {
		collapse = 1.0
	}
	m.throughputCollapse.WithLabelValues(stream).Set(collapse)
}

// IncBreachForecast counts an edge-triggered breach forecast for a stream.
func (m *Metrics) IncBreachForecast(stream string) {
	if m == nil {
		return
	}
	m.breachForecasts.WithLabelValues(stream).Inc()
}

// Forget removes a stream's series (e.g. after the stream is deleted) so the
// gauges do not linger at stale values.
func (m *Metrics) Forget(stream string) {
	if m == nil {
		return
	}
	m.predictedBreach.DeleteLabelValues(stream)
	m.lagTrendSlope.DeleteLabelValues(stream)
	m.throughputCollapse.DeleteLabelValues(stream)
}
