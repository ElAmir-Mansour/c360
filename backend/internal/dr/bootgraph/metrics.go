package bootgraph

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the boot-orchestration Prometheus series. A nil *Metrics is
// safe: every method is a no-op, so the service/orchestrator run unmetered in
// unit tests. Construct once per process with NewMetrics(reg) using the
// service's registry (never the global default — platform rule).
type Metrics struct {
	servicesDefined prometheus.Counter // dr_bootgraph_services_defined_total
	cyclesRejected  prometheus.Counter // dr_bootgraph_cycles_rejected_total
	runsStarted     prometheus.Counter // dr_bootgraph_runs_started_total
	runsCompleted   prometheus.Counter // dr_bootgraph_runs_completed_total
	runsFailed      prometheus.Counter // dr_bootgraph_runs_failed_total
	runsRolledBack  prometheus.Counter // dr_bootgraph_runs_rolled_back_total
	tiersHealthy    prometheus.Counter // dr_bootgraph_tiers_healthy_total
	tiersFailed     prometheus.Counter // dr_bootgraph_tiers_failed_total
	servicesHealthy prometheus.Counter // dr_bootgraph_services_healthy_total
	servicesRolled  prometheus.Counter // dr_bootgraph_services_rolled_back_total
	probeFailures   prometheus.Counter // dr_bootgraph_probe_failures_total
	bootErrors      prometheus.Counter // dr_bootgraph_boot_errors_total
}

// NewMetrics registers the boot-orchestration metrics on reg. A nil reg
// registers on a private registry so construction never panics on duplicate
// registration (useful in tests).
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		servicesDefined: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_services_defined_total",
			Help: "Boot services upserted via DefineServices.",
		}),
		cyclesRejected: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_cycles_rejected_total",
			Help: "Service-definition attempts rejected because they would create a dependency cycle.",
		}),
		runsStarted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_runs_started_total",
			Help: "Boot runs started.",
		}),
		runsCompleted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_runs_completed_total",
			Help: "Boot runs where every tier went healthy.",
		}),
		runsFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_runs_failed_total",
			Help: "Boot runs halted on a tier failure (halt policy).",
		}),
		runsRolledBack: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_runs_rolled_back_total",
			Help: "Boot runs that rolled back booted tiers after a tier failure (rollback policy).",
		}),
		tiersHealthy: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_tiers_healthy_total",
			Help: "Boot tiers that passed their health gate.",
		}),
		tiersFailed: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_tiers_failed_total",
			Help: "Boot tiers that failed their health gate within budget.",
		}),
		servicesHealthy: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_services_healthy_total",
			Help: "Individual services whose health probe passed during a run.",
		}),
		servicesRolled: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_services_rolled_back_total",
			Help: "Individual services torn down during a rollback.",
		}),
		probeFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_probe_failures_total",
			Help: "Health-probe attempts that did not pass.",
		}),
		bootErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_bootgraph_boot_errors_total",
			Help: "Service boot-issue attempts that errored.",
		}),
	}
	reg.MustRegister(
		m.servicesDefined, m.cyclesRejected, m.runsStarted, m.runsCompleted, m.runsFailed,
		m.runsRolledBack, m.tiersHealthy, m.tiersFailed, m.servicesHealthy, m.servicesRolled,
		m.probeFailures, m.bootErrors,
	)
	return m
}

func (m *Metrics) observeServicesDefined(n int) {
	if m == nil {
		return
	}
	m.servicesDefined.Add(float64(n))
}

func (m *Metrics) observeCycleRejected() {
	if m == nil {
		return
	}
	m.cyclesRejected.Inc()
}

func (m *Metrics) observeRunStarted() {
	if m == nil {
		return
	}
	m.runsStarted.Inc()
}

func (m *Metrics) observeRunCompleted() {
	if m == nil {
		return
	}
	m.runsCompleted.Inc()
}

func (m *Metrics) observeRunFailed() {
	if m == nil {
		return
	}
	m.runsFailed.Inc()
}

func (m *Metrics) observeRunRolledBack() {
	if m == nil {
		return
	}
	m.runsRolledBack.Inc()
}

func (m *Metrics) observeTierHealthy() {
	if m == nil {
		return
	}
	m.tiersHealthy.Inc()
}

func (m *Metrics) observeTierFailed() {
	if m == nil {
		return
	}
	m.tiersFailed.Inc()
}

func (m *Metrics) observeServiceHealthy() {
	if m == nil {
		return
	}
	m.servicesHealthy.Inc()
}

func (m *Metrics) observeServiceRolledBack() {
	if m == nil {
		return
	}
	m.servicesRolled.Inc()
}

func (m *Metrics) observeProbeFailure() {
	if m == nil {
		return
	}
	m.probeFailures.Inc()
}

func (m *Metrics) observeBootError() {
	if m == nil {
		return
	}
	m.bootErrors.Inc()
}
