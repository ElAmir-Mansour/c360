package service

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// auditTaskRepo is a minimal taskRepo double for the audit-emission tests: it
// serves one claimable task by id and records the claim. All other methods are
// inert (the audit tests only drive ClaimTask).
type auditTaskRepo struct {
	task    *model.HumanTask
	claimed bool
}

func (r *auditTaskRepo) GetByID(_ context.Context, _, _ string) (*model.HumanTask, error) {
	cp := *r.task
	return &cp, nil
}
func (r *auditTaskRepo) ClaimTask(_ context.Context, _, _, userID string) error {
	r.claimed = true
	if r.task.ClaimedBy == nil {
		r.task.ClaimedBy = &userID
	}
	r.task.Status = model.TaskStatusClaimed
	return nil
}
func (r *auditTaskRepo) Create(context.Context, *model.HumanTask) error { return nil }
func (r *auditTaskRepo) ListForUser(context.Context, string, string, []string, []string, string, string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *auditTaskRepo) ListMyQueues(context.Context, string, string, []string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *auditTaskRepo) UnclaimTask(context.Context, string, string, string) error { return nil }
func (r *auditTaskRepo) CompleteTask(context.Context, string, string, map[string]interface{}, map[string]bool) error {
	return nil
}
func (r *auditTaskRepo) DelegateTask(context.Context, string, string, string, string, string) error {
	return nil
}
func (r *auditTaskRepo) RejectTask(context.Context, string, string, string, string) error { return nil }
func (r *auditTaskRepo) CountByStatus(context.Context, string, string, []string) (map[string]int, error) {
	return nil, nil
}
func (r *auditTaskRepo) ListByInstanceStep(context.Context, string, string, string) ([]*model.HumanTask, error) {
	return nil, nil
}
func (r *auditTaskRepo) GetOverdueTasks(context.Context, int) ([]*model.HumanTask, error) {
	return nil, nil
}
func (r *auditTaskRepo) MarkSLABreached(context.Context, string) error                  { return nil }
func (r *auditTaskRepo) EscalateTask(context.Context, string, string) error             { return nil }
func (r *auditTaskRepo) CancelByInstance(context.Context, string) error                 { return nil }
func (r *auditTaskRepo) CancelOpenByInstanceStep(context.Context, string, string) error { return nil }
func (r *auditTaskRepo) UpdateMetadata(context.Context, string, string, map[string]interface{}) error {
	return nil
}
func (r *auditTaskRepo) DailyCreatedCounts(context.Context, string, int) ([]int, error) {
	return nil, nil
}

var _ taskRepo = (*auditTaskRepo)(nil)

// capturingPublisher records every published event so a test can assert the
// audit emission (event type + topic).
type capturingPublisher struct {
	events []*events.Event
	topics []string
}

func (p *capturingPublisher) Publish(_ context.Context, topic string, evt *events.Event) error {
	p.topics = append(p.topics, topic)
	p.events = append(p.events, evt)
	return nil
}

var _ eventPublisher = (*capturingPublisher)(nil)

// TestTaskService_ClaimEmitsAuditEvent proves GAP B: claiming a task emits a
// workflow.task.claimed event to the workflow-events (audit) topic when an audit
// publisher is wired.
func TestTaskService_ClaimEmitsAuditEvent(t *testing.T) {
	repo := &auditTaskRepo{task: &model.HumanTask{
		ID:         "task-1",
		TenantID:   "tenant-1",
		InstanceID: "inst-1",
		StepID:     "step-1",
		Status:     model.TaskStatusPending,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}}
	pub := &capturingPublisher{}
	svc := NewTaskService(repo, nil, zerolog.Nop()).WithAuditPublisher(pub)

	if err := svc.ClaimTask(context.Background(), "tenant-1", "task-1", "user-1"); err != nil {
		t.Fatalf("ClaimTask error: %v", err)
	}
	if !repo.claimed {
		t.Fatal("expected the task to be claimed")
	}
	if len(pub.events) != 1 {
		t.Fatalf("published events = %d, want 1", len(pub.events))
	}
	// events.NewEvent applies the CloudEvents reverse-DNS type prefix, so assert on
	// the suffix (the audit-service's event mapper extracts the action from it).
	if got := pub.events[0].Type; !strings.HasSuffix(got, "workflow.task.claimed") {
		t.Fatalf("event type = %q, want suffix workflow.task.claimed", got)
	}
	if pub.topics[0] != events.Topics.WorkflowEvents {
		t.Fatalf("topic = %q, want %q", pub.topics[0], events.Topics.WorkflowEvents)
	}
}

// TestTaskService_ClaimNoPublisherIsSilent proves the emission is optional: with
// no publisher wired, claiming still succeeds and emits nothing (legacy path).
func TestTaskService_ClaimNoPublisherIsSilent(t *testing.T) {
	repo := &auditTaskRepo{task: &model.HumanTask{
		ID:       "task-1",
		TenantID: "tenant-1",
		Status:   model.TaskStatusPending,
	}}
	svc := NewTaskService(repo, nil, zerolog.Nop()) // no WithAuditPublisher

	if err := svc.ClaimTask(context.Background(), "tenant-1", "task-1", "user-1"); err != nil {
		t.Fatalf("ClaimTask error: %v", err)
	}
	if !repo.claimed {
		t.Fatal("expected the task to be claimed even without a publisher")
	}
}
