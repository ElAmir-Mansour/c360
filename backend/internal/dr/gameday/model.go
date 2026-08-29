// Package gameday implements ClarioDR capability #14 — GAME-DAY: orchestrated
// resilience exercises with controlled, reversible fault injection and a
// pass/fail scorecard (DESIGN_DataStream_DR.md §6 drill-scope semantics, §8
// events, §11 SLO board). It is benchmarked against Cutover's runbook
// orchestration product: where Cutover rehearses a runbook, game-day actively
// PERTURBS the platform and SCORES how fast it detects and recovers.
//
// What it does (real, not simulated):
//
//   - A Scenario is an ORDERED list of Steps. Each step pairs a FaultAction with
//     an Expectation: inject a controlled fault, then assert the platform raises
//     a predicted signal (lag alert, predicted-breach, ransomware, topology
//     change) within a detection window, and recovers within a recovery window.
//   - Faults are injected through a FaultInjector with REAL, REVERSIBLE
//     implementations (fault.go): PauseStreamFault, InduceLagFault,
//     BlockSiteFault. Every injection returns a teardown closure that the
//     Orchestrator runs via defer, so a fault is ALWAYS rolled back — even when a
//     later step fails or panics.
//   - The Orchestrator (orchestrator.go) runs the scenario, polls a SignalSource
//     between steps, measures the OBSERVED detection and recovery latency, scores
//     each step against its Expectation, and assembles a Scorecard.
//   - A hard SAFETY GUARD refuses to run unless the target scope is drill /
//     non-prod. A production scope is rejected with a clear error BEFORE any fault
//     is injected — game-day never touches production data.
//
// Disjoint ownership: this package defines its OWN model types, its OWN store
// over repository.DBTX (raw queries; it does NOT edit the shared repository),
// its OWN chi.Router, and its OWN leader-singleton orchestrator loop. It reuses
// internal/dr/repository (DBTX), internal/events + outbox (the existing
// datastream.dr.events topic with its own dr.gameday.* event types), and the
// internal/dr/failover drill-scope semantics. It COMPLEMENTS — does not
// re-implement — internal/dr/registry (runbook generation), internal/dr/failover
// (the gated FSM), and internal/dr/topology (the site graph).
package gameday

import (
	"errors"
	"time"
)

// Sentinel errors mapped to HTTP statuses by the router.
var (
	// ErrScenarioNotFound is returned when a scenario does not exist for the tenant.
	ErrScenarioNotFound = errors.New("game-day scenario not found")
	// ErrRunNotFound is returned when a run does not exist for the tenant.
	ErrRunNotFound = errors.New("game-day run not found")
	// ErrScenarioExists is returned when a scenario name already exists for the tenant.
	ErrScenarioExists = errors.New("game-day scenario already exists")
	// ErrProductionScope is the SAFETY GUARD: a run was requested against a
	// production scope. The orchestrator refuses to inject any fault and the
	// router maps this to HTTP 422 so the rejection is unmistakable.
	ErrProductionScope = errors.New("game-day refuses to run against a production scope: target must be drill or non-prod")
	// ErrNoSteps is returned when a scenario has no steps.
	ErrNoSteps = errors.New("game-day scenario must have at least one step")
	// ErrInvalidScope is returned when a scope is not a recognised value.
	ErrInvalidScope = errors.New("invalid game-day scope")
	// ErrInvalidAction is returned when a step's fault action is unrecognised.
	ErrInvalidAction = errors.New("invalid game-day fault action")
	// ErrUnknownAction is returned by the injector when asked to inject a fault
	// action it has no implementation for.
	ErrUnknownAction = errors.New("no fault injector registered for action")
)

// Scope is the safety scope a scenario / run targets. Production is deliberately
// NOT a value here: a scenario can only be persisted with a drill / non-prod
// scope, and the orchestrator's safety guard rejects anything else.
const (
	// ScopeDrill is an isolated drill scope (the §6.2 isolated network profile).
	ScopeDrill = "drill"
	// ScopeNonProd is a non-production environment scope.
	ScopeNonProd = "non_prod"
	// ScopeProduction is the FORBIDDEN scope. It exists only so the safety guard
	// can name what it rejects; it is never a valid stored scope value.
	ScopeProduction = "production"
)

// ValidScope reports whether s is a runnable (non-production) game-day scope.
func ValidScope(s string) bool {
	return s == ScopeDrill || s == ScopeNonProd
}

// IsProductionScope reports whether s denotes a production target the safety
// guard must reject. Anything that is not an explicitly-allowed drill/non-prod
// scope is treated as unsafe so a typo or an unknown scope fails CLOSED.
func IsProductionScope(s string) bool {
	return !ValidScope(s)
}

// Fault actions. Each maps to a real, reversible FaultInjector implementation in
// fault.go. They are the controlled perturbations a game-day step injects.
const (
	// ActionPauseStream pauses a replication stream (reversible: resume on revert).
	ActionPauseStream = "pause_stream"
	// ActionInduceLag sets a simulated lag/delay marker the RPO monitor observes
	// (reversible: clear the marker on revert).
	ActionInduceLag = "induce_lag"
	// ActionBlockSite marks a site unreachable in a SANDBOX scope only
	// (reversible: unblock on revert).
	ActionBlockSite = "block_site"
)

// ValidAction reports whether a is a recognised fault action.
func ValidAction(a string) bool {
	switch a {
	case ActionPauseStream, ActionInduceLag, ActionBlockSite:
		return true
	default:
		return false
	}
}

// Fault observability classes. Each step's scorecard row records which class its
// fault belongs to, so a green run is never misread: a SystemObservable step's
// signal is genuinely raised by the platform reacting to the fault (a real
// resilience measurement), whereas a HarnessOnly step only proves the game-day
// machinery (inject → poll → revert → score) ran — the system under test never
// perceived the fault. All three shipped faults are system-observable; the class
// exists so any future harness-only fault is flagged explicitly.
const (
	// ObservabilitySystemObservable: the fault produces a state change the
	// platform's own monitoring observes (a paused stream the RPO monitor sees, a
	// lag the forecaster honors, a blocked site whose topology health flips), so
	// the scored signal is a real platform reaction.
	ObservabilitySystemObservable = "system_observable"
	// ObservabilityHarnessOnly: the fault is an in-process self-test nothing in
	// the observation path reads. A green result proves only the harness, not the
	// platform's resilience.
	ObservabilityHarnessOnly = "harness_only"
)

// Run lifecycle statuses (mirror the dr_gameday_run CHECK).
const (
	RunStatusPending = "pending"
	RunStatusRunning = "running"
	RunStatusPassed  = "passed"
	RunStatusFailed  = "failed"
	RunStatusAborted = "aborted"
)

// Safety-guard verdicts (mirror the dr_gameday_run CHECK).
const (
	SafetyPending            = "pending"
	SafetyAllowed            = "allowed"
	SafetyRejectedProduction = "rejected_production"
)

// Expectation is what the platform should do in response to an injected fault:
// raise a named signal within a detection window, and clear it within a recovery
// window after the fault is reverted.
type Expectation struct {
	// Signal is the platform response the step expects (e.g. "lag_alert",
	// "predicted_breach", "ransomware", "topology_degraded"). Empty means the step
	// only asserts the fault injects and reverts cleanly (no signal scoring).
	Signal string `json:"signal"`
	// DetectWithin is the maximum allowed detection latency: fault-injected to
	// signal-observed. Zero means "no detection-window assertion".
	DetectWithin Duration `json:"detect_within"`
	// RecoverWithin is the maximum allowed recovery latency: revert-started to
	// signal-cleared. Zero means "do not score recovery for this step".
	RecoverWithin Duration `json:"recover_within"`
}

// HasDetection reports whether the step scores a detection window.
func (e Expectation) HasDetection() bool {
	return e.Signal != "" && e.DetectWithin > 0
}

// HasRecovery reports whether the step scores a recovery window.
func (e Expectation) HasRecovery() bool {
	return e.Signal != "" && e.RecoverWithin > 0
}

// Step is one ordered scenario step: a fault action against a target, with the
// expected platform response.
type Step struct {
	// Action is one of the Action* constants.
	Action string `json:"action"`
	// Target identifies what the fault acts on (a stream id, a site id, …). Its
	// meaning is action-specific; the injector interprets it.
	Target string `json:"target"`
	// Params carries optional action-specific parameters (e.g. induced lag
	// seconds). Opaque to the orchestrator; passed to the injector.
	Params map[string]any `json:"params,omitempty"`
	// Expect is the scored expectation for this step.
	Expect Expectation `json:"expect"`
}

// Validate reports the first structural problem with a step, or nil.
func (s Step) Validate() error {
	if !ValidAction(s.Action) {
		return ErrInvalidAction
	}
	return nil
}

// Scenario is a reusable, ordered game-day exercise bound to a target group and
// a (non-production) safety scope.
type Scenario struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenant_id"`
	GroupID     string    `json:"group_id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	Scope       string    `json:"scope"`
	Steps       []Step    `json:"steps"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// Validate reports the first structural problem with a scenario, or nil. The
// production-scope guard is enforced here AND again in the orchestrator before
// any fault is injected (defence in depth).
func (s Scenario) Validate() error {
	if !ValidScope(s.Scope) {
		if s.Scope == ScopeProduction {
			return ErrProductionScope
		}
		return ErrInvalidScope
	}
	if len(s.Steps) == 0 {
		return ErrNoSteps
	}
	for _, step := range s.Steps {
		if err := step.Validate(); err != nil {
			return err
		}
	}
	return nil
}

// Run is one execution of a scenario — its lifecycle, timing, safety verdict and
// aggregate score.
type Run struct {
	ID                string     `json:"id"`
	TenantID          string     `json:"tenant_id"`
	ScenarioID        string     `json:"scenario_id"`
	GroupID           string     `json:"group_id"`
	Scope             string     `json:"scope"`
	Status            string     `json:"status"`
	StepsTotal        int        `json:"steps_total"`
	StepsPassed       int        `json:"steps_passed"`
	Score             *float64   `json:"score,omitempty"`
	AllFaultsReverted bool       `json:"all_faults_reverted"`
	SafetyVerdict     string     `json:"safety_verdict"`
	LastError         *string    `json:"last_error,omitempty"`
	InitiatedBy       *string    `json:"initiated_by,omitempty"`
	InitiatedAt       time.Time  `json:"initiated_at"`
	StartedAt         *time.Time `json:"started_at,omitempty"`
	CompletedAt       *time.Time `json:"completed_at,omitempty"`
	ClaimedAt         *time.Time `json:"claimed_at,omitempty"`
	UpdatedAt         time.Time  `json:"updated_at"`
}

// IsTerminal reports whether the run has reached a final status.
func (r Run) IsTerminal() bool {
	switch r.Status {
	case RunStatusPassed, RunStatusFailed, RunStatusAborted:
		return true
	default:
		return false
	}
}

// StepResult is the per-step scorecard row: the expectation, the observation,
// the measured latencies, and the verdict.
type StepResult struct {
	ID        string `json:"id"`
	TenantID  string `json:"tenant_id"`
	RunID     string `json:"run_id"`
	StepIndex int    `json:"step_index"`
	Action    string `json:"action"`
	Target    string `json:"target"`
	// Observability declares whether this step's fault was system-observable (a
	// real platform reaction was measured) or harness-only (a self-test). It is an
	// Observability* constant. See ObservabilitySystemObservable.
	Observability      string     `json:"observability"`
	ExpectedSignal     string     `json:"expected_signal"`
	DetectWithinMS     int64      `json:"detect_within_ms"`
	RecoverWithinMS    int64      `json:"recover_within_ms"`
	SignalObserved     bool       `json:"signal_observed"`
	ObservedSignal     string     `json:"observed_signal"`
	DetectionLatencyMS *int64     `json:"detection_latency_ms,omitempty"`
	RecoveryLatencyMS  *int64     `json:"recovery_latency_ms,omitempty"`
	FaultReverted      bool       `json:"fault_reverted"`
	Passed             bool       `json:"passed"`
	Detail             string     `json:"detail"`
	StartedAt          time.Time  `json:"started_at"`
	FinishedAt         *time.Time `json:"finished_at"`
}

// Scorecard is the assembled run report the GET /gameday/runs/{id} endpoint
// returns: the run plus its ordered per-step results.
type Scorecard struct {
	Run   *Run          `json:"run"`
	Steps []*StepResult `json:"steps"`
}

// scoreRatio computes steps_passed / steps_total as a 0..1 ratio. With no steps
// the score is 0 (an empty exercise proves nothing).
func scoreRatio(passed, total int) float64 {
	if total <= 0 {
		return 0
	}
	return float64(passed) / float64(total)
}
