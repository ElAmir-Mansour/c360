package gameday

import "github.com/prometheus/client_golang/prometheus"

// Metrics exposes the game-day SLO/observability series (DESIGN §11 pattern):
// run outcomes, per-step pass/fail, measured detection/recovery latency, and the
// safety-guard rejection counter. Construct once per process with NewMetrics and
// inject into the orchestrator. A nil *Metrics is safe — every method is a no-op
// — so unit tests need no registry.
type Metrics struct {
	runsTotal        *prometheus.CounterVec   // dr_gameday_runs_total{scope,result}
	stepResults      *prometheus.CounterVec   // dr_gameday_step_results_total{action,result}
	detectionLatency *prometheus.HistogramVec // dr_gameday_detection_latency_seconds{signal}
	recoveryLatency  *prometheus.HistogramVec // dr_gameday_recovery_latency_seconds{signal}
	faultsReverted   *prometheus.CounterVec   // dr_gameday_faults_reverted_total{action}
	safetyRejections prometheus.Counter       // dr_gameday_safety_rejections_total
}

// NewMetrics registers the game-day metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration; pass
// the service's registry in production so the series are scraped at /metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		runsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_gameday_runs_total",
			Help: "Game-day exercise runs by scope and result (passed|failed|aborted).",
		}, []string{"scope", "result"}),
		stepResults: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_gameday_step_results_total",
			Help: "Game-day scenario steps by fault action and result (passed|failed).",
		}, []string{"action", "result"}),
		detectionLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "dr_gameday_detection_latency_seconds",
			Help:    "Measured detection latency (fault injected -> signal observed) by signal.",
			Buckets: []float64{1, 5, 10, 30, 60, 120, 300},
		}, []string{"signal"}),
		recoveryLatency: prometheus.NewHistogramVec(prometheus.HistogramOpts{
			Name:    "dr_gameday_recovery_latency_seconds",
			Help:    "Measured recovery latency (fault reverted -> signal cleared) by signal.",
			Buckets: []float64{1, 5, 10, 30, 60, 120, 300, 600},
		}, []string{"signal"}),
		faultsReverted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_gameday_faults_reverted_total",
			Help: "Injected faults that were successfully reverted (defer teardown), by action.",
		}, []string{"action"}),
		safetyRejections: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_gameday_safety_rejections_total",
			Help: "Game-day runs refused by the production-scope safety guard.",
		}),
	}
	reg.MustRegister(m.runsTotal, m.stepResults, m.detectionLatency, m.recoveryLatency, m.faultsReverted, m.safetyRejections)
	return m
}

func (m *Metrics) observeRun(scope, result string) {
	if m == nil {
		return
	}
	m.runsTotal.WithLabelValues(scope, result).Inc()
}

func (m *Metrics) observeStep(action string, passed bool) {
	if m == nil {
		return
	}
	result := "failed"
	if passed {
		result = "passed"
	}
	m.stepResults.WithLabelValues(action, result).Inc()
}

func (m *Metrics) observeDetectionLatency(signal string, seconds float64) {
	if m == nil {
		return
	}
	m.detectionLatency.WithLabelValues(signal).Observe(seconds)
}

func (m *Metrics) observeRecoveryLatency(signal string, seconds float64) {
	if m == nil {
		return
	}
	m.recoveryLatency.WithLabelValues(signal).Observe(seconds)
}

func (m *Metrics) observeFaultReverted(action string) {
	if m == nil {
		return
	}
	m.faultsReverted.WithLabelValues(action).Inc()
}

func (m *Metrics) observeSafetyRejection() {
	if m == nil {
		return
	}
	m.safetyRejections.Inc()
}
