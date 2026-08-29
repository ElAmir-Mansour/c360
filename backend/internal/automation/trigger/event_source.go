package trigger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/events"
)

// EventSource is the bus-driven trigger source (model.TriggerTypeEvent,
// §4.3 row "event"). It subscribes a shared events.Consumer to the configured
// set of topics; for each incoming event it loads the tenant's enabled
// event-trigger automations on that topic, keeps those whose TriggerConfig.Filter
// matches the event data, and emits a FiredTrigger per match through the
// Dispatcher (exactly-once). It mirrors the multi-topic Subscribe loop in
// internal/notification/consumer.NotificationConsumer.
type EventSource struct {
	consumer   *events.Consumer
	lister     AutomationLister
	dispatcher *Dispatcher
	topics     []string
	logger     zerolog.Logger
}

// EventSourceConfig wires an EventSource.
type EventSourceConfig struct {
	// Consumer is a started-elsewhere bus consumer the source subscribes onto.
	Consumer *events.Consumer
	// Lister reads enabled event-trigger automations per tenant+topic.
	Lister AutomationLister
	// Dispatcher applies the exactly-once gate and hands matches to the sink.
	Dispatcher *Dispatcher
	// Topics is the set of bus topics to subscribe to. In production this is
	// the union of every distinct topic referenced by an enabled event trigger
	// (the service computes it); subscribing to a superset is harmless because
	// non-matching events resolve to zero automations.
	Topics []string
	Logger zerolog.Logger
}

// NewEventSource constructs an EventSource. It returns an error if a required
// dependency is missing so misconfiguration fails at construction, not at the
// first event.
func NewEventSource(cfg EventSourceConfig) (*EventSource, error) {
	if cfg.Consumer == nil {
		return nil, fmt.Errorf("event source: consumer is required")
	}
	if cfg.Lister == nil {
		return nil, fmt.Errorf("event source: lister is required")
	}
	if cfg.Dispatcher == nil {
		return nil, fmt.Errorf("event source: dispatcher is required")
	}
	if len(cfg.Topics) == 0 {
		return nil, fmt.Errorf("event source: at least one topic is required")
	}
	return &EventSource{
		consumer:   cfg.Consumer,
		lister:     cfg.Lister,
		dispatcher: cfg.Dispatcher,
		topics:     cfg.Topics,
		logger:     cfg.Logger.With().Str("component", "automation_event_source").Logger(),
	}, nil
}

// Type identifies this source.
func (s *EventSource) Type() string { return model.TriggerTypeEvent }

// Start subscribes the handler to every configured topic and begins consuming.
// It blocks until ctx is cancelled (the underlying consumer's Start blocks).
func (s *EventSource) Start(ctx context.Context) error {
	handler := events.EventHandlerFunc(func(ctx context.Context, event *events.Event) error {
		return s.HandleEvent(ctx, event)
	})
	for _, topic := range s.topics {
		s.consumer.Subscribe(topic, handler)
	}
	s.logger.Info().Strs("topics", s.topics).Msg("automation event source starting")
	return s.consumer.Start(ctx)
}

// HandleEvent is the per-event handler (exported so tests can drive it directly
// without a Kafka broker). It loads candidate automations, applies each one's
// filter, and dispatches a FiredTrigger per match. A malformed payload or a
// tenant-less event is skipped (returning nil) rather than retried forever — a
// bad message must not block the partition.
func (s *EventSource) HandleEvent(ctx context.Context, event *events.Event) error {
	if event.TenantID == "" {
		s.logger.Warn().Str("event_type", event.Type).Str("event_id", event.ID).Msg("event missing tenant id; skipping")
		return nil
	}
	topic := eventTopic(event)
	if topic == "" {
		s.logger.Warn().Str("event_id", event.ID).Msg("event has no resolvable topic; skipping")
		return nil
	}

	data, err := decodeEventData(event)
	if err != nil {
		s.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed event data; skipping")
		return nil
	}

	candidates, err := s.lister.ListEnabledByTopic(ctx, event.TenantID, model.TriggerTypeEvent, topic)
	if err != nil {
		// A read failure is transient — return the error so the consumer retries
		// (and, after maxHandlerErrors, dead-letters) rather than silently losing
		// the trigger.
		return fmt.Errorf("listing event automations for topic %s: %w", topic, err)
	}
	if len(candidates) == 0 {
		return nil
	}
	sortAutomationsByName(candidates)

	for _, a := range candidates {
		if a.Trigger.Type != model.TriggerTypeEvent {
			continue // defensive: the lister should only return event triggers
		}
		if !matchFilter(a.Trigger.Filter, data) {
			s.logger.Debug().
				Str("automation_id", a.ID).
				Str("event_id", event.ID).
				Msg("event did not match automation filter")
			continue
		}
		ft := FiredTrigger{
			AutomationID: a.ID,
			TenantID:     event.TenantID,
			EventID:      event.ID,
			TriggerType:  model.TriggerTypeEvent,
			Payload:      buildEventPayload(event, data),
		}
		if err := s.dispatcher.Dispatch(ctx, ft); err != nil {
			// One automation's dispatch failure must not drop the others, but it
			// must surface so the event is retried — return after attempting the
			// rest would double-fire the successful ones on retry, so we fail fast
			// and let the idempotency guard suppress the already-dispatched ones.
			return fmt.Errorf("dispatching event trigger (automation %s): %w", a.ID, err)
		}
	}
	return nil
}

// eventTopic resolves the Kafka topic an event arrived on. The consumer stamps
// it into Metadata["kafka.topic"] (consumer.go ConsumeClaim); when absent (a
// directly-handed event in tests) it falls back to the conventional topic for
// the event's domain derived from its type.
func eventTopic(event *events.Event) string {
	if event.Metadata != nil {
		if t := event.Metadata["kafka.topic"]; t != "" {
			return t
		}
	}
	return topicForEventType(event.Type)
}

// decodeEventData unmarshals the event's JSON payload into a map. An empty
// payload decodes to an empty (non-nil) map so filters with no required fields
// still match.
func decodeEventData(event *events.Event) (map[string]any, error) {
	data := map[string]any{}
	if len(event.Data) == 0 {
		return data, nil
	}
	if err := json.Unmarshal(event.Data, &data); err != nil {
		return nil, fmt.Errorf("unmarshaling event data: %w", err)
	}
	return data, nil
}

// buildEventPayload records the trigger occurrence for replay (§4.7): the event
// envelope identity plus its decoded data, under the same {trigger:{...}} shape
// the rule engine's expression context expects (so a rule's
// `trigger.data.severity` resolves against this payload downstream).
func buildEventPayload(event *events.Event, data map[string]any) map[string]any {
	return map[string]any{
		"trigger": map[string]any{
			"type":   model.TriggerTypeEvent,
			"source": event.Type,
			"id":     event.ID,
			"data":   data,
		},
	}
}
