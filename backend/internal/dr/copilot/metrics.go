package copilot

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the copilot's Prometheus series. Construct once per process with
// NewMetrics on the service registry. A nil *Metrics is safe: every method is a
// no-op so unit tests need no registry.
type Metrics struct {
	chatTotal       *prometheus.CounterVec // dr_copilot_chats_total{provider,proposed_action}
	chatLatency     prometheus.Histogram   // dr_copilot_chat_latency_seconds
	toolCallsPerHop prometheus.Histogram   // dr_copilot_tool_calls_per_chat
	sessionsPruned  prometheus.Counter     // dr_copilot_sessions_pruned_total
}

// NewMetrics registers the copilot metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration
// (per the repo convention of per-instance registries); production passes the
// service registry so the series are scraped at /metrics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		chatTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_copilot_chats_total",
			Help: "Total copilot chat turns, labelled by LLM provider and whether the turn produced a proposed (un-executed) action.",
		}, []string{"provider", "proposed_action"}),
		chatLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dr_copilot_chat_latency_seconds",
			Help:    "End-to-end latency of a copilot chat turn (LLM tool-use loop + persistence) in seconds.",
			Buckets: []float64{0.25, 0.5, 1, 2, 5, 10, 20, 30},
		}),
		toolCallsPerHop: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dr_copilot_tool_calls_per_chat",
			Help:    "Number of real DR tool invocations the LLM made in a single chat turn.",
			Buckets: []float64{0, 1, 2, 3, 5, 8, 13},
		}),
		sessionsPruned: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_copilot_sessions_pruned_total",
			Help: "Total copilot sessions removed by the retention-pruning background loop.",
		}),
	}
	reg.MustRegister(m.chatTotal, m.chatLatency, m.toolCallsPerHop, m.sessionsPruned)
	return m
}

// ObserveChat records one completed chat turn.
func (m *Metrics) ObserveChat(providerName string, latencyMS, toolCalls int, proposedAction bool) {
	if m == nil {
		return
	}
	label := "false"
	if proposedAction {
		label = "true"
	}
	m.chatTotal.WithLabelValues(providerName, label).Inc()
	m.chatLatency.Observe(float64(latencyMS) / 1000.0)
	m.toolCallsPerHop.Observe(float64(toolCalls))
}

// AddSessionsPruned records sessions removed by the pruning loop.
func (m *Metrics) AddSessionsPruned(n int64) {
	if m == nil || n <= 0 {
		return
	}
	m.sessionsPruned.Add(float64(n))
}
