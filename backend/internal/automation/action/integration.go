package action

import (
	"context"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
	"github.com/clario360/platform/internal/events"
)

// IntegrationExecutor implements the integration action (§4.6): it PUBLISHES a
// domain event onto a bus topic. The platform IntegrationConsumer
// (internal/integration/consumer) is subscribed to every topic and fans the
// event out to every active tenant integration whose event-filter matches
// (integration_consumer.go:48). The executor therefore drives integrations
// WITHOUT ever reading the integration config database (FR-XC-004) — it only
// names the event type + payload and lets the consumer do the routing.
//
// Config (ActionRef.Config):
//
//	event_type (string, required)  the domain event type to publish (e.g.
//	                               "integration.outbound.requested"); the
//	                               IntegrationConsumer's per-tenant event filters
//	                               decide which integrations receive it.
//	topic      (string, optional)  the bus topic to publish on; defaults to
//	                               platform.integration.events. Must be a known
//	                               topic the IntegrationConsumer subscribes to.
//	payload    (object, optional)  the event data; surfaced as event.data and
//	                               matched against each integration's filters.
type IntegrationExecutor struct {
	publisher Publisher
}

// integrationEventSource is the CloudEvents source stamped on events the
// automation engine publishes for integration fan-out.
const integrationEventSource = "automation-service"

// NewIntegrationExecutor constructs the executor. publisher is the live event
// producer (*events.Producer satisfies Publisher); it must be non-nil.
func NewIntegrationExecutor(publisher Publisher) (*IntegrationExecutor, error) {
	if publisher == nil {
		return nil, fmt.Errorf("integration executor: event publisher is required")
	}
	return &IntegrationExecutor{publisher: publisher}, nil
}

// Execute builds and publishes the integration domain event, recording the
// published event id + type + topic in the run log.
func (e *IntegrationExecutor) Execute(ctx context.Context, step *model.RunStep) (service.Output, error) {
	cfg, err := stepConfig(step, model.ActionIntegration)
	if err != nil {
		return service.Output{}, err
	}
	eventType, err := cfgString(cfg, "event_type")
	if err != nil {
		return service.Output{}, err
	}
	payload, err := cfgMap(cfg, "payload")
	if err != nil {
		return service.Output{}, err
	}
	topic, err := cfgStringOpt(cfg, "topic", events.Topics.IntegrationEvents)
	if err != nil {
		return service.Output{}, err
	}
	if strings.TrimSpace(topic) == "" {
		topic = events.Topics.IntegrationEvents
	}

	tenantID, err := tenantFromContext(ctx)
	if err != nil {
		return service.Output{}, err
	}

	if payload == nil {
		payload = map[string]any{}
	}
	event, err := events.NewEvent(eventType, integrationEventSource, tenantID, payload)
	if err != nil {
		return service.Output{}, invalidConfig("building integration event %q: %v", eventType, err)
	}

	if err := e.publisher.Publish(ctx, topic, event); err != nil {
		// Bus unavailability is transient: route to retry.
		return service.Output{}, unavailable(err, "publishing %q to %s", event.Type, topic)
	}

	return service.Output{Data: map[string]any{
		"action":     model.ActionIntegration,
		"event_id":   event.ID,
		"event_type": event.Type,
		"topic":      topic,
		"published":  true,
	}}, nil
}
