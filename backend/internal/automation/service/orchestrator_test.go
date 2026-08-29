package service

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/repository"
)

// =============================================================================
// In-memory store — models the real repository's observable behavior (the
// claim predicate, Ensure-not-Create on (run_id, step_index), the run/gate
// UNIQUE(run_id, step_index) upserts) without a database. It satisfies every
// interface the orchestrator, gate service, and loop depend on.
// =============================================================================

type memStore struct {
	mu       sync.Mutex
	runs     map[string]*model.Run          // id -> run
	runbooks map[string]*model.Runbook      // id -> runbook
	steps    map[string]*model.RunStep      // run_id|index -> step
	gates    map[string]*model.ApprovalGate // run_id|index -> gate
	seq      int                            // id generator
}

func newMemStore() *memStore {
	return &memStore{
		runs:     map[string]*model.Run{},
		runbooks: map[string]*model.Runbook{},
		steps:    map[string]*model.RunStep{},
		gates:    map[string]*model.ApprovalGate{},
	}
}

func key(runID string, idx int) string { return fmt.Sprintf("%s|%d", runID, idx) }

func (m *memStore) nextID(prefix string) string {
	m.seq++
	return fmt.Sprintf("%s-%d", prefix, m.seq)
}

// --- snapshot/restore for the rollback-on-error transaction runner ---

func (m *memStore) snapshot() *memStore {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := newMemStore()
	cp.seq = m.seq
	for k, v := range m.runs {
		r := *v
		cp.runs[k] = &r
	}
	for k, v := range m.runbooks {
		rb := *v
		rb.Steps = append([]model.RunbookStep(nil), v.Steps...)
		cp.runbooks[k] = &rb
	}
	for k, v := range m.steps {
		s := *v
		cp.steps[k] = &s
	}
	for k, v := range m.gates {
		g := *v
		g.Decisions = append([]model.Decision(nil), v.Decisions...)
		cp.gates[k] = &g
	}
	return cp
}

func (m *memStore) restore(cp *memStore) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.seq = cp.seq
	m.runs = cp.runs
	m.runbooks = cp.runbooks
	m.steps = cp.steps
	m.gates = cp.gates
}

// --- Repository / GateRepository / RunbookReader methods ---

func (m *memStore) GetRun(_ context.Context, _ repository.DBTX, tenantID, id string) (*model.Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.runs[id]
	if !ok || r.TenantID != tenantID {
		return nil, fmt.Errorf("run %s: %w", id, model.ErrNotFound)
	}
	cp := *r
	cp.Variables = copyMap(r.Variables)
	return &cp, nil
}

func (m *memStore) UpdateRunState(_ context.Context, _ repository.DBTX, run *model.Run) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	existing, ok := m.runs[run.ID]
	if !ok {
		return fmt.Errorf("run %s: %w", run.ID, model.ErrNotFound)
	}
	existing.Status = run.Status
	existing.CurrentStep = run.CurrentStep
	existing.Variables = copyMap(run.Variables)
	existing.LastError = run.LastError
	existing.CompletedAt = run.CompletedAt
	existing.UpdatedAt = time.Now().UTC()
	return nil
}

func (m *memStore) GetRunbook(_ context.Context, _ repository.DBTX, tenantID, id string) (*model.Runbook, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	rb, ok := m.runbooks[id]
	if !ok || rb.TenantID != tenantID {
		return nil, fmt.Errorf("runbook %s: %w", id, model.ErrNotFound)
	}
	cp := *rb
	cp.Steps = append([]model.RunbookStep(nil), rb.Steps...)
	return &cp, nil
}

func (m *memStore) EnsureRunStep(_ context.Context, _ string, s *model.RunStep) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(s.RunID, s.Index)
	if existing, ok := m.steps[k]; ok {
		// Ensure-not-Create: update the existing row in place, keep id/started_at.
		s.ID = existing.ID
		s.StartedAt = existing.StartedAt
	} else {
		s.ID = m.nextID("step")
		if s.StartedAt.IsZero() {
			s.StartedAt = time.Now().UTC()
		}
	}
	stored := *s
	m.steps[k] = &stored
	return nil
}

func (m *memStore) GetRunStep(_ context.Context, _ repository.DBTX, runID string, index int) (*model.RunStep, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.steps[key(runID, index)]
	if !ok {
		return nil, fmt.Errorf("run step %d: %w", index, model.ErrNotFound)
	}
	cp := *s
	return &cp, nil
}

func (m *memStore) UpsertApprovalGate(_ context.Context, _ repository.DBTX, g *model.ApprovalGate) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := key(g.RunID, g.StepIndex)
	if existing, ok := m.gates[k]; ok {
		g.ID = existing.ID
		g.OpenedAt = existing.OpenedAt
	} else {
		g.ID = m.nextID("gate")
		if g.OpenedAt.IsZero() {
			g.OpenedAt = time.Now().UTC()
		}
	}
	stored := *g
	stored.Decisions = append([]model.Decision(nil), g.Decisions...)
	m.gates[k] = &stored
	return nil
}

func (m *memStore) GetApprovalGate(_ context.Context, _ repository.DBTX, tenantID, runID string, stepIndex int) (*model.ApprovalGate, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.gates[key(runID, stepIndex)]
	if !ok || g.TenantID != tenantID {
		return nil, fmt.Errorf("gate (run %s step %d): %w", runID, stepIndex, model.ErrNotFound)
	}
	cp := *g
	cp.Decisions = append([]model.Decision(nil), g.Decisions...)
	return &cp, nil
}

// --- Claimer / GateLister (SYSTEM path) ---

func (m *memStore) SystemClaimRunnableRuns(_ context.Context, _ repository.DBTX, limit int) ([]*model.Run, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []*model.Run
	for _, r := range m.runs {
		// Mirror the partial index predicate: PENDING|RUNNING only.
		if r.Status != model.RunStatusPending && r.Status != model.RunStatusRunning {
			continue
		}
		now := time.Now().UTC()
		r.ClaimedAt = &now
		cp := *r
		cp.Variables = copyMap(r.Variables)
		out = append(out, &cp)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

func (m *memStore) SystemListExpiredGates(_ context.Context, _ repository.DBTX, limit int) ([]*model.ApprovalGate, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().UTC()
	var out []*model.ApprovalGate
	for _, g := range m.gates {
		if g.Status != model.GateStatusOpen || g.DeadlineAt == nil || g.DeadlineAt.After(now) {
			continue
		}
		cp := *g
		cp.Decisions = append([]model.Decision(nil), g.Decisions...)
		out = append(out, &cp)
		if len(out) >= limit {
			break
		}
	}
	return out, nil
}

// --- test helpers to seed/read the store ---

func (m *memStore) putRunbook(rb *model.Runbook) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runbooks[rb.ID] = rb
}

func (m *memStore) putRun(r *model.Run) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.runs[r.ID] = r
}

func (m *memStore) run(id string) *model.Run {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.runs[id]
}

func (m *memStore) gate(runID string, idx int) *model.ApprovalGate {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.gates[key(runID, idx)]
}

func (m *memStore) step(runID string, idx int) *model.RunStep {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.steps[key(runID, idx)]
}

// repoAdapter bridges memStore to the orchestrator's Repository interface, whose
// EnsureRunStep takes a DBTX (the store's bare EnsureRunStep does not, so it can
// be reused by tests directly).
type repoAdapter struct{ *memStore }

func (a repoAdapter) EnsureRunStep(ctx context.Context, db repository.DBTX, tenantID string, s *model.RunStep) error {
	return a.memStore.EnsureRunStep(ctx, tenantID, s)
}

var _ Repository = repoAdapter{}
var _ GateRepository = repoAdapter{}
var _ Claimer = (*memStore)(nil)
var _ GateLister = (*memStore)(nil)
var _ RunbookReader = repoAdapter{}

// =============================================================================
// Fake ActionExecutor + recording EventSink
// =============================================================================

type fakeExecutor struct {
	mu    sync.Mutex
	calls []int // step indices executed, in order
	// failOn maps step index -> remaining failures to inject before succeeding.
	failOn map[int]int
	// outputs maps step index -> output data to return on success.
	outputs map[int]map[string]any
}

func newFakeExecutor() *fakeExecutor {
	return &fakeExecutor{failOn: map[int]int{}, outputs: map[int]map[string]any{}}
}

func (f *fakeExecutor) Execute(_ context.Context, step *model.RunStep) (Output, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, step.Index)
	if n := f.failOn[step.Index]; n > 0 {
		f.failOn[step.Index] = n - 1
		return Output{}, fmt.Errorf("injected failure on step %d", step.Index)
	}
	out := f.outputs[step.Index]
	if out == nil {
		out = map[string]any{"ok": true, "step": step.Index}
	}
	return Output{Data: out}, nil
}

func (f *fakeExecutor) callCount(idx int) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.calls {
		if c == idx {
			n++
		}
	}
	return n
}

type recordingSink struct {
	mu     sync.Mutex
	events []string
}

func (s *recordingSink) Emit(_ context.Context, _ repository.DBTX, _, eventType string, _ map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, eventType)
	return nil
}

func (s *recordingSink) has(eventType string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.events {
		if e == eventType {
			return true
		}
	}
	return false
}

func (s *recordingSink) count(eventType string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, e := range s.events {
		if e == eventType {
			n++
		}
	}
	return n
}

// =============================================================================
// In-memory transaction runners for the loop. txRunnerCommit commits all
// mutations (the store is the committed state). txRunnerRollback discards the
// store's mutations when fn returns a non-recorded error, modelling a real
// transaction rollback so the separate-tx discipline is testable.
// =============================================================================

// commitRunner counts transaction invocations so a test can assert that claim
// and advance ran in SEPARATE transactions. It applies fn directly against the
// store (the store is the committed state).
type commitRunner struct {
	calls int
}

func (r *commitRunner) asTxRunner() txRunner {
	return func(_ context.Context, fn func(db repository.DBTX) error) error {
		r.calls++
		return fn(nil)
	}
}

func (r *commitRunner) asReadRunner() readRunner {
	return func(_ context.Context, fn func(db repository.DBTX) error) error {
		return fn(nil)
	}
}

// directTxRun is the simplest in-memory transaction runner: it runs fn against
// the store (the committed state) with a nil DBTX. Used by the orchestrator unit
// tests, which drive Advance directly (each call = one driver tick). The
// orchestrator opens its own sub-transactions through this runner, so an action
// step's Execute runs strictly between two of these calls (never inside one).
func directTxRun(_ context.Context, fn func(db repository.DBTX) error) error {
	return fn(nil)
}

// =============================================================================
// Builders
// =============================================================================

const (
	tnt = "aaaaaaaa-0000-0000-0000-000000000001"
)

func actionStep(idx int) model.RunbookStep {
	return model.RunbookStep{
		ID:        fmt.Sprintf("rbs-%d", idx),
		Index:     idx,
		Type:      model.StepTypeAction,
		Action:    model.ActionRef{Kind: model.ActionHTTPCall, Config: map[string]any{"url": "https://svc/" + fmt.Sprint(idx)}},
		RunbookID: "rb-1",
	}
}

func gateStep(idx, quorum, timeoutSec int, timeoutAction string) model.RunbookStep {
	return model.RunbookStep{
		ID:             fmt.Sprintf("rbs-%d", idx),
		Index:          idx,
		Type:           model.StepTypeApprovalGate,
		ApproverRoles:  []string{"sre-lead"},
		Quorum:         quorum,
		TimeoutSeconds: timeoutSec,
		TimeoutAction:  timeoutAction,
		RunbookID:      "rb-1",
	}
}

func seedRunbook(m *memStore, steps ...model.RunbookStep) {
	m.putRunbook(&model.Runbook{ID: "rb-1", TenantID: tnt, Name: "runbook", Steps: steps})
}

func seedRun(m *memStore, id string) *model.Run {
	r := &model.Run{
		ID:            id,
		TenantID:      tnt,
		AutomationID:  "auto-1",
		RunbookID:     "rb-1",
		Status:        model.RunStatusPending,
		SourceEventID: "evt-" + id,
		CurrentStep:   0,
		Trigger:       map[string]any{"data": map[string]any{"severity": "critical"}},
		StartedAt:     time.Now().UTC(),
	}
	m.putRun(r)
	return r
}

func newOrchestrator(t *testing.T, m *memStore, exec ActionExecutor, sink EventSink, maxAttempts int) *RunbookOrchestrator {
	t.Helper()
	o, err := NewRunbookOrchestrator(OrchestratorConfig{
		Repository:  repoAdapter{m},
		Executor:    exec,
		Events:      sink,
		Now:         func() time.Time { return time.Now().UTC() },
		MaxAttempts: maxAttempts,
	})
	if err != nil {
		t.Fatalf("NewRunbookOrchestrator: %v", err)
	}
	return o
}

// driveToQuiescence advances the run repeatedly (each call = one driver tick in
// its own transaction) until the run is terminal or parked, or maxTicks elapse.
func driveToQuiescence(t *testing.T, o *RunbookOrchestrator, m *memStore, runID string, maxTicks int) {
	t.Helper()
	for i := 0; i < maxTicks; i++ {
		r := m.run(runID)
		if r == nil {
			t.Fatalf("run %s vanished", runID)
		}
		if r.IsTerminal() || r.Status == model.RunStatusAwaitingApproval || r.Status == model.RunStatusEscalated {
			return
		}
		// Each Advance is one driver tick; pass a fresh copy as the loop would
		// after claiming (re-deriving state from the store). The orchestrator owns
		// its own sub-transactions through directTxRun.
		claimed, err := m.GetRun(context.Background(), nil, tnt, runID)
		if err != nil {
			t.Fatalf("re-deriving run: %v", err)
		}
		if _, err := o.Advance(context.Background(), claimed, directTxRun); err != nil {
			if IsRecordedFailure(err) {
				return
			}
			t.Fatalf("advance tick %d: %v", i, err)
		}
	}
	t.Fatalf("run %s did not quiesce within %d ticks (status=%s)", runID, maxTicks, m.run(runID).Status)
}

// =============================================================================
// Tests
// =============================================================================

func TestOrchestrator_HappyPath_AdvancesToCompleted(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0), actionStep(1), actionStep(2))
	seedRun(m, "run-happy")
	exec := newFakeExecutor()
	exec.outputs[1] = map[string]any{"instance_id": "wf-99"}
	sink := &recordingSink{}
	o := newOrchestrator(t, m, exec, sink, 3)

	driveToQuiescence(t, o, m, "run-happy", 20)

	r := m.run("run-happy")
	if r.Status != model.RunStatusCompleted {
		t.Fatalf("status = %s, want COMPLETED", r.Status)
	}
	if r.CompletedAt == nil {
		t.Fatal("CompletedAt not set on completed run")
	}
	if r.CurrentStep != 3 {
		t.Fatalf("CurrentStep = %d, want 3", r.CurrentStep)
	}
	for i := 0; i < 3; i++ {
		s := m.step("run-happy", i)
		if s == nil || s.Status != model.StepStatusOK {
			t.Fatalf("step %d not OK: %+v", i, s)
		}
		if exec.callCount(i) != 1 {
			t.Fatalf("step %d executed %d times, want exactly 1 (idempotent)", i, exec.callCount(i))
		}
	}
	// Step 1's output was merged into run variables for later reference.
	steps, _ := r.Variables["steps"].(map[string]any)
	if steps == nil || steps["1"] == nil {
		t.Fatalf("step output not merged into variables: %+v", r.Variables)
	}
	if !sink.has(eventRunStarted) || !sink.has(eventRunCompleted) {
		t.Fatalf("missing lifecycle events: %v", sink.events)
	}
	if sink.count(eventRunStepCompleted) != 3 {
		t.Fatalf("step.completed events = %d, want 3", sink.count(eventRunStepCompleted))
	}
}

func TestOrchestrator_ApprovalGate_PausesUntilApprove(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0), gateStep(1, 1, 0, model.TimeoutActionEscalate), actionStep(2))
	seedRun(m, "run-gate")
	exec := newFakeExecutor()
	sink := &recordingSink{}
	o := newOrchestrator(t, m, exec, sink, 3)

	// Drive until the run parks on the gate.
	driveToQuiescence(t, o, m, "run-gate", 20)
	r := m.run("run-gate")
	if r.Status != model.RunStatusAwaitingApproval {
		t.Fatalf("status = %s, want AWAITING_APPROVAL", r.Status)
	}
	if exec.callCount(2) != 0 {
		t.Fatal("step after gate executed before approval")
	}
	g := m.gate("run-gate", 1)
	if g == nil || g.Status != model.GateStatusOpen {
		t.Fatalf("gate not OPEN: %+v", g)
	}

	// The claim query must NOT pick up a parked run.
	claimed, err := m.SystemClaimRunnableRuns(context.Background(), nil, 10)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	for _, c := range claimed {
		if c.ID == "run-gate" {
			t.Fatal("parked AWAITING_APPROVAL run was claimed by the driver — gate auto-advanced")
		}
	}

	// Approve the gate (request path, tenant tx).
	gs, err := NewGateService(GateServiceConfig{Repository: repoAdapter{m}, Events: sink, Now: func() time.Time { return time.Now().UTC() }})
	if err != nil {
		t.Fatalf("NewGateService: %v", err)
	}
	if _, err := gs.ApproveGate(context.Background(), nil, tnt, "run-gate", 1,
		model.Decision{UserID: "u1", Approved: true}); err != nil {
		t.Fatalf("ApproveGate: %v", err)
	}
	if got := m.run("run-gate").Status; got != model.RunStatusRunning {
		t.Fatalf("after approve status = %s, want RUNNING (re-armed)", got)
	}

	// Now the driver picks it up again and completes.
	driveToQuiescence(t, o, m, "run-gate", 20)
	r = m.run("run-gate")
	if r.Status != model.RunStatusCompleted {
		t.Fatalf("after approval status = %s, want COMPLETED", r.Status)
	}
	if exec.callCount(2) != 1 {
		t.Fatalf("post-gate step executed %d times, want 1", exec.callCount(2))
	}
	gate := m.gate("run-gate", 1)
	if gate.Status != model.GateStatusApproved {
		t.Fatalf("gate status = %s, want APPROVED", gate.Status)
	}
	if !sink.has(eventRunAwaitingApprov) || !sink.has(eventRunApproved) {
		t.Fatalf("missing gate events: %v", sink.events)
	}
}

func TestOrchestrator_GateRejection_FailsRun(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 1, 0, model.TimeoutActionEscalate), actionStep(1))
	seedRun(m, "run-reject")
	exec := newFakeExecutor()
	sink := &recordingSink{}
	o := newOrchestrator(t, m, exec, sink, 3)
	driveToQuiescence(t, o, m, "run-reject", 10)

	gs, _ := NewGateService(GateServiceConfig{Repository: repoAdapter{m}, Events: sink})
	if _, err := gs.RejectGate(context.Background(), nil, tnt, "run-reject", 0,
		model.Decision{UserID: "u1", Comment: "unsafe"}); err != nil {
		t.Fatalf("RejectGate: %v", err)
	}
	r := m.run("run-reject")
	if r.Status != model.RunStatusFailed {
		t.Fatalf("status = %s, want FAILED", r.Status)
	}
	if exec.callCount(1) != 0 {
		t.Fatal("post-gate step ran after rejection")
	}
	if m.gate("run-reject", 0).Status != model.GateStatusRejected {
		t.Fatal("gate not REJECTED")
	}
	if !sink.has(eventRunRejected) {
		t.Fatalf("missing rejected event: %v", sink.events)
	}
}

func TestOrchestrator_Quorum_RequiresMultipleApprovals(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 2, 0, model.TimeoutActionEscalate), actionStep(1))
	seedRun(m, "run-quorum")
	exec := newFakeExecutor()
	sink := &recordingSink{}
	o := newOrchestrator(t, m, exec, sink, 3)
	driveToQuiescence(t, o, m, "run-quorum", 10)

	gs, _ := NewGateService(GateServiceConfig{Repository: repoAdapter{m}, Events: sink})

	// First approval: quorum (2) not met — stays parked.
	if _, err := gs.ApproveGate(context.Background(), nil, tnt, "run-quorum", 0, model.Decision{UserID: "u1", Approved: true}); err != nil {
		t.Fatalf("first approve: %v", err)
	}
	if got := m.run("run-quorum").Status; got != model.RunStatusAwaitingApproval {
		t.Fatalf("after 1/2 approvals status = %s, want still AWAITING_APPROVAL", got)
	}
	if m.gate("run-quorum", 0).Status != model.GateStatusOpen {
		t.Fatal("gate resolved before quorum")
	}

	// Second approval by a different user: quorum met — re-armed.
	if _, err := gs.ApproveGate(context.Background(), nil, tnt, "run-quorum", 0, model.Decision{UserID: "u2", Approved: true}); err != nil {
		t.Fatalf("second approve: %v", err)
	}
	if got := m.run("run-quorum").Status; got != model.RunStatusRunning {
		t.Fatalf("after 2/2 approvals status = %s, want RUNNING", got)
	}
	driveToQuiescence(t, o, m, "run-quorum", 10)
	if m.run("run-quorum").Status != model.RunStatusCompleted {
		t.Fatalf("run did not complete after quorum: %s", m.run("run-quorum").Status)
	}
}

func TestOrchestrator_DuplicateApproverVote_DoesNotDoubleCount(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 2, 0, model.TimeoutActionEscalate))
	seedRun(m, "run-dup")
	o := newOrchestrator(t, m, newFakeExecutor(), &recordingSink{}, 3)
	driveToQuiescence(t, o, m, "run-dup", 10)

	gs, _ := NewGateService(GateServiceConfig{Repository: repoAdapter{m}})
	if _, err := gs.ApproveGate(context.Background(), nil, tnt, "run-dup", 0, model.Decision{UserID: "u1", Approved: true}); err != nil {
		t.Fatalf("approve 1: %v", err)
	}
	// Same user votes again — must not satisfy quorum 2.
	if _, err := gs.ApproveGate(context.Background(), nil, tnt, "run-dup", 0, model.Decision{UserID: "u1", Approved: true}); err != nil {
		t.Fatalf("approve 1 again: %v", err)
	}
	if got := m.run("run-dup").Status; got != model.RunStatusAwaitingApproval {
		t.Fatalf("duplicate vote satisfied quorum: status = %s", got)
	}
	if n := m.gate("run-dup", 0).Approvals(); n != 1 {
		t.Fatalf("approvals = %d, want 1 (duplicate collapsed)", n)
	}
}

func TestOrchestrator_GateTimeout_AbortPolicy(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 1, 1, model.TimeoutActionAbort), actionStep(1))
	seedRun(m, "run-abort")
	o := newOrchestrator(t, m, newFakeExecutor(), &recordingSink{}, 3)
	driveToQuiescence(t, o, m, "run-abort", 10)

	// Force the deadline into the past.
	g := m.gate("run-abort", 0)
	past := time.Now().Add(-time.Minute)
	g.DeadlineAt = &past

	gs, _ := NewGateService(GateServiceConfig{Repository: repoAdapter{m}})
	if err := gs.ApplyTimeout(context.Background(), nil, g, model.TimeoutActionAbort); err != nil {
		t.Fatalf("ApplyTimeout abort: %v", err)
	}
	r := m.run("run-abort")
	if r.Status != model.RunStatusAborted {
		t.Fatalf("status = %s, want ABORTED", r.Status)
	}
	if m.gate("run-abort", 0).Status != model.GateStatusExpired {
		t.Fatal("gate not EXPIRED on abort")
	}
}

func TestOrchestrator_GateTimeout_EscalatePolicy(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 1, 1, model.TimeoutActionEscalate), actionStep(1))
	seedRun(m, "run-esc")
	o := newOrchestrator(t, m, newFakeExecutor(), &recordingSink{}, 3)
	driveToQuiescence(t, o, m, "run-esc", 10)

	g := m.gate("run-esc", 0)
	past := time.Now().Add(-time.Minute)
	g.DeadlineAt = &past

	gs, _ := NewGateService(GateServiceConfig{Repository: repoAdapter{m}})
	if err := gs.ApplyTimeout(context.Background(), nil, g, model.TimeoutActionEscalate); err != nil {
		t.Fatalf("ApplyTimeout escalate: %v", err)
	}
	r := m.run("run-esc")
	if r.Status != model.RunStatusEscalated {
		t.Fatalf("status = %s, want ESCALATED", r.Status)
	}
	gate := m.gate("run-esc", 0)
	if gate.Status != model.GateStatusEscalated {
		t.Fatalf("gate status = %s, want ESCALATED", gate.Status)
	}
	if gate.DeadlineAt != nil {
		t.Fatal("escalated gate should clear its deadline (avoid re-escalation)")
	}

	// An ESCALATED run is NOT runnable — the driver must not claim it.
	claimed, _ := m.SystemClaimRunnableRuns(context.Background(), nil, 10)
	for _, c := range claimed {
		if c.ID == "run-esc" {
			t.Fatal("ESCALATED run was claimed by the driver")
		}
	}

	// A human can still approve an escalated gate, which re-arms the run.
	if _, err := gs.ApproveGate(context.Background(), nil, tnt, "run-esc", 0, model.Decision{UserID: "boss", Approved: true}); err != nil {
		t.Fatalf("approve escalated gate: %v", err)
	}
	if m.run("run-esc").Status != model.RunStatusRunning {
		t.Fatalf("escalated gate approval did not re-arm run: %s", m.run("run-esc").Status)
	}
}

func TestOrchestrator_GateTimeout_AutoApprovePolicy(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, gateStep(0, 1, 1, model.TimeoutActionAutoApprove), actionStep(1))
	seedRun(m, "run-auto")
	exec := newFakeExecutor()
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)
	driveToQuiescence(t, o, m, "run-auto", 10)

	g := m.gate("run-auto", 0)
	past := time.Now().Add(-time.Minute)
	g.DeadlineAt = &past

	gs, _ := NewGateService(GateServiceConfig{Repository: repoAdapter{m}})
	if err := gs.ApplyTimeout(context.Background(), nil, g, model.TimeoutActionAutoApprove); err != nil {
		t.Fatalf("ApplyTimeout auto_approve: %v", err)
	}
	if m.run("run-auto").Status != model.RunStatusRunning {
		t.Fatalf("auto_approve did not re-arm run: %s", m.run("run-auto").Status)
	}
	driveToQuiescence(t, o, m, "run-auto", 10)
	if m.run("run-auto").Status != model.RunStatusCompleted {
		t.Fatalf("auto-approved run did not complete: %s", m.run("run-auto").Status)
	}
	if exec.callCount(1) != 1 {
		t.Fatalf("post-gate step ran %d times after auto-approve, want 1", exec.callCount(1))
	}
}

func TestOrchestrator_ActionError_RetriesThenFails(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0))
	seedRun(m, "run-retry")
	exec := newFakeExecutor()
	exec.failOn[0] = 100 // always fail
	sink := &recordingSink{}
	o := newOrchestrator(t, m, exec, sink, 3) // 3 attempts max

	driveToQuiescence(t, o, m, "run-retry", 20)

	r := m.run("run-retry")
	if r.Status != model.RunStatusFailed {
		t.Fatalf("status = %s, want FAILED", r.Status)
	}
	if exec.callCount(0) != 3 {
		t.Fatalf("action attempted %d times, want exactly MaxAttempts=3", exec.callCount(0))
	}
	s := m.step("run-retry", 0)
	if s.Status != model.StepStatusFailed || s.Attempt != 3 {
		t.Fatalf("final step row = %+v, want FAILED attempt 3", s)
	}
	if !sink.has(eventRunFailed) {
		t.Fatalf("missing run.failed event: %v", sink.events)
	}
}

func TestOrchestrator_ActionError_RetryThenSucceeds(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0), actionStep(1))
	seedRun(m, "run-recover")
	exec := newFakeExecutor()
	exec.failOn[0] = 2 // fail twice, succeed on the 3rd attempt
	o := newOrchestrator(t, m, exec, &recordingSink{}, 5)

	driveToQuiescence(t, o, m, "run-recover", 30)

	r := m.run("run-recover")
	if r.Status != model.RunStatusCompleted {
		t.Fatalf("status = %s, want COMPLETED after retry recovery", r.Status)
	}
	if exec.callCount(0) != 3 {
		t.Fatalf("step 0 attempts = %d, want 3 (2 fails + 1 success)", exec.callCount(0))
	}
	if exec.callCount(1) != 1 {
		t.Fatalf("step 1 attempts = %d, want 1", exec.callCount(1))
	}
}

func TestOrchestrator_Restart_ReadvancingCompletedRunIsNoop(t *testing.T) {
	// Driving an all-action runbook (one step per Advance tick, each on its own
	// three-boundary path) completes the run. After completion, a brand-new
	// orchestrator (modelling a process restart) re-derives the run from the
	// store and advancing it again must be a safe no-op that never re-fires any
	// action — the durable-resume guarantee for a finished run.
	m := newMemStore()
	seedRunbook(m, actionStep(0), actionStep(1), actionStep(2))
	seedRun(m, "run-restart")
	exec := newFakeExecutor()
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)

	driveToQuiescence(t, o, m, "run-restart", 20)
	if m.run("run-restart").Status != model.RunStatusCompleted {
		t.Fatalf("run not completed: %s", m.run("run-restart").Status)
	}
	callsAfterFirst := map[int]int{0: exec.callCount(0), 1: exec.callCount(1), 2: exec.callCount(2)}

	// Simulate process restart: brand-new orchestrator, re-derive state from DB.
	// Advancing a COMPLETED run is a no-op (progress=false, no error).
	o2 := newOrchestrator(t, m, exec, &recordingSink{}, 3)
	resumed, _ := m.GetRun(context.Background(), nil, tnt, "run-restart")
	progressed, err := o2.Advance(context.Background(), resumed, directTxRun)
	if err != nil {
		t.Fatalf("resume advance: %v", err)
	}
	if progressed {
		t.Fatal("advancing a COMPLETED run reported progress")
	}
	for i := 0; i < 3; i++ {
		if exec.callCount(i) != callsAfterFirst[i] {
			t.Fatalf("step %d re-executed after restart: was %d now %d", i, callsAfterFirst[i], exec.callCount(i))
		}
		if exec.callCount(i) != 1 {
			t.Fatalf("step %d executed %d times total, want exactly 1", i, exec.callCount(i))
		}
	}
}

func TestOrchestrator_Restart_MidRun_ResumesWithoutReexecutingCommittedStep(t *testing.T) {
	// Model a crash AFTER step 0 committed OK but BEFORE step 1 ran, by manually
	// seeding the store to that exact durable state, then letting a fresh
	// orchestrator resume. The committed step 0 must NOT be re-executed.
	m := newMemStore()
	seedRunbook(m, actionStep(0), actionStep(1))
	r := seedRun(m, "run-mid")
	r.Status = model.RunStatusRunning
	r.CurrentStep = 0
	// Durable step-0 OK row already committed in a prior (crashed) process.
	_ = m.EnsureRunStep(context.Background(), tnt, &model.RunStep{
		RunID: "run-mid", Index: 0, Action: actionStep(0).Action,
		Status: model.StepStatusOK, Attempt: 1, StartedAt: time.Now().Add(-time.Minute),
	})

	exec := newFakeExecutor()
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)
	driveToQuiescence(t, o, m, "run-mid", 20)

	if exec.callCount(0) != 0 {
		t.Fatalf("committed step 0 was re-executed on resume (%d calls)", exec.callCount(0))
	}
	if exec.callCount(1) != 1 {
		t.Fatalf("step 1 executed %d times, want 1", exec.callCount(1))
	}
	if m.run("run-mid").Status != model.RunStatusCompleted {
		t.Fatalf("resumed run did not complete: %s", m.run("run-mid").Status)
	}
}

func TestOrchestrator_TerminalRun_AdvanceIsNoop(t *testing.T) {
	m := newMemStore()
	seedRunbook(m, actionStep(0))
	r := seedRun(m, "run-term")
	r.Status = model.RunStatusCompleted
	exec := newFakeExecutor()
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)
	resumed, _ := m.GetRun(context.Background(), nil, tnt, "run-term")
	progressed, err := o.Advance(context.Background(), resumed, directTxRun)
	if err != nil {
		t.Fatalf("advancing terminal run should be a no-op, got %v", err)
	}
	if progressed {
		t.Fatal("advancing a terminal run reported progress")
	}
	if exec.callCount(0) != 0 {
		t.Fatal("terminal run executed an action")
	}
}

// trackingTxRun is an in-memory transaction runner that exposes whether a
// transaction is currently OPEN (between this runner's begin and commit). It lets
// a test prove that the orchestrator invokes the ActionExecutor strictly OUTSIDE
// any DB transaction (the §4.6 integrate-phase / auditor-flagged contract): while
// any fn passed to this runner is executing, txOpen is true; Execute must observe
// it false.
type trackingTxRun struct {
	mu       sync.Mutex
	open     int  // depth of currently-open transactions (must be 0 during Execute)
	everOpen bool // a transaction was opened at least once (sanity)
	maxDepth int  // the maximum nesting observed (must stay 1 — no nested txns)
}

func (r *trackingTxRun) run() txRunner {
	return func(_ context.Context, fn func(db repository.DBTX) error) error {
		r.mu.Lock()
		r.open++
		r.everOpen = true
		if r.open > r.maxDepth {
			r.maxDepth = r.open
		}
		r.mu.Unlock()
		err := fn(nil)
		r.mu.Lock()
		r.open--
		r.mu.Unlock()
		return err
	}
}

func (r *trackingTxRun) isOpen() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.open > 0
}

// txAssertingExecutor asserts, at the moment Execute is called, that NO DB
// transaction is open (the orchestrator must have committed the prepare tx and
// not yet opened the persist tx). It records a violation the test fails on. It
// also confirms it could open its OWN transaction during Execute — modelling a
// real executor that reaches its target with its own connection — which a held
// advance tx would deadlock against.
type txAssertingExecutor struct {
	tracker     *trackingTxRun
	mu          sync.Mutex
	calls       int
	openDuring  int // times a tx was observed OPEN during Execute (must be 0)
	ownTxOpened int // times the executor opened its own tx during Execute
}

func (e *txAssertingExecutor) Execute(ctx context.Context, step *model.RunStep) (Output, error) {
	e.mu.Lock()
	e.calls++
	if e.tracker.isOpen() {
		e.openDuring++
	}
	e.mu.Unlock()
	// An executor must be free to open its own transaction during Execute (e.g. a
	// target that records idempotency in its own DB). A still-held advance tx
	// would deadlock against it; here it must succeed cleanly.
	_ = e.tracker.run()(ctx, func(repository.DBTX) error {
		e.mu.Lock()
		e.ownTxOpened++
		e.mu.Unlock()
		return nil
	})
	return Output{Data: map[string]any{"executed_outside_tx": true, "step": step.Index}}, nil
}

func TestOrchestrator_Execute_RunsOutsideAnyTransaction(t *testing.T) {
	// The auditor-flagged correctness guarantee: ActionExecutor.Execute must run
	// OUTSIDE the advance DB transaction. The orchestrator claims the runnable
	// step in a short prepare tx (committed), then calls Execute with NO tx open,
	// then persists the result + outbox event in a SECOND short tx. A tx rollback
	// must never be able to un-send an external action.
	m := newMemStore()
	seedRunbook(m, actionStep(0), actionStep(1))
	seedRun(m, "run-notx")
	tracker := &trackingTxRun{}
	exec := &txAssertingExecutor{tracker: tracker}
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)

	// Drive to completion, each tick re-deriving the run as the loop would, using
	// the tracking runner so the executor can observe the open/closed tx state.
	for i := 0; i < 20; i++ {
		r := m.run("run-notx")
		if r.IsTerminal() {
			break
		}
		claimed, err := m.GetRun(context.Background(), nil, tnt, "run-notx")
		if err != nil {
			t.Fatalf("re-deriving run: %v", err)
		}
		if _, err := o.Advance(context.Background(), claimed, tracker.run()); err != nil {
			if IsRecordedFailure(err) {
				break
			}
			t.Fatalf("advance tick %d: %v", i, err)
		}
	}

	if m.run("run-notx").Status != model.RunStatusCompleted {
		t.Fatalf("run did not complete: %s", m.run("run-notx").Status)
	}
	if exec.calls != 2 {
		t.Fatalf("executor called %d times, want 2 (one per action step)", exec.calls)
	}
	if exec.openDuring != 0 {
		t.Fatalf("Execute observed an OPEN advance transaction %d time(s) — Execute must run OUTSIDE any tx", exec.openDuring)
	}
	if exec.ownTxOpened != 2 {
		t.Fatalf("executor opened its own tx %d time(s), want 2 (proving no advance tx was held during Execute)", exec.ownTxOpened)
	}
	if !tracker.everOpen {
		t.Fatal("no transaction was ever opened — the orchestrator must persist in a transaction")
	}
	if tracker.maxDepth != 1 {
		t.Fatalf("max observed transaction nesting depth = %d, want 1 (no tx is held open across Execute)", tracker.maxDepth)
	}
}

// rollbackTrackingTxRun is a transaction runner that rolls back (discards
// mutations) the FIRST persist transaction it sees AFTER an Execute has run, to
// prove a rollback can never un-send an external action: the executor is still
// re-invoked on the retry (the action target's idempotency, not the DB tx,
// guards against a double external effect) and the recorded step result then
// commits.
type countingExecutor struct {
	mu    sync.Mutex
	calls int
}

func (e *countingExecutor) Execute(_ context.Context, step *model.RunStep) (Output, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.calls++
	return Output{Data: map[string]any{"call": e.calls, "step": step.Index}}, nil
}

func (e *countingExecutor) count() int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls
}

func TestOrchestrator_PersistRollbackAfterExecute_RetriesWithoutLosingProgress(t *testing.T) {
	// If the PERSIST tx rolls back AFTER Execute committed externally, the run is
	// left RUNNING with no committed OK step; the next claim re-attempts. The
	// external action was already sent (Execute ran outside the tx); the run's
	// idempotency relies on the action target being safe to call twice, NOT on the
	// tx un-sending it. Here we prove the rollback leaves the run re-claimable and
	// the run still completes.
	m := newMemStore()
	seedRunbook(m, actionStep(0))
	seedRun(m, "run-rb")
	exec := &countingExecutor{}
	o := newOrchestrator(t, m, exec, &recordingSink{}, 3)

	// First tick: PENDING -> RUNNING (start), in its own tx. No Execute yet.
	claimed, _ := m.GetRun(context.Background(), nil, tnt, "run-rb")
	if _, err := o.Advance(context.Background(), claimed, directTxRun); err != nil {
		t.Fatalf("start advance: %v", err)
	}

	// Second tick: prepare tx commits (step RUNNING), Execute runs OUTSIDE tx, but
	// the PERSIST tx rolls back. We model that by snapshotting the store and
	// restoring it when the persist fn returns — but the prepare tx already
	// committed (separate runner call), so the RUNNING step row survives.
	persistTickCount := 0
	rbRun := func(_ context.Context, fn func(db repository.DBTX) error) error {
		persistTickCount++
		// The FIRST tx of this tick is the read (resolve step); the SECOND is the
		// prepare tx (commit the RUNNING row); the THIRD is the persist tx (roll
		// back exactly once to model a crash between Execute and commit).
		if persistTickCount == 3 {
			snap := m.snapshot()
			_ = fn(nil)
			m.restore(snap) // discard the persist mutations (rollback)
			return errors.New("simulated persist rollback after Execute")
		}
		return fn(nil)
	}
	claimed, _ = m.GetRun(context.Background(), nil, tnt, "run-rb")
	if _, err := o.Advance(context.Background(), claimed, rbRun); err == nil {
		t.Fatal("expected the simulated persist rollback to surface an error")
	}
	if exec.count() != 1 {
		t.Fatalf("Execute called %d times before rollback, want 1", exec.count())
	}
	// The run is still RUNNING (persist rolled back) and re-claimable.
	if got := m.run("run-rb").Status; got != model.RunStatusRunning {
		t.Fatalf("after persist rollback status = %s, want RUNNING (re-claimable)", got)
	}

	// Next ticks: the run re-attempts and completes. Execute is invoked again
	// (the retry) — the action target's own idempotency, not the DB tx, guards
	// against a double external effect.
	driveToQuiescence(t, o, m, "run-rb", 10)
	if m.run("run-rb").Status != model.RunStatusCompleted {
		t.Fatalf("run did not complete after retry: %s", m.run("run-rb").Status)
	}
	if exec.count() < 2 {
		t.Fatalf("Execute called %d times total, want >= 2 (retry after rollback re-invokes the executor)", exec.count())
	}
}
