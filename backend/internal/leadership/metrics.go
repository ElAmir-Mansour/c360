package leadership

import (
	"sync"

	"github.com/prometheus/client_golang/prometheus"
)

// leaderGauge is the package-level gauge tracking 1 (leader) / 0 (not leader).
//
// We deliberately do NOT use promauto on the default registry — the project
// pattern is to wire registries per-instance to avoid duplicate-registration
// panics in tests. A package-level sync.Once initialises the metric exactly
// once and lets callers register it on their own registry via RegisterMetrics.
var (
	metricsOnce sync.Once
	leaderGauge *prometheus.GaugeVec
)

func ensureMetrics() {
	metricsOnce.Do(func() {
		leaderGauge = prometheus.NewGaugeVec(
			prometheus.GaugeOpts{
				Name: "siem_leadership_leader",
				Help: "1 when this instance holds the leadership lock for role, 0 otherwise.",
			},
			[]string{"role", "instance"},
		)
	})
}

// RegisterMetrics attaches the leadership gauge to reg. It is safe to call
// from multiple goroutines and from multiple Elector instances; the
// underlying GaugeVec is shared.
func RegisterMetrics(reg prometheus.Registerer) error {
	ensureMetrics()
	if reg == nil {
		return nil
	}
	if err := reg.Register(leaderGauge); err != nil {
		// AlreadyRegistered is acceptable — the same gauge across multiple
		// callers is the desired shape.
		if _, ok := err.(prometheus.AlreadyRegisteredError); ok {
			return nil
		}
		return err
	}
	return nil
}

// setLeader updates the gauge for (role, instance).
func setLeader(role, instance string, leader bool) {
	ensureMetrics()
	v := 0.0
	if leader {
		v = 1.0
	}
	leaderGauge.WithLabelValues(role, instance).Set(v)
}
