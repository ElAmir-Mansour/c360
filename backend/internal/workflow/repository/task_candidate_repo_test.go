package repository

import (
	"context"
	"errors"
	"regexp"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/workflow/model"
)

// These tests exercise the candidate-group / work-queue (pool) assignment paths
// on the TaskRepository against a pgxmock pool injected through the
// newTaskRepositoryWithDB seam. Because the repository runs every statement
// inside an RLS-scoped transaction (beginScoped / rlsExec / newScopedPool), each
// test sets up the full ExpectBegin -> set_config -> <query> -> ExpectCommit
// sequence, mirroring the production SET LOCAL tenant scope.

const (
	catTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	catTaskID = "cccccccc-0000-0000-0000-000000000009"
	catUser   = "bbbbbbbb-0000-0000-0000-00000000000a"
)

func newTaskMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

// expectTenantScope sets the ExpectBegin + the SET LOCAL app.current_tenant_id
// set_config that beginScoped runs before the real statement.
func expectTenantScope(mock pgxmock.PgxPoolIface, tenantID string) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SELECT set_config('app.current_tenant_id',")).
		WithArgs(tenantID).
		WillReturnResult(pgxmock.NewResult("SELECT", 1))
}

// TestTaskRepo_CreatePersistsCandidatePool proves Create writes the
// candidate_groups / candidate_users arrays alongside the single assignee/role.
func TestTaskRepo_CreatePersistsCandidatePool(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	now := time.Date(2026, 7, 2, 9, 0, 0, 0, time.UTC)
	task := &model.HumanTask{
		TenantID:        catTenant,
		InstanceID:      "11111111-1111-1111-1111-111111111111",
		StepID:          "review",
		StepExecID:      "22222222-2222-2222-2222-222222222222",
		Name:            "Review",
		Status:          model.TaskStatusPending,
		CandidateGroups: []string{"legal-reviewers", "compliance"},
		CandidateUsers:  []string{catUser},
		FormSchema:      []model.FormField{},
		Metadata:        map[string]interface{}{},
	}

	expectTenantScope(mock, catTenant)
	// The candidate arrays are positional args 10 (groups) and 11 (users).
	mock.ExpectQuery(`(?s)INSERT INTO workflow_tasks.*candidate_groups, candidate_users.*RETURNING id, created_at, updated_at`).
		WithArgs(
			task.TenantID, task.InstanceID, task.StepID, task.StepExecID,
			task.Name, task.Description, task.Status,
			task.AssigneeID, task.AssigneeRole,
			[]string{"legal-reviewers", "compliance"},
			[]string{catUser},
			pgxmock.AnyArg(), // form_schema
			pgxmock.AnyArg(), // form_data
			task.SLADeadline, task.Priority,
			pgxmock.AnyArg(), // metadata
			task.DelegatedBy, task.DelegatedAt,
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at", "updated_at"}).
			AddRow(catTaskID, now, now))
	mock.ExpectCommit()

	if err := repo.Create(context.Background(), task); err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if task.ID != catTaskID {
		t.Fatalf("Create() id = %q, want %q", task.ID, catTaskID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestTaskRepo_ListForUserOffersGroupPool proves the visibility predicate for a
// user with roles surfaces (a) their owned work, (b) legacy role-claimable work,
// AND (c) unclaimed pending pool tasks whose candidate_groups overlap a role or
// whose candidate_users names them. The single group task is returned.
func TestTaskRepo_ListForUserOffersGroupPool(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	roles := []string{"legal-reviewers"}
	now := time.Date(2026, 7, 2, 9, 0, 0, 0, time.UTC)

	expectTenantScope(mock, catTenant)
	// COUNT under the visibility predicate — assert the candidate predicates are
	// present so a group member sees the pool.
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM workflow_tasks WHERE.*candidate_groups && ARRAY.*claimed_by IS NULL.*ANY\(candidate_users\)`).
		WithArgs(catTenant, catUser, "legal-reviewers").
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))

	mock.ExpectQuery(`(?s)SELECT id, tenant_id.*candidate_groups, candidate_users.*FROM workflow_tasks WHERE.*ORDER BY`).
		WithArgs(catTenant, catUser, "legal-reviewers", 20, 0).
		WillReturnRows(taskRowsWith(now, taskRow{
			id: catTaskID, status: model.TaskStatusPending,
			candidateGroups: []string{"legal-reviewers"},
		}))
	mock.ExpectCommit()

	tasks, total, err := repo.ListForUser(context.Background(), catTenant, catUser, roles, nil, "", "", 20, 0)
	if err != nil {
		t.Fatalf("ListForUser() error = %v", err)
	}
	if total != 1 || len(tasks) != 1 {
		t.Fatalf("ListForUser() total=%d len=%d, want 1/1", total, len(tasks))
	}
	if got := tasks[0].CandidateGroups; len(got) != 1 || got[0] != "legal-reviewers" {
		t.Fatalf("candidate_groups = %v, want [legal-reviewers]", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestTaskRepo_ListForUserMatchingMetadataFiltersBeforePagination(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	roles := []string{"legal-cases-manager"}
	statuses := []string{model.TaskStatusPending, model.TaskStatusClaimed, model.TaskStatusEscalated}
	now := time.Date(2026, 7, 13, 9, 0, 0, 0, time.UTC)
	matches := []TaskMetadataMatch{
		{Key: "subject_type", Value: "legal_case"},
		{Key: "source", Value: "lex_case_intake"},
	}

	expectTenantScope(mock, catTenant)
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM workflow_tasks WHERE.*status = ANY.*metadata ->>.*=.*AND.*metadata ->>.*=`).
		WithArgs(catTenant, catUser, "legal-cases-manager", statuses, "subject_type", "legal_case", "source", "lex_case_intake").
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT id, tenant_id.*FROM workflow_tasks WHERE.*metadata ->>.*ORDER BY created_at ASC.*LIMIT.*OFFSET`).
		WithArgs(catTenant, catUser, "legal-cases-manager", statuses, "subject_type", "legal_case", "source", "lex_case_intake", 25, 25).
		WillReturnRows(taskRowsWith(now, taskRow{
			id:       catTaskID,
			status:   model.TaskStatusPending,
			metadata: []byte(`{"subject_type":"legal_case","source":"lex_case_intake"}`),
		}))
	mock.ExpectCommit()

	tasks, total, err := repo.ListForUserMatchingMetadata(
		context.Background(), catTenant, catUser, roles, statuses, matches, "created_at", "asc", 25, 25,
	)
	if err != nil {
		t.Fatalf("ListForUserMatchingMetadata() error = %v", err)
	}
	if total != 1 || len(tasks) != 1 {
		t.Fatalf("ListForUserMatchingMetadata() total=%d len=%d, want 1/1", total, len(tasks))
	}
	if got := tasks[0].Metadata["source"]; got != "lex_case_intake" {
		t.Fatalf("metadata source = %v, want lex_case_intake", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestTaskRepo_ClaimFromPoolWinner proves the winning claimant locks the pending
// row (FOR UPDATE SKIP LOCKED returns it) and flips it to claimed+owned.
func TestTaskRepo_ClaimFromPoolWinner(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	expectTenantScope(mock, catTenant)
	mock.ExpectQuery(`(?s)SELECT id FROM workflow_tasks.*status = 'pending'.*FOR UPDATE SKIP LOCKED`).
		WithArgs(catTaskID, catTenant).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(catTaskID))
	mock.ExpectExec(`(?s)UPDATE workflow_tasks.*SET status = 'claimed', claimed_by = \$2, assignee_id = \$2`).
		WithArgs(catTaskID, catUser).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	if err := repo.ClaimTask(context.Background(), catTenant, catTaskID, catUser); err != nil {
		t.Fatalf("ClaimTask() winner error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestTaskRepo_ClaimFromPoolLoser proves a concurrent claimant that loses the
// SKIP LOCKED race (row already locked -> zero rows) gets ErrTaskNotClaimable and
// performs NO update. This is the exactly-one-winner guarantee at the SQL
// contract level: only the winner reaches the UPDATE.
func TestTaskRepo_ClaimFromPoolLoser(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	expectTenantScope(mock, catTenant)
	mock.ExpectQuery(`(?s)SELECT id FROM workflow_tasks.*FOR UPDATE SKIP LOCKED`).
		WithArgs(catTaskID, catTenant).
		WillReturnError(pgx.ErrNoRows)
	mock.ExpectRollback()

	err := repo.ClaimTask(context.Background(), catTenant, catTaskID, "other-user")
	if !errors.Is(err, model.ErrTaskNotClaimable) {
		t.Fatalf("ClaimTask() loser error = %v, want ErrTaskNotClaimable", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestTaskRepo_UnclaimReturnsPoolTask proves a claimed pool task is returned to
// its queue (status->pending, owner cleared) and the pool guard is in the WHERE.
func TestTaskRepo_UnclaimReturnsPoolTask(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	expectTenantScope(mock, catTenant)
	mock.ExpectExec(`(?s)UPDATE workflow_tasks.*SET status = 'pending'.*claimed_by = NULL.*assignee_id = NULL.*cardinality\(candidate_groups\) > 0 OR cardinality\(candidate_users\) > 0`).
		WithArgs(catTaskID, catTenant, catUser).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))
	mock.ExpectCommit()

	if err := repo.UnclaimTask(context.Background(), catTenant, catTaskID, catUser); err != nil {
		t.Fatalf("UnclaimTask() error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestTaskRepo_UnclaimLegacyTaskRejected proves a legacy single-assignee task
// (no candidate pool) cannot be unclaimed: the pool guard matches zero rows and
// the repository returns ErrTaskNotOwned.
func TestTaskRepo_UnclaimLegacyTaskRejected(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	expectTenantScope(mock, catTenant)
	mock.ExpectExec(`(?s)UPDATE workflow_tasks.*SET status = 'pending'`).
		WithArgs(catTaskID, catTenant, catUser).
		WillReturnResult(pgxmock.NewResult("UPDATE", 0)) // no candidate pool -> no row
	mock.ExpectCommit()

	err := repo.UnclaimTask(context.Background(), catTenant, catTaskID, catUser)
	if !errors.Is(err, model.ErrTaskNotOwned) {
		t.Fatalf("UnclaimTask() legacy error = %v, want ErrTaskNotOwned", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestTaskRepo_ListMyQueuesOnlyPoolWork proves the group-inbox query returns only
// unclaimed, unassigned pending pool work the user is eligible for.
func TestTaskRepo_ListMyQueuesOnlyPoolWork(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	now := time.Date(2026, 7, 2, 9, 0, 0, 0, time.UTC)
	expectTenantScope(mock, catTenant)
	mock.ExpectQuery(`(?s)SELECT COUNT\(\*\) FROM workflow_tasks WHERE.*status = 'pending'.*claimed_by IS NULL.*assignee_id IS NULL`).
		WithArgs(catTenant, catUser, "legal-reviewers").
		WillReturnRows(pgxmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectQuery(`(?s)SELECT id, tenant_id.*FROM workflow_tasks WHERE.*ORDER BY priority DESC, created_at ASC`).
		WithArgs(catTenant, catUser, "legal-reviewers", 20, 0).
		WillReturnRows(taskRowsWith(now, taskRow{
			id: catTaskID, status: model.TaskStatusPending,
			candidateGroups: []string{"legal-reviewers"},
		}))
	mock.ExpectCommit()

	tasks, total, err := repo.ListMyQueues(context.Background(), catTenant, catUser, []string{"legal-reviewers"}, 20, 0)
	if err != nil {
		t.Fatalf("ListMyQueues() error = %v", err)
	}
	if total != 1 || len(tasks) != 1 {
		t.Fatalf("ListMyQueues() total=%d len=%d, want 1/1", total, len(tasks))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// taskRow is a minimal spec for building a workflow_tasks result row in the exact
// taskSelectCols order used by scanTasks.
type taskRow struct {
	id              string
	status          string
	candidateGroups []string
	candidateUsers  []string
	metadata        []byte
}

// taskRowsWith builds a pgxmock Rows matching the taskSelectCols projection.
func taskRowsWith(now time.Time, rows ...taskRow) *pgxmock.Rows {
	cols := []string{
		"id", "tenant_id", "instance_id", "step_id", "step_exec_id",
		"name", "description", "status",
		"assignee_id", "assignee_role",
		"candidate_groups", "candidate_users",
		"claimed_by", "claimed_at",
		"form_schema", "form_data",
		"sla_deadline", "sla_breached",
		"escalated_to", "escalation_role",
		"delegated_by", "delegated_at",
		"priority", "metadata",
		"completed_at",
		"late_justification", "late_justification_submitted_by",
		"late_justification_submitted_at", "late_justification_manager_role",
		"created_at", "updated_at",
	}
	r := pgxmock.NewRows(cols)
	for _, tr := range rows {
		groups := tr.candidateGroups
		if groups == nil {
			groups = []string{}
		}
		users := tr.candidateUsers
		if users == nil {
			users = []string{}
		}
		metadata := tr.metadata
		if metadata == nil {
			metadata = []byte(`{}`)
		}
		r.AddRow(
			tr.id, catTenant, "11111111-1111-1111-1111-111111111111", "review", "22222222-2222-2222-2222-222222222222",
			"Review", "", tr.status,
			(*string)(nil), (*string)(nil),
			groups, users,
			(*string)(nil), (*time.Time)(nil),
			[]byte(`[]`), []byte(nil),
			(*time.Time)(nil), false,
			(*string)(nil), (*string)(nil),
			(*string)(nil), (*time.Time)(nil),
			0, metadata,
			(*time.Time)(nil),
			(*string)(nil), (*string)(nil), (*time.Time)(nil), (*string)(nil),
			now, now,
		)
	}
	return r
}
