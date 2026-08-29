package producer

import (
	"context"
	"errors"
	"fmt"
	"sync"

	"github.com/clario360/platform/internal/events"
)

// Publisher is the minimal interface every producer (real or fake)
// must satisfy. It mirrors events.Producer.Publish so the
// siem-service callers can swap implementations without changes.
type Publisher interface {
	Publish(ctx context.Context, topic string, evt *events.Event) error
	Close() error
}

// ErrMissingTenantID is returned when an event is published without
// a tenant id. SIEM-01 enforces this at the producer boundary as a
// defense in depth against gateway middleware failures.
var ErrMissingTenantID = errors.New("siem producer: event missing tenant id")

// Producer wraps the platform CloudEvents producer with a
// tenant-presence guard. SIEM topics produced from this struct must
// all be tenant-keyed.
type Producer struct {
	inner Publisher
	src   string // CloudEvents source attribute; e.g. "clario360/siem-service"
}

// New constructs a Producer over an existing Publisher (typically
// *events.Producer). The source string is automatically prefixed by
// the CloudEvents factory if absent.
func New(inner Publisher, source string) *Producer {
	if source == "" {
		source = "clario360/siem-service"
	}
	return &Producer{inner: inner, src: source}
}

// Source returns the CloudEvents source string used by this producer.
func (p *Producer) Source() string {
	if p == nil {
		return ""
	}
	return p.src
}

// PublishEvent constructs a CloudEvents envelope and ships it. It
// rejects messages with no tenant id.
func (p *Producer) PublishEvent(ctx context.Context, topic, eventType, tenantID string, data any) error {
	if p == nil || p.inner == nil {
		return fmt.Errorf("siem producer not initialized")
	}
	if tenantID == "" {
		return ErrMissingTenantID
	}
	evt, err := events.NewEvent(eventType, p.src, tenantID, data)
	if err != nil {
		return fmt.Errorf("siem producer: build event: %w", err)
	}
	return p.inner.Publish(ctx, topic, evt)
}

// Close releases any underlying resources.
func (p *Producer) Close() error {
	if p == nil || p.inner == nil {
		return nil
	}
	return p.inner.Close()
}

// FakeProducer is an in-memory Publisher for unit tests. It records
// every publish call so assertions can be made without touching Kafka.
type FakeProducer struct {
	mu       sync.Mutex
	Messages []FakeMessage
	closed   bool
	failNext error
}

// FakeMessage captures one publish call.
type FakeMessage struct {
	Topic string
	Event *events.Event
}

// NewFakeProducer constructs an in-memory Publisher.
func NewFakeProducer() *FakeProducer { return &FakeProducer{} }

// FailNext arms the next Publish call to return err.
func (f *FakeProducer) FailNext(err error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.failNext = err
}

// Publish records the call and clears any armed failure.
func (f *FakeProducer) Publish(_ context.Context, topic string, evt *events.Event) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.closed {
		return fmt.Errorf("publish on closed producer")
	}
	if f.failNext != nil {
		err := f.failNext
		f.failNext = nil
		return err
	}
	f.Messages = append(f.Messages, FakeMessage{Topic: topic, Event: evt})
	return nil
}

// Close marks the fake as closed; further publishes error.
func (f *FakeProducer) Close() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
	return nil
}

// Len returns the number of captured messages.
func (f *FakeProducer) Len() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.Messages)
}
