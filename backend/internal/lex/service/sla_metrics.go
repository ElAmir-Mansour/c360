package service

import (
	"github.com/prometheus/client_golang/prometheus"

	"github.com/clario360/platform/internal/lex/model"
)

// SLAMetrics is the WS7 Prometheus instrumentation for the SLA clock lifecycle.
// It is registered on the per-instance registry (the same prometheus.Registerer
// the lex app hands metrics.New) so repeated boots in tests never panic on a
// duplicate registration against the global default registry.
//
// The struct is deliberately separate from metrics.Metrics: the SLA module owns
// its own counters and wires them onto the SLAService via SetSLAMetrics, keeping
// the shared metrics catalogue untouched. Every Record* helper is nil-safe so
// callers (and an SLAService constructed without metrics, e.g. in unit tests)
// need not guard.
type SLAMetrics struct {
	// ClockStartedTotal counts materialised SLA clocks (one per request whose
	// completeness Execution confirmed).
	ClockStartedTotal prometheus.Counter
	// AckOverdueTotal counts ack rungs that lapsed without acknowledgement (the
	// monitor enqueued an ack_overdue notification).
	AckOverdueTotal prometheus.Counter
	// BreachedTotal counts turnaround deadlines that lapsed (clock flipped to
	// breached).
	BreachedTotal prometheus.Counter
	// EscalatedTotal counts escalation advances, labelled by the rung reached.
	EscalatedTotal *prometheus.CounterVec
	// ResolvedTotal counts terminal resolutions, labelled by outcome
	// (on_time|breached).
	ResolvedTotal *prometheus.CounterVec
}

// NewSLAMetrics constructs and registers the SLA lifecycle counters on the
// supplied registry. A nil registerer falls back to a fresh private registry so
// the metrics are still usable (and never collide with the global default).
func NewSLAMetrics(reg prometheus.Registerer) *SLAMetrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	factory := promauto(reg)
	return &SLAMetrics{
		ClockStartedTotal: factory.NewCounter(prometheus.CounterOpts{
			Name: "lex_sla_clock_started_total",
			Help: "Total SLA clocks materialised on completeness confirmation.",
		}),
		AckOverdueTotal: factory.NewCounter(prometheus.CounterOpts{
			Name: "lex_sla_ack_overdue_total",
			Help: "Total SLA acknowledgement windows that lapsed without acknowledgement.",
		}),
		BreachedTotal: factory.NewCounter(prometheus.CounterOpts{
			Name: "lex_sla_breached_total",
			Help: "Total SLA turnaround deadlines breached.",
		}),
		EscalatedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_sla_escalated_total",
			Help: "Total SLA escalation advances by rung level.",
		}, []string{"level"}),
		ResolvedTotal: factory.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_sla_resolved_total",
			Help: "Total SLA clocks resolved by terminal outcome.",
		}, []string{"outcome"}),
	}
}

// promauto is a tiny per-instance factory mirroring promauto.With so SLA metrics
// register on the passed-in registry rather than the global default (the project
// pitfall: promauto's package-level helpers use the default registry and panic on
// a second construction in tests).
type slaMetricFactory struct{ reg prometheus.Registerer }

func promauto(reg prometheus.Registerer) slaMetricFactory { return slaMetricFactory{reg: reg} }

func (f slaMetricFactory) NewCounter(opts prometheus.CounterOpts) prometheus.Counter {
	c := prometheus.NewCounter(opts)
	f.reg.MustRegister(c)
	return c
}

func (f slaMetricFactory) NewCounterVec(opts prometheus.CounterOpts, labels []string) *prometheus.CounterVec {
	c := prometheus.NewCounterVec(opts, labels)
	f.reg.MustRegister(c)
	return c
}

// --- nil-safe record helpers ------------------------------------------------

func (m *SLAMetrics) RecordClockStarted() {
	if m == nil || m.ClockStartedTotal == nil {
		return
	}
	m.ClockStartedTotal.Inc()
}

func (m *SLAMetrics) RecordAckOverdue() {
	if m == nil || m.AckOverdueTotal == nil {
		return
	}
	m.AckOverdueTotal.Inc()
}

func (m *SLAMetrics) RecordBreached() {
	if m == nil || m.BreachedTotal == nil {
		return
	}
	m.BreachedTotal.Inc()
}

func (m *SLAMetrics) RecordEscalated(level int) {
	if m == nil || m.EscalatedTotal == nil {
		return
	}
	m.EscalatedTotal.WithLabelValues(slaEscalationLevelLabel(level)).Inc()
}

func (m *SLAMetrics) RecordResolved(outcome model.SLAClockOutcome) {
	if m == nil || m.ResolvedTotal == nil {
		return
	}
	label := string(outcome)
	if label == "" {
		label = string(model.SLAClockOutcomePending)
	}
	m.ResolvedTotal.WithLabelValues(label).Inc()
}

func slaEscalationLevelLabel(level int) string {
	switch level {
	case 1:
		return "1"
	case 2:
		return "2"
	case 3:
		return "3"
	default:
		return "other"
	}
}
