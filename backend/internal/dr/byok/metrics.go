package byok

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the BYOK custody observability series. Construct once per process
// with NewMetrics and inject into the Service. A nil *Metrics is safe: every
// method is a no-op, so components not wired with metrics (unit tests) need no
// changes.
//
// Per the platform rule these register on a per-instance registry
// (prometheus.NewRegistry / the service's registry), never the global default,
// so constructing twice in a test never panics on duplicate registration.
type Metrics struct {
	enrollments    *prometheus.CounterVec // by provider
	wraps          prometheus.Counter
	unwraps        prometheus.Counter
	unwrapFailures prometheus.Counter
	rotations      prometheus.Counter
	rewraps        prometheus.Counter
	custodyEntries prometheus.Counter
	rotateSeconds  prometheus.Histogram // rotate_begin -> rotate_complete
}

// NewMetrics registers the BYOK metrics on reg. A nil reg registers on a private
// registry (tests), so construction never panics.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		enrollments: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_byok_enrollments_total",
			Help: "Total tenant KEK enrollments, by custody provider (software|hsm|kms).",
		}, []string{"provider"}),
		wraps: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_byok_dek_wraps_total",
			Help: "Total DEK envelope-wrap operations under a tenant KEK.",
		}),
		unwraps: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_byok_dek_unwraps_total",
			Help: "Total successful DEK envelope-unwrap operations under a tenant KEK.",
		}),
		unwrapFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_byok_dek_unwrap_failures_total",
			Help: "Total failed DEK unwraps (tamper / wrong KEK version / corrupt nonce).",
		}),
		rotations: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_byok_kek_rotations_total",
			Help: "Total completed tenant KEK rotations (old version retired after full rewrap).",
		}),
		rewraps: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_byok_dek_rewraps_total",
			Help: "Total DEKs rewrapped from an old KEK version to a new one during rotation.",
		}),
		custodyEntries: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_byok_custody_entries_total",
			Help: "Total custody-log entries appended to the hash chain.",
		}),
		rotateSeconds: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dr_byok_rotate_seconds",
			Help:    "Seconds from a rotation beginning to all DEKs rewrapped and the old KEK retired.",
			Buckets: []float64{0.01, 0.05, 0.1, 0.5, 1, 5, 15, 30, 60},
		}),
	}
	reg.MustRegister(
		m.enrollments, m.wraps, m.unwraps, m.unwrapFailures,
		m.rotations, m.rewraps, m.custodyEntries, m.rotateSeconds,
	)
	return m
}

// IncEnroll records a KEK enrollment for the given provider.
func (m *Metrics) IncEnroll(provider string) {
	if m == nil {
		return
	}
	m.enrollments.WithLabelValues(provider).Inc()
}

// IncWrap records a DEK wrap.
func (m *Metrics) IncWrap() {
	if m == nil {
		return
	}
	m.wraps.Inc()
}

// IncUnwrap records a successful DEK unwrap.
func (m *Metrics) IncUnwrap() {
	if m == nil {
		return
	}
	m.unwraps.Inc()
}

// IncUnwrapFailure records a failed DEK unwrap.
func (m *Metrics) IncUnwrapFailure() {
	if m == nil {
		return
	}
	m.unwrapFailures.Inc()
}

// IncRotation records a completed KEK rotation.
func (m *Metrics) IncRotation() {
	if m == nil {
		return
	}
	m.rotations.Inc()
}

// IncRewrap records n DEKs rewrapped during rotation.
func (m *Metrics) IncRewrap(n int) {
	if m == nil || n <= 0 {
		return
	}
	m.rewraps.Add(float64(n))
}

// IncCustody records a custody-log entry appended.
func (m *Metrics) IncCustody() {
	if m == nil {
		return
	}
	m.custodyEntries.Inc()
}

// ObserveRotate records seconds from rotation start to completion.
func (m *Metrics) ObserveRotate(seconds float64) {
	if m == nil {
		return
	}
	m.rotateSeconds.Observe(seconds)
}
