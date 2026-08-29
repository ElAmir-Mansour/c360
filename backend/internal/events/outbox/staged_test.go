package outbox

import (
	"context"
	"errors"
	"regexp"
	"testing"

	"github.com/pashagolub/pgxmock/v4"

	"github.com/clario360/platform/internal/events"
)

func TestStaged_PublishStagesIntoOutbox(t *testing.T) {
	mock := newMockPool(t)
	event := newTestEvent(t)

	mock.ExpectExec(regexp.QuoteMeta(insertSQL)).
		WithArgs(event.ID, event.TenantID, events.Topics.WorkflowEvents, event.Type, pgxmock.AnyArg()).
		WillReturnResult(pgxmock.NewResult("INSERT", 1))

	staged := NewStaged(mock)
	if err := staged.Publish(context.Background(), events.Topics.WorkflowEvents, event); err != nil {
		t.Fatalf("Publish() error = %v", err)
	}
	expectationsMet(t, mock)
}

func TestStaged_PublishPropagatesStagingError(t *testing.T) {
	mock := newMockPool(t)
	event := newTestEvent(t)

	mock.ExpectExec(regexp.QuoteMeta(insertSQL)).
		WithArgs(event.ID, event.TenantID, events.Topics.WorkflowEvents, event.Type, pgxmock.AnyArg()).
		WillReturnError(errors.New("connection refused"))

	staged := NewStaged(mock)
	if err := staged.Publish(context.Background(), events.Topics.WorkflowEvents, event); err == nil {
		t.Fatal("expected staging error to propagate")
	}
	expectationsMet(t, mock)
}

func TestStaged_PublishRejectsInvalidInput(t *testing.T) {
	mock := newMockPool(t)
	staged := NewStaged(mock)

	if err := staged.Publish(context.Background(), "", newTestEvent(t)); err == nil {
		t.Fatal("expected error for empty topic")
	}
	if err := staged.Publish(context.Background(), events.Topics.WorkflowEvents, nil); err == nil {
		t.Fatal("expected error for nil event")
	}
	expectationsMet(t, mock)
}
