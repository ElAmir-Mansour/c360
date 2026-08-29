package service

import "github.com/prometheus/client_golang/prometheus"

// LexDomainMetrics holds the runtime counters/histograms for the legal-affairs
// runtime chain (WS7): the execution clock, the email/platform intake pipeline,
// and the working-calendar engine. These collectors are intentionally kept out
// of metrics.Metrics (which is the contract/compliance read-model surface) so the
// runtime domain metrics live next to the services that emit them.
//
// It is constructed once from the application's per-instance prometheus registry
// (the same prometheus.Registerer that metrics.New(reg) uses) and injected into
// WorkingCalendarService / IntakeService / ExecutionRuleService via their
// SetDomainMetrics seams. Every record method is nil-safe so a service whose
// domain metrics were never wired (the constructor default) behaves exactly as
// before — these are pure observability and never change business behaviour.
type LexDomainMetrics struct {
	// Execution-rules engine (execution_rule_service.go).
	ExecutionClockStartedTotal  prometheus.Counter     // lex_execution_clock_started_total
	ExecutionReturnedTotal      *prometheus.CounterVec // lex_execution_returned_total{auto_closed}
	ExecutionTwoRoundCloneTotal prometheus.Counter     // lex_execution_two_round_clone_total

	// Intake pipeline (intake_service.go).
	IntakeMessagesTotal     *prometheus.CounterVec // lex_intake_messages_total{status}
	IntakeEligibilityDenied prometheus.Counter     // lex_intake_eligibility_denied_total

	// Working-calendar engine (working_calendar_service.go).
	CalendarMutationsTotal    *prometheus.CounterVec // lex_calendar_mutations_total{operation}
	CalendarFallbackUsedTotal prometheus.Counter     // lex_calendar_fallback_calendar_used_total
	CalendarSnapshotLoad      prometheus.Histogram   // lex_calendar_snapshot_load_seconds

	// Workforce report (workforce_service.go). Both collectors are label-free so
	// tenant, entity, user, and domain identifiers can never grow SaaS metric
	// cardinality.
	WorkforceLargeReportDuration prometheus.Histogram // lex_workforce_large_report_duration_seconds
	WorkforceOpenOver10KTotal    prometheus.Counter   // lex_workforce_open_items_over_10000_total
}

// NewLexDomainMetrics builds the WS7 collectors and registers them against the
// supplied per-instance registry. A nil registerer (or a duplicate registration)
// is tolerated by returning a non-registered instance so a misconfigured caller
// never panics the service; the collectors are still usable (their values are
// simply not exported) and remain nil-safe through the record helpers.
func NewLexDomainMetrics(reg prometheus.Registerer) *LexDomainMetrics {
	m := &LexDomainMetrics{
		ExecutionClockStartedTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "lex_execution_clock_started_total",
			Help: "Total execution clocks started (completeness confirmed).",
		}),
		ExecutionReturnedTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_execution_returned_total",
			Help: "Total return-incomplete review rounds opened, labelled by whether the round auto-closed the request.",
		}, []string{"auto_closed"}),
		ExecutionTwoRoundCloneTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "lex_execution_two_round_clone_total",
			Help: "Total CAP-026 clones spawned after the configured maximum review rounds were exhausted.",
		}),
		IntakeMessagesTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_intake_messages_total",
			Help: "Total intake submissions/messages processed, labelled by terminal status.",
		}, []string{"status"}),
		IntakeEligibilityDenied: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "lex_intake_eligibility_denied_total",
			Help: "Total platform intake submissions rejected by the service eligibility gate.",
		}),
		CalendarMutationsTotal: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "lex_calendar_mutations_total",
			Help: "Total working-calendar mutations by operation.",
		}, []string{"operation"}),
		CalendarFallbackUsedTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "lex_calendar_fallback_calendar_used_total",
			Help: "Total times working-time math fell back because no tenant default calendar was configured.",
		}),
		CalendarSnapshotLoad: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "lex_calendar_snapshot_load_seconds",
			Help:    "Duration of loading + assembling a working-calendar snapshot into a frozen Calculator.",
			Buckets: []float64{0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1},
		}),
		WorkforceLargeReportDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "lex_workforce_large_report_duration_seconds",
			Help:    "Workforce report duration for reports with at least 500 distinct attributable items.",
			Buckets: []float64{0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 2.5, 5, 10},
		}),
		WorkforceOpenOver10KTotal: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "lex_workforce_open_items_over_10000_total",
			Help: "Total successful workforce reports whose scoped distinct open-item count exceeded 10000.",
		}),
	}
	if reg != nil {
		collectors := []prometheus.Collector{
			m.ExecutionClockStartedTotal,
			m.ExecutionReturnedTotal,
			m.ExecutionTwoRoundCloneTotal,
			m.IntakeMessagesTotal,
			m.IntakeEligibilityDenied,
			m.CalendarMutationsTotal,
			m.CalendarFallbackUsedTotal,
			m.CalendarSnapshotLoad,
			m.WorkforceLargeReportDuration,
			m.WorkforceOpenOver10KTotal,
		}
		for _, c := range collectors {
			// Tolerate AlreadyRegisteredError so a second NewApplication in the same
			// process (e.g. a test that reuses the default registry) does not panic.
			if err := reg.Register(c); err != nil {
				if are, ok := err.(prometheus.AlreadyRegisteredError); ok {
					_ = are
				}
			}
		}
	}
	return m
}

// --- execution-rules record helpers ---------------------------------------

func (m *LexDomainMetrics) RecordExecutionClockStarted() {
	if m == nil || m.ExecutionClockStartedTotal == nil {
		return
	}
	m.ExecutionClockStartedTotal.Inc()
}

// RecordExecutionReturned counts a return-incomplete round; autoClosed marks the
// round that reached the review-round cap and closed the request.
func (m *LexDomainMetrics) RecordExecutionReturned(autoClosed bool) {
	if m == nil || m.ExecutionReturnedTotal == nil {
		return
	}
	m.ExecutionReturnedTotal.WithLabelValues(boolLabel(autoClosed)).Inc()
}

func (m *LexDomainMetrics) RecordExecutionTwoRoundClone() {
	if m == nil || m.ExecutionTwoRoundCloneTotal == nil {
		return
	}
	m.ExecutionTwoRoundCloneTotal.Inc()
}

// --- intake record helpers -------------------------------------------------

func (m *LexDomainMetrics) RecordIntakeMessage(status string) {
	if m == nil || m.IntakeMessagesTotal == nil {
		return
	}
	if status == "" {
		status = "unknown"
	}
	m.IntakeMessagesTotal.WithLabelValues(status).Inc()
}

func (m *LexDomainMetrics) RecordIntakeEligibilityDenied() {
	if m == nil || m.IntakeEligibilityDenied == nil {
		return
	}
	m.IntakeEligibilityDenied.Inc()
}

// --- working-calendar record helpers ---------------------------------------

func (m *LexDomainMetrics) RecordCalendarMutation(operation string) {
	if m == nil || m.CalendarMutationsTotal == nil {
		return
	}
	if operation == "" {
		operation = "unknown"
	}
	m.CalendarMutationsTotal.WithLabelValues(operation).Inc()
}

func (m *LexDomainMetrics) RecordCalendarFallbackUsed() {
	if m == nil || m.CalendarFallbackUsedTotal == nil {
		return
	}
	m.CalendarFallbackUsedTotal.Inc()
}

// ObserveCalendarSnapshotLoad records the seconds spent loading + assembling a
// working-calendar snapshot. A non-positive duration is ignored.
func (m *LexDomainMetrics) ObserveCalendarSnapshotLoad(seconds float64) {
	if m == nil || m.CalendarSnapshotLoad == nil {
		return
	}
	if seconds < 0 {
		return
	}
	m.CalendarSnapshotLoad.Observe(seconds)
}

// ObserveWorkforceReport records only large reports. Both collectors are
// label-free, and the exact two-second bucket makes the approved p95 >2s trigger
// directly evaluable.
func (m *LexDomainMetrics) ObserveWorkforceReport(itemCount, openItemCount int, seconds float64) {
	if m == nil {
		return
	}
	if itemCount >= 500 && m.WorkforceLargeReportDuration != nil && seconds >= 0 {
		m.WorkforceLargeReportDuration.Observe(seconds)
	}
	if openItemCount > 10000 && m.WorkforceOpenOver10KTotal != nil {
		m.WorkforceOpenOver10KTotal.Inc()
	}
}

func boolLabel(v bool) string {
	if v {
		return "true"
	}
	return "false"
}
