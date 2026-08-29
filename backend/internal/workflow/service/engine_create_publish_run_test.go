package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/dto"
	"github.com/clario360/platform/internal/workflow/executor"
	"github.com/clario360/platform/internal/workflow/model"
)

// This file proves Work-stream 3 of the Workflow Module design: the default
// workflow created by the "Create" button (a "Start" human_task that transitions
// to an end step) is publishable with zero designer edits, and the full
// create -> publish -> start -> complete loop works end to end. It also pins the
// negative path: a single-step (end-only) definition fails activation with a
// structured validation error.

const cprTenant = "tenant-cpr"
const cprUser = "user-cpr"

// defaultPublishableSteps mirrors the seed the frontend "Create" button now uses
// (definition-list.tsx): a human_task "Start" -> end. Authoring contract is
// model/definition.go.
func defaultPublishableSteps() []model.StepDefinition {
	return []model.StepDefinition{
		{
			ID:   "start",
			Type: model.StepTypeHumanTask,
			Name: "Start",
			Config: map[string]interface{}{
				"assignee_role": "admin",
				"form_fields":   []interface{}{},
			},
			Transitions: []model.Transition{{Target: "end"}},
		},
		{ID: "end", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
	}
}

// TestCreateDefaultDefinitionThenActivatePublishesWithZeroEdits asserts that the
// default new-definition payload activates without any further editing.
func TestCreateDefaultDefinitionThenActivatePublishesWithZeroEdits(t *testing.T) {
	repo := newStatefulDefRepo()
	svc := NewDefinitionService(repo, zerolog.Nop())

	def, err := svc.Create(context.Background(), cprTenant, cprUser, dto.CreateDefinitionRequest{
		Name:          "Untitled Workflow",
		Category:      model.CategoryCustom,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{},
		Steps:         defaultPublishableSteps(),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if def.Status != model.DefinitionStatusDraft {
		t.Fatalf("created status = %q, want draft", def.Status)
	}

	if err := svc.Activate(context.Background(), cprTenant, def.ID); err != nil {
		t.Fatalf("Activate() on default definition error = %v (the default must publish with zero edits)", err)
	}

	got, err := repo.GetByID(context.Background(), cprTenant, def.ID)
	if err != nil {
		t.Fatalf("GetByID() after activate error = %v", err)
	}
	if got.Status != model.DefinitionStatusActive {
		t.Fatalf("status after activate = %q, want active", got.Status)
	}
	if got.PublishedAt == nil {
		t.Fatalf("published_at is nil after activate, want a timestamp")
	}
}

// TestCreatePublishStartCompleteEndToEnd drives the full happy path: create the
// default definition, publish it, start an instance, complete the human task,
// and assert the instance reaches completed.
func TestCreatePublishStartCompleteEndToEnd(t *testing.T) {
	defRepo := newStatefulDefRepo()
	defSvc := NewDefinitionService(defRepo, zerolog.Nop())

	def, err := defSvc.Create(context.Background(), cprTenant, cprUser, dto.CreateDefinitionRequest{
		Name:          "Untitled Workflow",
		Category:      model.CategoryCustom,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{},
		Steps:         defaultPublishableSteps(),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if err := defSvc.Activate(context.Background(), cprTenant, def.ID); err != nil {
		t.Fatalf("Activate() error = %v", err)
	}

	instRepo := newStatefulInstanceRepo()
	taskRepo := newRecordingTaskRepo()
	engine := NewEngineService(instRepo, defRepo, taskRepo, &parkingHumanTaskExecutor{}, nil, zerolog.Nop())

	inst, err := engine.StartInstance(context.Background(), cprTenant, cprUser, dto.StartInstanceRequest{
		DefinitionID: def.ID,
	})
	if err != nil {
		t.Fatalf("StartInstance() error = %v", err)
	}
	if inst.Status != model.InstanceStatusRunning {
		t.Fatalf("instance status after start = %q, want running (parked on human task)", inst.Status)
	}
	if inst.CurrentStepID == nil || *inst.CurrentStepID != "start" {
		t.Fatalf("current step after start = %v, want start", inst.CurrentStepID)
	}

	// Complete the human task: simulate the task-service handing a completed
	// task back to the engine to resume.
	task := &model.HumanTask{
		ID:         "task-1",
		TenantID:   cprTenant,
		InstanceID: inst.ID,
		StepID:     "start",
		StepExecID: instRepo.lastExecIDForStep("start"),
		Status:     model.TaskStatusCompleted,
		FormData:   map[string]interface{}{"note": "done"},
	}
	if err := engine.ResumeFromTask(context.Background(), task); err != nil {
		t.Fatalf("ResumeFromTask() error = %v", err)
	}

	final, err := instRepo.GetByID(context.Background(), cprTenant, inst.ID)
	if err != nil {
		t.Fatalf("GetByID(instance) error = %v", err)
	}
	if final.Status != model.InstanceStatusCompleted {
		t.Fatalf("instance status after completing task = %q, want completed", final.Status)
	}
	if final.CompletedAt == nil {
		t.Fatalf("completed_at is nil, want a timestamp")
	}
}

// TestActivateSingleStepDefinitionReturnsStructuredErrors pins the negative path:
// the old broken default (a lone end step) must fail activation and the error
// must carry the structured validation list (incl. the >=2-steps rule) so the
// handler can surface it.
func TestActivateSingleStepDefinitionReturnsStructuredErrors(t *testing.T) {
	repo := newStatefulDefRepo()
	svc := NewDefinitionService(repo, zerolog.Nop())

	def, err := svc.Create(context.Background(), cprTenant, cprUser, dto.CreateDefinitionRequest{
		Name:          "Broken One Step",
		Category:      model.CategoryCustom,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{},
		Steps: []model.StepDefinition{
			{ID: "end_1", Type: model.StepTypeEnd, Name: "End", Config: map[string]interface{}{}},
		},
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	err = svc.Activate(context.Background(), cprTenant, def.ID)
	if err == nil {
		t.Fatal("Activate() on a 1-step definition returned nil, want a validation error")
	}

	var vErr *ValidationFailedError
	if !errors.As(err, &vErr) {
		t.Fatalf("Activate() error type = %T (%v), want *ValidationFailedError", err, err)
	}
	if len(vErr.Errors) == 0 {
		t.Fatal("ValidationFailedError carries no structured errors, want >=1")
	}

	// The >=2-steps rule must be one of the reported problems.
	var sawStepsRule bool
	for _, e := range vErr.ValidationErrors() {
		if e.Field == "steps" && e.Message == "workflow must contain at least 2 steps" {
			sawStepsRule = true
		}
	}
	if !sawStepsRule {
		t.Fatalf("structured errors %+v missing the >=2-steps rule", vErr.Errors)
	}

	// The definition must remain in draft after a failed activation.
	got, err := repo.GetByID(context.Background(), cprTenant, def.ID)
	if err != nil {
		t.Fatalf("GetByID() error = %v", err)
	}
	if got.Status != model.DefinitionStatusDraft {
		t.Fatalf("status after failed activate = %q, want draft", got.Status)
	}
}

// TestStartInstanceOnDraftReturnsPublishGuidance pins fix #4: starting an
// instance on a draft definition returns a clear "in draft - publish first"
// error rather than an ambiguous not-found.
func TestStartInstanceOnDraftReturnsPublishGuidance(t *testing.T) {
	defRepo := newStatefulDefRepo()
	defSvc := NewDefinitionService(defRepo, zerolog.Nop())

	def, err := defSvc.Create(context.Background(), cprTenant, cprUser, dto.CreateDefinitionRequest{
		Name:          "Still Draft",
		Category:      model.CategoryCustom,
		TriggerConfig: model.TriggerConfig{Type: model.TriggerTypeManual},
		Variables:     map[string]model.VariableDef{},
		Steps:         defaultPublishableSteps(),
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	engine := NewEngineService(newStatefulInstanceRepo(), defRepo, newRecordingTaskRepo(), &parkingHumanTaskExecutor{}, nil, zerolog.Nop())
	_, err = engine.StartInstance(context.Background(), cprTenant, cprUser, dto.StartInstanceRequest{DefinitionID: def.ID})
	if err == nil {
		t.Fatal("StartInstance() on a draft definition returned nil, want an error")
	}
	if !contains(err.Error(), "draft") || !contains(err.Error(), "publish") {
		t.Fatalf("draft-start error = %q, want it to mention draft + publish", err.Error())
	}
}

func contains(haystack, needle string) bool {
	return len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// statefulDefRepo persists definitions in a map so Create/GetByID/GetActiveByID/
// Update reflect one another (unlike the recording repo, which only logs calls).
type statefulDefRepo struct {
	byID map[string]*model.WorkflowDefinition
}

func newStatefulDefRepo() *statefulDefRepo {
	return &statefulDefRepo{byID: map[string]*model.WorkflowDefinition{}}
}

func (r *statefulDefRepo) Create(_ context.Context, def *model.WorkflowDefinition) error {
	cp := *def
	r.byID[def.ID] = &cp
	return nil
}

func (r *statefulDefRepo) GetByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	def, ok := r.byID[id]
	if !ok || def.TenantID != tenantID {
		return nil, model.ErrNotFound
	}
	cp := *def
	return &cp, nil
}

func (r *statefulDefRepo) GetActiveByID(_ context.Context, tenantID, id string) (*model.WorkflowDefinition, error) {
	def, ok := r.byID[id]
	if !ok || def.TenantID != tenantID || def.Status != model.DefinitionStatusActive {
		return nil, model.ErrNotFound
	}
	cp := *def
	return &cp, nil
}

func (r *statefulDefRepo) List(context.Context, string, string, string, string, string, string, int, int) ([]*model.WorkflowDefinition, int, error) {
	return nil, 0, nil
}

func (r *statefulDefRepo) ListVersions(context.Context, string, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

func (r *statefulDefRepo) Update(_ context.Context, def *model.WorkflowDefinition) error {
	cp := *def
	r.byID[def.ID] = &cp
	return nil
}

func (r *statefulDefRepo) SoftDelete(context.Context, string, string) error { return nil }

func (r *statefulDefRepo) GetMaxVersion(context.Context, string, string) (int, error) { return 1, nil }

func (r *statefulDefRepo) GetActiveByTriggerTopic(context.Context, string) ([]*model.WorkflowDefinition, error) {
	return nil, nil
}

// statefulInstanceRepo persists a single instance plus its step executions.
type statefulInstanceRepo struct {
	inst       *model.WorkflowInstance
	executions []*model.StepExecution
}

func newStatefulInstanceRepo() *statefulInstanceRepo { return &statefulInstanceRepo{} }

func (r *statefulInstanceRepo) Create(_ context.Context, inst *model.WorkflowInstance) error {
	cp := *inst
	r.inst = &cp
	return nil
}

func (r *statefulInstanceRepo) GetByID(_ context.Context, _, _ string) (*model.WorkflowInstance, error) {
	if r.inst == nil {
		return nil, model.ErrNotFound
	}
	cp := *r.inst
	return &cp, nil
}

func (r *statefulInstanceRepo) UpdateWithLock(_ context.Context, inst *model.WorkflowInstance) error {
	cp := *inst
	r.inst = &cp
	return nil
}

func (r *statefulInstanceRepo) List(context.Context, string, string, string, string, *time.Time, *time.Time, string, string, int, int) ([]*model.WorkflowInstance, int, error) {
	return nil, 0, nil
}

func (r *statefulInstanceRepo) ListRunning(context.Context, int, int) ([]*model.WorkflowInstance, error) {
	return nil, nil
}

func (r *statefulInstanceRepo) CreateStepExecution(_ context.Context, exec *model.StepExecution) error {
	cp := *exec
	r.executions = append(r.executions, &cp)
	return nil
}

func (r *statefulInstanceRepo) UpdateStepExecution(_ context.Context, exec *model.StepExecution) error {
	for i, e := range r.executions {
		if e.ID == exec.ID {
			cp := *exec
			r.executions[i] = &cp
			return nil
		}
	}
	return nil
}

func (r *statefulInstanceRepo) GetStepExecutions(_ context.Context, _ string) ([]*model.StepExecution, error) {
	return r.executions, nil
}

func (r *statefulInstanceRepo) GetLastFailedStep(context.Context, string) (*model.StepExecution, error) {
	return nil, nil
}

// lastExecIDForStep returns the id of the most recent step execution for stepID.
func (r *statefulInstanceRepo) lastExecIDForStep(stepID string) string {
	for i := len(r.executions) - 1; i >= 0; i-- {
		if r.executions[i].StepID == stepID {
			return r.executions[i].ID
		}
	}
	return ""
}

// recordingTaskRepo is a no-op task repo sufficient for the happy/negative paths.
type recordingTaskRepo struct {
	created []*model.HumanTask
}

func newRecordingTaskRepo() *recordingTaskRepo { return &recordingTaskRepo{} }

func (r *recordingTaskRepo) Create(_ context.Context, task *model.HumanTask) error {
	r.created = append(r.created, task)
	return nil
}
func (r *recordingTaskRepo) GetByID(context.Context, string, string) (*model.HumanTask, error) {
	return nil, model.ErrNotFound
}
func (r *recordingTaskRepo) ListForUser(context.Context, string, string, []string, []string, string, string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *recordingTaskRepo) ListMyQueues(context.Context, string, string, []string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *recordingTaskRepo) ClaimTask(context.Context, string, string, string) error   { return nil }
func (r *recordingTaskRepo) UnclaimTask(context.Context, string, string, string) error { return nil }
func (r *recordingTaskRepo) CompleteTask(context.Context, string, string, map[string]interface{}, map[string]bool) error {
	return nil
}
func (r *recordingTaskRepo) DelegateTask(context.Context, string, string, string, string, string) error {
	return nil
}
func (r *recordingTaskRepo) RejectTask(context.Context, string, string, string, string) error {
	return nil
}
func (r *recordingTaskRepo) CountByStatus(context.Context, string, string, []string) (map[string]int, error) {
	return nil, nil
}
func (r *recordingTaskRepo) ListByInstanceStep(context.Context, string, string, string) ([]*model.HumanTask, error) {
	return nil, nil
}
func (r *recordingTaskRepo) GetOverdueTasks(context.Context, int) ([]*model.HumanTask, error) {
	return nil, nil
}
func (r *recordingTaskRepo) MarkSLABreached(context.Context, string) error      { return nil }
func (r *recordingTaskRepo) EscalateTask(context.Context, string, string) error { return nil }
func (r *recordingTaskRepo) CancelByInstance(context.Context, string) error     { return nil }
func (r *recordingTaskRepo) CancelOpenByInstanceStep(context.Context, string, string) error {
	return nil
}
func (r *recordingTaskRepo) UpdateMetadata(context.Context, string, string, map[string]interface{}) error {
	return nil
}
func (r *recordingTaskRepo) DailyCreatedCounts(context.Context, string, int) ([]int, error) {
	return nil, nil
}

// parkingHumanTaskExecutor mirrors the real human_task executor's relevant
// behavior: it parks the step (waiting for external completion) so the instance
// stays running until ResumeFromTask drives it forward.
type parkingHumanTaskExecutor struct{}

func (parkingHumanTaskExecutor) Execute(_ context.Context, _ *model.WorkflowInstance, step *model.StepDefinition, _ *model.StepExecution) (*executor.ExecutionResult, error) {
	if step.Type == model.StepTypeHumanTask {
		return nil, executor.ErrParked
	}
	return &executor.ExecutionResult{}, nil
}

var _ definitionRepo = (*statefulDefRepo)(nil)
var _ instanceRepo = (*statefulInstanceRepo)(nil)
var _ taskRepo = (*recordingTaskRepo)(nil)
var _ executorRegistry = (*parkingHumanTaskExecutor)(nil)
