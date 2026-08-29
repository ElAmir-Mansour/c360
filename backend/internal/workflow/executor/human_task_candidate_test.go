package executor

import (
	"context"
	"testing"

	"github.com/rs/zerolog"
)

// TestHumanTaskExecute_ParsesCandidatePool proves a human_task step config that
// names candidate_groups / candidate_users produces a task carrying those pools
// (candidate-group / work-queue assignment), alongside any single assignee/role.
func TestHumanTaskExecute_ParsesCandidatePool(t *testing.T) {
	creator := &fakeTaskCreator{}
	exec := NewHumanTaskExecutor(creator, &fakeEventPublisher{}, zerolog.Nop())

	step := testStep()
	// A literal group, a ${...} group reference resolved from instance variables,
	// and a candidate user list.
	step.Config["candidate_groups"] = []interface{}{"legal-reviewers", "${variables.team}"}
	step.Config["candidate_users"] = []interface{}{"user-a", "user-b"}

	inst := testInstance()
	inst.Variables["team"] = "compliance"

	if _, err := exec.Execute(context.Background(), inst, step, testExec()); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if len(creator.tasks) != 1 {
		t.Fatalf("created tasks = %d, want 1", len(creator.tasks))
	}
	task := creator.tasks[0]

	wantGroups := map[string]bool{"legal-reviewers": true, "compliance": true}
	if len(task.CandidateGroups) != len(wantGroups) {
		t.Fatalf("candidate_groups = %v, want %v", task.CandidateGroups, wantGroups)
	}
	for _, g := range task.CandidateGroups {
		if !wantGroups[g] {
			t.Fatalf("unexpected candidate group %q in %v", g, task.CandidateGroups)
		}
	}
	if len(task.CandidateUsers) != 2 || task.CandidateUsers[0] != "user-a" || task.CandidateUsers[1] != "user-b" {
		t.Fatalf("candidate_users = %v, want [user-a user-b]", task.CandidateUsers)
	}
	if !task.IsGroupTask() {
		t.Fatal("task with candidates should report IsGroupTask")
	}
	// The single assignee_role from the base step config is preserved (additive).
	if task.AssigneeRole == nil || *task.AssigneeRole != "legal-reviewer" {
		t.Fatalf("assignee_role = %v, want legal-reviewer (candidate pool is additive)", task.AssigneeRole)
	}
}

// TestHumanTaskExecute_NoCandidatePoolIsLegacy proves a step with no candidate
// config yields empty pools (nil), so the task is a legacy single-assignee /
// single-role task, unaffected by the new columns.
func TestHumanTaskExecute_NoCandidatePoolIsLegacy(t *testing.T) {
	creator := &fakeTaskCreator{}
	exec := NewHumanTaskExecutor(creator, &fakeEventPublisher{}, zerolog.Nop())

	if _, err := exec.Execute(context.Background(), testInstance(), testStep(), testExec()); err != nil {
		t.Fatalf("Execute() error = %v", err)
	}
	if len(creator.tasks) != 1 {
		t.Fatalf("created tasks = %d, want 1", len(creator.tasks))
	}
	task := creator.tasks[0]
	if len(task.CandidateGroups) != 0 || len(task.CandidateUsers) != 0 {
		t.Fatalf("expected empty candidate pools, got groups=%v users=%v", task.CandidateGroups, task.CandidateUsers)
	}
	if task.IsGroupTask() {
		t.Fatal("a task with no candidates must not be a group task")
	}
}
