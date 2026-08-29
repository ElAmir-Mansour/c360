package eventbus

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

func newTestEvent(t *testing.T, eventType string) *events.Event {
	t.Helper()
	evt, err := events.NewEvent(eventType, "lex-service", "11111111-1111-1111-1111-111111111111", map[string]any{"id": "x"})
	if err != nil {
		t.Fatalf("build event: %v", err)
	}
	return evt
}

func TestPublishDispatchesToMatchingPrefix(t *testing.T) {
	bus := New(nil, zerolog.Nop())

	var lexCount, otherCount int
	bus.Subscribe("com.clario360.lex.", func(context.Context, *events.Event) error {
		lexCount++
		return nil
	})
	bus.Subscribe("com.clario360.cyber.", func(context.Context, *events.Event) error {
		otherCount++
		return nil
	})

	if err := bus.Publish(context.Background(), "lex.events", newTestEvent(t, "lex.contract.created")); err != nil {
		t.Fatalf("publish: %v", err)
	}

	if lexCount != 1 {
		t.Fatalf("expected lex handler invoked once, got %d", lexCount)
	}
	if otherCount != 0 {
		t.Fatalf("expected non-matching handler not invoked, got %d", otherCount)
	}
}

func TestPublishEmptyPrefixMatchesAll(t *testing.T) {
	bus := New(nil, zerolog.Nop())
	var count int
	bus.Subscribe("", func(context.Context, *events.Event) error {
		count++
		return nil
	})
	if err := bus.Publish(context.Background(), "lex.events", newTestEvent(t, "lex.matter.opened")); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected empty-prefix handler invoked, got %d", count)
	}
}

func TestPanicAndErrorAreContained(t *testing.T) {
	bus := New(nil, zerolog.Nop())

	var thirdRan bool
	bus.Subscribe("com.clario360.lex.", func(context.Context, *events.Event) error {
		panic("boom")
	})
	bus.Subscribe("com.clario360.lex.", func(context.Context, *events.Event) error {
		return errors.New("handler failed")
	})
	bus.Subscribe("com.clario360.lex.", func(context.Context, *events.Event) error {
		thirdRan = true
		return nil
	})

	// Publish must not panic and must not return an in-process handler error.
	if err := bus.Publish(context.Background(), "lex.events", newTestEvent(t, "lex.request.created")); err != nil {
		t.Fatalf("publish returned error from in-process handler: %v", err)
	}
	if !thirdRan {
		t.Fatal("expected third handler to run despite earlier panic/error")
	}
}

type fakeDelegate struct {
	mu    sync.Mutex
	calls int
	topic string
	err   error
}

func (f *fakeDelegate) Publish(_ context.Context, topic string, _ *events.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	f.topic = topic
	return f.err
}

func TestPublishForwardsToDelegate(t *testing.T) {
	del := &fakeDelegate{}
	bus := New(del, zerolog.Nop())

	var handled bool
	bus.Subscribe("com.clario360.lex.", func(context.Context, *events.Event) error {
		handled = true
		return nil
	})

	if err := bus.Publish(context.Background(), "lex.events", newTestEvent(t, "lex.contract.created")); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if !handled {
		t.Fatal("expected in-process handler to run")
	}
	if del.calls != 1 {
		t.Fatalf("expected delegate called once, got %d", del.calls)
	}
	if del.topic != "lex.events" {
		t.Fatalf("expected delegate to receive topic, got %q", del.topic)
	}
}

func TestDelegateErrorIsReturnedButHandlersStillRun(t *testing.T) {
	del := &fakeDelegate{err: errors.New("kafka down")}
	bus := New(del, zerolog.Nop())

	var handled bool
	bus.Subscribe("com.clario360.lex.", func(context.Context, *events.Event) error {
		handled = true
		return nil
	})

	err := bus.Publish(context.Background(), "lex.events", newTestEvent(t, "lex.contract.created"))
	if err == nil {
		t.Fatal("expected delegate error to propagate")
	}
	if !handled {
		t.Fatal("in-process handler must still run even when delegate errors")
	}
}

func TestTypedNilProducerTreatedAsNoDelegate(t *testing.T) {
	var producer *events.Producer // typed nil
	bus := New(producer, zerolog.Nop())

	// Must not panic by calling Publish on a nil *events.Producer.
	if err := bus.Publish(context.Background(), "lex.events", newTestEvent(t, "lex.contract.created")); err != nil {
		t.Fatalf("publish with typed-nil delegate: %v", err)
	}
}

func TestSetDelegateAfterConstruction(t *testing.T) {
	bus := New(nil, zerolog.Nop())
	del := &fakeDelegate{}
	bus.SetDelegate(del)
	if err := bus.Publish(context.Background(), "lex.events", newTestEvent(t, "lex.contract.created")); err != nil {
		t.Fatalf("publish: %v", err)
	}
	if del.calls != 1 {
		t.Fatalf("expected delegate called after SetDelegate, got %d", del.calls)
	}
}

func TestNilEventAndNilHandlerAreSafe(t *testing.T) {
	bus := New(nil, zerolog.Nop())
	bus.Subscribe("com.clario360.lex.", nil) // ignored
	if err := bus.Publish(context.Background(), "lex.events", nil); err != nil {
		t.Fatalf("publish nil event: %v", err)
	}
}
