package repository

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/workflow/model"
)

// OUTBOX-ATOMICITY POLISH — repository proof.
//
// commitInstanceStateWithEventTx applies a lifecycle state UPDATE and stages the
// workflow.* audit event via outbox.Write within the SUPPLIED transaction. These
// tests drive it against a fake pgx.Tx (no DB) to prove:
//   1. a COMMITTED transition (UPDATE affects the row) stages exactly one
//      "INSERT INTO event_outbox" on the SAME tx, in order AFTER the state UPDATE;
//   2. a ROLLED-BACK transition (UPDATE conflicts, 0 rows) stages NOTHING — the
//      outbox INSERT is never issued, so a lost state change can never leave a
//      dangling audit event (and vice versa).

// fakeTx records the ordered Exec SQLs it receives and lets a test force the
// instance-UPDATE to affect 0 rows (an optimistic-lock conflict → rollback). It
// embeds pgx.Tx so it satisfies the interface; only the methods the code path
// touches are implemented — any other call panics loudly.
type fakeTx struct {
	pgx.Tx
	execSQLs     []string
	updateRows   int64 // RowsAffected returned for the instance UPDATE
	committed    bool
	rolledBack   bool
	queryRowSQLs []string
}

func (t *fakeTx) Exec(_ context.Context, sql string, _ ...any) (pgconn.CommandTag, error) {
	t.execSQLs = append(t.execSQLs, sql)
	// The optimistic-locked instance state change.
	if strings.Contains(sql, "UPDATE workflow_instances") {
		if t.updateRows == 1 {
			return pgconn.NewCommandTag("UPDATE 1"), nil
		}
		return pgconn.NewCommandTag("UPDATE 0"), nil
	}
	// The outbox staging INSERT (and any set_config scope call, though the tx body
	// itself issues none — the caller scopes the tx).
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

// scanReturningRow feeds createStepExecutionTx's RETURNING id, created_at scan so
// the end-step audit row path (completeInstance) can be exercised in the same tx.
type scanReturningRow struct{}

func (scanReturningRow) Scan(dest ...any) error {
	for _, d := range dest {
		switch v := d.(type) {
		case *string:
			*v = "step-exec-1"
		default:
			// created_at is time.Time; leave zero value.
		}
	}
	return nil
}

func (t *fakeTx) QueryRow(_ context.Context, sql string, _ ...any) pgx.Row {
	t.queryRowSQLs = append(t.queryRowSQLs, sql)
	return scanReturningRow{}
}

func (t *fakeTx) Commit(context.Context) error   { t.committed = true; return nil }
func (t *fakeTx) Rollback(context.Context) error { t.rolledBack = true; return nil }

func (t *fakeTx) outboxInserts() int {
	n := 0
	for _, s := range t.execSQLs {
		if strings.Contains(s, "INSERT INTO event_outbox") {
			n++
		}
	}
	return n
}

// indexOfSQL returns the position of the first exec whose SQL contains sub, or -1.
func (t *fakeTx) indexOfSQL(sub string) int {
	for i, s := range t.execSQLs {
		if strings.Contains(s, sub) {
			return i
		}
	}
	return -1
}

func outboxTestInstance() *model.WorkflowInstance {
	step := "s1"
	return &model.WorkflowInstance{
		ID:            "inst-outbox",
		TenantID:      "aaaaaaaa-0000-0000-0000-000000000001",
		DefinitionID:  "def-outbox",
		DefinitionVer: 1,
		Status:        model.InstanceStatusCompleted,
		CurrentStepID: &step,
		Variables:     map[string]interface{}{},
		StepOutputs:   map[string]interface{}{},
		LockVersion:   3,
	}
}

func outboxTestEvent(t *testing.T) *events.Event {
	t.Helper()
	evt, err := events.NewEvent("workflow.instance.completed", "workflow-engine",
		"aaaaaaaa-0000-0000-0000-000000000001", map[string]interface{}{"instance_id": "inst-outbox"})
	if err != nil {
		t.Fatalf("building event: %v", err)
	}
	return evt
}

// TestCommitInstanceStateWithEventTx_CommittedStagesEventInSameTx proves the audit
// event is staged into the outbox on the SAME transaction as the state change, and
// only after the state UPDATE — so it commits atomically with the state.
func TestCommitInstanceStateWithEventTx_CommittedStagesEventInSameTx(t *testing.T) {
	repo := NewInstanceRepository(nil) // no codec: plain JSONB, focuses the test on the tx path
	tx := &fakeTx{updateRows: 1}       // UPDATE affects the row → no conflict
	inst := outboxTestInstance()

	err := repo.commitInstanceStateWithEventTx(context.Background(), tx, inst, nil,
		events.Topics.WorkflowEvents, outboxTestEvent(t))
	if err != nil {
		t.Fatalf("commit tx body: unexpected error: %v", err)
	}

	// Exactly one audit event staged, on THIS tx.
	if got := tx.outboxInserts(); got != 1 {
		t.Fatalf("outbox inserts on committed transition = %d, want 1", got)
	}

	// Ordering: the outbox INSERT must come AFTER the instance state UPDATE, so the
	// event is staged only once the state write in the same tx has succeeded.
	updIdx := tx.indexOfSQL("UPDATE workflow_instances")
	obIdx := tx.indexOfSQL("INSERT INTO event_outbox")
	if updIdx < 0 || obIdx < 0 || obIdx < updIdx {
		t.Fatalf("expected state UPDATE (idx %d) before outbox INSERT (idx %d); execs=%v", updIdx, obIdx, tx.execSQLs)
	}

	// The lock version was advanced on the caller's struct (the committed row).
	if inst.LockVersion != 4 {
		t.Fatalf("lock version after commit = %d, want 4", inst.LockVersion)
	}
}

// TestCommitInstanceStateWithEventTx_WithEndStepRowSameTx proves completeInstance's
// end-step audit row and the audit event share the one transaction.
func TestCommitInstanceStateWithEventTx_WithEndStepRowSameTx(t *testing.T) {
	repo := NewInstanceRepository(nil)
	tx := &fakeTx{updateRows: 1}
	inst := outboxTestInstance()
	endExec := &model.StepExecution{
		InstanceID: inst.ID,
		StepID:     "end",
		StepType:   model.StepTypeEnd,
		Status:     model.StepStatusCompleted,
		Attempt:    1,
	}

	err := repo.commitInstanceStateWithEventTx(context.Background(), tx, inst, endExec,
		events.Topics.WorkflowEvents, outboxTestEvent(t))
	if err != nil {
		t.Fatalf("commit tx body with end step: unexpected error: %v", err)
	}

	// The end-step INSERT went through this tx's QueryRow (RETURNING), and the audit
	// event was staged on the same tx.
	if len(tx.queryRowSQLs) != 1 || !strings.Contains(tx.queryRowSQLs[0], "workflow_step_executions") {
		t.Fatalf("expected one end-step INSERT via QueryRow on the tx, got %v", tx.queryRowSQLs)
	}
	if got := tx.outboxInserts(); got != 1 {
		t.Fatalf("outbox inserts = %d, want 1", got)
	}
	if endExec.ID != "step-exec-1" {
		t.Fatalf("end-step id not scanned back from the tx: %q", endExec.ID)
	}
}

// TestCommitInstanceStateWithEventTx_ConflictStagesNothing proves that when the
// optimistic-locked UPDATE affects no row (a concurrent committer won), the body
// returns model.ErrConcurrencyConfl BEFORE staging — so NO audit event is written.
// The caller's deferred Rollback then discards the whole (empty) transaction.
func TestCommitInstanceStateWithEventTx_ConflictStagesNothing(t *testing.T) {
	repo := NewInstanceRepository(nil)
	tx := &fakeTx{updateRows: 0} // UPDATE affects 0 rows → optimistic-lock conflict
	inst := outboxTestInstance()
	before := inst.LockVersion

	err := repo.commitInstanceStateWithEventTx(context.Background(), tx, inst, nil,
		events.Topics.WorkflowEvents, outboxTestEvent(t))
	if err == nil {
		t.Fatal("expected a conflict error on a rolled-back transition, got nil")
	}
	if !errors.Is(err, model.ErrConcurrencyConfl) {
		t.Fatalf("error = %v, want model.ErrConcurrencyConfl", err)
	}

	// The whole point: a rolled-back state transition must stage NO audit event.
	if got := tx.outboxInserts(); got != 0 {
		t.Fatalf("outbox inserts on rolled-back transition = %d, want 0 (no dangling audit event)", got)
	}
	// Lock version must NOT be advanced on a conflict.
	if inst.LockVersion != before {
		t.Fatalf("lock version mutated on conflict: %d → %d", before, inst.LockVersion)
	}
}

// TestCommitInstanceStateWithEvent_NilEventRejected pins the fail-closed guard: a
// nil event is rejected before any tx work, so the atomic path can never commit
// state with a missing audit event.
func TestCommitInstanceStateWithEvent_NilEventRejected(t *testing.T) {
	repo := NewInstanceRepository(nil)
	err := repo.CommitInstanceStateWithEvent(context.Background(), outboxTestInstance(), nil,
		events.Topics.WorkflowEvents, nil)
	if err == nil {
		t.Fatal("expected error for nil event, got nil")
	}
}
