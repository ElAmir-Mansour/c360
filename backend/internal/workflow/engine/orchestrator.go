// Package engine defines the D-9 execution seam for the workflow engine.
//
// The seam freezes the swap boundary between the workflow API/FRs and the
// underlying step-traversal implementation. Today the only implementation is
// FSMOrchestrator, a thin adapter over the existing in-house FSM traversal in
// service.EngineService. A future BPMN core would be a second Orchestrator
// implementation plus a BPMN-XML -> []model.StepDefinition compiler; BPMN never
// leaks past this interface into the HTTP API, DTOs, events, or the executor
// registry.
//
// This package is additive and behavior-preserving: it does not move or rewrite
// the traversal logic. It delegates Start -> EngineService.StartInstance,
// Advance -> EngineService.AdvanceWorkflow, and Signal -> EngineService.ResumeFromTask.
package engine

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/model"
)

// TriggerData carries everything the engine needs to start an instance. It maps
// directly onto the arguments of service.EngineService.StartInstance: the
// authenticated tenant and user, the declared input variables, and the raw
// trigger payload (event data, manual request body, or schedule context).
//
// TenantID and UserID are required. UserID defaults to "system" for engine-
// initiated starts (event/schedule triggers) exactly as the existing trigger
// consumer does.
type TriggerData struct {
	// TenantID is the tenant that owns the instance. Required.
	TenantID string
	// UserID is the initiator. Use "system" for non-interactive triggers.
	UserID string
	// InputVariables are explicit variable overrides for the new instance.
	InputVariables map[string]any
	// Data is the raw trigger payload (event.Data, manual body, etc.).
	Data json.RawMessage
}

// Orchestrator is the frozen D-9 execution seam. Every workflow engine drives
// step traversal through this interface and honors the executor park/resume
// contract (executor.ErrParked / ExecutionResult.Parked). Swapping the FSM core
// for a BPMN core means providing a second implementation of this interface
// without touching the API, DTOs, events, or the executor registry.
type Orchestrator interface {
	// Start creates and begins executing a new instance of def using the trigger
	// data, running until the first park point or the end of the workflow.
	Start(ctx context.Context, def *model.WorkflowDefinition, trigger TriggerData) (*model.WorkflowInstance, error)
	// Advance moves a running instance forward from its current step, running
	// until the next park point or the end of the workflow.
	Advance(ctx context.Context, instanceID string) error
	// Signal resumes a parked step (e.g. a completed human task / approval gate)
	// with the supplied payload, then advances the instance.
	Signal(ctx context.Context, instanceID, stepID string, payload map[string]any) error
}

// engineDelegate is the subset of *service.EngineService that FSMOrchestrator
// delegates to. Declaring it as an interface keeps the adapter unit-testable
// (a fake delegate proves the adapter calls through) and avoids importing the
// concrete service type into the seam's public surface.
//
// The signatures match service.EngineService exactly:
//
//	StartInstance(ctx, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error)
//	AdvanceWorkflow(ctx, instanceID, fromStepID string) error
//	ResumeFromTask(ctx, task *model.HumanTask) error
type engineDelegate interface {
	StartInstance(ctx context.Context, tenantID, userID string, req dto.StartInstanceRequest) (*model.WorkflowInstance, error)
	AdvanceWorkflow(ctx context.Context, instanceID, fromStepID string) error
	ResumeFromTask(ctx context.Context, task *model.HumanTask) error
}

// instanceLoader loads a workflow instance by ID. FSMOrchestrator uses it to
// resolve the tenant and current step for Advance/Signal, since the Orchestrator
// interface intentionally keys only on instanceID (the BPMN-friendly shape) while
// the underlying EngineService methods need tenant and from-step.
//
// *repository.InstanceRepository satisfies this interface. Passing an empty
// tenantID performs the same untenanted internal lookup the engine itself uses
// in AdvanceWorkflow, so no engine semantics change.
type instanceLoader interface {
	GetByID(ctx context.Context, tenantID, id string) (*model.WorkflowInstance, error)
}

// FSMOrchestrator is the in-house FSM implementation of Orchestrator. It is a
// thin, behavior-preserving adapter over service.EngineService: it does not own
// any traversal logic of its own. It exists solely to freeze the D-9 seam so a
// later BPMN core can be substituted without API churn.
type FSMOrchestrator struct {
	engine    engineDelegate
	instances instanceLoader
}

// NewFSMOrchestrator builds an FSMOrchestrator over the given engine and instance
// loader. In production, engine is *service.EngineService and instances is the
// *repository.InstanceRepository the engine already uses; both are passed in by
// the service wiring (cmd/workflow-engine/main.go, the INTEGRATE phase).
//
// Both arguments are required; NewFSMOrchestrator returns an error if either is
// nil so wiring mistakes fail loudly at startup rather than at first request.
func NewFSMOrchestrator(engine engineDelegate, instances instanceLoader) (*FSMOrchestrator, error) {
	if engine == nil {
		return nil, fmt.Errorf("engine: %w", errNilDependency)
	}
	if instances == nil {
		return nil, fmt.Errorf("instances: %w", errNilDependency)
	}
	return &FSMOrchestrator{engine: engine, instances: instances}, nil
}

// errNilDependency is returned by NewFSMOrchestrator for missing dependencies.
var errNilDependency = fmt.Errorf("required dependency is nil")

// Start delegates to EngineService.StartInstance. The trigger's tenant and user
// drive authorization/ownership; def.ID selects the definition (the engine
// re-loads the active definition by ID, preserving the existing validation that
// only active definitions can start instances).
func (o *FSMOrchestrator) Start(ctx context.Context, def *model.WorkflowDefinition, trigger TriggerData) (*model.WorkflowInstance, error) {
	if def == nil {
		return nil, fmt.Errorf("workflow definition is nil")
	}
	if trigger.TenantID == "" {
		return nil, fmt.Errorf("trigger tenant id is required")
	}
	userID := trigger.UserID
	if userID == "" {
		// Match the trigger consumer's convention for non-interactive starts.
		userID = "system"
	}

	req := dto.StartInstanceRequest{
		DefinitionID:   def.ID,
		InputVariables: trigger.InputVariables,
		TriggerData:    trigger.Data,
	}

	inst, err := o.engine.StartInstance(ctx, trigger.TenantID, userID, req)
	if err != nil {
		return nil, fmt.Errorf("orchestrator start (definition %s): %w", def.ID, err)
	}
	return inst, nil
}

// Advance delegates to EngineService.AdvanceWorkflow. The Orchestrator interface
// keys only on instanceID, so the adapter resolves the from-step from the
// instance's current step — exactly as RecoveryService does when it resumes an
// instance after a crash. If the instance has no current step there is nothing
// to advance from and the call is a no-op.
func (o *FSMOrchestrator) Advance(ctx context.Context, instanceID string) error {
	if instanceID == "" {
		return fmt.Errorf("instance id is required")
	}

	inst, err := o.instances.GetByID(ctx, "", instanceID)
	if err != nil {
		return fmt.Errorf("orchestrator advance: loading instance %s: %w", instanceID, err)
	}

	fromStepID := ""
	if inst.CurrentStepID != nil {
		fromStepID = *inst.CurrentStepID
	}
	if fromStepID == "" {
		// No current step to advance from; nothing to do. This preserves the
		// engine's own behavior, which is keyed on a from-step.
		return nil
	}

	if err := o.engine.AdvanceWorkflow(ctx, instanceID, fromStepID); err != nil {
		return fmt.Errorf("orchestrator advance (instance %s from step %s): %w", instanceID, fromStepID, err)
	}
	return nil
}

// Signal delegates to EngineService.ResumeFromTask. The interface gives only
// instanceID/stepID/payload, so the adapter loads the instance to resolve the
// tenant and builds the minimal HumanTask that ResumeFromTask consumes
// (TenantID, InstanceID, StepID, FormData). This resumes a parked step — the
// human-task / approval-gate completion path — without changing engine semantics.
func (o *FSMOrchestrator) Signal(ctx context.Context, instanceID, stepID string, payload map[string]any) error {
	if instanceID == "" {
		return fmt.Errorf("instance id is required")
	}
	if stepID == "" {
		return fmt.Errorf("step id is required")
	}

	inst, err := o.instances.GetByID(ctx, "", instanceID)
	if err != nil {
		return fmt.Errorf("orchestrator signal: loading instance %s: %w", instanceID, err)
	}

	task := &model.HumanTask{
		TenantID:   inst.TenantID,
		InstanceID: instanceID,
		StepID:     stepID,
		Status:     model.TaskStatusCompleted,
		FormData:   payload,
	}

	if err := o.engine.ResumeFromTask(ctx, task); err != nil {
		return fmt.Errorf("orchestrator signal (instance %s step %s): %w", instanceID, stepID, err)
	}
	return nil
}

// Ensure FSMOrchestrator satisfies the Orchestrator seam at compile time.
var _ Orchestrator = (*FSMOrchestrator)(nil)
