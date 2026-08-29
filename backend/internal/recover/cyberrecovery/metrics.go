package cyberrecovery

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

// Metrics are the Cyber Recovery flow observability counters. They are
// registered against a caller-provided registry (never the global default) so
// constructing the service twice in tests cannot panic. A nil *Metrics is a
// no-op, so the service works without metrics wired.
type Metrics struct {
	transitions   *prometheus.CounterVec
	integrityGate *prometheus.CounterVec
	approvals     prometheus.Counter
	returned      prometheus.Counter
	blocked       *prometheus.CounterVec
}

// NewMetrics constructs and registers the flow metrics on reg.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	f := promauto.With(reg)
	return &Metrics{
		transitions: f.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_cyber_recovery_transitions_total",
			Help: "Clean-room recovery flow phase transitions, by destination phase.",
		}, []string{"phase"}),
		integrityGate: f.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_cyber_recovery_integrity_gate_total",
			Help: "Clean-room integrity-gate evaluations, by clean-room verdict.",
		}, []string{"verdict"}),
		approvals: f.NewCounter(prometheus.CounterOpts{
			Name: "recover_cyber_recovery_approvals_total",
			Help: "Return-to-production approvals recorded.",
		}),
		returned: f.NewCounter(prometheus.CounterOpts{
			Name: "recover_cyber_recovery_returned_to_production_total",
			Help: "Flows that passed the gate and returned to the production network.",
		}),
		blocked: f.NewCounterVec(prometheus.CounterOpts{
			Name: "recover_cyber_recovery_return_blocked_total",
			Help: "Return-to-production attempts blocked by the hard gate, by reason.",
		}, []string{"reason"}),
	}
}

// IncTransition counts one phase transition.
func (m *Metrics) IncTransition(phase string) {
	if m == nil {
		return
	}
	m.transitions.WithLabelValues(phase).Inc()
}

// IncIntegrityGate counts one integrity-gate evaluation by verdict.
func (m *Metrics) IncIntegrityGate(verdict string) {
	if m == nil {
		return
	}
	m.integrityGate.WithLabelValues(verdict).Inc()
}

// IncApproval counts one recorded approval.
func (m *Metrics) IncApproval() {
	if m == nil {
		return
	}
	m.approvals.Inc()
}

// IncReturned counts one successful return-to-production.
func (m *Metrics) IncReturned() {
	if m == nil {
		return
	}
	m.returned.Inc()
}

// IncBlocked counts one return-to-production attempt blocked by the hard gate.
func (m *Metrics) IncBlocked(reason string) {
	if m == nil {
		return
	}
	m.blocked.WithLabelValues(reason).Inc()
}
