package outbox

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/events"
)

func newTestEvent(t *testing.T) *events.Event {
	t.Helper()
	event, err := events.NewEvent("workflow.instance.started", "workflow-engine", "aaaaaaaa-0000-0000-0000-000000000001", map[string]string{"instance_id": "wf-1"})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	return event
}

func newMockPool(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool() error = %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func expectationsMet(t *testing.T, mock pgxmock.PgxPoolIface) {
	t.Helper()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

func TestWrite_StagesEventInCallersTransaction(t *testing.T) {
	mock := newMockPool(t)
	event := newTestEvent(t)

	payload, err := event.Marshal()
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	mock.ExpectExec(regexp.QuoteMeta(insertSQL)).
		WithArgs(event.ID, event.TenantID, events.Topics.WorkflowEvents, event.Type, payload).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := Write(context.Background(), mock, events.Topics.WorkflowEvents, event); err != nil {
		t.Fatalf("Write() error = %v", err)
	}
	expectationsMet(t, mock)
}

func TestWrite_RequiresTopic(t *testing.T) {
	mock := newMockPool(t)

	err := Write(context.Background(), mock, "", newTestEvent(t))
	if err == nil {
		t.Fatal("expected error for empty topic")
	}
	expectationsMet(t, mock)
}

func TestWrite_RequiresEvent(t *testing.T) {
	mock := newMockPool(t)

	err := Write(context.Background(), mock, events.Topics.WorkflowEvents, nil)
	if err == nil {
		t.Fatal("expected error for nil event")
	}
	expectationsMet(t, mock)
}

func TestWrite_RejectsInvalidEvent(t *testing.T) {
	mock := newMockPool(t)
	event := newTestEvent(t)
	event.TenantID = "" // fails CloudEvents validation

	err := Write(context.Background(), mock, events.Topics.WorkflowEvents, event)
	if err == nil {
		t.Fatal("expected error for invalid event")
	}
	expectationsMet(t, mock)
}

func TestWrite_WrapsExecError(t *testing.T) {
	mock := newMockPool(t)
	event := newTestEvent(t)

	mock.ExpectExec(regexp.QuoteMeta(insertSQL)).
		WithArgs(event.ID, event.TenantID, events.Topics.WorkflowEvents, event.Type, pgxmock.AnyArg()).
		WillReturnError(errors.New("connection reset"))

	err := Write(context.Background(), mock, events.Topics.WorkflowEvents, event)
	if err == nil {
		t.Fatal("expected error from exec failure")
	}
	expectationsMet(t, mock)
}

func TestWriteBatch_StagesAllEventsInOrder(t *testing.T) {
	mock := newMockPool(t)
	first := newTestEvent(t)
	second := newTestEvent(t)

	mock.ExpectExec(regexp.QuoteMeta(insertSQL)).
		WithArgs(first.ID, first.TenantID, events.Topics.WorkflowEvents, first.Type, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))
	mock.ExpectExec(regexp.QuoteMeta(insertSQL)).
		WithArgs(second.ID, second.TenantID, events.Topics.WorkflowEvents, second.Type, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	if err := WriteBatch(context.Background(), mock, events.Topics.WorkflowEvents, []*events.Event{first, second}); err != nil {
		t.Fatalf("WriteBatch() error = %v", err)
	}
	expectationsMet(t, mock)
}

func TestWriteBatch_EmptyBatchIsNoOp(t *testing.T) {
	mock := newMockPool(t)

	if err := WriteBatch(context.Background(), mock, events.Topics.WorkflowEvents, nil); err != nil {
		t.Fatalf("WriteBatch() error = %v", err)
	}
	expectationsMet(t, mock)
}

func TestWriteBatch_StopsOnFirstFailure(t *testing.T) {
	mock := newMockPool(t)
	first := newTestEvent(t)
	second := newTestEvent(t)

	mock.ExpectExec(regexp.QuoteMeta(insertSQL)).
		WithArgs(first.ID, first.TenantID, events.Topics.WorkflowEvents, first.Type, pgxmock.AnyArg()).
		WillReturnError(errors.New("disk full"))

	err := WriteBatch(context.Background(), mock, events.Topics.WorkflowEvents, []*events.Event{first, second})
	if err == nil {
		t.Fatal("expected error from first failed insert")
	}
	expectationsMet(t, mock)
}
