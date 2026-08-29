package executor

import (
	"context"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// fakeSubstitutionResolver returns a canned outcome for any user, recording that
// it was consulted and with which user id.
type fakeSubstitutionResolver struct {
	outcome    SubstitutionOutcome
	consulted  bool
	consultFor string
}

func (f *fakeSubstitutionResolver) ResolveAssignee(_ context.Context, _ string, userID string) SubstitutionOutcome {
	f.consulted = true
	f.consultFor = userID
	return f.outcome
}

// assignedTestStep is a human-task step assigned to a SPECIFIC user (not a role),
// so the OOO resolver is consulted.
func assignedTestStep(assignee string) *model.StepDefinition {
	return &model.StepDefinition{
		ID:   "step-approve",
		Name: "Approve request",
		Type: "human_task",
		Config: map[string]interface{}{
			"form_fields": []interface{}{
				map[string]interface{}{
					"name": "decision", "type": "text", "label": "Decision", "required": true,
				},
			},
			"assignee":  assignee,
			"sla_hours": 4.0,
		},
	}
}

func TestHumanTaskExecute_OOO_ReassignsToDeputyAndAuditsEvent(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{}
	exec := NewHumanTaskExecutor(creator, publisher, zerolog.Nop())

	// alice is out of office; the deputy chain resolves to bob.
	resolver := &fakeSubstitutionResolver{
		outcome: SubstitutionOutcome{
			Assignee:    "bob",
			Substituted: true,
			Chain:       []SubstitutionHop{{From: "alice", To: "bob", Reason: "vacation"}},
		},
	}
	exec.SetSubstitutionResolver(resolver)

	result, err := exec.Execute(context.Background(), testInstance(), assignedTestStep("alice"), testExec())
	if err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if !result.Parked {
		t.Fatal("Execute() Parked = false, want true")
	}
	if !resolver.consulted || resolver.consultFor != "alice" {
		t.Fatalf("resolver not consulted for the original assignee; consulted=%v for=%q", resolver.consulted, resolver.consultFor)
	}

	if len(creator.tasks) != 1 {
		t.Fatalf("created tasks = %d, want 1", len(creator.tasks))
	}
	task := creator.tasks[0]
	if task.AssigneeID == nil || *task.AssigneeID != "bob" {
		t.Fatalf("task assignee = %v, want re-routed deputy 'bob'", task.AssigneeID)
	}
	if task.DelegatedBy == nil || *task.DelegatedBy != "alice" {
		t.Fatalf("task delegated_by = %v, want original assignee 'alice'", task.DelegatedBy)
	}
	// The typed delegated_at column must also be stamped so the hand-off is
	// durably recorded on the task (both columns are written by the repository
	// INSERT); metadata-only durability is not sufficient for the audit trail.
	if task.DelegatedAt == nil {
		t.Fatalf("task delegated_at = nil, want a timestamp for an OOO-reassigned task")
	}
	if task.Metadata[metaOOOReassigned] != true {
		t.Fatalf("task metadata %q = %v, want true", metaOOOReassigned, task.Metadata[metaOOOReassigned])
	}
	if task.Metadata[metaOOOOriginalAssignee] != "alice" {
		t.Fatalf("task metadata %q = %v, want 'alice'", metaOOOOriginalAssignee, task.Metadata[metaOOOOriginalAssignee])
	}

	// Two events must be published: task.created AND task.reassigned_ooo.
	var sawReassign bool
	for _, e := range publisher.events {
		if e.Type == "com.clario360.workflow.task.reassigned_ooo" {
			sawReassign = true
			var payload map[string]interface{}
			if uerr := e.Unmarshal(&payload); uerr != nil {
				t.Fatalf("unmarshaling reassign payload: %v", uerr)
			}
			if payload["original_assignee"] != "alice" {
				t.Errorf("reassign payload original_assignee = %v, want alice", payload["original_assignee"])
			}
			if payload["deputy_assignee"] != "bob" {
				t.Errorf("reassign payload deputy_assignee = %v, want bob", payload["deputy_assignee"])
			}
		}
	}
	if !sawReassign {
		t.Fatalf("expected a workflow.task.reassigned_ooo audit event; got types %v", eventTypes(publisher))
	}
}

func TestHumanTaskExecute_OOO_NoActiveWindow_Unaffected(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{}
	exec := NewHumanTaskExecutor(creator, publisher, zerolog.Nop())

	// Resolver reports NO substitution (the fast-path no-op).
	resolver := &fakeSubstitutionResolver{
		outcome: SubstitutionOutcome{Assignee: "alice", Substituted: false},
	}
	exec.SetSubstitutionResolver(resolver)

	if _, err := exec.Execute(context.Background(), testInstance(), assignedTestStep("alice"), testExec()); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	task := creator.tasks[0]
	if task.AssigneeID == nil || *task.AssigneeID != "alice" {
		t.Fatalf("assignee = %v, want unchanged 'alice' when not OOO", task.AssigneeID)
	}
	if task.DelegatedAt != nil {
		t.Fatalf("delegated_at = %v, want nil when not substituted", task.DelegatedAt)
	}
	if task.DelegatedBy != nil {
		t.Fatalf("delegated_by = %v, want nil when not substituted", task.DelegatedBy)
	}
	if _, ok := task.Metadata[metaOOOReassigned]; ok {
		t.Fatalf("did not expect OOO metadata when not substituted")
	}
	for _, e := range publisher.events {
		if e.Type == "com.clario360.workflow.task.reassigned_ooo" {
			t.Fatalf("did not expect a reassigned_ooo event for a non-OOO user")
		}
	}
}

func TestHumanTaskExecute_OOO_NoResolver_LegacyBehaviour(t *testing.T) {
	creator := &fakeTaskCreator{}
	publisher := &fakeEventPublisher{}
	exec := NewHumanTaskExecutor(creator, publisher, zerolog.Nop())
	// No resolver installed at all — the legacy path.

	if _, err := exec.Execute(context.Background(), testInstance(), assignedTestStep("alice"), testExec()); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	task := creator.tasks[0]
	if task.AssigneeID == nil || *task.AssigneeID != "alice" {
		t.Fatalf("assignee = %v, want 'alice' with no resolver (legacy)", task.AssigneeID)
	}
}

func eventTypes(p *fakeEventPublisher) []string {
	out := make([]string, 0, len(p.events))
	for _, e := range p.events {
		out = append(out, e.Type)
	}
	return out
}
