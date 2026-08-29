package repository

import (
	"context"
	"testing"
	"time"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/workflow/model"
)

func newActivityMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

// TestActivityRepo_ClaimWinsInsertsPendingRow proves the happy claim: the INSERT
// affects one row, so Claim reports claimed=true and does NOT read back.
func TestActivityRepo_ClaimWinsInsertsPendingRow(t *testing.T) {
	mock := newActivityMock(t)
	repo := newActivityExecutionRepositoryWithDB(mock)

	act := &model.ActivityExecution{
		IdempotencyKey: "inst-1:step-a:1",
		InstanceID:     "11111111-1111-1111-1111-111111111111",
		StepID:         "step-a",
		Attempt:        1,
	}

	mock.ExpectExec(`(?s)INSERT INTO workflow_activity_executions.*ON CONFLICT \(idempotency_key\) DO NOTHING`).
		WithArgs(act.IdempotencyKey, act.InstanceID, act.StepID, act.Attempt).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	claimed, existing, err := repo.Claim(context.Background(), act)
	if err != nil {
		t.Fatalf("Claim() error = %v", err)
	}
	if !claimed {
		t.Fatal("Claim() claimed = false, want true (won the insert)")
	}
	if existing != nil {
		t.Fatalf("Claim() existing = %+v, want nil on a winning claim", existing)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestActivityRepo_ClaimConflictReturnsCompletedRow proves the dedup path: on
// ON CONFLICT (0 rows inserted) Claim reads back the existing completed row so the
// caller can replay its cached response instead of re-firing.
func TestActivityRepo_ClaimConflictReturnsCompletedRow(t *testing.T) {
	mock := newActivityMock(t)
	repo := newActivityExecutionRepositoryWithDB(mock)

	key := "inst-1:step-a:1"
	now := time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC)

	mock.ExpectExec(`(?s)INSERT INTO workflow_activity_executions.*ON CONFLICT`).
		WithArgs(key, "11111111-1111-1111-1111-111111111111", "step-a", 1).
		WillReturnResult(pgxmock.NewResult("INSERT", 0)) // conflict: nothing inserted

	mock.ExpectQuery(`(?s)SELECT idempotency_key, instance_id, step_id, attempt, status.*FROM workflow_activity_executions.*WHERE idempotency_key = \$1`).
		WithArgs(key).
		WillReturnRows(pgxmock.NewRows([]string{
			"idempotency_key", "instance_id", "step_id", "attempt", "status",
			"response_data", "error_message", "created_at", "updated_at",
		}).AddRow(
			key, "11111111-1111-1111-1111-111111111111", "step-a", 1, model.ActivityStatusCompleted,
			[]byte(`{"charged":true}`), (*string)(nil), now, now,
		))

	claimed, existing, err := repo.Claim(context.Background(), &model.ActivityExecution{
		IdempotencyKey: key,
		InstanceID:     "11111111-1111-1111-1111-111111111111",
		StepID:         "step-a",
		Attempt:        1,
	})
	if err != nil {
		t.Fatalf("Claim() error = %v", err)
	}
	if claimed {
		t.Fatal("Claim() claimed = true, want false (conflict — prior attempt owns the key)")
	}
	if existing == nil || existing.Status != model.ActivityStatusCompleted {
		t.Fatalf("Claim() existing = %+v, want a completed row", existing)
	}
	if string(existing.ResponseData) != `{"charged":true}` {
		t.Fatalf("Claim() cached response = %s, want the persisted body", string(existing.ResponseData))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

// TestActivityRepo_MarkCompletedCachesResponse asserts MarkCompleted writes the
// completed status + cached response body.
func TestActivityRepo_MarkCompletedCachesResponse(t *testing.T) {
	mock := newActivityMock(t)
	repo := newActivityExecutionRepositoryWithDB(mock)

	key := "inst-1:step-a:1"
	mock.ExpectExec(`(?s)UPDATE workflow_activity_executions.*SET status = 'completed'.*WHERE idempotency_key = \$1`).
		WithArgs(key, []byte(`{"ok":true}`)).
		WillReturnResult(pgxmock.NewResult("UPDATE", 1))

	if err := repo.MarkCompleted(context.Background(), key, []byte(`{"ok":true}`)); err != nil {
		t.Fatalf("MarkCompleted() error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}
