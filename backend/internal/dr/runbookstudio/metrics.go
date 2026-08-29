package runbookstudio

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the Runbook Studio Prometheus series. A nil *Metrics is safe:
// every method is a no-op, so the service/loop run unmetered in unit tests.
// Construct once per process with NewMetrics(reg) using the service's registry
// (never the global default — platform rule) so the series are scraped.
type Metrics struct {
	runbooksCreated prometheus.Counter     // dr_studio_runbooks_created_total
	tasksCreated    prometheus.Counter     // dr_studio_tasks_created_total
	cyclesRejected  prometheus.Counter     // dr_studio_cycles_rejected_total
	runsStarted     *prometheus.CounterVec // dr_studio_runs_started_total{mode}
	runsCompleted   *prometheus.CounterVec // dr_studio_runs_finished_total{status}
	taskActions     *prometheus.CounterVec // dr_studio_task_actions_total{action,task_type}
	automationRuns  *prometheus.CounterVec // dr_studio_automation_runs_total{outcome}
	frontierSize    *prometheus.GaugeVec   // dr_studio_run_frontier_size{run}
}

// NewMetrics registers the studio metrics on reg. A nil reg registers on a
// private registry so construction never panics on duplicate registration.
func NewMetrics(reg prometheus.Registerer) *Metrics {
	if reg == nil {
		reg = prometheus.NewRegistry()
	}
	m := &Metrics{
		runbooksCreated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_studio_runbooks_created_total",
			Help: "Runbook Studio runbooks created.",
		}),
		tasksCreated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_studio_tasks_created_total",
			Help: "Runbook Studio tasks authored.",
		}),
		cyclesRejected: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dr_studio_cycles_rejected_total",
			Help: "Task author/edit attempts rejected because they would create a cycle.",
		}),
		runsStarted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_studio_runs_started_total",
			Help: "Runbook Studio live runs started, by mode.",
		}, []string{"mode"}),
		runsCompleted: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_studio_runs_finished_total",
			Help: "Runbook Studio runs that reached a terminal status.",
		}, []string{"status"}),
		taskActions: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_studio_task_actions_total",
			Help: "Task actions (complete/skip/fail/approve) by task type.",
		}, []string{"action", "task_type"}),
		automationRuns: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "dr_studio_automation_runs_total",
			Help: "Automated-task executor invocations by outcome (success/failure).",
		}, []string{"outcome"}),
		frontierSize: prometheus.NewGaugeVec(prometheus.GaugeOpts{
			Name: "dr_studio_run_frontier_size",
			Help: "Number of runnable tasks on a run's current frontier.",
		}, []string{"run"}),
	}
	reg.MustRegister(m.runbooksCreated, m.tasksCreated, m.cyclesRejected, m.runsStarted,
		m.runsCompleted, m.taskActions, m.automationRuns, m.frontierSize)
	return m
}

func (m *Metrics) observeRunbookCreated() {
	if m == nil {
		return
	}
	m.runbooksCreated.Inc()
}

func (m *Metrics) observeTaskCreated() {
	if m == nil {
		return
	}
	m.tasksCreated.Inc()
}

func (m *Metrics) observeCycleRejected() {
	if m == nil {
		return
	}
	m.cyclesRejected.Inc()
}

func (m *Metrics) observeRunStarted(mode string) {
	if m == nil {
		return
	}
	m.runsStarted.WithLabelValues(mode).Inc()
}

func (m *Metrics) observeRunFinished(status string) {
	if m == nil {
		return
	}
	m.runsCompleted.WithLabelValues(status).Inc()
}

func (m *Metrics) observeTaskAction(action, taskType string) {
	if m == nil {
		return
	}
	m.taskActions.WithLabelValues(action, taskType).Inc()
}

func (m *Metrics) observeAutomation(outcome string) {
	if m == nil {
		return
	}
	m.automationRuns.WithLabelValues(outcome).Inc()
}

func (m *Metrics) observeFrontier(runID string, size int) {
	if m == nil {
		return
	}
	m.frontierSize.WithLabelValues(runID).Set(float64(size))
}
