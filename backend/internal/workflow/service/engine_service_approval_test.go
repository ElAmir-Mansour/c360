package service

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

const (
	approvalTenant = "tenant-approval"
	approvalInstID = "inst-approval"
	approvalDefID  = "def-approval"
	approvalStepID = "approval"
	approvalExecID = "exec-approval"
)

func TestEngineResumeApprovalChain_ParallelNOfMWaitsThenAdvances(t *testing.T) {
	step := approvalStepDefinition(map[string]interface{}{
		"mode":     executor.ApprovalModeParallel,
		"quorum":   executor.QuorumNofM,
		"quorum_n": 2,
	})
	def := approvalDefinition(step, model.StepDefinition{ID: "end", Type: model.StepTypeEnd, Name: "End"})
	inst := approvalInstance()
	exec := &model.StepExecution{ID: approvalExecID, InstanceID: inst.ID, StepID: approvalStepID, StepType: model.StepTypeApprovalChain, Status: model.StepStatusRunning}
	instances := &approvalInstanceRepo{inst: inst, executions: []*model.StepExecution{exec}}
	tasks := &approvalTaskRepo{tasks: []*model.HumanTask{
		approvalTask("task-1", 0, model.TaskStatusCompleted, "approve"),
		approvalTask("task-2", 1, model.TaskStatusPending, ""),
		approvalTask("task-3", 2, model.TaskStatusPending, ""),
	}}
	svc := NewEngineService(instances, &approvalDefRepo{def: def}, tasks, &approvalExecutors{}, nil, zerolog.Nop())

	if err := svc.ResumeFromTask(context.Background(), tasks.tasks[0]); err != nil {
		t.Fatalf("first ResumeFromTask error = %v", err)
	}
	if tasks.cancelStepCalls != 0 {
		t.Fatalf("cancel step calls after first approval = %d, want 0", tasks.cancelStepCalls)
	}
	if exec.Status != model.StepStatusRunning {
		t.Fatalf("step status after first approval = %s, want running", exec.Status)
	}
	if inst.Status != model.InstanceStatusRunning {
		t.Fatalf("instance status after first approval = %s, want running", inst.Status)
	}

	tasks.tasks[1].Status = model.TaskStatusCompleted
	tasks.tasks[1].FormData = map[string]interface{}{"decision": "approve"}
	if err := svc.ResumeFromTask(context.Background(), tasks.tasks[1]); err != nil {
		t.Fatalf("second ResumeFromTask error = %v", err)
	}
	if tasks.cancelStepCalls != 1 {
		t.Fatalf("cancel step calls after quorum = %d, want 1", tasks.cancelStepCalls)
	}
	if exec.Status != model.StepStatusCompleted {
		t.Fatalf("step status after quorum = %s, want completed", exec.Status)
	}
	if inst.Status != model.InstanceStatusCompleted {
		t.Fatalf("instance status after quorum = %s, want completed", inst.Status)
	}
	output := inst.StepOutputs[approvalStepID].(map[string]interface{})["output"].(map[string]interface{})
	if output["approval_result"] != "approved" || output["approvals"] != 2 {
		t.Fatalf("approval output = %#v, want approved with 2 approvals", output)
	}
}

func TestEngineResumeApprovalChain_SequentialCreatesNextApprover(t *testing.T) {
	step := approvalStepDefinition(map[string]interface{}{
		"mode":   executor.ApprovalModeSequential,
		"quorum": executor.QuorumAll,
	})
	def := approvalDefinition(step, model.StepDefinition{ID: "end", Type: model.StepTypeEnd, Name: "End"})
	inst := approvalInstance()
	tasks := &approvalTaskRepo{tasks: []*model.HumanTask{
		approvalTask("task-1", 0, model.TaskStatusCompleted, "approve"),
	}}
	svc := NewEngineService(&approvalInstanceRepo{
		inst:       inst,
		executions: []*model.StepExecution{{ID: approvalExecID, InstanceID: inst.ID, StepID: approvalStepID, Status: model.StepStatusRunning}},
	}, &approvalDefRepo{def: def}, tasks, &approvalExecutors{}, nil, zerolog.Nop())

	if err := svc.ResumeFromTask(context.Background(), tasks.tasks[0]); err != nil {
		t.Fatalf("ResumeFromTask error = %v", err)
	}
	if len(tasks.created) != 1 {
		t.Fatalf("created tasks = %d, want 1", len(tasks.created))
	}
	next := tasks.created[0]
	if idx := next.Metadata["approver_index"]; idx != 1 {
		t.Fatalf("next approver_index = %v, want 1", idx)
	}
	if next.AssigneeRole == nil || *next.AssigneeRole != "manager" {
		t.Fatalf("next assignee role = %v, want manager", next.AssigneeRole)
	}
	if inst.Status != model.InstanceStatusRunning {
		t.Fatalf("instance status = %s, want running", inst.Status)
	}
}

func TestTaskServiceDelegateTask_RejectsUnclaimedRoleTask(t *testing.T) {
	taskRepo := &approvalTaskRepo{byID: map[string]*model.HumanTask{
		"task-role": {
			ID:           "task-role",
			TenantID:     approvalTenant,
			Status:       model.TaskStatusPending,
			AssigneeRole: strPtr("legal"),
		},
	}}
	svc := NewTaskService(taskRepo, nil, zerolog.Nop())

	err := svc.DelegateTask(context.Background(), approvalTenant, "task-role", "user-a", "user-b", "ooo")
	if err == nil {
		t.Fatal("expected delegation error for unclaimed role task")
	}
	if !strings.Contains(err.Error(), "must be claimed") {
		t.Fatalf("delegation error = %v, want claimed guidance", err)
	}
	if taskRepo.delegateCalls != 0 {
		t.Fatalf("repository delegation calls = %d, want 0", taskRepo.delegateCalls)
	}
}

func approvalStepDefinition(extra map[string]interface{}) model.StepDefinition {
	approvers := []interface{}{
		map[string]interface{}{"type": "role", "ref": "legal"},
		map[string]interface{}{"type": "role", "ref": "manager"},
		map[string]interface{}{"type": "role", "ref": "finance"},
	}
	cfg := map[string]interface{}{
		"approvers": approvers,
	}
	for k, v := range extra {
		cfg[k] = v
	}
	return model.StepDefinition{
		ID:     approvalStepID,
		Type:   model.StepTypeApprovalChain,
		Name:   "Approval",
		Config: cfg,
		Transitions: []model.Transition{
			{Condition: "steps.approval.output.approval_result == 'approved'", Target: "end"},
		},
	}
}

func approvalDefinition(steps ...model.StepDefinition) *model.WorkflowDefinition {
	return &model.WorkflowDefinition{
		ID:       approvalDefID,
		TenantID: approvalTenant,
		Status:   model.DefinitionStatusActive,
		Steps:    steps,
	}
}

func approvalInstance() *model.WorkflowInstance {
	current := approvalStepID
	return &model.WorkflowInstance{
		ID:            approvalInstID,
		TenantID:      approvalTenant,
		DefinitionID:  approvalDefID,
		DefinitionVer: 1,
		Status:        model.InstanceStatusRunning,
		CurrentStepID: &current,
		Variables:     map[string]interface{}{"priority": 3},
		StepOutputs:   map[string]interface{}{},
		StartedAt:     time.Now().UTC(),
		UpdatedAt:     time.Now().UTC(),
	}
}

func approvalTask(id string, idx int, status, decision string) *model.HumanTask {
	task := &model.HumanTask{
		ID:         id,
		TenantID:   approvalTenant,
		InstanceID: approvalInstID,
		StepID:     approvalStepID,
		StepExecID: approvalExecID,
		Status:     status,
		FormData:   map[string]interface{}{},
		Metadata: map[string]interface{}{
			"approval_chain": true,
			"approver_index": idx,
		},
	}
	if decision != "" {
		task.FormData["decision"] = decision
		claimedBy := "actor-" + id
		task.ClaimedBy = &claimedBy
		now := time.Now().UTC()
		task.CompletedAt = &now
	}
	return task
}

type approvalInstanceRepo struct {
	inst       *model.WorkflowInstance
	executions []*model.StepExecution
	created    []*model.StepExecution
}

func (r *approvalInstanceRepo) Create(context.Context, *model.WorkflowInstance) error { return nil }
func (r *approvalInstanceRepo) GetByID(_ context.Context, _, _ string) (*model.WorkflowInstance, error) {
	return r.inst, nil
}
func (r *approvalInstanceRepo) UpdateWithLock(_ context.Context, inst *model.WorkflowInstance) error {
	r.inst = inst
	return nil
}
func (r *approvalInstanceRepo) List(context.Context, string, string, string, string, *time.Time, *time.Time, string, string, int, int) ([]*model.WorkflowInstance, int, error) {
	return nil, 0, nil
}
func (r *approvalInstanceRepo) ListRunning(context.Context, int, int) ([]*model.WorkflowInstance, error) {
	return nil, nil
}
func (r *approvalInstanceRepo) CreateStepExecution(_ context.Context, exec *model.StepExecution) error {
	r.created = append(r.created, exec)
	return nil
}
func (r *approvalInstanceRepo) UpdateStepExecution(context.Context, *model.StepExecution) error {
	return nil
}
func (r *approvalInstanceRepo) GetStepExecutions(context.Context, string) ([]*model.StepExecution, error) {
	return r.executions, nil
}
func (r *approvalInstanceRepo) GetLastFailedStep(context.Context, string) (*model.StepExecution, error) {
	return nil, nil
}

type approvalDefRepo struct {
	def *model.WorkflowDefinition
}

func (r *approvalDefRepo) Create(context.Context, *model.WorkflowDefinition) error { return nil }
func (r *approvalDefRepo) GetByID(context.Context, string, string) (*model.WorkflowDefinition, error) {
	return r.def, nil
}
func (r *approvalDefRepo) GetActiveByID(context.Context, string, string) (*model.WorkflowDefinition, error) {
	return r.def, nil
}
func (r *approvalDefRepo) List(context.Context, string, string, string, string, string, string, int, int) ([]*model.WorkflowDefinition, int, error) {
	return nil, 0, nil
}
func (r *approvalDefRepo) ListVersions(context.Context, string, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}
func (r *approvalDefRepo) Update(context.Context, *model.WorkflowDefinition) error { return nil }
func (r *approvalDefRepo) SoftDelete(context.Context, string, string) error        { return nil }
func (r *approvalDefRepo) GetMaxVersion(context.Context, string, string) (int, error) {
	return 0, nil
}
func (r *approvalDefRepo) GetActiveByTriggerTopic(context.Context, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

type approvalTaskRepo struct {
	tasks           []*model.HumanTask
	byID            map[string]*model.HumanTask
	created         []*model.HumanTask
	cancelStepCalls int
	delegateCalls   int
}

func (r *approvalTaskRepo) Create(_ context.Context, task *model.HumanTask) error {
	r.created = append(r.created, task)
	r.tasks = append(r.tasks, task)
	return nil
}
func (r *approvalTaskRepo) GetByID(_ context.Context, _, id string) (*model.HumanTask, error) {
	if r.byID != nil {
		if task := r.byID[id]; task != nil {
			return task, nil
		}
	}
	for _, task := range r.tasks {
		if task.ID == id {
			return task, nil
		}
	}
	return nil, model.ErrNotFound
}
func (r *approvalTaskRepo) ListForUser(context.Context, string, string, []string, []string, string, string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *approvalTaskRepo) ListMyQueues(context.Context, string, string, []string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *approvalTaskRepo) ClaimTask(context.Context, string, string, string) error   { return nil }
func (r *approvalTaskRepo) UnclaimTask(context.Context, string, string, string) error { return nil }
func (r *approvalTaskRepo) CompleteTask(context.Context, string, string, map[string]interface{}, map[string]bool) error {
	return nil
}
func (r *approvalTaskRepo) DelegateTask(context.Context, string, string, string, string, string) error {
	r.delegateCalls++
	return nil
}
func (r *approvalTaskRepo) RejectTask(context.Context, string, string, string, string) error {
	return nil
}
func (r *approvalTaskRepo) CountByStatus(context.Context, string, string, []string) (map[string]int, error) {
	return nil, nil
}
func (r *approvalTaskRepo) ListByInstanceStep(context.Context, string, string, string) ([]*model.HumanTask, error) {
	return r.tasks, nil
}
func (r *approvalTaskRepo) GetOverdueTasks(context.Context, int) ([]*model.HumanTask, error) {
	return nil, nil
}
func (r *approvalTaskRepo) MarkSLABreached(context.Context, string) error      { return nil }
func (r *approvalTaskRepo) EscalateTask(context.Context, string, string) error { return nil }
func (r *approvalTaskRepo) CancelByInstance(context.Context, string) error     { return nil }
func (r *approvalTaskRepo) CancelOpenByInstanceStep(context.Context, string, string) error {
	r.cancelStepCalls++
	for _, task := range r.tasks {
		if task.Status == model.TaskStatusPending || task.Status == model.TaskStatusClaimed || task.Status == model.TaskStatusEscalated {
			task.Status = model.TaskStatusCancelled
		}
	}
	return nil
}
func (r *approvalTaskRepo) UpdateMetadata(context.Context, string, string, map[string]interface{}) error {
	return nil
}
func (r *approvalTaskRepo) DailyCreatedCounts(context.Context, string, int) ([]int, error) {
	return nil, nil
}

type approvalExecutors struct{}

func (approvalExecutors) Execute(context.Context, *model.WorkflowInstance, *model.StepDefinition, *model.StepExecution) (*executor.ExecutionResult, error) {
	return nil, errors.New("approvalExecutors should not be called")
}

type approvalPublisher struct{}

func (approvalPublisher) Publish(context.Context, string, *events.Event) error { return nil }

var _ taskRepo = (*approvalTaskRepo)(nil)
var _ instanceRepo = (*approvalInstanceRepo)(nil)
var _ definitionRepo = (*approvalDefRepo)(nil)

func strPtr(s string) *string { return &s }
