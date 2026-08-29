package consumer

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// Handler is the signature every SIEM topic handler implements. It
// returns an error to mark the message as needing redelivery; nil
// means the offset is committed.
type Handler func(ctx context.Context, evt *events.Event) error

// Consumer is the SIEM lifecycle wrapper around a Kafka consumer.
//
// In SIEM-01 the consumer is not bound to any topic. The Start/Stop
// surface is fully exercised so SIEM-04 can wire real handlers.
type Consumer struct {
	logger zerolog.Logger
	mu     sync.Mutex
	subs   map[string]Handler

	started atomic.Bool
	stopped atomic.Bool
	done    chan struct{}
}

// New constructs a Consumer. The logger is used for lifecycle traces
// only; no goroutine is spawned until Start is called.
func New(logger zerolog.Logger) *Consumer {
	return &Consumer{
		logger: logger,
		subs:   make(map[string]Handler),
		done:   make(chan struct{}),
	}
}

// Subscribe registers a handler for topic. It is safe to call before
// or after Start.
func (c *Consumer) Subscribe(topic string, h Handler) error {
	if c == nil {
		return errors.New("siem consumer: nil receiver")
	}
	if topic == "" {
		return errors.New("siem consumer: empty topic")
	}
	if h == nil {
		return errors.New("siem consumer: nil handler")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.subs[topic] = h
	return nil
}

// Subscriptions returns a snapshot of registered topics.
func (c *Consumer) Subscriptions() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make([]string, 0, len(c.subs))
	for k := range c.subs {
		out = append(out, k)
	}
	return out
}

// Start begins the consumer loop. SIEM-01's implementation just
// blocks until ctx is cancelled (no topics to consume). The exit path
// matters more than the body — SIEM-04 will replace the inner select
// with the real broker driver.
func (c *Consumer) Start(ctx context.Context) error {
	if c == nil {
		return errors.New("siem consumer: nil receiver")
	}
	if !c.started.CompareAndSwap(false, true) {
		return errors.New("siem consumer: already started")
	}
	c.logger.Info().Int("topic_subscriptions", len(c.subs)).Msg("siem consumer started")

	select {
	case <-ctx.Done():
		c.logger.Info().Msg("siem consumer: context cancelled, shutting down")
	case <-c.done:
		c.logger.Info().Msg("siem consumer: stop signal received")
	}

	c.stopped.Store(true)
	return nil
}

// Stop signals the consumer to exit. It is idempotent.
func (c *Consumer) Stop() {
	if c == nil {
		return
	}
	select {
	case <-c.done:
		// already closed
	default:
		close(c.done)
	}
}

// IsRunning reports whether Start has been called and Stop/ctx
// cancellation has not yet been observed.
func (c *Consumer) IsRunning() bool {
	if c == nil {
		return false
	}
	return c.started.Load() && !c.stopped.Load()
}
