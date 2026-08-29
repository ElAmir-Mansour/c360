package repository

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/workflow/model"
)

// These tests pin the column count of the at-risk / approaching SLA queries
// against the scanTasks projection. A prior regression gave those queries a
// LOCAL 25-column list (missing candidate_groups / candidate_users) while
// scanTasks reads 27 columns, so every scan failed at runtime. Feeding the mock
// a full taskRowsWith row proves the SELECT projection and scanTasks
// agree: if the query's column list drifts short again, the scan errors here.

// expectSystemScope sets ExpectBegin + the SET LOCAL app.bypass_rls = 'on'
// set_config that newScopedPool applies for a WithSystemScope (cross-tenant)
// read. The SELECT + ExpectCommit (scopedRows.Close) follow.
func expectSystemScope(mock pgxmock.PgxPoolIface) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SELECT set_config('app.bypass_rls', 'on', true)")).
		WillReturnResult(pgxmock.NewResult("SELECT", 1))
}

// TestTaskRepo_GetAtRiskTasksScans27Cols proves GetAtRiskTasks selects the full
// taskSelectCols projection (incl. candidate_groups/candidate_users) so scanTasks
// scans without a column-count mismatch, and that the at_risk / not-breached /
// open predicate is present.
func TestTaskRepo_GetAtRiskTasksScans27Cols(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	now := time.Date(2026, 7, 2, 9, 0, 0, 0, time.UTC)
	expectSystemScope(mock)
	mock.ExpectQuery(`(?s)SELECT id, tenant_id.*candidate_groups, candidate_users.*FROM workflow_tasks WHERE at_risk = true.*sla_breached = false.*ORDER BY at_risk_since`).
		WithArgs(50).
		WillReturnRows(taskRowsWith(now, taskRow{
			id: catTaskID, status: model.TaskStatusPending,
			candidateGroups: []string{"legal-reviewers"},
			candidateUsers:  []string{catUser},
		}))
	mock.ExpectCommit()

	tasks, err := repo.GetAtRiskTasks(context.Background(), 50)
	if err != nil {
		t.Fatalf("GetAtRiskTasks() error = %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("GetAtRiskTasks() len = %d, want 1", len(tasks))
	}
	if got := tasks[0].CandidateGroups; len(got) != 1 || got[0] != "legal-reviewers" {
		t.Fatalf("candidate_groups scanned = %v, want [legal-reviewers]", got)
	}
	if got := tasks[0].CandidateUsers; len(got) != 1 || got[0] != catUser {
		t.Fatalf("candidate_users scanned = %v, want [%s]", got, catUser)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestTaskRepo_GetApproachingTasksScans27Cols proves GetApproachingTasks selects
// the full taskSelectCols projection so scanTasks scans cleanly, and that the
// interval-lookahead + at_risk predicate is present with the interval/limit args.
func TestTaskRepo_GetApproachingTasksScans27Cols(t *testing.T) {
	mock := newTaskMock(t)
	repo := newTaskRepositoryWithDB(mock)

	now := time.Date(2026, 7, 2, 9, 0, 0, 0, time.UTC)
	expectSystemScope(mock)
	mock.ExpectQuery(`(?s)SELECT id, tenant_id.*candidate_groups, candidate_users.*FROM workflow_tasks WHERE sla_breached = false.*at_risk = true.*sla_deadline <= now\(\).*ORDER BY sla_deadline`).
		WithArgs("3600 seconds", 25).
		WillReturnRows(taskRowsWith(now, taskRow{
			id: catTaskID, status: model.TaskStatusClaimed,
			candidateUsers: []string{catUser},
		}))
	mock.ExpectCommit()

	tasks, err := repo.GetApproachingTasks(context.Background(), time.Hour, 25)
	if err != nil {
		t.Fatalf("GetApproachingTasks() error = %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("GetApproachingTasks() len = %d, want 1", len(tasks))
	}
	if got := tasks[0].CandidateUsers; len(got) != 1 || got[0] != catUser {
		t.Fatalf("candidate_users scanned = %v, want [%s]", got, catUser)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
