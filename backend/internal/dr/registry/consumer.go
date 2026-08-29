package registry

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// regenerator is the surface the reconcile consumer drives. *Generator
// satisfies it. It is an interface so the consumer's event-routing logic is
// unit-tested without a database (a fake records the (tenant, group, trigger)
// calls), per the no-mock-only rule the regeneration logic itself is tested
// against the real Store in the generator/integration tests.
type regenerator interface {
	regenerateSystem(ctx context.Context, tenantID, groupID, profile, trigger string) (RegenerateResult, error)
}

// DR asset-change event types the reconcile loop reacts to. These are the
// lifecycle events the DR service emits on datastream.dr.events when the assets
// a runbook is generated from change (members, sites, network mappings, and
// recovery points). Consuming them is what makes the runbook self-maintaining:
// an asset change regenerates the runbook and versions the diff.
const (
	evtGroupMemberAdded      = "com.clario360.dr.group.member_added"
	evtGroupMemberRemoved    = "com.clario360.dr.group.member_removed"
	evtGroupCreated          = "com.clario360.dr.group.created"
	evtSiteUpdated           = "com.clario360.dr.site.updated"
	evtNetworkMappingCreated = "com.clario360.dr.network_mapping.created"
	evtNetworkMappingUpdated = "com.clario360.dr.network_mapping.updated"
	evtRecoveryPointCreated  = "com.clario360.dr.recovery_point.created"
	evtRecoveryPointSealed   = "com.clario360.dr.recovery_point.sealed"
	evtRecoveryPointValid    = "com.clario360.dr.recovery_point.validated"
	evtRecoveryPointRecorded = "com.clario360.dr.recovery_point.validation_recorded"
)

// Consumer is the runbook reconcile loop: it consumes datastream.dr.events and,
// when an event signals that a consistency group's assets changed, regenerates
// that group's runbook and stores a new version with the step-level diff (only
// if the steps actually changed). It implements events.TypedEventHandler so it
// plugs into the shared events.Consumer exactly like the cross-suite consumer.
//
// It is the "real self-maintenance" path: no polling, no fabricated triggers —
// the runbook follows its assets because the same events that mutate the assets
// drive the regeneration.
type Consumer struct {
	gen    regenerator
	logger zerolog.Logger
	m      *Metrics
}

// NewConsumer constructs the reconcile consumer over a Generator.
func NewConsumer(gen *Generator, logger zerolog.Logger) *Consumer {
	return newConsumer(gen, gen.metrics, logger)
}

// newConsumer is the internal constructor that accepts the regenerator interface
// so unit tests can inject a fake.
func newConsumer(gen regenerator, m *Metrics, logger zerolog.Logger) *Consumer {
	return &Consumer{
		gen:    gen,
		m:      m,
		logger: logger.With().Str("consumer", "dr-runbook-reconcile").Logger(),
	}
}

// Topics returns the bus topics this consumer subscribes to.
func (c *Consumer) Topics() []string {
	return []string{events.Topics.DREvents}
}

// EventTypes returns the asset-change event types this consumer reacts to, so
// the shared consumer's type filter skips everything else on the busy
// datastream.dr.events topic (including this package's own runbook.generated /
// runbook.regenerated events, preventing a regeneration feedback loop).
func (c *Consumer) EventTypes() []string {
	return []string{
		evtGroupMemberAdded,
		evtGroupMemberRemoved,
		evtGroupCreated,
		evtSiteUpdated,
		evtNetworkMappingCreated,
		evtNetworkMappingUpdated,
		evtRecoveryPointCreated,
		evtRecoveryPointSealed,
		evtRecoveryPointValid,
		evtRecoveryPointRecorded,
	}
}

// Handle reconciles one asset-change event. It extracts the affected group from
// the event payload, maps the event type to a trigger, and regenerates the
// runbook. Events that do not carry a resolvable group are skipped (logged), not
// errored, so an unrelated or malformed event never blocks the consumer. A real
// regeneration error IS returned so the bus redelivers it.
func (c *Consumer) Handle(ctx context.Context, event *events.Event) error {
	if event == nil {
		return nil
	}
	trigger, ok := triggerFor(event.Type)
	if !ok {
		// Not an asset-change event (e.g. our own runbook.* event, or a failover
		// event). The EventTypes() filter normally prevents this, but be defensive.
		return nil
	}
	if c == nil || c.gen == nil {
		return errors.New("registry consumer: generator is required")
	}

	groupID, err := groupIDFromEvent(event)
	if err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Str("event_type", event.Type).
			Msg("dr asset event without resolvable group; skipping")
		return nil
	}
	if event.TenantID == "" {
		c.logger.Warn().Str("event_id", event.ID).Str("event_type", event.Type).
			Msg("dr asset event without tenant; skipping")
		return nil
	}

	profile := profileFor(event)
	res, err := c.gen.regenerateSystem(ctx, event.TenantID, groupID, profile, trigger)
	if err != nil {
		// A missing group/no-members is an expected transient state (the asset was
		// just deleted, or a group was created before any member): log and ack so
		// the bus does not hot-loop. Genuine persistence errors are returned for
		// redelivery.
		if errors.Is(err, ErrGroupNotFound) || errors.Is(err, ErrNoAssets) {
			c.logger.Info().Str("group_id", groupID).Str("trigger", trigger).
				Str("reason", err.Error()).Msg("runbook reconcile skipped (assets not ready)")
			return nil
		}
		c.m.observeReconcileError()
		return fmt.Errorf("registry consumer: regenerating runbook for group %s: %w", groupID, err)
	}

	c.logger.Info().
		Str("group_id", groupID).
		Str("trigger", trigger).
		Bool("changed", res.Changed).
		Int("version", versionNumber(res.Version)).
		Msg("runbook reconcile processed")
	return nil
}

// triggerFor maps an asset-change event type to the trigger recorded on the
// resulting version. The second return is false for event types this consumer
// does not act on.
func triggerFor(eventType string) (string, bool) {
	switch eventType {
	case evtGroupMemberAdded, evtGroupMemberRemoved:
		return TriggerMembership, true
	case evtGroupCreated:
		return TriggerGroup, true
	case evtSiteUpdated:
		return TriggerSite, true
	case evtNetworkMappingCreated, evtNetworkMappingUpdated:
		return TriggerNetworkMapping, true
	case evtRecoveryPointCreated, evtRecoveryPointSealed, evtRecoveryPointValid, evtRecoveryPointRecorded:
		return TriggerRecoveryPoint, true
	default:
		return "", false
	}
}

// groupIDFromEvent extracts the consistency-group ID from an event payload. DR
// asset events carry the group on a "group_id" field; the CloudEvents Subject is
// the fallback when an event is keyed by the group resource.
func groupIDFromEvent(event *events.Event) (string, error) {
	if len(event.Data) > 0 {
		var payload struct {
			GroupID string `json:"group_id"`
		}
		if err := json.Unmarshal(event.Data, &payload); err == nil && payload.GroupID != "" {
			return payload.GroupID, nil
		}
	}
	if event.Subject != "" {
		return event.Subject, nil
	}
	return "", fmt.Errorf("no group_id in event data or subject")
}

// profileFor selects the network profile the regeneration should document. The
// reconcile loop maintains the production runbook by default; a payload that
// names an isolated (drill) profile is honoured so a drill-mapping change keeps
// the drill runbook current.
func profileFor(event *events.Event) string {
	if len(event.Data) > 0 {
		var payload struct {
			Profile string `json:"profile"`
		}
		if err := json.Unmarshal(event.Data, &payload); err == nil && payload.Profile == "isolated" {
			return "isolated"
		}
	}
	return "production"
}

// compile-time check that Consumer is a typed event handler.
var (
	_ events.TypedEventHandler = (*Consumer)(nil)
	_ regenerator              = (*Generator)(nil)
)
