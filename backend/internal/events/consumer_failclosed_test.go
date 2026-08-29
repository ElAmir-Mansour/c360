package events

import (
	"context"
	"errors"
	"testing"

	"github.com/rs/zerolog"
)

// TestProcessWithRetry_NoSinkReportsNotDeadLettered asserts that when the
// handler exhausts its retries AND there is no DLQ producer configured,
// processWithRetry reports deadLettered=false. ConsumeClaim uses exactly this
// signal to WITHHOLD the offset commit (fail-closed, #5) so the event
// redelivers instead of being silently dropped.
func TestProcessWithRetry_NoSinkReportsNotDeadLettered(t *testing.T) {
	h := &consumerGroupHandler{
		logger:           zerolog.Nop(),
		handlers:         map[string][]EventHandler{},
		maxHandlerErrors: 2,
		consumerName:     "test",
		// dlqProducer intentionally nil → no durable sink.
	}

	handler := EventHandlerFunc(func(context.Context, *Event) error {
		return errors.New("permanent failure")
	})

	deadLettered, err := h.processWithRetry(context.Background(), handler, &Event{ID: "e1", Type: "com.clario360.test"}, "topic", 2)
	if err == nil {
		t.Fatal("expected a handler error to be returned")
	}
	if deadLettered {
		t.Fatal("with no DLQ sink, the event must be reported NOT dead-lettered so the offset commit is blocked")
	}
}

// TestProcessWithRetry_SuccessCommits asserts a handler that eventually
// succeeds returns (false, nil): no error, and deadLettered is irrelevant —
// ConsumeClaim commits the offset normally.
func TestProcessWithRetry_SuccessCommits(t *testing.T) {
	h := &consumerGroupHandler{
		logger:           zerolog.Nop(),
		handlers:         map[string][]EventHandler{},
		maxHandlerErrors: 3,
		consumerName:     "test",
	}

	calls := 0
	handler := EventHandlerFunc(func(context.Context, *Event) error {
		calls++
		if calls < 2 {
			return errors.New("transient")
		}
		return nil
	})

	deadLettered, err := h.processWithRetry(context.Background(), handler, &Event{ID: "e2", Type: "com.clario360.test"}, "topic", 3)
	if err != nil {
		t.Fatalf("expected success after retry, got %v", err)
	}
	if deadLettered {
		t.Fatal("success path must not report dead-lettered")
	}
	if calls != 2 {
		t.Fatalf("expected 2 handler invocations, got %d", calls)
	}
}
