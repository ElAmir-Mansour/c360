package gameday

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/rs/zerolog"
)

// orchestratorStore is the persistence surface the orchestrator needs. *Store
// satisfies it; tests substitute a fake so the revert-guarantee and scoring are
// exercised without a database.
type orchestratorStore interface {
	SystemGetScenario(ctx context.Context, db DBTX, id string) (*Scenario, error)
	SystemMarkRunStarted(ctx context.Context, db DBTX, id string) (bool, error)
	SystemRejectRunForProduction(ctx context.Context, db DBTX, id, reason string) error
	UpsertStepResult(ctx context.Context, db DBTX, r *StepResult) error
	SystemCompleteRun(ctx context.Context, db DBTX, id, status string, stepsTotal, stepsPassed int, allReverted bool, lastErr string) error
}

// systemRunner runs a function inside a system (RLS-bypass) transaction — the
// single, clearly-named system path the design reserves for background loops
// (§7). The orchestrator runs each persistence step in its own short system
// transaction so a step result commits before the next fault is injected.
type systemRunner interface {
	RunSystem(ctx context.Context, fn func(DBTX) error) error
}

// eventEmitter stages a game-day lifecycle event in the same transaction as a
// state write. The default implementation writes to the transactional outbox.
type eventEmitter interface {
	Emit(ctx context.Context, db DBTX, tenantID, eventType string, data map[string]any) error
}

// Orchestrator runs a game-day scenario: it enforces the production-scope safety
// guard, then for each step injects a controlled, reversible fault, observes the
// platform's response by polling the SignalSource, measures detection (and
// recovery) latency against the step's expectation, scores the step pass/fail,
// and ALWAYS reverts the fault via a deferred teardown — even if a later step
// fails or panics. The aggregate scorecard (steps passed / total, all-reverted)
// is persisted to the run.
//
// The revert discipline is the load-bearing safety property: every Inject that
// succeeds registers its Revert on a teardown stack; the stack is unwound in a
// deferred call in LIFO order, each revert running exactly once (onceRevert), so
// no injected fault is ever left in place.
type Orchestrator struct {
	store     orchestratorStore
	runner    systemRunner
	registry  *Registry
	signals   SignalSource
	emitter   eventEmitter
	metrics   *Metrics
	now       func() time.Time
	sleep     func(ctx context.Context, d time.Duration) error
	pollEvery time.Duration
	logger    zerolog.Logger
}

// OrchestratorConfig wires an Orchestrator.
type OrchestratorConfig struct {
	Store    orchestratorStore
	Runner   systemRunner
	Registry *Registry
	Signals  SignalSource
	// Emitter is optional; defaults to a no-op (events disabled).
	Emitter eventEmitter
	Metrics *Metrics
	// Now / Sleep are optional; default to wall-clock time. Injected for
	// deterministic tests.
	Now   func() time.Time
	Sleep func(ctx context.Context, d time.Duration) error
	// PollEvery is the signal-poll interval; defaults to 250ms.
	PollEvery time.Duration
	Logger    zerolog.Logger
}

// NewOrchestrator constructs an Orchestrator. Store, Runner, Registry and
// Signals are required.
func NewOrchestrator(cfg OrchestratorConfig) (*Orchestrator, error) {
	if cfg.Store == nil {
		return nil, errors.New("gameday orchestrator: store is required")
	}
	if cfg.Runner == nil {
		return nil, errors.New("gameday orchestrator: runner is required")
	}
	if cfg.Registry == nil {
		return nil, errors.New("gameday orchestrator: fault registry is required")
	}
	if cfg.Signals == nil {
		return nil, errors.New("gameday orchestrator: signal source is required")
	}
	now := cfg.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	sleep := cfg.Sleep
	if sleep == nil {
		sleep = realSleep
	}
	var emitter eventEmitter = cfg.Emitter
	if emitter == nil {
		emitter = nopEmitter{}
	}
	return &Orchestrator{
		store:     cfg.Store,
		runner:    cfg.Runner,
		registry:  cfg.Registry,
		signals:   cfg.Signals,
		emitter:   emitter,
		metrics:   cfg.Metrics,
		now:       now,
		sleep:     sleep,
		pollEvery: cfg.PollEvery,
		logger:    cfg.Logger,
	}, nil
}

// nopEmitter is the default no-op event emitter.
type nopEmitter struct{}

func (nopEmitter) Emit(context.Context, DBTX, string, string, map[string]any) error { return nil }

// RunResult is the in-memory outcome of executing a run (also persisted).
type RunResult struct {
	RunID             string
	Status            string
	StepsTotal        int
	StepsPassed       int
	AllFaultsReverted bool
	SafetyVerdict     string
	Steps             []*StepResult
}

// teardown is a registered fault revert plus its action label, so the deferred
// unwind can record the per-fault revert and meter it.
type teardown struct {
	action string
	revert *onceRevert
	result *StepResult
}

// Execute runs the scenario `scenario` for run `run`. It is safe to call under
// the leader-singleton loop (the run is already claimed) or inline from the API
// (the run is pending and is marked started here).
//
// SAFETY GUARD: if the scenario's scope is not an allowed drill/non-prod scope,
// Execute injects NO fault, records the rejection on the run, emits a rejection
// event, and returns ErrProductionScope.
//
// REVERT GUARANTEE: every fault that is successfully injected has its revert
// registered on a teardown stack that is unwound in a deferred call. The defer
// runs on normal return, on an early error return, AND on a panic — so every
// injected fault is always rolled back exactly once.
func (o *Orchestrator) Execute(ctx context.Context, run *Run, scenario *Scenario) (result RunResult, err error) {
	result.RunID = run.ID

	// --- SAFETY GUARD (before any fault) -----------------------------------
	scope := scenario.Scope
	if IsProductionScope(scope) {
		result.SafetyVerdict = SafetyRejectedProduction
		result.Status = RunStatusAborted
		o.metrics.observeSafetyRejection()
		reason := fmt.Sprintf("scope %q is not drill/non-prod", scope)
		if rerr := o.runner.RunSystem(ctx, func(tx DBTX) error {
			if e := o.store.SystemRejectRunForProduction(ctx, tx, run.ID, reason); e != nil {
				return e
			}
			return o.emitter.Emit(ctx, tx, run.TenantID, eventRunRejected, map[string]any{
				"run_id":   run.ID,
				"group_id": run.GroupID,
				"scope":    scope,
				"reason":   reason,
			})
		}); rerr != nil {
			return result, fmt.Errorf("gameday: recording safety rejection for run %s: %w", run.ID, rerr)
		}
		o.metrics.observeRun(scope, RunStatusAborted)
		return result, ErrProductionScope
	}
	result.SafetyVerdict = SafetyAllowed

	// Mark the run started (idempotent: a no-op if already running via claim).
	if merr := o.runner.RunSystem(ctx, func(tx DBTX) error {
		_, e := o.store.SystemMarkRunStarted(ctx, tx, run.ID)
		return e
	}); merr != nil {
		return result, fmt.Errorf("gameday: marking run %s started: %w", run.ID, merr)
	}
	_ = o.runner.RunSystem(ctx, func(tx DBTX) error {
		return o.emitter.Emit(ctx, tx, run.TenantID, eventRunStarted, map[string]any{
			"run_id":      run.ID,
			"group_id":    run.GroupID,
			"scenario_id": scenario.ID,
			"scope":       scope,
			"steps":       len(scenario.Steps),
		})
	})

	result.StepsTotal = len(scenario.Steps)

	// --- Teardown stack: every injected fault is reverted here, LIFO -------
	var stack []*teardown
	defer func() {
		// Recover a panic so the teardown still runs, then re-raise after revert.
		var panicVal any
		if r := recover(); r != nil {
			panicVal = r
		}
		allReverted := o.unwind(ctx, run, stack)
		result.AllFaultsReverted = allReverted

		// Decide and persist the terminal status. A panic or an in-flight error
		// aborts the run; otherwise pass requires every step passed.
		if panicVal != nil {
			result.Status = RunStatusAborted
			if err == nil {
				err = fmt.Errorf("gameday: orchestrator panicked: %v", panicVal)
			}
		} else if err != nil && !errors.Is(err, ErrProductionScope) {
			result.Status = RunStatusAborted
		} else if err == nil {
			if result.StepsPassed == result.StepsTotal && result.StepsTotal > 0 {
				result.Status = RunStatusPassed
			} else {
				result.Status = RunStatusFailed
			}
		}

		lastErr := ""
		if err != nil {
			lastErr = err.Error()
		}
		if perr := o.runner.RunSystem(ctx, func(tx DBTX) error {
			if e := o.store.SystemCompleteRun(ctx, tx, run.ID, result.Status, result.StepsTotal, result.StepsPassed, allReverted, lastErr); e != nil {
				return e
			}
			return o.emitter.Emit(ctx, tx, run.TenantID, eventRunCompleted, map[string]any{
				"run_id":              run.ID,
				"group_id":            run.GroupID,
				"status":              result.Status,
				"steps_total":         result.StepsTotal,
				"steps_passed":        result.StepsPassed,
				"all_faults_reverted": allReverted,
				"score":               scoreRatio(result.StepsPassed, result.StepsTotal),
			})
		}); perr != nil && err == nil {
			err = fmt.Errorf("gameday: completing run %s: %w", run.ID, perr)
		}
		o.metrics.observeRun(scope, result.Status)
	}()

	// --- Step loop ---------------------------------------------------------
	for i, step := range scenario.Steps {
		sr := &StepResult{
			TenantID:  run.TenantID,
			RunID:     run.ID,
			StepIndex: i,
			Action:    step.Action,
			Target:    step.Target,
			// Default to harness-only; overridden from the resolved injector below.
			// An unknown action has no injector and is, by definition, not observed.
			Observability:   ObservabilityHarnessOnly,
			ExpectedSignal:  step.Expect.Signal,
			DetectWithinMS:  step.Expect.DetectWithin.Milliseconds(),
			RecoverWithinMS: step.Expect.RecoverWithin.Milliseconds(),
		}

		injector, ok := o.registry.Injector(step.Action)
		if !ok {
			sr.Passed = false
			sr.Detail = fmt.Sprintf("%s: %v", step.Action, ErrUnknownAction)
			o.persistStep(ctx, sr)
			result.Steps = append(result.Steps, sr)
			o.metrics.observeStep(step.Action, false)
			// An unknown action is a fatal scenario error: abort, but the defer
			// still unwinds whatever faults are already injected.
			return result, fmt.Errorf("gameday: step %d action %q: %w", i, step.Action, ErrUnknownAction)
		}
		sr.Observability = injector.Observability()

		faultAt := o.now()
		revertFn, ierr := injector.Inject(ctx, step)
		if ierr != nil {
			// Inject failed and left nothing to revert; the step is a fail but the
			// exercise continues to the next step.
			sr.Passed = false
			sr.Detail = fmt.Sprintf("fault injection failed: %v", ierr)
			finishStep(sr, o.now())
			o.persistStep(ctx, sr)
			result.Steps = append(result.Steps, sr)
			o.metrics.observeStep(step.Action, false)
			continue
		}

		// Register the revert on the teardown stack IMMEDIATELY so even a panic in
		// the observe-and-score block below cannot strand the injected fault.
		once := newOnceRevert(revertFn)
		td := &teardown{action: step.Action, revert: once, result: sr}
		stack = append(stack, td)

		// Observe the platform response and score the step. The step's teardown is
		// passed in so a recovery-scored step can revert early (the onceRevert keeps
		// it exactly-once with the deferred unwind).
		o.observeAndScore(ctx, step, sr, faultAt, td)
		finishStep(sr, o.now())

		if sr.Passed {
			result.StepsPassed++
		}
		o.metrics.observeStep(step.Action, sr.Passed)
		o.persistStep(ctx, sr)
		result.Steps = append(result.Steps, sr)
	}

	return result, nil
}

// observeAndScore polls the SignalSource for the step's expected signal and
// scores the step. A step with no detection expectation passes as long as the
// fault injected (reversibility is asserted by the teardown). A step with a
// detection expectation passes only if the signal fires within the window; if it
// also has a recovery expectation, the fault is reverted and recovery latency is
// measured and must fall within the recovery window.
func (o *Orchestrator) observeAndScore(ctx context.Context, step Step, sr *StepResult, faultAt time.Time, td *teardown) {
	if !step.Expect.HasDetection() {
		// No signal to score — the step asserts the fault injects and (via the
		// teardown) reverts. That is a pass.
		sr.Passed = true
		sr.Detail = "fault injected; no detection expectation (reversibility asserted by teardown)"
		return
	}

	p := newPoller(o.signals, o.now, o.sleep, o.pollEvery)
	detect, derr := p.awaitSignal(ctx, step.Expect.Signal, step.Target, faultAt, step.Expect.DetectWithin.Std())
	if derr != nil {
		sr.Passed = false
		sr.Detail = fmt.Sprintf("error polling for signal %q: %v", step.Expect.Signal, derr)
		return
	}
	if !detect.observed {
		sr.SignalObserved = false
		sr.Passed = false
		sr.Detail = fmt.Sprintf("expected signal %q not observed within %s", step.Expect.Signal, step.Expect.DetectWithin.Std())
		return
	}

	sr.SignalObserved = true
	sr.ObservedSignal = detect.signal.Kind
	latencyMS := detect.latency.Milliseconds()
	sr.DetectionLatencyMS = &latencyMS
	o.metrics.observeDetectionLatency(step.Expect.Signal, detect.latency.Seconds())

	// Detection is within window iff measured latency <= the expectation.
	detectionOK := detect.latency <= step.Expect.DetectWithin.Std()

	if !step.Expect.HasRecovery() {
		sr.Passed = detectionOK
		if detectionOK {
			sr.Detail = fmt.Sprintf("signal %q detected in %s (within %s)", sr.ObservedSignal, detect.latency, step.Expect.DetectWithin.Std())
		} else {
			sr.Detail = fmt.Sprintf("signal %q detected in %s but exceeded %s", sr.ObservedSignal, detect.latency, step.Expect.DetectWithin.Std())
		}
		return
	}

	// Recovery is scored: revert the fault NOW (in addition to the deferred
	// safety teardown — the onceRevert ensures it runs exactly once), then measure
	// how long the signal takes to clear.
	revertAt := o.now()
	if td != nil {
		if ran, rerr := td.revert.run(ctx); ran {
			sr.FaultReverted = rerr == nil
			if rerr == nil {
				o.metrics.observeFaultReverted(step.Action)
			}
		}
	}

	recover, rerr := p.awaitCleared(ctx, step.Expect.Signal, step.Target, revertAt, revertAt, step.Expect.RecoverWithin.Std())
	if rerr != nil {
		sr.Passed = false
		sr.Detail = fmt.Sprintf("error polling for recovery of %q: %v", step.Expect.Signal, rerr)
		return
	}
	if !recover.observed {
		sr.Passed = false
		sr.Detail = fmt.Sprintf("signal %q did not clear within %s of revert", step.Expect.Signal, step.Expect.RecoverWithin.Std())
		return
	}
	recoveryMS := recover.latency.Milliseconds()
	sr.RecoveryLatencyMS = &recoveryMS
	o.metrics.observeRecoveryLatency(step.Expect.Signal, recover.latency.Seconds())
	recoveryOK := recover.latency <= step.Expect.RecoverWithin.Std()

	sr.Passed = detectionOK && recoveryOK
	switch {
	case !detectionOK:
		sr.Detail = fmt.Sprintf("detection %s exceeded %s", detect.latency, step.Expect.DetectWithin.Std())
	case !recoveryOK:
		sr.Detail = fmt.Sprintf("recovery %s exceeded %s", recover.latency, step.Expect.RecoverWithin.Std())
	default:
		sr.Detail = fmt.Sprintf("detected in %s, recovered in %s", detect.latency, recover.latency)
	}
}

// unwind runs every registered teardown in LIFO order. Each teardown's revert
// runs AT MOST ONCE across the whole run (onceRevert): a recovery-scored step may
// already have reverted during scoring, in which case the run here observes the
// cached error and does not re-invoke the side effect. unwind returns whether
// ALL faults were reverted successfully (every teardown ran and none errored).
func (o *Orchestrator) unwind(ctx context.Context, run *Run, stack []*teardown) bool {
	allReverted := true
	for i := len(stack) - 1; i >= 0; i-- {
		td := stack[i]
		ran, rerr := td.revert.run(ctx)
		// reverted == ran-without-error, at some point in this run.
		reverted := td.revert.reverted() && rerr == nil
		if td.result != nil && reverted {
			td.result.FaultReverted = true
		}
		// Meter the revert only on the call that actually performed the teardown.
		if ran && rerr == nil {
			o.metrics.observeFaultReverted(td.action)
		}
		if rerr != nil {
			allReverted = false
			o.logger.Error().Err(rerr).Str("run_id", run.ID).Str("action", td.action).Msg("gameday fault revert failed")
		}
	}
	return allReverted
}

// persistStep writes a step result in its own short system transaction so the
// scorecard row is durable before the next fault is injected. A persistence
// failure is logged but does not abort the exercise (the in-memory scorecard is
// still assembled and the run completion records the aggregate).
func (o *Orchestrator) persistStep(ctx context.Context, sr *StepResult) {
	if err := o.runner.RunSystem(ctx, func(tx DBTX) error {
		return o.store.UpsertStepResult(ctx, tx, sr)
	}); err != nil {
		o.logger.Error().Err(err).Str("run_id", sr.RunID).Int("step", sr.StepIndex).Msg("gameday persisting step result failed")
	}
}

// finishStep stamps the finished time on a step result.
func finishStep(sr *StepResult, at time.Time) {
	t := at
	sr.FinishedAt = &t
}
