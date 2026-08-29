package executor

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// fakeTaskCreator records created tasks and returns a configurable error.
type fakeTaskCreator struct {
	mu    sync.Mutex
	tasks []*model.HumanTask
	err   error
}

func (f *fakeTaskCreator) Create(_ context.Context, task *model.HumanTask) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.tasks = append(f.tasks, task)
	return nil
}

// fakeEventPublisher records published events and returns a configurable error.
type fakeEventPublisher struct {
	mu     sync.Mutex
	topics []string
	events []*events.Event
	err    error
}

func (f *fakeEventPublisher) Publish(_ context.Context, topic string, event *events.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.topics = append(f.topics, topic)
	f.events = append(f.events, event)
	return nil
}

func testInstance() *model.WorkflowInstance {
	startedBy := "user-1"
	return &model.WorkflowInstance{
		ID:            "inst-1",
		TenantID:      "aaaaaaaa-0000-0000-0000-000000000001",
		DefinitionID:  "def-1",
		DefinitionVer: 1,
		Variables:     map[string]interface{}{"severity": "high"},
		StartedBy:     &startedBy,
	}
}

func testStep() *model.StepDefinition {
	return &model.StepDefinition{
		ID:   "step-approve",
		Name: "Approve request",
		Type: "human_task",
		Config: map[string]interface{}{
			"form_fields": []interface{}{
				map[string]interface{}{
					"name":     "decision",
					"type":     "select",
					"label":    "Decision",
					"required": true,
					"options":  []interface{}{"approve", "reject"},
				},
			},
			"assignee_role":   "legal-reviewer",
			"escalation_role": "legal-lead",
			"sla_hours":       4.0,
		},
	}
}

func testExec() *model.StepExecution {
	return &model.StepExecution{ID: "exec-1"}
}

func TestHumanTaskExecute_CreatesTaskAndPublishesEvent(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{}
	executor := NewHumanTaskExecutor(creator, publisher, zerolog.Nop())

	result, err := executor.Execute(context.Background(), testInstance(), testStep(), testExec())
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if !result.Parked {
		t.Fatal("Execute() Parked = false, want true — human tasks must park the workflow")
	}

	if len(creator.tasks) != 1 {
		t.Fatalf("created tasks = %d, want 1", len(creator.tasks))
	}
	task := creator.tasks[0]
	if task.TenantID != "aaaaaaaa-0000-0000-0000-000000000001" {
		t.Errorf("task tenant = %s, want instance tenant", task.TenantID)
	}
	if task.Priority != 1 { // severity "high" → priority 1
		t.Errorf("task priority = %d, want 1 for high severity", task.Priority)
	}
	if got := result.Output["task_id"]; got != task.ID {
		t.Errorf("result task_id = %v, want %s", got, task.ID)
	}

	if len(publisher.events) != 1 {
		t.Fatalf("published events = %d, want 1", len(publisher.events))
	}
	if publisher.topics[0] != events.Topics.WorkflowEvents {
		t.Errorf("published topic = %s, want %s", publisher.topics[0], events.Topics.WorkflowEvents)
	}
	event := publisher.events[0]
	if event.Type != "com.clario360.workflow.task.created" {
		t.Errorf("event type = %s, want com.clario360.workflow.task.created", event.Type)
	}
	if event.TenantID != task.TenantID {
		t.Errorf("event tenant = %s, want %s", event.TenantID, task.TenantID)
	}

	var payload map[string]interface{}
	if err := event.Unmarshal(&payload); err != nil {
		t.Fatalf("unmarshaling event payload: %v", err)
	}
	if payload["task_id"] != task.ID {
		t.Errorf("payload task_id = %v, want %s", payload["task_id"], task.ID)
	}
	if payload["instance_id"] != "inst-1" {
		t.Errorf("payload instance_id = %v, want inst-1", payload["instance_id"])
	}
	if payload["assignee_role"] != "legal-reviewer" {
		t.Errorf("payload assignee_role = %v, want legal-reviewer", payload["assignee_role"])
	}
	if payload["initiator_id"] != "user-1" {
		t.Errorf("payload initiator_id = %v, want user-1", payload["initiator_id"])
	}
}

func TestHumanTaskExecute_NilPublisherSkipsEventWithoutPanic(t *testing.T) {
	creator := &fakeTaskCreator{}
	executor := NewHumanTaskExecutor(creator, nil, zerolog.Nop())

	result, err := executor.Execute(context.Background(), testInstance(), testStep(), testExec())
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if !result.Parked {
		t.Fatal("Execute() Parked = false, want true")
	}
	if len(creator.tasks) != 1 {
		t.Fatalf("created tasks = %d, want 1 — task creation must not depend on publishing", len(creator.tasks))
	}
}

func TestHumanTaskExecute_PublishFailureDoesNotFailStep(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{err: errors.New("outbox unavailable")}
	executor := NewHumanTaskExecutor(creator, publisher, zerolog.Nop())

	result, err := executor.Execute(context.Background(), testInstance(), testStep(), testExec())
	if err != nil {
		t.Fatalf("Execute() error = %v — publishing is best-effort, the step must succeed", err)
	}
	if !result.Parked {
		t.Fatal("Execute() Parked = false, want true")
	}
	if len(creator.tasks) != 1 {
		t.Fatalf("created tasks = %d, want 1", len(creator.tasks))
	}
}

func TestHumanTaskExecute_MissingFormFieldsFails(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{}
	executor := NewHumanTaskExecutor(creator, publisher, zerolog.Nop())

	step := testStep()
	delete(step.Config, "form_fields")

	if _, err := executor.Execute(context.Background(), testInstance(), step, testExec()); err == nil {
		t.Fatal("expected error for missing form_fields")
	}
	if len(creator.tasks) != 0 {
		t.Fatalf("created tasks = %d, want 0 on config error", len(creator.tasks))
	}
	if len(publisher.events) != 0 {
		t.Fatalf("published events = %d, want 0 on config error", len(publisher.events))
	}
}

func TestHumanTaskExecute_TaskCreationFailurePublishesNothing(t *testing.T) {
	creator := &fakeTaskCreator{err: errors.New("database down")}
	publisher := &fakeEventPublisher{}
	executor := NewHumanTaskExecutor(creator, publisher, zerolog.Nop())

	if _, err := executor.Execute(context.Background(), testInstance(), testStep(), testExec()); err == nil {
		t.Fatal("expected error when task creation fails")
	}
	if len(publisher.events) != 0 {
		t.Fatalf("published events = %d, want 0 — no event without a persisted task", len(publisher.events))
	}
}
