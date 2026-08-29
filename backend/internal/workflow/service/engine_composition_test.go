package service

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// This file proves the two BPMN composition step types on the existing durable
// park/resume engine:
//
//   * call_activity  — a parent step starts a CHILD instance, parks the parent,
//     and resumes + maps the child's output back when the child completes; a
//     child failure surfaces to the parent step.
//   * multi_instance — a parent step fans out N children over a 3-element
//     collection and completes under all / any / n_of_m.
//
// It drives the REAL CallActivityExecutor / MultiInstanceExecutor wired to the
// REAL EngineService (as their ChildStarter), a real in-memory fan-in ledger,
// and a multi-instance-capable instance + definition store — so the whole
// park/resume/fan-in path is exercised, not mocked.

const compTenant = "tenant-composition"
const compUser = "user-composition"

// ---------------------------------------------------------------------------
// Multi-instance-capable test doubles (parent + children are distinct instances)
// ---------------------------------------------------------------------------

// multiInstanceRepo stores an arbitrary number of instances keyed by id and
// implements the durable-execution capabilities (stepCommitter + serializer) so
// the engine takes its production transactional path.
type multiInstanceRepo struct {
	mu         sync.Mutex
	instances  map[string]*model.WorkflowInstance
	executions []*model.StepExecution
}

func newMultiInstanceRepo() *multiInstanceRepo {
	return &multiInstanceRepo{instances: map[string]*model.WorkflowInstance{}}
}

func (r *multiInstanceRepo) Create(_ context.Context, inst *model.WorkflowInstance) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if inst.ID == "" {
		inst.ID = generateUUID()
	}
	cp := *inst
	r.instances[inst.ID] = &cp
	return nil
}

func (r *multiInstanceRepo) GetByID(_ context.Context, _, id string) (*model.WorkflowInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.instances[id]
	if !ok {
		return nil, model.ErrNotFound
	}
	cp := *inst
	return &cp, nil
}

func (r *multiInstanceRepo) UpdateWithLock(_ context.Context, inst *model.WorkflowInstance) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, ok := r.instances[inst.ID]
	if !ok {
		return model.ErrNotFound
	}
	if inst.LockVersion != cur.LockVersion {
		return model.ErrConcurrencyConfl
	}
	cp := *inst
	cp.LockVersion = cur.LockVersion + 1
	r.instances[inst.ID] = &cp
	inst.LockVersion = cp.LockVersion
	return nil
}

func (r *multiInstanceRepo) CommitStepTransition(_ context.Context, inst *model.WorkflowInstance, stepExec *model.StepExecution) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cur, ok := r.instances[inst.ID]
	if !ok {
		return model.ErrNotFound
	}
	if inst.LockVersion != cur.LockVersion {
		return model.ErrConcurrencyConfl
	}
	if stepExec != nil {
		stepExec.ID = generateUUID()
		stepExec.CreatedAt = time.Now().UTC()
		cp := *stepExec
		r.executions = append(r.executions, &cp)
	}
	cp := *inst
	cp.LockVersion = cur.LockVersion + 1
	r.instances[inst.ID] = &cp
	inst.LockVersion = cp.LockVersion
	return nil
}

// SerializeInstance uses a per-key mutex map so a parent and its children (which
// live under DIFFERENT keys) do not serialize against one another — otherwise a
// child completing while holding its own lock and then acquiring the parent lock
// would self-deadlock against a global mutex.
var miSerializeLocks = struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}{locks: map[string]*sync.Mutex{}}

func (r *multiInstanceRepo) SerializeInstance(_ context.Context, id string, fn func() error) error {
	miSerializeLocks.mu.Lock()
	m, ok := miSerializeLocks.locks[id]
	if !ok {
		m = &sync.Mutex{}
		miSerializeLocks.locks[id] = m
	}
	miSerializeLocks.mu.Unlock()
	m.Lock()
	defer m.Unlock()
	return fn()
}

func (r *multiInstanceRepo) List(context.Context, string, string, string, string, *time.Time, *time.Time, string, string, int, int) ([]*model.WorkflowInstance, int, error) {
	return nil, 0, nil
}
func (r *multiInstanceRepo) ListRunning(context.Context, int, int) ([]*model.WorkflowInstance, error) {
	return nil, nil
}
func (r *multiInstanceRepo) CreateStepExecution(_ context.Context, exec *model.StepExecution) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	exec.ID = generateUUID()
	exec.CreatedAt = time.Now().UTC()
	cp := *exec
	r.executions = append(r.executions, &cp)
	return nil
}
func (r *multiInstanceRepo) UpdateStepExecution(_ context.Context, exec *model.StepExecution) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, e := range r.executions {
		if e.ID == exec.ID {
			cp := *exec
			r.executions[i] = &cp
			return nil
		}
	}
	return nil
}
func (r *multiInstanceRepo) GetStepExecutions(_ context.Context, instanceID string) ([]*model.StepExecution, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*model.StepExecution
	for _, e := range r.executions {
		if e.InstanceID == instanceID {
			cp := *e
			out = append(out, &cp)
		}
	}
	return out, nil
}
func (r *multiInstanceRepo) GetLastFailedStep(_ context.Context, instanceID string) (*model.StepExecution, error) {
	return nil, nil
}

func (r *multiInstanceRepo) get(id string) *model.WorkflowInstance {
	r.mu.Lock()
	defer r.mu.Unlock()
	inst, ok := r.instances[id]
	if !ok {
		return nil
	}
	cp := *inst
	return &cp
}

func (r *multiInstanceRepo) count() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.instances)
}

var _ instanceRepo = (*multiInstanceRepo)(nil)
var _ stepCommitter = (*multiInstanceRepo)(nil)
var _ instanceSerializer = (*multiInstanceRepo)(nil)

// compDefRepo stores definitions by id and by definition_key, and implements the
// engine's OPTIONAL childDefinitionResolver (GetActiveByDefinitionKey) so the
// composition step types can resolve their child by key.
type compDefRepo struct {
	byID  map[string]*model.WorkflowDefinition
	byKey map[string]*model.WorkflowDefinition
}

func newCompDefRepo() *compDefRepo {
	return &compDefRepo{byID: map[string]*model.WorkflowDefinition{}, byKey: map[string]*model.WorkflowDefinition{}}
}

func (r *compDefRepo) add(def *model.WorkflowDefinition) {
	cp := *def
	r.byID[def.ID] = &cp
	if def.DefinitionKey != "" {
		r.byKey[def.DefinitionKey] = &cp
	}
}

func (r *compDefRepo) Create(_ context.Context, def *model.WorkflowDefinition) error {
	r.add(def)
	return nil
}
func (r *compDefRepo) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	def, ok := r.byID[id]
	if !ok || (tenantID != "" && def.TenantID != tenantID) {
		return nil, model.ErrNotFound
	}
	cp := *def
	return &cp, nil
}
func (r *compDefRepo) GetActiveByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	def, ok := r.byID[id]
	if !ok || def.TenantID != tenantID || def.Status != model.DefinitionStatusActive {
		return nil, model.ErrNotFound
	}
	cp := *def
	return &cp, nil
}
func (r *compDefRepo) GetActiveByDefinitionKey(_ context.Context, tenantID, key string) (*model.WorkflowDefinition, error) {
	def, ok := r.byKey[key]
	if !ok || def.TenantID != tenantID || def.Status != model.DefinitionStatusActive {
		return nil, model.ErrNotFound
	}
	cp := *def
	return &cp, nil
}
func (r *compDefRepo) List(context.Context, string, string, string, string, string, string, int, int) ([]*model.WorkflowDefinition, int, error) {
	return nil, 0, nil
}
func (r *compDefRepo) ListVersions(context.Context, string, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}
func (r *compDefRepo) Update(_ context.Context, def *model.WorkflowDefinition) error {
	r.add(def)
	return nil
}
func (r *compDefRepo) SoftDelete(context.Context, string, string) error           { return nil }
func (r *compDefRepo) GetMaxVersion(context.Context, string, string) (int, error) { return 1, nil }
func (r *compDefRepo) GetActiveByTriggerTopic(context.Context, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

var _ definitionRepo = (*compDefRepo)(nil)
var _ childDefinitionResolver = (*compDefRepo)(nil)

// memMILedger is an in-memory fan-in ledger implementing the engine's
// miChildLedger seam (and the executor never touches it directly).
type memMILedger struct {
	mu    sync.Mutex
	slots []*model.MIChild
}

func newMemMILedger() *memMILedger { return &memMILedger{} }

func (l *memMILedger) CreateChild(_ context.Context, child *model.MIChild) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	// Idempotent on (parent, step, index).
	for _, s := range l.slots {
		if s.ParentInstanceID == child.ParentInstanceID && s.ParentStepID == child.ParentStepID && s.ChildIndex == child.ChildIndex {
			return nil
		}
	}
	if child.ID == "" {
		child.ID = generateUUID()
	}
	cp := *child
	l.slots = append(l.slots, &cp)
	return nil
}

func (l *memMILedger) MarkChildTerminalByInstance(_ context.Context, childInstanceID, status string, output map[string]interface{}, errMsg *string) (bool, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, s := range l.slots {
		if s.ChildInstanceID != nil && *s.ChildInstanceID == childInstanceID && s.Status == model.MIChildStatusRunning {
			s.Status = status
			s.Output = output
			s.ErrorMessage = errMsg
			return true, nil
		}
	}
	return false, nil
}

func (l *memMILedger) GetChildByInstance(_ context.Context, childInstanceID string) (*model.MIChild, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, s := range l.slots {
		if s.ChildInstanceID != nil && *s.ChildInstanceID == childInstanceID {
			cp := *s
			return &cp, nil
		}
	}
	return nil, model.ErrNotFound
}

func (l *memMILedger) ListChildren(_ context.Context, parentInstanceID, parentStepID string) ([]*model.MIChild, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	var out []*model.MIChild
	for _, s := range l.slots {
		if s.ParentInstanceID == parentInstanceID && s.ParentStepID == parentStepID {
			cp := *s
			out = append(out, &cp)
		}
	}
	return out, nil
}

func (l *memMILedger) AttachChildInstance(_ context.Context, parentInstanceID, parentStepID string, childIndex int, childInstanceID string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, s := range l.slots {
		if s.ParentInstanceID == parentInstanceID && s.ParentStepID == parentStepID && s.ChildIndex == childIndex && s.ChildInstanceID == nil {
			cid := childInstanceID
			s.ChildInstanceID = &cid
		}
	}
	return nil
}

var _ miChildLedger = (*memMILedger)(nil)

// ---------------------------------------------------------------------------
// A leaf executor that dispatches call_activity / multi_instance to the real
// composition executors and handles the leaf step types the child/parent use.
// ---------------------------------------------------------------------------

// compExecutor routes step types to their real executors. call_activity and
// multi_instance are the real composition executors (wired to the engine as their
// child starter, set after engine construction); leaf steps are handled inline.
type compExecutor struct {
	call *executor.CallActivityExecutor
	mi   *executor.MultiInstanceExecutor

	// failStep, when non-empty, makes a service_task with that step ID fail so a
	// child failure can be exercised.
	failStep string
}

func (e *compExecutor) Execute(ctx context.Context, inst *model.WorkflowInstance, step *model.StepDefinition, exec *model.StepExecution) (*executor.ExecutionResult, error) {
	switch step.Type {
	case model.StepTypeCallActivity:
		return e.call.Execute(ctx, inst, step, exec)
	case model.StepTypeMultiInstance:
		return e.mi.Execute(ctx, inst, step, exec)
	case model.StepTypeHumanTask:
		// Park the child on a human task so it stays running after the parent
		// starts — this exercises the PARK (not just the synchronous fast path).
		return nil, executor.ErrParked
	case model.StepTypeServiceTask:
		if e.failStep != "" && step.ID == e.failStep {
			return nil, errors.New("simulated leaf failure")
		}
		// Echo a per-child output derived from the child's variables so the parent
		// can assert on the mapped-back value.
		out := map[string]interface{}{"done": true}
		if v, ok := inst.Variables["item"]; ok {
			out["item"] = v
		}
		if v, ok := inst.Variables["doubled"]; ok {
			out["doubled"] = v
		}
		return &executor.ExecutionResult{Output: out}, nil
	default:
		return &executor.ExecutionResult{Output: map[string]interface{}{"ok": true}}, nil
	}
}

var _ executorRegistry = (*compExecutor)(nil)

// buildCompositionEngine wires a real EngineService with the composition executors
// pointing back at it. Returns the engine, the instance store, and the leaf
// executor (so a test can toggle failStep).
func buildCompositionEngine(t *testing.T, defRepo *compDefRepo) (*EngineService, *multiInstanceRepo, *compExecutor) {
	t.Helper()
	instRepo := newMultiInstanceRepo()
	ledger := newMemMILedger()
	leaf := &compExecutor{}

	eng := NewEngineService(instRepo, defRepo, newRecordingTaskRepo(), leaf, nil, zerolog.Nop())
	eng.WithCompositionStores(ledger)

	leaf.call = executor.NewCallActivityExecutor(eng, zerolog.Nop())
	leaf.mi = executor.NewMultiInstanceExecutor(eng, nil, nil, zerolog.Nop())

	return eng, instRepo, leaf
}

// childDef is a child workflow: a single service_task "work" -> end. Its work
// step echoes its "item" variable (and "doubled" when present) as output. It
// completes SYNCHRONOUSLY during its start advance.
func childDef(key string) *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:            "def-child-" + key,
		TenantID:      compTenant,
		DefinitionKey: key,
		Version:       1,
		Status:        model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:          "work",
				Type:        model.StepTypeServiceTask,
				Name:        "Work",
				Config:      map[string]interface{}{},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

// childDefParking is a child workflow that PARKS on a human_task "review" before
// its service_task "work" -> end. Used to prove the parent genuinely parks while
// the child is still running, then resumes when the child later completes.
func childDefParking(key string) *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:            "def-child-" + key,
		TenantID:      compTenant,
		DefinitionKey: key,
		Version:       1,
		Status:        model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:          "review",
				Type:        model.StepTypeHumanTask,
				Name:        "Review",
				Config:      map[string]interface{}{"form_fields": []interface{}{}},
				Transitions: []model.Transition{{Target: "work"}},
			},
			{
				ID:          "work",
				Type:        model.StepTypeServiceTask,
				Name:        "Work",
				Config:      map[string]interface{}{},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

// ---------------------------------------------------------------------------
// call_activity
// ---------------------------------------------------------------------------

// TestCallActivityStartsChildParksParentResumesWithOutput proves the full
// call-activity loop: start parent -> parent starts child + parks -> child
// completes -> parent resumes with the child's output mapped back -> parent
// completes.
func TestCallActivityStartsChildParksParentResumesWithOutput(t *testing.T) {
	defRepo := newCompDefRepo()
	// A PARKING child (human_task first) so the parent genuinely parks while the
	// child is still running, and only resumes when the child later completes.
	defRepo.add(childDefParking("child-flow"))

	// Parent: call_activity "call" (maps item in, maps child work output out) -> end.
	parent := &model.WorkflowDefinition{
		ID: "def-parent", TenantID: compTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "call",
				Type: model.StepTypeCallActivity,
				Name: "Call Child",
				Config: map[string]interface{}{
					"definition_key": "child-flow",
					"input_mapping":  map[string]interface{}{"item": "${variables.subject}"},
					"output_mapping": map[string]interface{}{"child_item": "${child.steps.work.output.item}"},
				},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(parent)

	eng, instRepo, _ := buildCompositionEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID:   parent.ID,
		InputVariables: map[string]interface{}{"subject": "hello"},
	})
	if err != nil {
		t.Fatalf("StartInstance(parent) error = %v", err)
	}

	// The parent must be PARKED on the call step (still running), and a child must
	// exist linked back to the parent AND still be running (parked on its own
	// human task).
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusRunning {
		t.Fatalf("parent status after start = %q, want running (parked on call_activity)", got)
	}

	child := findChildOf(instRepo, inst.ID, "call")
	if child == nil {
		t.Fatal("no child instance linked to parent 'call' step")
	}
	if !child.HasParent() || *child.ParentInstanceID != inst.ID || *child.ParentStepID != "call" {
		t.Fatalf("child parent link = (%v,%v), want (%s,call)", child.ParentInstanceID, child.ParentStepID, inst.ID)
	}
	if child.Status != model.InstanceStatusRunning {
		t.Fatalf("child status = %q, want running (parked on its human task)", child.Status)
	}
	// The input mapping must have seeded the child's "item" from the parent subject.
	if got := child.Variables["item"]; got != "hello" {
		t.Fatalf("child item variable = %v, want hello (from input_mapping)", got)
	}

	// Complete the child's human task -> the child advances work -> end -> completes
	// -> the parent-resume hook maps the child output back and advances the parent.
	childReviewExecID := runningStepExecIDFor(instRepo, child.ID, "review")
	task := &model.HumanTask{
		ID:         "child-task-1",
		TenantID:   compTenant,
		InstanceID: child.ID,
		StepID:     "review",
		StepExecID: childReviewExecID,
		Status:     model.TaskStatusCompleted,
		FormData:   map[string]interface{}{"ok": true},
	}
	if err := eng.ResumeFromTask(context.Background(), task); err != nil {
		t.Fatalf("ResumeFromTask(child) error = %v", err)
	}

	// Child completed, parent resumed + completed.
	if got := instRepo.get(child.ID).Status; got != model.InstanceStatusCompleted {
		t.Fatalf("child status after task complete = %q, want completed", got)
	}
	pFinal := instRepo.get(inst.ID)
	if pFinal.Status != model.InstanceStatusCompleted {
		t.Fatalf("parent status = %q, want completed after child finished", pFinal.Status)
	}
	// The output mapping must have projected the child's work output back onto the
	// parent variables.
	if got := pFinal.Variables["child_item"]; got != "hello" {
		t.Fatalf("parent child_item variable = %v, want hello (from output_mapping)", got)
	}
}

// TestCallActivityChildFailureSurfacesToParent proves that a child failure
// propagates to the parent call_activity step (default policy: the parent step
// fails, and — with no incident store wired — the parent instance fails).
func TestCallActivityChildFailureSurfacesToParent(t *testing.T) {
	defRepo := newCompDefRepo()
	defRepo.add(childDef("failing-child"))

	parent := &model.WorkflowDefinition{
		ID: "def-parent-fail", TenantID: compTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "call",
				Type: model.StepTypeCallActivity,
				Name: "Call Failing Child",
				Config: map[string]interface{}{
					"definition_key": "failing-child",
				},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(parent)

	eng, instRepo, leaf := buildCompositionEngine(t, defRepo)
	leaf.failStep = "work" // the child's work step fails

	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID: parent.ID,
	})
	if err != nil {
		t.Fatalf("StartInstance(parent) error = %v", err)
	}

	child := findChildOf(instRepo, inst.ID, "call")
	if child == nil {
		t.Fatal("no child instance linked to parent 'call' step")
	}
	// The child must have failed.
	cFinal := instRepo.get(child.ID)
	if cFinal.Status != model.InstanceStatusFailed {
		t.Fatalf("child status = %q, want failed", cFinal.Status)
	}
	// The failure must have surfaced to the parent (no incident store => the parent
	// instance fails).
	pFinal := instRepo.get(inst.ID)
	if pFinal.Status != model.InstanceStatusFailed {
		t.Fatalf("parent status = %q, want failed after child failure surfaced", pFinal.Status)
	}
	if pFinal.ErrorMessage == nil {
		t.Fatal("parent error_message is nil, want the propagated child failure")
	}
}

// selfRecursiveDef is a definition whose single call_activity step resolves its
// child by definition_key back to ITS OWN definition_key — i.e. it calls itself.
// Absent a depth bound this spawns child->grandchild->... unbounded (each a real
// workflow_instances row + park), a self-DoS footgun.
func selfRecursiveDef(key string) *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:            "def-" + key,
		TenantID:      compTenant,
		DefinitionKey: key,
		Version:       1,
		Status:        model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "call",
				Type: model.StepTypeCallActivity,
				Name: "Call Self",
				Config: map[string]interface{}{
					"definition_key": key, // resolves to itself
				},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
}

// TestCallActivitySelfRecursionBoundedByMaxCallDepth proves the cycle guard: a
// self-recursive call_activity definition fails CLOSED at maxCallDepth instead of
// spawning an unbounded child->grandchild->... chain. With maxCallDepth=3 the
// spawn tree is top(depth0) -> child(1) -> grandchild(2) -> great-grandchild(3);
// the 4th (depth 4) is rejected BEFORE its instance row is created, so exactly
// 1 top + 3 nested = 4 instances exist and the failure propagates up so the
// top-level instance fails (no incident store wired).
func TestCallActivitySelfRecursionBoundedByMaxCallDepth(t *testing.T) {
	defRepo := newCompDefRepo()
	def := selfRecursiveDef("recur")
	defRepo.add(def)

	eng, instRepo, _ := buildCompositionEngine(t, defRepo)
	eng.WithMaxCallDepth(3)

	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID: def.ID,
	})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}

	// Exactly 4 instances: the top-level plus 3 nested children (depths 1..3).
	// The 4th spawn (would-be depth 4) is rejected before creation.
	if got := instRepo.count(); got != 4 {
		t.Fatalf("instance count = %d, want 4 (1 top + 3 bounded children); depth guard did not fail closed", got)
	}

	// The deepest child's call step is rejected -> its instance fails -> the
	// failure propagates up so the top-level instance fails closed (not runaway).
	final := instRepo.get(inst.ID)
	if final.Status != model.InstanceStatusFailed {
		t.Fatalf("top-level status = %q, want failed (depth guard should surface as a failure)", final.Status)
	}
	if final.ErrorMessage == nil {
		t.Fatal("top-level error_message is nil, want the propagated depth-exceeded failure")
	}
}

// TestCallActivityMutualRecursionBoundedByMaxCallDepth proves the guard also
// catches a mutually-recursive PAIR (A calls B, B calls A), where no single
// definition self-references — only the depth walk over parent_instance_id can
// detect it. The bound still holds regardless of which definitions alternate.
func TestCallActivityMutualRecursionBoundedByMaxCallDepth(t *testing.T) {
	defRepo := newCompDefRepo()
	// A calls B; B calls A.
	defA := selfRecursiveDef("mutual-a")
	defA.Steps[0].Config["definition_key"] = "mutual-b"
	defB := selfRecursiveDef("mutual-b")
	defB.Steps[0].Config["definition_key"] = "mutual-a"
	defRepo.add(defA)
	defRepo.add(defB)

	eng, instRepo, _ := buildCompositionEngine(t, defRepo)
	eng.WithMaxCallDepth(4)

	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID: defA.ID,
	})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}

	// maxCallDepth=4 => top(0) + children at depths 1..4 = 5 instances; depth 5 rejected.
	if got := instRepo.count(); got != 5 {
		t.Fatalf("instance count = %d, want 5 (1 top + 4 bounded children); mutual-recursion guard did not fail closed", got)
	}
	if final := instRepo.get(inst.ID); final.Status != model.InstanceStatusFailed {
		t.Fatalf("top-level status = %q, want failed", final.Status)
	}
}

// TestCompositionDepthWalkBoundedAgainstCorruptCycle proves the parent-chain walk
// itself is hard-bounded so a corrupt parent_instance_id cycle in existing data
// (A.parent=B, B.parent=A) cannot spin forever — compositionDepth returns a depth
// past the bound and the caller fails closed.
func TestCompositionDepthWalkBoundedAgainstCorruptCycle(t *testing.T) {
	defRepo := newCompDefRepo()
	eng, instRepo, _ := buildCompositionEngine(t, defRepo)
	eng.WithMaxCallDepth(3)

	// Two instances that (corruptly) point at each other as parents.
	a := "inst-corrupt-a"
	b := "inst-corrupt-b"
	stepID := "s"
	instRepo.instances[a] = &model.WorkflowInstance{
		ID: a, TenantID: compTenant, Status: model.InstanceStatusRunning,
		ParentInstanceID: &b, ParentStepID: &stepID,
	}
	instRepo.instances[b] = &model.WorkflowInstance{
		ID: b, TenantID: compTenant, Status: model.InstanceStatusRunning,
		ParentInstanceID: &a, ParentStepID: &stepID,
	}

	depth, err := eng.compositionDepth(context.Background(), a)
	if err != nil {
		t.Fatalf("compositionDepth error = %v", err)
	}
	if depth <= eng.maxCallDepth {
		t.Fatalf("compositionDepth over a corrupt cycle = %d, want > maxCallDepth (%d) so the caller fails closed", depth, eng.maxCallDepth)
	}
}

// ---------------------------------------------------------------------------
// multi_instance
// ---------------------------------------------------------------------------

// runMultiInstance drives a multi_instance parent over a 3-element collection
// with the given completion_policy and returns the parent's final instance. The
// children complete SYNCHRONOUSLY (service_task), so the whole fan-out + fan-in
// resolves within StartInstance via the deferred-resume drain.
func runMultiInstance(t *testing.T, policy interface{}) *model.WorkflowInstance {
	t.Helper()
	defRepo := newCompDefRepo()
	defRepo.add(childDef("mi-child"))

	config := map[string]interface{}{
		"collection":           "${variables.items}",
		"child_definition_key": "mi-child",
		"element_var":          "item",
	}
	if policy != nil {
		config["completion_policy"] = policy
	}

	parent := &model.WorkflowDefinition{
		ID: "def-mi-parent", TenantID: compTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:          "fanout",
				Type:        model.StepTypeMultiInstance,
				Name:        "Fan Out",
				Config:      config,
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(parent)

	eng, instRepo, _ := buildCompositionEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID:   parent.ID,
		InputVariables: map[string]interface{}{"items": []interface{}{"a", "b", "c"}},
	})
	if err != nil {
		t.Fatalf("StartInstance(mi parent) error = %v", err)
	}
	return instRepo.get(inst.ID)
}

// TestMultiInstanceFanOutAllPolicy proves a multi_instance step over 3 elements
// completes under the default "all" policy after every child completes, and
// aggregates the child outputs into a result collection.
func TestMultiInstanceFanOutAllPolicy(t *testing.T) {
	parent := runMultiInstance(t, nil) // nil => default "all"
	if parent.Status != model.InstanceStatusCompleted {
		t.Fatalf("parent status = %q, want completed under 'all' policy", parent.Status)
	}
	assertMIResults(t, parent, 3)
}

// TestMultiInstanceFanOutAnyPolicy proves the step completes under "any" once at
// least one child completes.
func TestMultiInstanceFanOutAnyPolicy(t *testing.T) {
	parent := runMultiInstance(t, "any")
	if parent.Status != model.InstanceStatusCompleted {
		t.Fatalf("parent status = %q, want completed under 'any' policy", parent.Status)
	}
	got := miResultsLen(t, parent)
	if got < 1 {
		t.Fatalf("mi results len = %d, want >=1 under 'any'", got)
	}
}

// TestMultiInstanceFanOutNofMPolicy proves the step completes under n_of_m (N=2).
func TestMultiInstanceFanOutNofMPolicy(t *testing.T) {
	parent := runMultiInstance(t, float64(2))
	if parent.Status != model.InstanceStatusCompleted {
		t.Fatalf("parent status = %q, want completed under n_of_m(2) policy", parent.Status)
	}
	got := miResultsLen(t, parent)
	if got < 2 {
		t.Fatalf("mi results len = %d, want >=2 under n_of_m(2)", got)
	}
}

// TestMultiInstanceParkedChildrenFanInAllPolicy proves the TRUE fan-in counter:
// with children that PARK (human_task), the parent stays parked until every
// child is resumed and completes, then the parent resumes exactly once.
func TestMultiInstanceParkedChildrenFanInAllPolicy(t *testing.T) {
	defRepo := newCompDefRepo()
	defRepo.add(childDefParking("mi-parked-child"))

	parent := &model.WorkflowDefinition{
		ID: "def-mi-parked", TenantID: compTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "fanout",
				Type: model.StepTypeMultiInstance,
				Name: "Fan Out",
				Config: map[string]interface{}{
					"collection":           "${variables.items}",
					"child_definition_key": "mi-parked-child",
					"element_var":          "item",
				},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(parent)

	eng, instRepo, _ := buildCompositionEngine(t, defRepo)
	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID:   parent.ID,
		InputVariables: map[string]interface{}{"items": []interface{}{"a", "b", "c"}},
	})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}

	// After fan-out all 3 children exist, running (parked), and the parent is
	// parked too.
	children := childrenOf(instRepo, inst.ID, "fanout")
	if len(children) != 3 {
		t.Fatalf("child count = %d, want 3", len(children))
	}
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusRunning {
		t.Fatalf("parent status = %q, want running (parked on fan-in) before children complete", got)
	}

	// Resume the first two children; the parent must STILL be parked (all policy).
	for i := 0; i < 2; i++ {
		resumeParkedChild(t, eng, instRepo, children[i].ID)
	}
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusRunning {
		t.Fatalf("parent status = %q after 2/3 children, want still running (all policy)", got)
	}

	// Resume the last child -> policy satisfied -> parent resumes + completes.
	resumeParkedChild(t, eng, instRepo, children[2].ID)
	pFinal := instRepo.get(inst.ID)
	if pFinal.Status != model.InstanceStatusCompleted {
		t.Fatalf("parent status = %q, want completed after all children finished", pFinal.Status)
	}
	assertMIResults(t, pFinal, 3)
}

// resumeParkedChild completes a parked child's "review" human task, driving it to
// completion (and thus firing the parent fan-in).
func resumeParkedChild(t *testing.T, eng *EngineService, instRepo *multiInstanceRepo, childID string) {
	t.Helper()
	execID := runningStepExecIDFor(instRepo, childID, "review")
	task := &model.HumanTask{
		ID:         "mi-task-" + childID,
		TenantID:   compTenant,
		InstanceID: childID,
		StepID:     "review",
		StepExecID: execID,
		Status:     model.TaskStatusCompleted,
		FormData:   map[string]interface{}{"ok": true},
	}
	if err := eng.ResumeFromTask(context.Background(), task); err != nil {
		t.Fatalf("ResumeFromTask(child %s) error = %v", childID, err)
	}
}

// childrenOf returns all child instances linked to (parentID, stepID), ordered by
// their loop_index variable so the caller can resume them deterministically.
func childrenOf(repo *multiInstanceRepo, parentID, stepID string) []*model.WorkflowInstance {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	var out []*model.WorkflowInstance
	for _, in := range repo.instances {
		if in.ParentInstanceID != nil && *in.ParentInstanceID == parentID &&
			in.ParentStepID != nil && *in.ParentStepID == stepID {
			cp := *in
			out = append(out, &cp)
		}
	}
	// Stable order by loop_index.
	for i := 0; i < len(out); i++ {
		for j := i + 1; j < len(out); j++ {
			if loopIndexOf(out[j]) < loopIndexOf(out[i]) {
				out[i], out[j] = out[j], out[i]
			}
		}
	}
	return out
}

func loopIndexOf(inst *model.WorkflowInstance) int {
	switch v := inst.Variables["loop_index"].(type) {
	case int:
		return v
	case float64:
		return int(v)
	default:
		return 0
	}
}

// TestMultiInstanceEmptyCollectionCompletesImmediately proves an empty
// collection is a valid vacuous fan-out that completes the step immediately.
func TestMultiInstanceEmptyCollectionCompletesImmediately(t *testing.T) {
	defRepo := newCompDefRepo()
	defRepo.add(childDef("mi-child"))
	parent := &model.WorkflowDefinition{
		ID: "def-mi-empty", TenantID: compTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:   "fanout",
				Type: model.StepTypeMultiInstance,
				Name: "Fan Out",
				Config: map[string]interface{}{
					"collection":           "${variables.items}",
					"child_definition_key": "mi-child",
				},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(parent)
	eng, instRepo, _ := buildCompositionEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID:   parent.ID,
		InputVariables: map[string]interface{}{"items": []interface{}{}},
	})
	if err != nil {
		t.Fatalf("StartInstance error = %v", err)
	}
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusCompleted {
		t.Fatalf("parent status = %q, want completed for empty collection", got)
	}
}

// ---------------------------------------------------------------------------
// backward-compat: a plain workflow using only leaf step types is unaffected.
// ---------------------------------------------------------------------------

// TestCompositionWiringDoesNotAffectPlainWorkflow proves that with the
// composition executors + stores wired, a definition that references NONE of the
// new step types runs exactly as before (start -> service_task -> end).
func TestCompositionWiringDoesNotAffectPlainWorkflow(t *testing.T) {
	defRepo := newCompDefRepo()
	plain := &model.WorkflowDefinition{
		ID: "def-plain", TenantID: compTenant, Version: 1, Status: model.DefinitionStatusActive,
		Steps: []model.StepDefinition{
			{
				ID:          "work",
				Type:        model.StepTypeServiceTask,
				Name:        "Work",
				Config:      map[string]interface{}{},
				Transitions: []model.Transition{{Target: "end"}},
			},
			{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	}
	defRepo.add(plain)
	eng, instRepo, _ := buildCompositionEngine(t, defRepo)

	inst, err := eng.StartInstance(context.Background(), compTenant, compUser, dto.StartInstanceRequest{
		DefinitionID: plain.ID,
	})
	if err != nil {
		t.Fatalf("StartInstance(plain) error = %v", err)
	}
	if got := instRepo.get(inst.ID).Status; got != model.InstanceStatusCompleted {
		t.Fatalf("plain workflow status = %q, want completed (composition wiring must not affect it)", got)
	}
	// No child instance may have been created for a plain workflow.
	for id, in := range instRepo.instances {
		if id != inst.ID && in.HasParent() {
			t.Fatalf("unexpected child instance %s for a plain workflow", id)
		}
	}
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// runningStepExecIDFor returns the id of the RUNNING step execution for
// (instanceID, stepID), used to build a resume task for a parked child.
func runningStepExecIDFor(repo *multiInstanceRepo, instanceID, stepID string) string {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for _, e := range repo.executions {
		if e.InstanceID == instanceID && e.StepID == stepID && e.Status == model.StepStatusRunning {
			return e.ID
		}
	}
	return ""
}

func findChildOf(repo *multiInstanceRepo, parentID, stepID string) *model.WorkflowInstance {
	repo.mu.Lock()
	defer repo.mu.Unlock()
	for _, in := range repo.instances {
		if in.ParentInstanceID != nil && *in.ParentInstanceID == parentID &&
			in.ParentStepID != nil && *in.ParentStepID == stepID {
			cp := *in
			return &cp
		}
	}
	return nil
}

func assertMIResults(t *testing.T, parent *model.WorkflowInstance, want int) {
	t.Helper()
	if got := miResultsLen(t, parent); got != want {
		t.Fatalf("mi results len = %d, want %d", got, want)
	}
}

func miResultsLen(t *testing.T, parent *model.WorkflowInstance) int {
	t.Helper()
	so, ok := parent.StepOutputs["fanout"].(map[string]interface{})
	if !ok {
		t.Fatalf("no step output for 'fanout' step: %#v", parent.StepOutputs)
	}
	out, ok := so["output"].(map[string]interface{})
	if !ok {
		t.Fatalf("fanout output shape unexpected: %#v", so)
	}
	results, ok := out["results"].([]interface{})
	if !ok {
		t.Fatalf("fanout results not a slice: %#v", out["results"])
	}
	return len(results)
}
