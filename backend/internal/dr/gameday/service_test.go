package gameday

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// fakeServiceStore is a combined in-memory store satisfying BOTH serviceStore
// (request path) and orchestratorStore (system path), so a real Service +
// Orchestrator can be exercised end-to-end against it.
type fakeServiceStore struct {
	mu        sync.Mutex
	groups    map[string]bool
	scenarios map[string]*Scenario
	runs      map[string]*Run
	steps     map[string][]*StepResult
	seq       int
}

func newFakeServiceStore() *fakeServiceStore {
	return &fakeServiceStore{
		groups:    map[string]bool{},
		scenarios: map[string]*Scenario{},
		runs:      map[string]*Run{},
		steps:     map[string][]*StepResult{},
	}
}

func (s *fakeServiceStore) GroupExists(_ context.Context, _ DBTX, groupID string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.groups[groupID], nil
}

func (s *fakeServiceStore) CreateScenario(_ context.Context, _ DBTX, sc *Scenario) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	sc.ID = uuid.New().String()
	sc.CreatedAt = time.Now().UTC()
	sc.UpdatedAt = sc.CreatedAt
	s.scenarios[sc.ID] = sc
	return nil
}

func (s *fakeServiceStore) GetScenario(_ context.Context, _ DBTX, tenantID, id string) (*Scenario, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc, ok := s.scenarios[id]
	if !ok || sc.TenantID != tenantID {
		return nil, ErrScenarioNotFound
	}
	return sc, nil
}

func (s *fakeServiceStore) SystemGetScenario(_ context.Context, _ DBTX, id string) (*Scenario, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc, ok := s.scenarios[id]
	if !ok {
		return nil, ErrScenarioNotFound
	}
	return sc, nil
}

func (s *fakeServiceStore) ListScenarios(_ context.Context, _ DBTX, tenantID string) ([]*Scenario, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*Scenario
	for _, sc := range s.scenarios {
		if sc.TenantID == tenantID {
			out = append(out, sc)
		}
	}
	return out, nil
}

func (s *fakeServiceStore) CreateRun(_ context.Context, _ DBTX, run *Run) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.seq++
	run.ID = uuid.New().String()
	run.InitiatedAt = time.Now().UTC()
	run.UpdatedAt = run.InitiatedAt
	s.runs[run.ID] = run
	return nil
}

func (s *fakeServiceStore) GetRun(_ context.Context, _ DBTX, tenantID, id string) (*Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, ok := s.runs[id]
	if !ok || run.TenantID != tenantID {
		return nil, ErrRunNotFound
	}
	return run, nil
}

func (s *fakeServiceStore) ListStepResults(_ context.Context, _ DBTX, tenantID, runID string) ([]*StepResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*StepResult
	for _, r := range s.steps[runID] {
		if r.TenantID == tenantID {
			out = append(out, r)
		}
	}
	return out, nil
}

// --- orchestratorStore methods (system path) ---

func (s *fakeServiceStore) SystemMarkRunStarted(_ context.Context, _ DBTX, id string) (bool, error) {
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

func (s *fakeServiceStore) SystemRejectRunForProduction(_ context.Context, _ DBTX, id, reason string) error {
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

func (s *fakeServiceStore) UpsertStepResult(_ context.Context, _ DBTX, r *StepResult) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if r.ID == "" {
		r.ID = "step-" + r.RunID + "-" + itoa(r.StepIndex)
	}
	list := s.steps[r.RunID]
	for i, ex := range list {
		if ex.StepIndex == r.StepIndex {
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

func (s *fakeServiceStore) SystemCompleteRun(_ context.Context, _ DBTX, id, status string, stepsTotal, stepsPassed int, allReverted bool, lastErr string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
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

// fakeServiceRunner runs every transaction function against a nil DBTX (the fake
// store ignores it). It satisfies both txRunner and systemRunner.
type fakeServiceRunner struct{}

func (fakeServiceRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}
func (fakeServiceRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(nil)
}
func (fakeServiceRunner) RunSystem(_ context.Context, fn func(DBTX) error) error { return fn(nil) }
func (fakeServiceRunner) RunSystemRead(_ context.Context, fn func(DBTX) error) error {
	return fn(nil)
}

func buildService(t *testing.T, store *fakeServiceStore, clock *testClock, signals SignalSource, ctrl *fakeStreamController) *Service {
	t.Helper()
	reg := NewRegistry(NewPauseStreamFault(ctrl))
	orch, err := NewOrchestrator(OrchestratorConfig{
		Store:     store,
		Runner:    fakeServiceRunner{},
		Registry:  reg,
		Signals:   signals,
		Now:       clock.Now,
		Sleep:     clock.sleepFn,
		PollEvery: time.Second,
	})
	if err != nil {
		t.Fatalf("NewOrchestrator: %v", err)
	}
	svc, err := NewService(ServiceConfig{
		Store:        store,
		Runner:       fakeServiceRunner{},
		Orchestrator: orch,
		// Use a no-op stager: the fake runner passes a nil DBTX, and the real
		// outbox writer dereferences it. Event emission is covered by the
		// production path; here we exercise the service logic.
		Stager: nopEmitter{},
		Now:    clock.Now,
		Logger: zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc
}

func TestService_CreateScenario_ValidatesAndRejectsProduction(t *testing.T) {
	store := newFakeServiceStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = true
	clock := newTestClock(time.Now().UTC())
	svc := buildService(t, store, clock, &scriptedSignalSource{clock: clock}, newFakeStreamController())
	tenantID := uuid.New()

	// Production scope is rejected before anything is stored.
	_, err := svc.CreateScenario(context.Background(), tenantID, CreateScenarioInput{
		GroupID: groupID.String(), Name: "danger", Scope: ScopeProduction,
		Steps: []Step{{Action: ActionPauseStream, Target: "s1"}},
	})
	if !errors.Is(err, ErrProductionScope) {
		t.Fatalf("CreateScenario(production) err = %v, want ErrProductionScope", err)
	}
	if len(store.scenarios) != 0 {
		t.Fatalf("a production scenario must NOT be stored, have %d", len(store.scenarios))
	}

	// A valid drill scenario is created.
	sc, err := svc.CreateScenario(context.Background(), tenantID, CreateScenarioInput{
		GroupID: groupID.String(), Name: "ok", Scope: ScopeDrill,
		Steps: []Step{{Action: ActionPauseStream, Target: "s1",
			Expect: Expectation{Signal: "lag_alert", DetectWithin: Duration(30 * time.Second)}}},
	})
	if err != nil {
		t.Fatalf("CreateScenario(drill): %v", err)
	}
	if sc.ID == "" || sc.TenantID != tenantID.String() {
		t.Fatalf("scenario not persisted properly: %+v", sc)
	}
}

func TestService_ExecuteScenario_EndToEndPasses(t *testing.T) {
	store := newFakeServiceStore()
	groupID := uuid.New()
	store.groups[groupID.String()] = true
	clock := newTestClock(time.Date(2026, 6, 13, 9, 0, 0, 0, time.UTC))
	ctrl := newFakeStreamController()
	faultTime := clock.Now()
	signals := &scriptedSignalSource{
		clock: clock,
		scripts: []scriptedSignal{{
			kind: "lag_alert", target: "stream-1", availableFrom: faultTime.Add(4 * time.Second),
		}},
	}
	svc := buildService(t, store, clock, signals, ctrl)
	tenantID := uuid.New()

	sc, err := svc.CreateScenario(context.Background(), tenantID, CreateScenarioInput{
		GroupID: groupID.String(), Name: "pause-lag", Scope: ScopeDrill,
		Steps: []Step{{Action: ActionPauseStream, Target: "stream-1",
			Expect: Expectation{Signal: "lag_alert", DetectWithin: Duration(30 * time.Second)}}},
	})
	if err != nil {
		t.Fatalf("CreateScenario: %v", err)
	}

	card, err := svc.ExecuteScenario(context.Background(), tenantID, sc.ID, nil)
	if err != nil {
		t.Fatalf("ExecuteScenario: %v", err)
	}
	if card.Run.Status != RunStatusPassed {
		t.Fatalf("run status = %q, want passed; last_error=%v", card.Run.Status, card.Run.LastError)
	}
	if card.Run.Score == nil || *card.Run.Score != 1.0 {
		t.Fatalf("score = %v, want 1.0", card.Run.Score)
	}
	if len(card.Steps) != 1 || !card.Steps[0].Passed {
		t.Fatalf("scorecard step not passed: %+v", card.Steps)
	}
	if card.Steps[0].DetectionLatencyMS == nil || *card.Steps[0].DetectionLatencyMS != 4000 {
		t.Fatalf("detection latency = %v, want 4000ms", card.Steps[0].DetectionLatencyMS)
	}
	// Fault injected and reverted exactly once.
	if ctrl.pausedCount("stream-1") != 1 || ctrl.resumedCount("stream-1") != 1 {
		t.Fatalf("paused/resumed = %d/%d, want 1/1", ctrl.pausedCount("stream-1"), ctrl.resumedCount("stream-1"))
	}
}

func TestService_GetScorecard_TenantIsolation(t *testing.T) {
	store := newFakeServiceStore()
	clock := newTestClock(time.Now().UTC())
	svc := buildService(t, store, clock, &scriptedSignalSource{clock: clock}, newFakeStreamController())

	// A run owned by tenant A.
	tenantA := uuid.New()
	runID := uuid.New().String()
	store.runs[runID] = &Run{ID: runID, TenantID: tenantA.String(), Status: RunStatusPassed}

	// Tenant B must not be able to read it.
	tenantB := uuid.New()
	_, err := svc.GetScorecard(context.Background(), tenantB, runID)
	if !errors.Is(err, ErrRunNotFound) {
		t.Fatalf("cross-tenant GetScorecard err = %v, want ErrRunNotFound", err)
	}

	// Tenant A reads it fine.
	card, err := svc.GetScorecard(context.Background(), tenantA, runID)
	if err != nil {
		t.Fatalf("GetScorecard(owner): %v", err)
	}
	if card.Run.ID != runID {
		t.Fatalf("run = %+v", card.Run)
	}
}

// compile-time: the fake satisfies both store interfaces.
var (
	_ serviceStore      = (*fakeServiceStore)(nil)
	_ orchestratorStore = (*fakeServiceStore)(nil)
	_ txRunner          = fakeServiceRunner{}
	_ systemRunner      = fakeServiceRunner{}
)
