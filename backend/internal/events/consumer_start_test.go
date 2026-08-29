package events

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/IBM/sarama"
	"github.com/rs/zerolog"
)

type fakeConsumerGroup struct {
	mu     sync.Mutex
	calls  int
	errors []error
}

func (f *fakeConsumerGroup) Consume(ctx context.Context, _ []string, _ sarama.ConsumerGroupHandler) error {
	f.mu.Lock()
	f.calls++
	call := f.calls
	var err error
	if call <= len(f.errors) {
		err = f.errors[call-1]
	}
	f.mu.Unlock()

	if err != nil {
		return err
	}

	<-ctx.Done()
	return ctx.Err()
}

func (f *fakeConsumerGroup) Errors() <-chan error      { return nil }
func (f *fakeConsumerGroup) Close() error              { return nil }
func (f *fakeConsumerGroup) Pause(map[string][]int32)  {}
func (f *fakeConsumerGroup) Resume(map[string][]int32) {}
func (f *fakeConsumerGroup) PauseAll()                 {}
func (f *fakeConsumerGroup) ResumeAll()                {}

func (f *fakeConsumerGroup) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func TestConsumerStartRetriesConsumeErrors(t *testing.T) {
	originalInitial := consumerRetryInitialBackoff
	originalMax := consumerRetryMaxBackoff
	consumerRetryInitialBackoff = time.Millisecond
	consumerRetryMaxBackoff = 2 * time.Millisecond
	t.Cleanup(func() {
		consumerRetryInitialBackoff = originalInitial
		consumerRetryMaxBackoff = originalMax
	})

	group := &fakeConsumerGroup{
		errors: []error{
			errors.New("kafka server: The coordinator is still loading offsets"),
			errors.New("read tcp: i/o timeout"),
		},
	}
	consumer := &Consumer{
		group:   group,
		groupID: "test-consumer",
		handler: &consumerGroupHandler{
			logger:       zerolog.Nop(),
			handlers:     map[string][]EventHandler{"topic": {EventHandlerFunc(func(context.Context, *Event) error { return nil })}},
			ready:        make(chan struct{}),
			consumerName: "test-consumer",
		},
		logger: zerolog.Nop(),
	}

	ctx, cancel := context.WithCancel(context.Background())
	errCh := make(chan error, 1)
	go func() {
		errCh <- consumer.Start(ctx)
	}()

	deadline := time.After(250 * time.Millisecond)
	for group.callCount() < 3 {
		select {
		case <-deadline:
			cancel()
			t.Fatalf("expected Consume to be retried, got %d call(s)", group.callCount())
		case <-time.After(time.Millisecond):
		}
	}

	cancel()
	if err := <-errCh; !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after retries, got %v", err)
	}
}
