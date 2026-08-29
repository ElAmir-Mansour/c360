// Package consumer handles cross-suite control events for ClarioDR.
package consumer

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

const (
	EventLicenseSuspended = "com.clario360.license.suspended"
	EventLicenseExpired   = "com.clario360.license.expired"
)

// StreamPauser is the DR service surface needed by cross-suite entitlement
// events.
type StreamPauser interface {
	PauseTenantStreams(ctx context.Context, tenantID uuid.UUID, reason string) (int64, error)
}

// Consumer reacts to cross-suite events required by DESIGN_DataStream_DR.md §8.
type Consumer struct {
	svc    StreamPauser
	logger zerolog.Logger
}

// New constructs a DR cross-suite event consumer.
func New(svc StreamPauser, logger zerolog.Logger) *Consumer {
	return &Consumer{
		svc:    svc,
		logger: logger.With().Str("consumer", "dr-cross-suite").Logger(),
	}
}

// Topics returns the bus topics this consumer must be subscribed to.
func (c *Consumer) Topics() []string {
	return []string{events.Topics.LicenseEvents}
}

// EventTypes returns the event types this consumer handles.
func (c *Consumer) EventTypes() []string {
	return []string{EventLicenseSuspended, EventLicenseExpired}
}

// Handle pauses tenant streams on license suspension/expiry. Unknown event
// types are ignored so this handler can share the license topic with other
// services.
func (c *Consumer) Handle(ctx context.Context, event *events.Event) error {
	if event == nil {
		return nil
	}
	if !isPauseEvent(event.Type) {
		return nil
	}
	if c == nil || c.svc == nil {
		return fmt.Errorf("dr consumer: stream pauser is required")
	}
	if event.TenantID == "" {
		c.logger.Warn().Str("event_id", event.ID).Str("event_type", event.Type).
			Msg("license control event without tenant; skipping")
		return nil
	}
	tenantID, err := uuid.Parse(event.TenantID)
	if err != nil {
		return fmt.Errorf("dr consumer: parse tenant id %q: %w", event.TenantID, err)
	}

	paused, err := c.svc.PauseTenantStreams(ctx, tenantID, event.Type)
	if err != nil {
		return err
	}
	c.logger.Info().
		Str("tenant_id", tenantID.String()).
		Str("event_type", event.Type).
		Int64("paused_streams", paused).
		Msg("processed DR license control event")
	return nil
}

func isPauseEvent(eventType string) bool {
	switch eventType {
	case EventLicenseSuspended, EventLicenseExpired:
		return true
	default:
		return false
	}
}

var _ events.TypedEventHandler = (*Consumer)(nil)
