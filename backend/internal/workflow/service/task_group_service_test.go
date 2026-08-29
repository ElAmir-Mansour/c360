package service

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/workflow/model"
)

// groupTaskRepo is a taskRepo double for the candidate-group / work-queue service
// tests. It serves one configured task by id and implements an exactly-one-winner
// ClaimTask: the FIRST caller flips pending->claimed and wins; every subsequent
// caller sees a non-pending task and loses (ErrTaskNotClaimable), modelling the
// repository's FOR UPDATE SKIP LOCKED guarantee at the service boundary.
type groupTaskRepo struct {
	mu         sync.Mutex
	task       *model.HumanTask
	claimCount int32
	unclaimed  bool
}

func (r *groupTaskRepo) GetByID(_ context.Context, _, _ string) (*model.HumanTask, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *r.task
	return &cp, nil
}

func (r *groupTaskRepo) ClaimTask(_ context.Context, _, _, userID string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.task.Status != model.TaskStatusPending {
		return model.ErrTaskNotClaimable
	}
	r.task.Status = model.TaskStatusClaimed
	uid := userID
	r.task.ClaimedBy = &uid
	r.task.AssigneeID = &uid
	atomic.AddInt32(&r.claimCount, 1)
	return nil
}

func (r *groupTaskRepo) UnclaimTask(_ context.Context, _, _, _ string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.unclaimed = true
	r.task.Status = model.TaskStatusPending
	r.task.ClaimedBy = nil
	r.task.AssigneeID = nil
	return nil
}

func (r *groupTaskRepo) Create(context.Context, *model.HumanTask) error { return nil }
func (r *groupTaskRepo) ListForUser(context.Context, string, string, []string, []string, string, string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *groupTaskRepo) ListMyQueues(context.Context, string, string, []string, int, int) ([]*model.HumanTask, int, error) {
	return nil, 0, nil
}
func (r *groupTaskRepo) CompleteTask(context.Context, string, string, map[string]interface{}, map[string]bool) error {
	return nil
}
func (r *groupTaskRepo) DelegateTask(context.Context, string, string, string, string, string) error {
	return nil
}
func (r *groupTaskRepo) RejectTask(context.Context, string, string, string, string) error { return nil }
func (r *groupTaskRepo) CountByStatus(context.Context, string, string, []string) (map[string]int, error) {
	return nil, nil
}
func (r *groupTaskRepo) ListByInstanceStep(context.Context, string, string, string) ([]*model.HumanTask, error) {
	return nil, nil
}
func (r *groupTaskRepo) GetOverdueTasks(context.Context, int) ([]*model.HumanTask, error) {
	return nil, nil
}
func (r *groupTaskRepo) MarkSLABreached(context.Context, string) error      { return nil }
func (r *groupTaskRepo) EscalateTask(context.Context, string, string) error { return nil }
func (r *groupTaskRepo) CancelByInstance(context.Context, string) error     { return nil }
func (r *groupTaskRepo) CancelOpenByInstanceStep(context.Context, string, string) error {
	return nil
}
func (r *groupTaskRepo) UpdateMetadata(context.Context, string, string, map[string]interface{}) error {
	return nil
}
func (r *groupTaskRepo) DailyCreatedCounts(context.Context, string, int) ([]int, error) {
	return nil, nil
}

var _ taskRepo = (*groupTaskRepo)(nil)

func newGroupTask() *model.HumanTask {
	return &model.HumanTask{
		ID:              "task-grp",
		TenantID:        "tenant-1",
		InstanceID:      "inst-1",
		StepID:          "review",
		Status:          model.TaskStatusPending,
		CandidateGroups: []string{"legal-reviewers"},
		CandidateUsers:  []string{"user-named"},
	}
}

// TestClaimFromPool_CandidateGroupMemberAllowed proves a member of a candidate
// group may claim an unassigned group task from the pool.
func TestClaimFromPool_CandidateGroupMemberAllowed(t *testing.T) {
	repo := &groupTaskRepo{task: newGroupTask()}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	if err := svc.ClaimTask(context.Background(), "tenant-1", "task-grp", "user-x", "legal-reviewers"); err != nil {
		t.Fatalf("group member claim error = %v, want nil", err)
	}
	if repo.claimCount != 1 {
		t.Fatalf("claimCount = %d, want 1", repo.claimCount)
	}
}

// TestClaimFromPool_NamedCandidateUserAllowed proves a named candidate user may
// claim even without a matching group.
func TestClaimFromPool_NamedCandidateUserAllowed(t *testing.T) {
	repo := &groupTaskRepo{task: newGroupTask()}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	if err := svc.ClaimTask(context.Background(), "tenant-1", "task-grp", "user-named"); err != nil {
		t.Fatalf("named candidate claim error = %v, want nil", err)
	}
}

// TestClaimFromPool_NonCandidateRejected proves a user who is neither in a
// candidate group nor a named candidate is rejected BEFORE racing for the lock.
func TestClaimFromPool_NonCandidateRejected(t *testing.T) {
	repo := &groupTaskRepo{task: newGroupTask()}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	err := svc.ClaimTask(context.Background(), "tenant-1", "task-grp", "outsider", "some-other-role")
	if err == nil {
		t.Fatal("expected non-candidate claim to be rejected, got nil")
	}
	if repo.claimCount != 0 {
		t.Fatalf("claimCount = %d, want 0 (never reached the repo)", repo.claimCount)
	}
}

// TestClaimFromPool_ExactlyOneWinnerUnderConcurrency proves that when many
// candidates race to claim the same pool task, exactly ONE succeeds and the rest
// are rejected — the service authorises all candidates, and the repo's
// single-winner claim (modelled here) admits only the first.
func TestClaimFromPool_ExactlyOneWinnerUnderConcurrency(t *testing.T) {
	repo := &groupTaskRepo{task: newGroupTask()}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	const n = 32
	var wg sync.WaitGroup
	var wins int32
	wg.Add(n)
	for i := 0; i < n; i++ {
		go func() {
			defer wg.Done()
			// All are members of the candidate group, so all are eligible; only one
			// wins the claim.
			if err := svc.ClaimTask(context.Background(), "tenant-1", "task-grp", "racer", "legal-reviewers"); err == nil {
				atomic.AddInt32(&wins, 1)
			}
		}()
	}
	wg.Wait()

	if wins != 1 {
		t.Fatalf("concurrent winners = %d, want exactly 1", wins)
	}
	if repo.claimCount != 1 {
		t.Fatalf("repo claimCount = %d, want exactly 1", repo.claimCount)
	}
}

// TestUnclaim_ReturnsPoolTask proves the claimant can return a claimed pool task
// to its queue.
func TestUnclaim_ReturnsPoolTask(t *testing.T) {
	task := newGroupTask()
	task.Status = model.TaskStatusClaimed
	owner := "owner-1"
	task.ClaimedBy = &owner
	repo := &groupTaskRepo{task: task}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	if err := svc.UnclaimTask(context.Background(), "tenant-1", "task-grp", "owner-1"); err != nil {
		t.Fatalf("UnclaimTask() error = %v", err)
	}
	if !repo.unclaimed {
		t.Fatal("expected the repo unclaim to be invoked")
	}
}

// TestUnclaim_OnlyClaimant proves a user who does not own the claimed task cannot
// unclaim it (guarded before touching the repo).
func TestUnclaim_OnlyClaimant(t *testing.T) {
	task := newGroupTask()
	task.Status = model.TaskStatusClaimed
	owner := "owner-1"
	task.ClaimedBy = &owner
	repo := &groupTaskRepo{task: task}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	if err := svc.UnclaimTask(context.Background(), "tenant-1", "task-grp", "not-owner"); err == nil {
		t.Fatal("expected non-owner unclaim to be rejected")
	}
	if repo.unclaimed {
		t.Fatal("repo unclaim must not run for a non-owner")
	}
}

// TestUnclaim_LegacyTaskHasNoPool proves a legacy single-assignee task (no
// candidates) cannot be unclaimed — there is no pool to return to.
func TestUnclaim_LegacyTaskHasNoPool(t *testing.T) {
	assignee := "owner-1"
	task := &model.HumanTask{
		ID:         "task-legacy",
		TenantID:   "tenant-1",
		Status:     model.TaskStatusClaimed,
		AssigneeID: &assignee,
		ClaimedBy:  &assignee,
		// No CandidateGroups / CandidateUsers -> not a pool task.
	}
	repo := &groupTaskRepo{task: task}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	if err := svc.UnclaimTask(context.Background(), "tenant-1", "task-legacy", "owner-1"); err == nil {
		t.Fatal("expected unclaim of a legacy non-pool task to be rejected")
	}
	if repo.unclaimed {
		t.Fatal("repo unclaim must not run for a legacy non-pool task")
	}
}

// TestClaim_LegacySingleAssigneeUnaffected proves a legacy single-assignee task
// (no candidate pool) still enforces the specific-assignee rule: the assignee can
// claim, a different user cannot — the candidate path is not consulted.
func TestClaim_LegacySingleAssigneeUnaffected(t *testing.T) {
	assignee := "owner-1"
	task := &model.HumanTask{
		ID:         "task-legacy",
		TenantID:   "tenant-1",
		Status:     model.TaskStatusPending,
		AssigneeID: &assignee,
	}
	repo := &groupTaskRepo{task: task}
	svc := NewTaskService(repo, nil, zerolog.Nop())

	// Wrong user -> rejected (unchanged legacy behaviour), never reaches repo.
	if err := svc.ClaimTask(context.Background(), "tenant-1", "task-legacy", "someone-else", "legal-reviewers"); err == nil {
		t.Fatal("expected a non-assignee to be rejected for a single-assignee task")
	}
	if repo.claimCount != 0 {
		t.Fatalf("claimCount = %d, want 0", repo.claimCount)
	}

	// Correct assignee -> claims.
	if err := svc.ClaimTask(context.Background(), "tenant-1", "task-legacy", "owner-1"); err != nil {
		t.Fatalf("assignee claim error = %v, want nil", err)
	}
}

// TestModel_UserIsCandidate exercises the membership predicate directly: a
// candidate user or a role match is a candidate; an outsider is not; and a task
// with no pool is never a group task.
func TestModel_UserIsCandidate(t *testing.T) {
	gt := newGroupTask()
	if !gt.IsGroupTask() {
		t.Fatal("newGroupTask should be a group task")
	}
	if !gt.UserIsCandidate("user-named", nil) {
		t.Fatal("named candidate user should be a candidate")
	}
	if !gt.UserIsCandidate("anyone", []string{"legal-reviewers"}) {
		t.Fatal("role member should be a candidate")
	}
	if gt.UserIsCandidate("outsider", []string{"unrelated"}) {
		t.Fatal("outsider must not be a candidate")
	}

	legacy := &model.HumanTask{ID: "l"}
	if legacy.IsGroupTask() {
		t.Fatal("a task with no candidates must not be a group task")
	}
}
