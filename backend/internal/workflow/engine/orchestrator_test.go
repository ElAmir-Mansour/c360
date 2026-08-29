package engine

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// fakeEngine is a recording stand-in for *service.EngineService. It captures the
// arguments each delegated method receives and returns configurable results so
// tests can assert both the delegation path and the pass-through of return values.
type fakeEngine struct {
	// recorded Start args
	startTenantID string
	startUserID   string
	startReq      dto.StartInstanceRequest
	startCalls    int
	startResult   *model.WorkflowInstance
	startErr      error

	// recorded Advance args
	advInstanceID string
	advFromStepID string
	advCalls      int
	advErr        error

	// recorded Signal args (via ResumeFromTask)
	resumeTask  *model.HumanTask
	resumeCalls int
	resumeErr   error
}

func (f *fakeEngine) StartInstance(_ context.Context, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error) {
	f.startCalls++
	f.startTenantID = tenantID
	f.startUserID = userID
	f.startReq = req
	return f.startResult, f.startErr
}

func (f *fakeEngine) AdvanceWorkflow(_ context.Context, instanceID, fromStepID string) error {
	f.advCalls++
	f.advInstanceID = instanceID
	f.advFromStepID = fromStepID
	return f.advErr
}

func (f *fakeEngine) ResumeFromTask(_ context.Context, task *model.HumanTask) error {
	f.resumeCalls++
	f.resumeTask = task
	return f.resumeErr
}

// fakeInstances is a recording stand-in for the instance loader.
type fakeInstances struct {
	inst       *model.WorkflowInstance
	err        error
	calls      int
	lastTenant string
	lastID     string
}

func (f *fakeInstances) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowInstance, error) {
	f.calls++
	f.lastTenant = tenantID
	f.lastID = id
	if f.err != nil {
		return nil, f.err
	}
	return f.inst, nil
}

func newOrch(t *testing.T, eng *fakeEngine, inst *fakeInstances) *FSMOrchestrator {
	t.Helper()
	o, err := NewFSMOrchestrator(eng, inst)
	if err != nil {
		t.Fatalf("NewFSMOrchestrator() error = %v", err)
	}
	return o
}

func TestNewFSMOrchestrator_NilDeps(t *testing.T) {
	if _, err := NewFSMOrchestrator(nil, &fakeInstances{}); err == nil {
		t.Error("NewFSMOrchestrator(nil engine) error = nil, want non-nil")
	}
	if _, err := NewFSMOrchestrator(&fakeEngine{}, nil); err == nil {
		t.Error("NewFSMOrchestrator(nil instances) error = nil, want non-nil")
	}
}

func TestStart_DelegatesAndReturnsEngineResult(t *testing.T) {
	want := &model.WorkflowInstance{ID: "inst-123", TenantID: "tenant-A"}
	eng := &fakeEngine{startResult: want}
	o := newOrch(t, eng, &fakeInstances{})

	def := &model.WorkflowDefinition{ID: "def-7"}
	trigger := TriggerData{
		TenantID:       "tenant-A",
		UserID:         "user-9",
		InputVariables: map[string]any{"amount": 500},
		Data:           json.RawMessage(`{"foo":"bar"}`),
	}

	got, err := o.Start(context.Background(), def, trigger)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if got != want {
		t.Fatalf("Start() returned %v, want the engine's instance %v", got, want)
	}
	if eng.startCalls != 1 {
		t.Fatalf("StartInstance call count = %d, want 1", eng.startCalls)
	}
	if eng.startTenantID != "tenant-A" {
		t.Errorf("StartInstance tenantID = %q, want tenant-A", eng.startTenantID)
	}
	if eng.startUserID != "user-9" {
		t.Errorf("StartInstance userID = %q, want user-9", eng.startUserID)
	}
	if eng.startReq.DefinitionID != "def-7" {
		t.Errorf("StartInstance req.DefinitionID = %q, want def-7 (from def.ID)", eng.startReq.DefinitionID)
	}
	if eng.startReq.InputVariables["amount"] != 500 {
		t.Errorf("StartInstance req.InputVariables not passed through: %v", eng.startReq.InputVariables)
	}
	if string(eng.startReq.TriggerData) != `{"foo":"bar"}` {
		t.Errorf("StartInstance req.TriggerData = %s, want raw trigger data", eng.startReq.TriggerData)
	}
}

func TestStart_DefaultsUserToSystem(t *testing.T) {
	eng := &fakeEngine{startResult: &model.WorkflowInstance{ID: "x"}}
	o := newOrch(t, eng, &fakeInstances{})

	_, err := o.Start(context.Background(), &model.WorkflowDefinition{ID: "def-1"}, TriggerData{TenantID: "t"})
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if eng.startUserID != "system" {
		t.Errorf("StartInstance userID = %q, want system for empty trigger user", eng.startUserID)
	}
}

func TestStart_PropagatesEngineError(t *testing.T) {
	sentinel := errors.New("definition not active")
	eng := &fakeEngine{startErr: sentinel}
	o := newOrch(t, eng, &fakeInstances{})

	_, err := o.Start(context.Background(), &model.WorkflowDefinition{ID: "def-1"}, TriggerData{TenantID: "t"})
	if !errors.Is(err, sentinel) {
		t.Fatalf("Start() error = %v, want wrapped %v", err, sentinel)
	}
}

func TestStart_ValidatesInput(t *testing.T) {
	o := newOrch(t, &fakeEngine{}, &fakeInstances{})

	if _, err := o.Start(context.Background(), nil, TriggerData{TenantID: "t"}); err == nil {
		t.Error("Start(nil def) error = nil, want non-nil")
	}
	if _, err := o.Start(context.Background(), &model.WorkflowDefinition{ID: "d"}, TriggerData{}); err == nil {
		t.Error("Start(empty tenant) error = nil, want non-nil")
	}
}

func TestAdvance_ResolvesFromStepAndDelegates(t *testing.T) {
	step := "step-review"
	insts := &fakeInstances{inst: &model.WorkflowInstance{ID: "inst-1", CurrentStepID: &step}}
	eng := &fakeEngine{}
	o := newOrch(t, eng, insts)

	if err := o.Advance(context.Background(), "inst-1"); err != nil {
		t.Fatalf("Advance() error = %v", err)
	}
	if insts.calls != 1 {
		t.Fatalf("instance loader calls = %d, want 1", insts.calls)
	}
	if insts.lastTenant != "" {
		t.Errorf("instance loaded with tenant %q, want empty (untenanted internal lookup)", insts.lastTenant)
	}
	if insts.lastID != "inst-1" {
		t.Errorf("instance loaded with id %q, want inst-1", insts.lastID)
	}
	if eng.advCalls != 1 {
		t.Fatalf("AdvanceWorkflow call count = %d, want 1", eng.advCalls)
	}
	if eng.advInstanceID != "inst-1" {
		t.Errorf("AdvanceWorkflow instanceID = %q, want inst-1", eng.advInstanceID)
	}
	if eng.advFromStepID != "step-review" {
		t.Errorf("AdvanceWorkflow fromStepID = %q, want step-review (the instance's current step)", eng.advFromStepID)
	}
}

func TestAdvance_NoCurrentStepIsNoop(t *testing.T) {
	insts := &fakeInstances{inst: &model.WorkflowInstance{ID: "inst-1", CurrentStepID: nil}}
	eng := &fakeEngine{}
	o := newOrch(t, eng, insts)

	if err := o.Advance(context.Background(), "inst-1"); err != nil {
		t.Fatalf("Advance() error = %v", err)
	}
	if eng.advCalls != 0 {
		t.Errorf("AdvanceWorkflow called %d times, want 0 when there is no current step", eng.advCalls)
	}
}

func TestAdvance_PropagatesLoadAndEngineErrors(t *testing.T) {
	loadErr := errors.New("instance vanished")
	o := newOrch(t, &fakeEngine{}, &fakeInstances{err: loadErr})
	if err := o.Advance(context.Background(), "inst-1"); !errors.Is(err, loadErr) {
		t.Fatalf("Advance() load error = %v, want wrapped %v", err, loadErr)
	}

	advErr := errors.New("transition failed")
	step := "s1"
	o2 := newOrch(t, &fakeEngine{advErr: advErr}, &fakeInstances{inst: &model.WorkflowInstance{ID: "i", CurrentStepID: &step}})
	if err := o2.Advance(context.Background(), "inst-1"); !errors.Is(err, advErr) {
		t.Fatalf("Advance() engine error = %v, want wrapped %v", err, advErr)
	}

	if err := o2.Advance(context.Background(), ""); err == nil {
		t.Error("Advance(empty id) error = nil, want non-nil")
	}
}

func TestSignal_BuildsTaskAndDelegates(t *testing.T) {
	insts := &fakeInstances{inst: &model.WorkflowInstance{ID: "inst-1", TenantID: "tenant-Z"}}
	eng := &fakeEngine{}
	o := newOrch(t, eng, insts)

	payload := map[string]any{"decision": "approve", "comment": "ok"}
	if err := o.Signal(context.Background(), "inst-1", "step-approve", payload); err != nil {
		t.Fatalf("Signal() error = %v", err)
	}
	if eng.resumeCalls != 1 {
		t.Fatalf("ResumeFromTask call count = %d, want 1", eng.resumeCalls)
	}
	task := eng.resumeTask
	if task == nil {
		t.Fatal("ResumeFromTask received nil task")
	}
	if task.TenantID != "tenant-Z" {
		t.Errorf("task.TenantID = %q, want tenant-Z (resolved from instance)", task.TenantID)
	}
	if task.InstanceID != "inst-1" {
		t.Errorf("task.InstanceID = %q, want inst-1", task.InstanceID)
	}
	if task.StepID != "step-approve" {
		t.Errorf("task.StepID = %q, want step-approve", task.StepID)
	}
	if task.Status != model.TaskStatusCompleted {
		t.Errorf("task.Status = %q, want %q", task.Status, model.TaskStatusCompleted)
	}
	if task.FormData["decision"] != "approve" || task.FormData["comment"] != "ok" {
		t.Errorf("task.FormData = %v, want the signal payload", task.FormData)
	}
}

func TestSignal_PropagatesLoadAndEngineErrors(t *testing.T) {
	loadErr := errors.New("no such instance")
	o := newOrch(t, &fakeEngine{}, &fakeInstances{err: loadErr})
	if err := o.Signal(context.Background(), "inst-1", "s1", nil); !errors.Is(err, loadErr) {
		t.Fatalf("Signal() load error = %v, want wrapped %v", err, loadErr)
	}

	resumeErr := errors.New("instance not runnable")
	o2 := newOrch(t, &fakeEngine{resumeErr: resumeErr}, &fakeInstances{inst: &model.WorkflowInstance{ID: "i", TenantID: "t"}})
	if err := o2.Signal(context.Background(), "inst-1", "s1", nil); !errors.Is(err, resumeErr) {
		t.Fatalf("Signal() engine error = %v, want wrapped %v", err, resumeErr)
	}

	if err := o2.Signal(context.Background(), "", "s1", nil); err == nil {
		t.Error("Signal(empty instance id) error = nil, want non-nil")
	}
	if err := o2.Signal(context.Background(), "inst-1", "", nil); err == nil {
		t.Error("Signal(empty step id) error = nil, want non-nil")
	}
}
