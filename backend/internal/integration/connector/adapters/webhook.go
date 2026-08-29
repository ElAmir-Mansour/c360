package adapters

import (
	"context"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	intmodel "github.com/clario360/platform/internal/integration/model"
	"github.com/clario360/platform/internal/integration/service/webhook"
)

// WebhookAdapter wraps the unchanged *webhook.Client as a connector.Connector.
// Send decodes the config into intmodel.WebhookConfig and calls Client.Post —
// the same method the legacy type-switch called. Test posts a synthetic
// "integration.test" event, matching integration_service.Test for webhook.
type WebhookAdapter struct {
	client *webhook.Client
}

// NewWebhookAdapter wraps client (the same instance main.go already builds).
func NewWebhookAdapter(client *webhook.Client) *WebhookAdapter {
	return &WebhookAdapter{client: client}
}

// webhookManifest declares the Webhook config schema. url is required (matching
// service.NormalizeAndValidateConfig); method/content_type carry the legacy
// defaults ("POST"/"application/json") and headers defaults to an empty object.
// ApplyDefaults (run by the config-normalization path) materializes these so the
// stored config is identical to the legacy normalized config.
func webhookManifest() connector.Manifest {
	return connector.Manifest{
		Type:         string(intmodel.IntegrationTypeWebhook),
		DisplayName:  "Webhook",
		Capabilities: connector.CapabilityNotify,
		AuthKind:     connector.AuthHMAC,
		ConfigSchema: []connector.FieldSpec{
			{Name: "url", Type: connector.FieldTypeString, Required: true, Description: "Receiver URL"},
			{Name: "method", Type: connector.FieldTypeString, Default: "POST", Description: "HTTP method"},
			{Name: "content_type", Type: connector.FieldTypeString, Default: "application/json", Description: "Request Content-Type"},
			{Name: "headers", Type: connector.FieldTypeObject, Default: map[string]string{}, Description: "Static headers to send"},
			{Name: "secret", Type: connector.FieldTypeSecret, Secret: true, Description: "HMAC signing secret"},
		},
	}
}

// Manifest returns the Webhook connector descriptor.
func (a *WebhookAdapter) Manifest() connector.Manifest { return webhookManifest() }

// ValidateConfig enforces the Webhook schema, which encodes the required url
// rule. Defaults are applied separately by the normalization path (ApplyDefaults
// over the same schema), preserving legacy NormalizeAndValidateConfig output.
func (a *WebhookAdapter) ValidateConfig(cfg map[string]any) error {
	return connector.ValidateAgainstSchemaPolicy(webhookManifest().ConfigSchema, cfg, connector.IgnoreUnknownFields)
}

// Send decodes cfg into intmodel.WebhookConfig and posts event via the wrapped
// client.
func (a *WebhookAdapter) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	var wc intmodel.WebhookConfig
	if err := decodeInto(cfg, &wc); err != nil {
		return connector.Result{}, err
	}
	code, body, err := a.client.Post(ctx, wc, event)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// Test posts a synthetic integration-test event, reproducing the legacy
// integration_service.Test webhook branch exactly (same event type, source and
// data; tenant ID is taken from the context via WithTenant).
func (a *WebhookAdapter) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	var wc intmodel.WebhookConfig
	if err := decodeInto(cfg, &wc); err != nil {
		return connector.Result{}, err
	}
	event, err := events.NewEvent("integration.test", "notification-service", tenantFromContext(ctx), map[string]any{"title": "Integration test"})
	if err != nil {
		return connector.Result{}, err
	}
	code, body, err := a.client.Post(ctx, wc, event)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// Compile-time conformance: WebhookAdapter is a notify connector and a tester.
var (
	_ connector.Connector = (*WebhookAdapter)(nil)
	_ connector.Tester    = (*WebhookAdapter)(nil)
)
