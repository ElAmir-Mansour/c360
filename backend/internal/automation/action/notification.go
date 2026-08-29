package action

import (
	"context"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/automation/model"
	"github.com/clario360/platform/internal/automation/service"
	"github.com/clario360/platform/internal/events"
)

// NotificationExecutor implements the notification action (§4.6): it PUBLISHES a
// domain event onto a bus topic. The platform NotificationConsumer
// (internal/notification/consumer) runs its rule engine over every event
// (notification_consumer.go:57) and turns a matching event into notifications
// for the resolved recipients. The executor therefore creates notifications
// WITHOUT calling the notification database directly (there is no general
// create-notification REST endpoint, by design, §4.6): it only names the event
// type + payload and lets the consumer's rules fan it out.
//
// Config (ActionRef.Config):
//
//	event_type (string, required)  the domain event type to publish; the
//	                               NotificationConsumer's rule engine matches it.
//	topic      (string, optional)  the bus topic; defaults to
//	                               platform.notification.events.
//	payload    (object, optional)  event data the notification rules read (e.g.
//	                               severity, recipient hints, template fields).
type NotificationExecutor struct {
	publisher Publisher
}

// notificationEventSource is the CloudEvents source stamped on events the
// automation engine publishes for notification fan-out.
const notificationEventSource = "automation-service"

// NewNotificationExecutor constructs the executor. publisher is the live event
// producer (*events.Producer satisfies Publisher); it must be non-nil.
func NewNotificationExecutor(publisher Publisher) (*NotificationExecutor, error) {
	if publisher == nil {
		return nil, fmt.Errorf("notification executor: event publisher is required")
	}
	return &NotificationExecutor{publisher: publisher}, nil
}

// Execute builds and publishes the notification domain event, recording the
// published event id + type + topic in the run log.
func (e *NotificationExecutor) Execute(ctx context.Context, step *model.RunStep) (service.Output, error) {
	cfg, err := stepConfig(step, model.ActionNotification)
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
	topic, err := cfgStringOpt(cfg, "topic", events.Topics.NotificationEvents)
	if err != nil {
		return service.Output{}, err
	}
	if strings.TrimSpace(topic) == "" {
		topic = events.Topics.NotificationEvents
	}

	tenantID, err := tenantFromContext(ctx)
	if err != nil {
		return service.Output{}, err
	}

	if payload == nil {
		payload = map[string]any{}
	}
	event, err := events.NewEvent(eventType, notificationEventSource, tenantID, payload)
	if err != nil {
		return service.Output{}, invalidConfig("building notification event %q: %v", eventType, err)
	}

	if err := e.publisher.Publish(ctx, topic, event); err != nil {
		return service.Output{}, unavailable(err, "publishing %q to %s", event.Type, topic)
	}

	return service.Output{Data: map[string]any{
		"action":     model.ActionNotification,
		"event_id":   event.ID,
		"event_type": event.Type,
		"topic":      topic,
		"published":  true,
	}}, nil
}
