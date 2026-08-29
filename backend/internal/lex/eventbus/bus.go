// Package eventbus provides an always-on, in-process event delivery path for the
// lex (legal-affairs) suite. The maturation audit found that the event producer
// and every lex consumer were gated on a non-empty Kafka broker list with no
// fallback: in the documented single-node dev default, nothing reacted to the
// well-formed CloudEvents the services already emit (cmd/lex-service/main.go
// ~88/287). InProcessBus closes that gap.
//
// InProcessBus implements service.Publisher (Publish(ctx, topic, *events.Event)),
// so it drops straight into every lex service constructor where a *events.Producer
// used to go. On Publish it:
//
//  1. Synchronously dispatches the event to all registered in-process handlers
//     whose subscription prefix matches event.Type (e.g. "com.clario360.lex.").
//     Each handler runs under panic-recovery with per-handler error logging so a
//     single failing or panicking handler never blocks the others and never
//     surfaces as a Publish error to the caller (in-process delivery is
//     best-effort and idempotent at the consumer layer via dedup keys).
//  2. If an optional delegate Kafka Publisher is configured, forwards the event to
//     it for cross-suite fan-out. A delegate error IS returned to the caller so the
//     existing writeEvent log-on-error behavior is preserved for the durable bus.
//
// Net effect: every existing writeEvent(...) call delivers to the reporting +
// notification consumers in-process, with or without Kafka, while Kafka (when
// present) still carries the event to other suites.
package eventbus

import (
	"context"
	"strings"
	"sync"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// Handler is the in-process handler signature. It is intentionally identical to
// events.EventHandler.Handle (and therefore to the Handle method on both
// consumer.ReportingConsumer and consumer.LexNotificationConsumer), so those
// consumers can be registered directly:
//
//	bus.Subscribe("com.clario360.lex.", reportingConsumer.Handle)
//	bus.Subscribe("com.clario360.lex.", lexNotificationConsumer.Handle)
type Handler func(ctx context.Context, event *events.Event) error

// Delegate is the subset of a durable publisher the bus forwards to for
// cross-suite fan-out. *events.Producer satisfies it. It matches the
// service.Publisher contract so a *events.Producer (or any Publisher) can be
// wrapped without importing the lex service package (avoids an import cycle:
// service already imports nothing from eventbus, and the consumers import
// service, so the bus must NOT import service).
type Delegate interface {
	Publish(ctx context.Context, topic string, event *events.Event) error
}

type subscription struct {
	prefix  string
	handler Handler
}

// InProcessBus is a synchronous, prefix-matched, panic-safe in-process event
// dispatcher that optionally forwards to a durable delegate publisher.
//
// The zero value is not ready for use; construct with New.
type InProcessBus struct {
	mu       sync.RWMutex
	subs     []subscription
	delegate Delegate
	logger   zerolog.Logger
}

// New constructs an InProcessBus. delegate may be nil (in-process-only mode, the
// documented dev default). When delegate is a typed-nil *events.Producer the bus
// still treats it as "no delegate" so callers can pass the optional producer
// directly without a nil-interface footgun.
func New(delegate Delegate, logger zerolog.Logger) *InProcessBus {
	return &InProcessBus{
		delegate: normalizeDelegate(delegate),
		logger:   logger.With().Str("component", "lex-inprocess-bus").Logger(),
	}
}

// normalizeDelegate collapses a typed-nil *events.Producer (the common case when
// Kafka is disabled and main.go leaves `var producer *events.Producer` nil) into
// a real nil so dispatch skips the delegate instead of calling a method on a nil
// pointer.
func normalizeDelegate(delegate Delegate) Delegate {
	switch d := delegate.(type) {
	case nil:
		return nil
	case *events.Producer:
		if d == nil {
			return nil
		}
		return d
	default:
		return d
	}
}

// SetDelegate installs (or clears, with nil) the durable delegate publisher after
// construction. Safe for concurrent use. Typed-nil producers are normalized to no
// delegate.
func (b *InProcessBus) SetDelegate(delegate Delegate) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.delegate = normalizeDelegate(delegate)
}

// Subscribe registers handler to receive every event whose Type begins with
// prefix. An empty prefix matches all events. Registration order is preserved and
// is the dispatch order. Safe to call before the service starts publishing; not
// intended for hot-path churn.
func (b *InProcessBus) Subscribe(prefix string, handler Handler) {
	if handler == nil {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.subs = append(b.subs, subscription{prefix: prefix, handler: handler})
	b.logger.Info().Str("prefix", prefix).Int("handler_count", len(b.subs)).Msg("in-process handler registered")
}

// Publish implements service.Publisher. It first fans the event out to all
// matching in-process handlers (panic-safe, best-effort) and then forwards to the
// durable delegate (if any). Only a delegate error is returned; in-process
// handler errors are logged but never propagated, so a transient consumer failure
// cannot roll back or fail the originating service transaction's event emission.
func (b *InProcessBus) Publish(ctx context.Context, topic string, event *events.Event) error {
	if event == nil {
		return nil
	}

	b.mu.RLock()
	subs := make([]subscription, len(b.subs))
	copy(subs, b.subs)
	delegate := b.delegate
	b.mu.RUnlock()

	for _, sub := range subs {
		if !strings.HasPrefix(event.Type, sub.prefix) {
			continue
		}
		b.dispatch(ctx, sub, event)
	}

	if delegate != nil {
		return delegate.Publish(ctx, topic, event)
	}
	return nil
}

// dispatch runs a single handler under panic-recovery with per-handler error
// logging. A panic or error in one handler is contained and does not affect the
// others or the caller.
func (b *InProcessBus) dispatch(ctx context.Context, sub subscription, event *events.Event) {
	defer func() {
		if r := recover(); r != nil {
			b.logger.Error().
				Interface("panic", r).
				Str("prefix", sub.prefix).
				Str("event_type", event.Type).
				Str("event_id", event.ID).
				Str("tenant_id", event.TenantID).
				Msg("in-process event handler panicked; recovered")
		}
	}()

	if err := sub.handler(ctx, event); err != nil {
		b.logger.Error().
			Err(err).
			Str("prefix", sub.prefix).
			Str("event_type", event.Type).
			Str("event_id", event.ID).
			Str("tenant_id", event.TenantID).
			Msg("in-process event handler returned error")
	}
}
