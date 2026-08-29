package gameday

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// --- test doubles ----------------------------------------------------------

// fakeOrchestratorStore is an in-memory orchestratorStore. It ignores the DBTX
// (the fake runner passes nil) and records the run + step rows the orchestrator
// writes, so the test asserts the persisted scorecard directly.
type fakeOrchestratorStore struct {
	mu          sync.Mutex
	scenarios   map[string]*Scenario
	runs        map[string]*Run
	steps       map[string][]*StepResult // runID -> ordered results
	completeErr error
}

func newFakeOrchestratorStore() *fakeOrchestratorStore {
	return &fakeOrchestratorStore{
		scenarios: map[string]*Scenario{},
		runs:      map[string]*Run{},
		steps:     map[string][]*StepResult{},
	}
}

func (s *fakeOrchestratorStore) SystemGetScenario(_ context.Context, _ DBTX, id string) (*Scenario, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc, ok := s.scenarios[id]
	if !ok {
		return nil, ErrScenarioNotFound
	}
	return sc, nil
}

func (s *fakeOrchestratorStore) SystemMarkRunStarted(_ context.Context, _ DBTX, id string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.runs[id]
	if !ok {
		return false, ErrRunNotFound
	}
	if run.Status == RunStatusPending {
		run.Status = RunStatusRunning
		run.SafetyVerdict = SafetyAllowed
		return true, nil
	}
	return false, nil
}

func (s *fakeOrchestratorStore) SystemRejectRunForProduction(_ context.Context, _ DBTX, id, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.runs[id]
	if !ok {
		return ErrRunNotFound
	}
	run.Status = RunStatusAborted
	run.SafetyVerdict = SafetyRejectedProduction
	run.LastError = &reason
	return nil
}

func (s *fakeOrchestratorStore) UpsertStepResult(_ context.Context, _ DBTX, r *StepResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.ID == "" {
		r.ID = "step-" + r.RunID + "-" + itoa(r.StepIndex)
	}
	list := s.steps[r.RunID]
	for i, existing := range list {
		if existing.StepIndex == r.StepIndex {
			cp := *r
			list[i] = &cp
			s.steps[r.RunID] = list
			return nil
		}
	}
	cp := *r
	s.steps[r.RunID] = append(list, &cp)
	return nil
}

func (s *fakeOrchestratorStore) SystemCompleteRun(_ context.Context, _ DBTX, id, status string, stepsTotal, stepsPassed int, allReverted bool, lastErr string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.completeErr != nil {
		return s.completeErr
	}
	run, ok := s.runs[id]
	if !ok {
		return ErrRunNotFound
	}
	run.Status = status
	run.StepsTotal = stepsTotal
	run.StepsPassed = stepsPassed
	run.AllFaultsReverted = allReverted
	score := scoreRatio(stepsPassed, stepsTotal)
	run.Score = &score
	if lastErr != "" {
		run.LastError = &lastErr
	}
	return nil
}

func (s *fakeOrchestratorStore) runStatus(id string) string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.runs[id].Status
}

func (s *fakeOrchestratorStore) stepResults(id string) []*StepResult {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]*StepResult, len(s.steps[id]))
	copy(out, s.steps[id])
	return out
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var b [20]byte
	p := len(b)
	for i > 0 {
		p--
		b[p] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		p--
		b[p] = '-'
	}
	return string(b[p:])
}

// fakeRunner runs fn with a nil DBTX (the fake store ignores it).
type fakeRunner struct{}

func (fakeRunner) RunSystem(_ context.Context, fn func(DBTX) error) error { return fn(nil) }

// scriptedSignal is one programmed signal observation: from `availableFrom`
// onward (per the test clock) the source reports the signal as firing, until
// `clearedFrom` when it stops firing (recovery).
type scriptedSignal struct {
	kind          string
	target        string
	availableFrom time.Time
	clearedFrom   *time.Time // nil = never clears
}

// scriptedSignalSource is a deterministic SignalSource driven by a test clock and
// a script. LatestSignal reports a firing signal when the clock is within
// [availableFrom, clearedFrom).
type scriptedSignalSource struct {
	clock   *testClock
	scripts []scriptedSignal
	err     error
}

func (s *scriptedSignalSource) LatestSignal(_ context.Context, kind, target string, since time.Time) (Signal, bool, error) {
	if s.err != nil {
		return Signal{}, false, s.err
	}
	now := s.clock.Now()
	for _, sc := range s.scripts {
		if sc.kind != kind || sc.target != target {
			continue
		}
		if now.Before(sc.availableFrom) {
			continue
		}
		if sc.clearedFrom != nil && !now.Before(*sc.clearedFrom) {
			continue // signal has cleared
		}
		// The signal is firing now; it was observed at availableFrom (or `since`,
		// whichever is later, to model "raised after the fault").
		observedAt := sc.availableFrom
		if observedAt.Before(since) {
			observedAt = since
		}
		return Signal{Kind: kind, Target: target, ObservedAt: observedAt}, true, nil
	}
	return Signal{}, false, nil
}

// testClock is a manually-advanced clock. The orchestrator's sleep advances it,
// so polling loops terminate deterministically without real time passing.
type testClock struct {
	mu sync.Mutex
	t  time.Time
}

func newTestClock(start time.Time) *testClock { return &testClock{t: start} }

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}

// sleepFn advances the test clock instead of blocking.
func (c *testClock) sleepFn(_ context.Context, d time.Duration) error {
	c.advance(d)
	return nil
}

// buildOrchestrator wires an orchestrator over the fakes with a deterministic
// clock and the given fault registry + signal source.
func buildOrchestrator(t *testing.T, store orchestratorStore, reg *Registry, signals SignalSource, clock *testClock) *Orchestrator {
	t.Helper()
	o, err := NewOrchestrator(OrchestratorConfig{
		Store:     store,
		Runner:    fakeRunner{},
		Registry:  reg,
		Signals:   signals,
		Now:       clock.Now,
		Sleep:     clock.sleepFn,
		PollEvery: time.Second,
	})
	if err != nil {
		t.Fatalf("NewOrchestrator: %v", err)
	}
	return o
}

// --- the core scenario test ------------------------------------------------

// TestExecute_PauseStreamExpectLagAlert is the load-bearing test: a scenario
// [pause stream -> expect lag alert within 30s -> resume] runs against a fake
// StreamController + scripted SignalSource. It asserts:
//   - the fault is injected AND reverted,
//   - the observed detection latency is measured and scored,
//   - the scorecard pass/fail is correct,
//   - the fault is reverted exactly once.
func TestExecute_PauseStreamExpectLagAlert_Passes(t *testing.T) {
	clock := newTestClock(time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC))
	ctrl := newFakeStreamController()
	reg := NewRegistry(NewPauseStreamFault(ctrl))

	// The lag alert fires 5s after the fault (well within the 30s detection
	// window) and clears 3s after the resume (within a 30s recovery window).
	faultTime := clock.Now()
	alertAt := faultTime.Add(5 * time.Second)
	signals := &scriptedSignalSource{
		clock: clock,
		scripts: []scriptedSignal{{
			kind:          "lag_alert",
			target:        "stream-1",
			availableFrom: alertAt,
			// clearedFrom is set relative to when recovery polling begins; the
			// orchestrator reverts then polls awaitCleared from revertAt. Because the
			// scripted source reports "firing" only while now < clearedFrom, set it a
			// little after the alert so the first recovery poll (which advances the
			// clock) eventually sees it cleared.
			clearedFrom: ptrTime(alertAt.Add(2 * time.Second)),
		}},
	}

	store := newFakeOrchestratorStore()
	scenario := &Scenario{
		ID: "sc-1", TenantID: "t-1", GroupID: "g-1", Scope: ScopeDrill, Name: "pause-lag",
		Steps: []Step{{
			Action: ActionPauseStream,
			Target: "stream-1",
			Expect: Expectation{
				Signal:        "lag_alert",
				DetectWithin:  Duration(30 * time.Second),
				RecoverWithin: Duration(30 * time.Second),
			},
		}},
	}
	store.scenarios[scenario.ID] = scenario
	run := &Run{ID: "run-1", TenantID: "t-1", ScenarioID: scenario.ID, GroupID: "g-1", Scope: ScopeDrill, Status: RunStatusPending}
	store.runs[run.ID] = run

	o := buildOrchestrator(t, store, reg, signals, clock)
	result, err := o.Execute(context.Background(), run, scenario)
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}

	// Fault injected exactly once and resumed exactly once (reverted once).
	if got := ctrl.pausedCount("stream-1"); got != 1 {
		t.Fatalf("paused count = %d, want 1", got)
	}
	if got := ctrl.resumedCount("stream-1"); got != 1 {
		t.Fatalf("resumed (reverted) count = %d, want exactly 1", got)
	}

	// Scorecard pass.
	if result.Status != RunStatusPassed {
		t.Fatalf("run status = %q, want passed", result.Status)
	}
	if result.StepsPassed != 1 || result.StepsTotal != 1 {
		t.Fatalf("steps passed/total = %d/%d, want 1/1", result.StepsPassed, result.StepsTotal)
	}
	if !result.AllFaultsReverted {
		t.Fatal("AllFaultsReverted = false, want true")
	}

	steps := store.stepResults(run.ID)
	if len(steps) != 1 {
		t.Fatalf("persisted %d step results, want 1", len(steps))
	}
	sr := steps[0]
	if !sr.SignalObserved {
		t.Fatal("SignalObserved = false, want true")
	}
	if sr.DetectionLatencyMS == nil {
		t.Fatal("DetectionLatencyMS is nil, want measured latency")
	}
	if *sr.DetectionLatencyMS != (5 * time.Second).Milliseconds() {
		t.Fatalf("detection latency = %dms, want 5000ms", *sr.DetectionLatencyMS)
	}
	if !sr.FaultReverted {
		t.Fatal("step FaultReverted = false, want true")
	}
	if !sr.Passed {
		t.Fatalf("step passed = false, detail = %q", sr.Detail)
	}
	// The scorecard records the fault's observability from the resolved injector,
	// so a green run is never misread: pause_stream is system-observable.
	if sr.Observability != ObservabilitySystemObservable {
		t.Fatalf("step observability = %q, want %q", sr.Observability, ObservabilitySystemObservable)
	}
	if store.runStatus(run.ID) != RunStatusPassed {
		t.Fatalf("persisted run status = %q, want passed", store.runStatus(run.ID))
	}
}

// TestExecute_DetectionMiss_Fails: the alert never fires within the window, so
// the step (and run) fail — and the fault is STILL reverted.
func TestExecute_DetectionMiss_Fails(t *testing.T) {
	clock := newTestClock(time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC))
	ctrl := newFakeStreamController()
	reg := NewRegistry(NewPauseStreamFault(ctrl))
	// No scripted signal -> never observed.
	signals := &scriptedSignalSource{clock: clock}

	store := newFakeOrchestratorStore()
	scenario := &Scenario{
		ID: "sc-2", TenantID: "t-1", GroupID: "g-1", Scope: ScopeNonProd, Name: "miss",
		Steps: []Step{{
			Action: ActionPauseStream, Target: "stream-9",
			Expect: Expectation{Signal: "lag_alert", DetectWithin: Duration(10 * time.Second)},
		}},
	}
	store.scenarios[scenario.ID] = scenario
	run := &Run{ID: "run-2", TenantID: "t-1", ScenarioID: scenario.ID, GroupID: "g-1", Scope: ScopeNonProd, Status: RunStatusPending}
	store.runs[run.ID] = run

	o := buildOrchestrator(t, store, reg, signals, clock)
	result, err := o.Execute(context.Background(), run, scenario)
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if result.Status != RunStatusFailed {
		t.Fatalf("run status = %q, want failed", result.Status)
	}
	if result.StepsPassed != 0 {
		t.Fatalf("steps passed = %d, want 0", result.StepsPassed)
	}
	// Fault still reverted despite the failed expectation.
	if ctrl.resumedCount("stream-9") != 1 {
		t.Fatalf("fault not reverted on detection miss: resumed=%d", ctrl.resumedCount("stream-9"))
	}
	if !result.AllFaultsReverted {
		t.Fatal("AllFaultsReverted = false, want true even on a failed step")
	}
}

// TestExecute_DetectionTooSlow_Fails: the alert fires, but only after the
// detection window — measured latency exceeds the expectation, so the step fails.
func TestExecute_DetectionTooSlow_Fails(t *testing.T) {
	clock := newTestClock(time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC))
	ctrl := newFakeStreamController()
	reg := NewRegistry(NewPauseStreamFault(ctrl))
	faultTime := clock.Now()
	signals := &scriptedSignalSource{
		clock: clock,
		scripts: []scriptedSignal{{
			kind: "lag_alert", target: "s1",
			availableFrom: faultTime.Add(25 * time.Second), // after the 10s window
		}},
	}
	store := newFakeOrchestratorStore()
	scenario := &Scenario{
		ID: "sc-3", TenantID: "t-1", GroupID: "g-1", Scope: ScopeDrill, Name: "slow",
		Steps: []Step{{
			Action: ActionPauseStream, Target: "s1",
			Expect: Expectation{Signal: "lag_alert", DetectWithin: Duration(10 * time.Second)},
		}},
	}
	store.scenarios[scenario.ID] = scenario
	run := &Run{ID: "run-3", TenantID: "t-1", ScenarioID: scenario.ID, GroupID: "g-1", Scope: ScopeDrill, Status: RunStatusPending}
	store.runs[run.ID] = run

	o := buildOrchestrator(t, store, reg, signals, clock)
	result, _ := o.Execute(context.Background(), run, scenario)
	if result.Status != RunStatusFailed {
		t.Fatalf("run status = %q, want failed (detection too slow)", result.Status)
	}
	if ctrl.resumedCount("s1") != 1 {
		t.Fatalf("fault not reverted: resumed=%d", ctrl.resumedCount("s1"))
	}
}

// TestExecute_ProductionScope_Rejected is the SAFETY GUARD test: a production
// scope is refused, NO fault is injected, and the run is aborted with the
// rejected-production verdict.
func TestExecute_ProductionScope_Rejected(t *testing.T) {
	clock := newTestClock(time.Now().UTC())
	ctrl := newFakeStreamController()
	reg := NewRegistry(NewPauseStreamFault(ctrl))
	signals := &scriptedSignalSource{clock: clock}

	store := newFakeOrchestratorStore()
	// A scenario whose scope is production (forced past validation by constructing
	// the struct directly — the guard must catch it regardless of how it arrived).
	scenario := &Scenario{
		ID: "sc-prod", TenantID: "t-1", GroupID: "g-1", Scope: ScopeProduction, Name: "danger",
		Steps: []Step{{Action: ActionPauseStream, Target: "prod-stream",
			Expect: Expectation{Signal: "lag_alert", DetectWithin: Duration(time.Second)}}},
	}
	store.scenarios[scenario.ID] = scenario
	run := &Run{ID: "run-prod", TenantID: "t-1", ScenarioID: scenario.ID, GroupID: "g-1", Scope: ScopeProduction, Status: RunStatusPending}
	store.runs[run.ID] = run

	o := buildOrchestrator(t, store, reg, signals, clock)
	result, err := o.Execute(context.Background(), run, scenario)
	if !errors.Is(err, ErrProductionScope) {
		t.Fatalf("Execute() error = %v, want ErrProductionScope", err)
	}
	if result.SafetyVerdict != SafetyRejectedProduction {
		t.Fatalf("safety verdict = %q, want %q", result.SafetyVerdict, SafetyRejectedProduction)
	}
	// CRITICAL: no fault was injected.
	if ctrl.pausedCount("prod-stream") != 0 {
		t.Fatalf("a fault was injected against a production scope! paused=%d", ctrl.pausedCount("prod-stream"))
	}
	if store.runStatus(run.ID) != RunStatusAborted {
		t.Fatalf("run status = %q, want aborted", store.runStatus(run.ID))
	}
}

// TestExecute_RevertOnLaterStepFailure: a two-step scenario where the SECOND
// step's injection fails. The FIRST step's fault must still be reverted (the
// deferred teardown), proving revert survives a later step failure.
func TestExecute_RevertOnLaterStepFailure(t *testing.T) {
	clock := newTestClock(time.Now().UTC())
	ctrl := newFakeStreamController()
	// The lag controller errors on inject, so step 2 fails to inject.
	failingLag := &erroringLagController{}
	reg := NewRegistry(NewPauseStreamFault(ctrl), NewInduceLagFault(failingLag, time.Minute))
	signals := &scriptedSignalSource{clock: clock} // step 1 has no detection expectation

	store := newFakeOrchestratorStore()
	scenario := &Scenario{
		ID: "sc-4", TenantID: "t-1", GroupID: "g-1", Scope: ScopeDrill, Name: "two-step",
		Steps: []Step{
			{Action: ActionPauseStream, Target: "s1"}, // no detection -> passes, fault active
			{Action: ActionInduceLag, Target: "s2"},   // injection fails
		},
	}
	store.scenarios[scenario.ID] = scenario
	run := &Run{ID: "run-4", TenantID: "t-1", ScenarioID: scenario.ID, GroupID: "g-1", Scope: ScopeDrill, Status: RunStatusPending}
	store.runs[run.ID] = run

	o := buildOrchestrator(t, store, reg, signals, clock)
	result, _ := o.Execute(context.Background(), run, scenario)

	// Step 1's pause MUST be reverted even though step 2 failed.
	if ctrl.resumedCount("s1") != 1 {
		t.Fatalf("step 1 fault not reverted after step 2 failure: resumed=%d", ctrl.resumedCount("s1"))
	}
	// Step 2 failed to inject -> step fails -> run fails.
	if result.Status != RunStatusFailed {
		t.Fatalf("run status = %q, want failed", result.Status)
	}
	if result.StepsPassed != 1 {
		t.Fatalf("steps passed = %d, want 1 (step 1)", result.StepsPassed)
	}
}

// TestExecute_RevertOnPanic: a fault injector that panics during a LATER step
// must not strand the FIRST step's injected fault — the deferred teardown runs
// during panic recovery and the run is aborted.
func TestExecute_RevertOnPanic(t *testing.T) {
	clock := newTestClock(time.Now().UTC())
	ctrl := newFakeStreamController()
	reg := NewRegistry(NewPauseStreamFault(ctrl), &panickingInjector{})
	signals := &scriptedSignalSource{clock: clock}

	store := newFakeOrchestratorStore()
	scenario := &Scenario{
		ID: "sc-5", TenantID: "t-1", GroupID: "g-1", Scope: ScopeDrill, Name: "panic",
		Steps: []Step{
			{Action: ActionPauseStream, Target: "s1"},
			{Action: "panic_action", Target: "boom"},
		},
	}
	store.scenarios[scenario.ID] = scenario
	run := &Run{ID: "run-5", TenantID: "t-1", ScenarioID: scenario.ID, GroupID: "g-1", Scope: ScopeDrill, Status: RunStatusPending}
	store.runs[run.ID] = run

	o := buildOrchestrator(t, store, reg, signals, clock)
	result, err := o.Execute(context.Background(), run, scenario)
	if err == nil {
		t.Fatal("Execute() error = nil, want a panic-derived error")
	}
	// The first fault MUST be reverted despite the panic.
	if ctrl.resumedCount("s1") != 1 {
		t.Fatalf("fault not reverted on panic: resumed=%d", ctrl.resumedCount("s1"))
	}
	if result.Status != RunStatusAborted {
		t.Fatalf("run status = %q, want aborted", result.Status)
	}
}

// TestExecute_UnknownAction_Aborts: a step whose action has no injector aborts
// the run; no fault is injected for that step, and any prior fault is reverted.
func TestExecute_UnknownAction_Aborts(t *testing.T) {
	clock := newTestClock(time.Now().UTC())
	ctrl := newFakeStreamController()
	reg := NewRegistry(NewPauseStreamFault(ctrl)) // no injector for "induce_lag"
	signals := &scriptedSignalSource{clock: clock}

	store := newFakeOrchestratorStore()
	scenario := &Scenario{
		ID: "sc-6", TenantID: "t-1", GroupID: "g-1", Scope: ScopeDrill, Name: "unknown",
		Steps: []Step{
			{Action: ActionPauseStream, Target: "s1"},
			{Action: ActionInduceLag, Target: "s2"}, // no injector registered
		},
	}
	store.scenarios[scenario.ID] = scenario
	run := &Run{ID: "run-6", TenantID: "t-1", ScenarioID: scenario.ID, GroupID: "g-1", Scope: ScopeDrill, Status: RunStatusPending}
	store.runs[run.ID] = run

	o := buildOrchestrator(t, store, reg, signals, clock)
	result, err := o.Execute(context.Background(), run, scenario)
	if !errors.Is(err, ErrUnknownAction) {
		t.Fatalf("Execute() error = %v, want ErrUnknownAction", err)
	}
	if ctrl.resumedCount("s1") != 1 {
		t.Fatalf("prior fault not reverted on unknown-action abort: resumed=%d", ctrl.resumedCount("s1"))
	}
	if result.Status != RunStatusAborted {
		t.Fatalf("run status = %q, want aborted", result.Status)
	}
}

// --- helper doubles --------------------------------------------------------

type erroringLagController struct{}

func (erroringLagController) InduceLag(context.Context, string, time.Duration) error {
	return errors.New("lag controller unavailable")
}
func (erroringLagController) ClearLag(context.Context, string) error { return nil }

type panickingInjector struct{}

func (*panickingInjector) Action() string        { return "panic_action" }
func (*panickingInjector) Observability() string { return ObservabilityHarnessOnly }
func (*panickingInjector) Inject(context.Context, Step) (Revert, error) {
	panic("injector blew up")
}

func ptrTime(t time.Time) *time.Time { return &t }
