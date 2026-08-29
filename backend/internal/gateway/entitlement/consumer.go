package entitlement

import (
	"context"
	"encoding/json"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// entitlementsChangedType is the CloudEvents type the license-service emits when
// a route-level entitlement decision cached outside it may have gone stale. It
// is the model.EntitlementsChangedEvent staged in the license outbox, published
// to Topics.LicenseEvents and prefixed with "com.clario360." by events.NewEvent.
const entitlementsChangedType = "com.clario360.license.entitlements_changed"

// Invalidator is the slice of CachedChecker the consumer drives: drop the whole
// tenant namespace on an invalidate_all event, or one entry on a per-key event.
// Defined as an interface so the consumer is unit-testable without Redis.
type Invalidator interface {
	InvalidateTenant(ctx context.Context, tenantID string) error
	InvalidateKey(ctx context.Context, tenantID, key string) error
}

// changedPayload mirrors license/service.EntitlementsChangedEvent's JSON. We do
// not import the license package (gateway must not depend on a backend service);
// only the two fields the gateway acts on are decoded.
type changedPayload struct {
	EntitlementKey string `json:"entitlement_key"`
	InvalidateAll  bool   `json:"invalidate_all"`
}

// CacheBustConsumer subscribes to the license event topic and busts the
// gateway's entitlement cache when entitlements change, closing the window in
// which a corrected license is still denied by a stale cached decision (up to
// the cache TTL). It owns its events.Consumer so Start/Stop manage the whole
// consumer-group lifecycle.
//
// Correctness never depends on this consumer: the CachedChecker TTL is the
// backstop. Delivery is best-effort — a dropped or mishandled event only delays
// visibility until the entry expires, so handler failures are logged and
// swallowed rather than retried into the DLQ forever.
type CacheBustConsumer struct {
	consumer    *events.Consumer
	invalidator Invalidator
	logger      zerolog.Logger
}

// NewCacheBustConsumer wires consumer to drive invalidator. The caller builds
// the events.Consumer (its kafka connection is the only failure point) and is
// responsible for Start/Stop.
func NewCacheBustConsumer(consumer *events.Consumer, invalidator Invalidator, logger zerolog.Logger) *CacheBustConsumer {
	return &CacheBustConsumer{
		consumer:    consumer,
		invalidator: invalidator,
		logger:      logger.With().Str("component", "entitlement_cache_bust_consumer").Logger(),
	}
}

// Start subscribes to the license topic and blocks consuming until ctx is
// cancelled. It returns the consumer's terminal error (kafka group closed /
// ctx cancelled) so the caller can log it; the caller must treat that as
// best-effort (the TTL backstops correctness) and never crash the gateway on it.
func (c *CacheBustConsumer) Start(ctx context.Context) error {
	c.consumer.Subscribe(events.Topics.LicenseEvents, events.EventHandlerFunc(c.handle))
	c.logger.Info().Str("topic", events.Topics.LicenseEvents).Msg("entitlement cache-bust consumer starting")
	return c.consumer.Start(ctx)
}

// Stop gracefully stops the underlying consumer group.
func (c *CacheBustConsumer) Stop() error {
	if c == nil || c.consumer == nil {
		return nil
	}
	return c.consumer.Stop()
}

// handle busts the cache for one event. It returns nil on every non-fatal
// condition (wrong type, missing tenant, malformed payload, Redis error) so the
// event is committed and never dead-lettered: a missed bust is harmless because
// the cache entry expires on its TTL anyway.
func (c *CacheBustConsumer) handle(ctx context.Context, event *events.Event) error {
	if event == nil || event.Type != entitlementsChangedType {
		return nil
	}
	if event.TenantID == "" {
		c.logger.Warn().Str("event_id", event.ID).Msg("entitlements_changed event without tenant; skipping cache bust")
		return nil
	}

	var payload changedPayload
	if err := json.Unmarshal(event.Data, &payload); err != nil {
		c.logger.Warn().Err(err).Str("event_id", event.ID).Msg("malformed entitlements_changed payload; skipping cache bust")
		return nil
	}

	if payload.InvalidateAll {
		if err := c.invalidator.InvalidateTenant(ctx, event.TenantID); err != nil {
			c.logger.Warn().Err(err).Str("tenant_id", event.TenantID).Msg("failed to invalidate tenant entitlement cache; TTL will backstop")
		} else {
			c.logger.Debug().Str("tenant_id", event.TenantID).Msg("invalidated all entitlement cache entries for tenant")
		}
		return nil
	}

	if payload.EntitlementKey == "" {
		// Neither invalidate_all nor a key — nothing the gateway can act on.
		return nil
	}
	if err := c.invalidator.InvalidateKey(ctx, event.TenantID, payload.EntitlementKey); err != nil {
		c.logger.Warn().Err(err).
			Str("tenant_id", event.TenantID).
			Str("entitlement_key", payload.EntitlementKey).
			Msg("failed to invalidate entitlement cache key; TTL will backstop")
	} else {
		c.logger.Debug().
			Str("tenant_id", event.TenantID).
			Str("entitlement_key", payload.EntitlementKey).
			Msg("invalidated entitlement cache key for tenant")
	}
	return nil
}
