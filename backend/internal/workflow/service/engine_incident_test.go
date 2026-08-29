package service

import (
	"context"
	"encoding/json"
	"errors"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// This file pins GAP 4 — the incident + dead-letter model with governed operator
// intervention. It builds on the durable-execution substrate in
// engine_durable_test.go (the durableInstanceRepo double + countingExecutor +
// durableDefRepo) and adds an incidentTestStore double that faithfully models the
// production IncidentRepository's atomicity + the maker-checker SQL guard.

// incidentTestStore is an in-memory incidentStore that models the production
// repository closely enough to exercise the engine's incident logic: the atomic
// raise re-checks the instance lock_version (via the shared durableInstanceRepo),
// the partial-unique open-incident invariant, and the ApproveOverride
// requested_by <> approver fail-closed guard.
type incidentTestStore struct {
	mu        sync.Mutex
	repo      *durableInstanceRepo // shared instance state for the atomic raise
	incidents map[string]*model.Incident
	overrides map[string]*model.IncidentOverride
	deadLett  []*model.DeadLetter
	seq       int
}

func newIncidentTestStore(repo *durableInstanceRepo) *incidentTestStore {
	return &incidentTestStore{
		repo:      repo,
		incidents: map[string]*model.Incident{},
		overrides: map[string]*model.IncidentOverride{},
	}
}

func (s *incidentTestStore) nextID(prefix string) string {
	s.seq++
	return prefix + "-" + time.Now().Format("150405.000000") + "-" + strconv.Itoa(s.seq)
}

func (s *incidentTestStore) RaiseIncidentAtomic(_ context.Context, inst *model.WorkflowInstance, inc *model.Incident) error {
	// Model the atomic raise: update the shared instance under its optimistic lock
	// FIRST (so a lock conflict aborts the whole raise, writing no incident), then
	// insert the incident honouring the open-per-step invariant.
	s.mu.Lock()
	defer s.mu.Unlock()

	// Idempotent open-incident invariant: reuse an existing open incident.
	for _, existing := range s.incidents {
		if existing.InstanceID == inst.ID && existing.StepID == inc.StepID && existing.Status == model.IncidentStatusOpen {
			// Still apply the instance transition (parked) under the lock.
			if err := s.repo.UpdateWithLock(context.Background(), inst); err != nil {
				return err
			}
			*inc = *existing
			return nil
		}
	}

	if err := s.repo.UpdateWithLock(context.Background(), inst); err != nil {
		return err // lock conflict -> no incident written (torn-state guard)
	}

	inc.ID = s.nextID("inc")
	inc.Status = model.IncidentStatusOpen
	inc.CreatedAt = time.Now().UTC()
	inc.UpdatedAt = inc.CreatedAt
	cp := *inc
	s.incidents[inc.ID] = &cp
	return nil
}

func (s *incidentTestStore) GetOpenByInstance(_ context.Context, tenantID, instanceID string) (*model.Incident, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, inc := range s.incidents {
		if inc.TenantID == tenantID && inc.InstanceID == instanceID && inc.Status == model.IncidentStatusOpen {
			cp := *inc
			return &cp, nil
		}
	}
	return nil, model.ErrNotFound
}

func (s *incidentTestStore) GetByID(_ context.Context, tenantID, id string) (*model.Incident, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if inc, ok := s.incidents[id]; ok && inc.TenantID == tenantID {
		cp := *inc
		return &cp, nil
	}
	return nil, model.ErrNotFound
}

func (s *incidentTestStore) ListByInstance(_ context.Context, tenantID, instanceID string) ([]*model.Incident, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*model.Incident
	for _, inc := range s.incidents {
		if inc.TenantID == tenantID && inc.InstanceID == instanceID {
			cp := *inc
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (s *incidentTestStore) ResolveIncident(_ context.Context, id, resolvedBy, kind string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	inc, ok := s.incidents[id]
	if !ok || inc.Status != model.IncidentStatusOpen {
		return model.ErrNoOpenIncident
	}
	inc.Status = model.IncidentStatusResolved
	inc.ResolvedBy = &resolvedBy
	inc.ResolutionKind = &kind
	now := time.Now().UTC()
	inc.ResolvedAt = &now
	return nil
}

func (s *incidentTestStore) MarkIncidentDeadLettered(_ context.Context, id, resolvedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	inc, ok := s.incidents[id]
	if !ok || inc.Status != model.IncidentStatusOpen {
		return model.ErrNoOpenIncident
	}
	inc.Status = model.IncidentStatusDeadLettered
	inc.ResolvedBy = &resolvedBy
	kind := model.IncidentResolutionDeadLetter
	inc.ResolutionKind = &kind
	return nil
}

func (s *incidentTestStore) CreateOverride(_ context.Context, ov *model.IncidentOverride) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ov.ID = s.nextID("ov")
	ov.Status = model.OverrideStatusPending
	ov.CreatedAt = time.Now().UTC()
	ov.UpdatedAt = ov.CreatedAt
	cp := *ov
	s.overrides[ov.ID] = &cp
	return nil
}

func (s *incidentTestStore) GetOverride(_ context.Context, tenantID, id string) (*model.IncidentOverride, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if ov, ok := s.overrides[id]; ok && ov.TenantID == tenantID {
		cp := *ov
		return &cp, nil
	}
	return nil, model.ErrNotFound
}

// ApproveOverride models the production SQL guard: the UPDATE only affects a row
// when it is still pending AND requested_by <> approver, so a same-actor approval
// affects zero rows -> ErrOverrideNotPending (fail-closed). The engine's own
// distinct-actor check should catch same-actor first, but this belt-and-suspenders
// guard mirrors production.
func (s *incidentTestStore) ApproveOverride(_ context.Context, id, approvedBy string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ov, ok := s.overrides[id]
	if !ok || ov.Status != model.OverrideStatusPending || ov.RequestedBy == approvedBy {
		return model.ErrOverrideNotPending
	}
	ov.Status = model.OverrideStatusApproved
	ov.ApprovedBy = &approvedBy
	now := time.Now().UTC()
	ov.ApprovedAt = &now
	return nil
}

func (s *incidentTestStore) RejectOverride(_ context.Context, id, rejectedBy, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ov, ok := s.overrides[id]
	if !ok || ov.Status != model.OverrideStatusPending {
		return model.ErrOverrideNotPending
	}
	ov.Status = model.OverrideStatusRejected
	ov.RejectedBy = &rejectedBy
	ov.RejectReason = &reason
	return nil
}

func (s *incidentTestStore) CreateDeadLetter(_ context.Context, dl *model.DeadLetter) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	dl.ID = s.nextID("dl")
	dl.CreatedAt = time.Now().UTC()
	cp := *dl
	s.deadLett = append(s.deadLett, &cp)
	return nil
}

func (s *incidentTestStore) ListDeadLetter(_ context.Context, tenantID string, _ int) ([]*model.DeadLetter, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []*model.DeadLetter
	for _, dl := range s.deadLett {
		if dl.TenantID == tenantID {
			cp := *dl
			out = append(out, &cp)
		}
	}
	return out, nil
}

var _ incidentStore = (*incidentTestStore)(nil)

// flakyExecutor fails a target step until a switch is flipped, then succeeds.
type flakyExecutor struct {
	mu        sync.Mutex
	failStep  string
	failUntil bool // while true, failStep returns an error
	calls     map[string]int
}

func newFlakyExecutor(failStep string) *flakyExecutor {
	return &flakyExecutor{failStep: failStep, failUntil: true, calls: map[string]int{}}
}

func (e *flakyExecutor) heal() {
	e.mu.Lock()
	e.failUntil = false
	e.mu.Unlock()
}

func (e *flakyExecutor) Execute(_ context.Context, _ *model.WorkflowInstance, step *model.StepDefinition, _ *model.StepExecution) (*executor.ExecutionResult, error) {
	e.mu.Lock()
	e.calls[step.ID]++
	failing := e.failUntil && step.ID == e.failStep
	e.mu.Unlock()
	if failing {
		return nil, errors.New("flaky boom")
	}
	return &executor.ExecutionResult{Output: map[string]interface{}{"ok": true}}, nil
}

func (e *flakyExecutor) callsFor(step string) int {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.calls[step]
}

// incidentDef builds s1(service_task, fails, max_retries=1) -> s2 -> end so retry
// exhaustion on s1 raises an incident.
func incidentDef() *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:       "def-inc",
		TenantID: "tenant-inc",
		Status:   model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{ID: "s1", Type: model.StepTypeServiceTask, Name: "S1", Config: map[string]interface{}{"max_retries": 1}, Transitions: []model.Transition{{Target: "s2"}}},
			{ID: "s2", Type: model.StepTypeCondition, Name: "S2", Config: map[string]interface{}{}, Transitions: []model.Transition{{Target: "end"}}},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

func incidentInstance() *model.WorkflowInstance {
	first := "s1"
	return &model.WorkflowInstance{
		ID:            "inst-inc",
		TenantID:      "tenant-inc",
		DefinitionID:  "def-inc",
		DefinitionVer: 1,
		Status:        model.InstanceStatusRunning,
		CurrentStepID: &first,
		Variables:     map[string]interface{}{"amount": 100},
		StepOutputs:   map[string]interface{}{},
		StartedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
		LockVersion:   0,
	}
}

func newIncidentEngine(repo *durableInstanceRepo, def *model.WorkflowDefinition, exe executorRegistry) (*EngineService, *incidentTestStore) {
	store := newIncidentTestStore(repo)
	eng := NewEngineService(repo, &durableDefRepo{def: def}, newRecordingTaskRepo(), exe, nil, zerolog.Nop()).WithIncidentStore(store)
	return eng, store
}

// TestRetryExhaustion_RaisesIncidentNotFailInstance proves GAP 4: when a step's
// retries are exhausted and an incident store is wired, the engine raises an
// incident that PARKS the failed step (instance status 'incident', NOT 'failed'),
// leaving the instance resolvable rather than terminated.
func TestRetryExhaustion_RaisesIncidentNotFailInstance(t *testing.T) {
	def := incidentDef()
	repo := newDurableInstanceRepo(incidentInstance())
	exe := newFlakyExecutor("s1")
	eng, store := newIncidentEngine(repo, def, exe)

	if err := eng.executeStep(context.Background(), mustInst(repo), def, "s1"); err != nil {
		t.Fatalf("executeStep returned error (should raise incident, not error): %v", err)
	}

	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusIncident {
		t.Fatalf("instance status = %s, want %s (parked, not failed)", inst.Status, model.InstanceStatusIncident)
	}
	if inst.Status == model.InstanceStatusFailed {
		t.Fatal("instance must NOT be failed — the whole instance was destroyed on retry exhaustion")
	}

	inc, err := store.GetOpenByInstance(context.Background(), "tenant-inc", "inst-inc")
	if err != nil {
		t.Fatalf("expected an open incident, got err: %v", err)
	}
	if inc.StepID != "s1" || inc.ErrorMessage == "" {
		t.Fatalf("incident did not capture the failure context: %+v", inc)
	}
}

// TestOperatorRetry_ResumesInstance proves an operator retry on an incident
// re-runs the failed step and, once the transient fault clears, the instance
// resumes and completes.
func TestOperatorRetry_ResumesInstance(t *testing.T) {
	def := incidentDef()
	repo := newDurableInstanceRepo(incidentInstance())
	exe := newFlakyExecutor("s1")
	eng, _ := newIncidentEngine(repo, def, exe)

	// Drive s1 to retry exhaustion -> incident.
	_ = eng.executeStep(context.Background(), mustInst(repo), def, "s1")
	if got, _ := repo.snapshot(); got.Status != model.InstanceStatusIncident {
		t.Fatalf("precondition: expected incident, got %s", got.Status)
	}

	// Heal the fault, then operator retries.
	exe.heal()
	if err := eng.RetryIncident(context.Background(), "tenant-inc", "inst-inc", "operator-1"); err != nil {
		t.Fatalf("RetryIncident error = %v", err)
	}

	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusCompleted {
		t.Fatalf("after operator retry, instance status = %s, want completed", inst.Status)
	}
}

// TestOperatorSkip_AdvancesPastFailedStep proves an approved maker-checker skip
// marks the failed step done and advances the workflow to completion.
func TestOperatorSkip_AdvancesPastFailedStep(t *testing.T) {
	def := incidentDef()
	repo := newDurableInstanceRepo(incidentInstance())
	exe := newFlakyExecutor("s1") // stays broken; skip must not re-run s1
	eng, store := newIncidentEngine(repo, def, exe)

	_ = eng.executeStep(context.Background(), mustInst(repo), def, "s1")
	if got, _ := repo.snapshot(); got.Status != model.InstanceStatusIncident {
		t.Fatalf("precondition: expected incident, got %s", got.Status)
	}

	// Maker requests a skip override; distinct checker approves.
	ov, err := eng.RequestOverride(context.Background(), "tenant-inc", "inst-inc", "maker-1", model.IncidentResolutionSkip, "known-bad step", nil)
	if err != nil {
		t.Fatalf("RequestOverride error = %v", err)
	}
	if _, err := eng.ApproveOverride(context.Background(), "tenant-inc", ov.ID, "checker-2"); err != nil {
		t.Fatalf("ApproveOverride (distinct) error = %v", err)
	}

	callsBefore := exe.callsFor("s1")
	if err := eng.SkipIncidentStep(context.Background(), "tenant-inc", "inst-inc", "operator-1", ov.ID); err != nil {
		t.Fatalf("SkipIncidentStep error = %v", err)
	}

	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusCompleted {
		t.Fatalf("after skip, instance status = %s, want completed", inst.Status)
	}
	if exe.callsFor("s1") != callsBefore {
		t.Fatalf("skip must NOT re-execute s1: calls before=%d after=%d", callsBefore, exe.callsFor("s1"))
	}
	// The incident must be resolved.
	if _, err := store.GetOpenByInstance(context.Background(), "tenant-inc", "inst-inc"); !errors.Is(err, model.ErrNotFound) {
		t.Fatalf("expected no open incident after skip, err=%v", err)
	}
}

// TestMakerChecker_RejectsSameActorApproval proves the fail-closed
// separation-of-duties guard: the operator who REQUESTED a sensitive override
// cannot also APPROVE it. It also proves the sensitive action cannot proceed on a
// still-pending override.
func TestMakerChecker_RejectsSameActorApproval(t *testing.T) {
	def := incidentDef()
	repo := newDurableInstanceRepo(incidentInstance())
	exe := newFlakyExecutor("s1")
	eng, _ := newIncidentEngine(repo, def, exe)

	_ = eng.executeStep(context.Background(), mustInst(repo), def, "s1")

	ov, err := eng.RequestOverride(context.Background(), "tenant-inc", "inst-inc", "same-actor", model.IncidentResolutionSkip, "reason", nil)
	if err != nil {
		t.Fatalf("RequestOverride error = %v", err)
	}

	// Same actor tries to approve -> must be rejected fail-closed.
	if _, err := eng.ApproveOverride(context.Background(), "tenant-inc", ov.ID, "same-actor"); !errors.Is(err, model.ErrSameActorOverride) {
		t.Fatalf("same-actor approval must fail with ErrSameActorOverride, got: %v", err)
	}

	// Because approval was refused, the skip must be blocked (override still pending
	// / not approved) -> ErrOverrideRequired, fail-closed.
	if err := eng.SkipIncidentStep(context.Background(), "tenant-inc", "inst-inc", "same-actor", ov.ID); !errors.Is(err, model.ErrOverrideRequired) {
		t.Fatalf("skip with an un-approved override must fail-closed with ErrOverrideRequired, got: %v", err)
	}

	// The instance must remain parked on the incident (not advanced, not failed).
	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusIncident {
		t.Fatalf("instance status = %s, want still %s (SoD blocked the override)", inst.Status, model.InstanceStatusIncident)
	}
}

// TestModifyVariablesRetry_AppliesApprovedChange proves the modify-variables
// override applies the approved new values (audited as old/new on the override)
// before the retry.
func TestModifyVariablesRetry_AppliesApprovedChange(t *testing.T) {
	def := incidentDef()
	repo := newDurableInstanceRepo(incidentInstance())
	exe := newFlakyExecutor("s1")
	eng, store := newIncidentEngine(repo, def, exe)

	_ = eng.executeStep(context.Background(), mustInst(repo), def, "s1")

	ov, err := eng.RequestOverride(context.Background(), "tenant-inc", "inst-inc", "maker-1", model.IncidentResolutionModifyRetry, "bump amount", map[string]interface{}{"amount": 999})
	if err != nil {
		t.Fatalf("RequestOverride error = %v", err)
	}
	// old_variables must have captured the pre-change value for audit.
	var oldVars map[string]interface{}
	_ = json.Unmarshal(ov.OldVariables, &oldVars)
	if oldVars["amount"] == nil {
		t.Fatalf("override did not capture old_variables for audit: %s", string(ov.OldVariables))
	}

	if _, err := eng.ApproveOverride(context.Background(), "tenant-inc", ov.ID, "checker-2"); err != nil {
		t.Fatalf("ApproveOverride error = %v", err)
	}
	exe.heal()
	if err := eng.ModifyVariablesAndRetryIncident(context.Background(), "tenant-inc", "inst-inc", "operator-1", ov.ID); err != nil {
		t.Fatalf("ModifyVariablesAndRetryIncident error = %v", err)
	}

	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusCompleted {
		t.Fatalf("after modify-retry, status = %s, want completed", inst.Status)
	}
	if got := inst.Variables["amount"]; !numEq(got, 999) {
		t.Fatalf("variable amount = %v, want 999 (approved change applied)", got)
	}
	_ = store
}

// TestAbandonIncident_DeadLetterCapture proves an operator abandon writes a
// dead-letter row with replay context (definition pin + snapshot) and fails the
// instance.
func TestAbandonIncident_DeadLetterCapture(t *testing.T) {
	def := incidentDef()
	repo := newDurableInstanceRepo(incidentInstance())
	exe := newFlakyExecutor("s1")
	eng, store := newIncidentEngine(repo, def, exe)

	_ = eng.executeStep(context.Background(), mustInst(repo), def, "s1")
	if got, _ := repo.snapshot(); got.Status != model.InstanceStatusIncident {
		t.Fatalf("precondition: expected incident, got %s", got.Status)
	}

	if err := eng.AbandonIncident(context.Background(), "tenant-inc", "inst-inc", "operator-1", "unrecoverable"); err != nil {
		t.Fatalf("AbandonIncident error = %v", err)
	}

	dls, err := store.ListDeadLetter(context.Background(), "tenant-inc", 10)
	if err != nil {
		t.Fatalf("ListDeadLetter error = %v", err)
	}
	if len(dls) != 1 {
		t.Fatalf("expected exactly 1 dead-letter row, got %d", len(dls))
	}
	dl := dls[0]
	if dl.Reason != model.DeadLetterReasonAbandoned || dl.StepID != "s1" {
		t.Fatalf("dead-letter context wrong: %+v", dl)
	}
	if dl.DefinitionID != "def-inc" || dl.DefinitionVer != 1 || len(dl.Snapshot) == 0 {
		t.Fatalf("dead-letter must pin definition + snapshot for replay: %+v", dl)
	}
	if dl.AbandonedBy == nil || *dl.AbandonedBy != "operator-1" {
		t.Fatalf("dead-letter must record the abandoning operator: %+v", dl.AbandonedBy)
	}

	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusFailed {
		t.Fatalf("after abandon, instance status = %s, want failed", inst.Status)
	}
}

// TestLegacyNoIncidentStore_FailsInstance proves backward compatibility: with NO
// incident store wired the engine keeps the historical behaviour — retry
// exhaustion fails the whole instance.
func TestLegacyNoIncidentStore_FailsInstance(t *testing.T) {
	def := incidentDef()
	repo := newDurableInstanceRepo(incidentInstance())
	exe := newFlakyExecutor("s1")
	// NOTE: no WithIncidentStore -> legacy path.
	eng := NewEngineService(repo, &durableDefRepo{def: def}, newRecordingTaskRepo(), exe, nil, zerolog.Nop())

	if err := eng.executeStep(context.Background(), mustInst(repo), def, "s1"); err != nil {
		t.Fatalf("executeStep error = %v", err)
	}
	inst, _ := repo.snapshot()
	if inst.Status != model.InstanceStatusFailed {
		t.Fatalf("legacy (no incident store): instance status = %s, want failed", inst.Status)
	}
}

// numEq compares a JSON-decoded number (float64) or an int to an expected int.
func numEq(got interface{}, want int) bool {
	switch v := got.(type) {
	case int:
		return v == want
	case int64:
		return int(v) == want
	case float64:
		return int(v) == want
	default:
		return false
	}
}
