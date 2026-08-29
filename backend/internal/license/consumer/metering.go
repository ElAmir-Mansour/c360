// Package consumer implements usage metering from the event bus (Solution
// Architecture E2E, slide 18: "usage metering ← events from the bus").
// Domain events drive entitlement counters without enforcement — metering
// records the truth; enforcement happens at the Check/Consume API. Crossing a
// limit while metering still stages license.entitlement.limit_reached, so
// operators and BOSALAH dashboards see overage the moment it happens.
package consumer

import (
	"context"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/license/model"
	licservice "github.com/clario360/platform/internal/license/service"
)

// meterer is the slice of the license service the consumer needs.
type meterer interface {
	Consume(ctx context.Context, tenantID, key string, delta int64, enforce bool) (*model.Decision, error)
}

// meterAction maps one domain event type to a counter movement.
type meterAction struct {
	key   string
	delta int64
}

// meterRules maps fully-qualified event types to entitlement counters.
// IAM user lifecycle drives seat consumption; extend this table as more
// domains become metered (pipelines, storage, API calls).
var meterRules = map[string]meterAction{
	"com.clario360.iam.user.created":     {key: licservice.SeatsKey, delta: 1},
	"com.clario360.iam.user.deleted":     {key: licservice.SeatsKey, delta: -1},
	"com.clario360.iam.user.deactivated": {key: licservice.SeatsKey, delta: -1},
	"com.clario360.iam.user.reactivated": {key: licservice.SeatsKey, delta: 1},
}

// MeteringConsumer applies meterRules to bus events. It implements
// events.EventHandler and is subscribed to the IAM topic.
type MeteringConsumer struct {
	svc    meterer
	logger zerolog.Logger
}

// NewMeteringConsumer constructs the consumer.
func NewMeteringConsumer(svc meterer, logger zerolog.Logger) *MeteringConsumer {
	return &MeteringConsumer{
		svc:    svc,
		logger: logger.With().Str("consumer", "license-metering").Logger(),
	}
}

// Topics returns the bus topics this consumer must be subscribed to.
func (c *MeteringConsumer) Topics() []string {
	return []string{events.Topics.IAMEvents}
}

// Handle applies the metering rule for the event type, if any. Unknown event
// types are ignored. A tenant without a license meters as a no-op: usage
// before licensing is not an error. Returning an error hands retry/DLQ
// handling to the consumer middleware.
func (c *MeteringConsumer) Handle(ctx context.Context, event *events.Event) error {
	action, ok := meterRules[event.Type]
	if !ok {
		return nil
	}
	if event.TenantID == "" {
		c.logger.Warn().Str("event_id", event.ID).Str("event_type", event.Type).
			Msg("metering event without tenant; skipping")
		return nil
	}

	decision, err := c.svc.Consume(ctx, event.TenantID, action.key, action.delta, false)
	if err != nil {
		return err
	}
	if decision != nil && !decision.Allowed && decision.Reason == "no license assigned" {
		// Not licensed yet — nothing to meter against.
		return nil
	}

	logEvent := c.logger.Debug()
	if decision != nil && decision.Limit != nil && decision.Used >= *decision.Limit {
		logEvent = c.logger.Warn()
	}
	logEvent.
		Str("tenant_id", event.TenantID).
		Str("event_type", event.Type).
		Str("entitlement", action.key).
		Int64("delta", action.delta).
		Msg("usage metered")
	return nil
}

// Ensure interface compliance.
var _ events.EventHandler = (*MeteringConsumer)(nil)
