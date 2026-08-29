package ai

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the assistant's Prometheus series. Construct once per process
// with NewMetrics on the service registry. A nil *Metrics is safe: every method
// is a no-op so unit tests need no registry.
type Metrics struct {
	chatTotal        *prometheus.CounterVec // lex_ai_chats_total{provider}
	chatLatency      prometheus.Histogram   // lex_ai_chat_latency_seconds
	toolCallsPerChat prometheus.Histogram   // lex_ai_tool_calls_per_chat
}

// NewMetrics registers the assistant metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration (per
// the repo convention of per-instance registries).
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		chatTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_ai_chats_total",
			Help: "Total Lex AI assistant chat turns, labelled by LLM provider.",
		}, []string{"provider"}),
		chatLatency: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "lex_ai_chat_latency_seconds",
			Help:    "End-to-end latency of one assistant chat turn (tool-use loop + persistence) in seconds.",
			Buckets: []float64{0.25, 0.5, 1, 2, 5, 10, 20, 30, 60},
		}),
		toolCallsPerChat: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "lex_ai_tool_calls_per_chat",
			Help:    "Number of grounding-tool invocations the model made in a single chat turn.",
			Buckets: []float64{0, 1, 2, 3, 5, 8},
		}),
	}
	reg.MustRegister(m.chatTotal, m.chatLatency, m.toolCallsPerChat)
	return m
}

// ObserveChat records one completed chat turn.
func (m *Metrics) ObserveChat(provider string, latencyMS, toolCalls int) {
	if m == nil {
		return
	}
	m.chatTotal.WithLabelValues(provider).Inc()
	m.chatLatency.Observe(float64(latencyMS) / 1000.0)
	m.toolCallsPerChat.Observe(float64(toolCalls))
}
