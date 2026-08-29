// Package adapters wraps the existing, unchanged integration clients
// (slack/teams/jira/servicenow/webhook) as connector.Connector implementations
// and assembles them into a connector.Registry.
//
// This package is strictly additive and behavior-preserving: every adapter
// decodes the incoming map[string]any config into the same concrete *Config
// struct the legacy type-switch used, then calls the SAME client method the
// switch called. No client code is modified. The registry produced by
// BuildDefaultRegistry is the single dispatch point that replaces the three
// type-switches in the service package (delivery Process, integration Test,
// config NormalizeAndValidateConfig).
//
// Adapters must not import internal/integration/service to avoid an import
// cycle (service imports this package); the small decodeInto helper here is a
// byte-for-byte copy of service.DecodeInto's behavior (json marshal then
// unmarshal) so config decoding is identical.
package adapters

import (
	"context"
	"encoding/json"
	"fmt"

	intmodel "github.com/clario360/platform/internal/integration/model"
)

// integrationCtxKey is the context key under which the ticket dispatch carries
// the *intmodel.Integration. The jira/servicenow clients' CreateFromEntity
// methods require the integration (for TenantID/ID on the created
// ExternalTicketLink), but the SDK TicketConnector.CreateFromEntity signature —
// fixed by the connector contract — does not pass it. The delivery and
// integration services, which already hold the integration, attach it to the
// context before invoking the registry; the ticket adapters read it back here.
// This keeps the SDK signature verbatim while preserving exact legacy behavior.
type integrationCtxKey struct{}

// WithIntegration returns a child context carrying integration, for the ticket
// adapters to consume. Callers in the service package set this immediately
// before dispatching a ticket creation through the registry.
func WithIntegration(ctx context.Context, integration *intmodel.Integration) context.Context {
	return context.WithValue(ctx, integrationCtxKey{}, integration)
}

// integrationFromContext extracts the *intmodel.Integration previously attached
// by WithIntegration. The ok result is false when none was attached.
func integrationFromContext(ctx context.Context) (*intmodel.Integration, bool) {
	integration, ok := ctx.Value(integrationCtxKey{}).(*intmodel.Integration)
	return integration, ok && integration != nil
}

// requireIntegration returns the integration from ctx or an error explaining
// that the ticket dispatch was invoked without one. This is a real failure
// path, not a stub: the registry-driven dispatch always attaches it, so a
// missing integration indicates a wiring bug and must surface, not panic.
func requireIntegration(ctx context.Context, connectorType string) (*intmodel.Integration, error) {
	integration, ok := integrationFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("%s connector: CreateFromEntity requires an integration on the context (use adapters.WithIntegration)", connectorType)
	}
	return integration, nil
}

// tenantCtxKey carries the tenant ID for connectors whose Test path embeds it
// in the test payload (webhook). The integration_service.Test caller attaches it
// via WithTenant so the webhook test event is byte-identical to the legacy one.
type tenantCtxKey struct{}

// WithTenant returns a child context carrying tenantID for Test dispatch.
func WithTenant(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, tenantCtxKey{}, tenantID)
}

// tenantFromContext extracts the tenant ID attached by WithTenant ("" if none).
func tenantFromContext(ctx context.Context) string {
	if v, ok := ctx.Value(tenantCtxKey{}).(string); ok {
		return v
	}
	return ""
}

// stringField returns the string value at key, or "" if absent or non-string.
// It mirrors the leniency of service.stringValue for the string case (the only
// case the required-field checks care about) without pulling in the service
// package.
func stringField(cfg map[string]any, key string) string {
	if cfg == nil {
		return ""
	}
	if v, ok := cfg[key].(string); ok {
		return v
	}
	return ""
}

// decodeInto re-encodes config as JSON and decodes it into target, exactly as
// the legacy service.DecodeInto does. It is duplicated here (rather than
// imported) solely to avoid an import cycle; the behavior is identical so config
// decoding — and therefore delivery behavior — is unchanged.
func decodeInto[T any](config map[string]any, target *T) error {
	payload, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}
	if err := json.Unmarshal(payload, target); err != nil {
		return fmt.Errorf("decode config: %w", err)
	}
	return nil
}
