package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	intmodel "github.com/clario360/platform/internal/integration/model"
	"github.com/clario360/platform/internal/integration/service/slack"
)

// SlackAdapter wraps the unchanged *slack.Client as a connector.Connector.
// Send/Test decode the config into intmodel.SlackConfig and call the same
// client methods the legacy type-switch called (Client.Send / Client.SendTest),
// so delivery and test behavior are identical.
type SlackAdapter struct {
	client *slack.Client
}

// NewSlackAdapter wraps client. client must be non-nil (the same instance
// main.go already builds).
func NewSlackAdapter(client *slack.Client) *SlackAdapter {
	return &SlackAdapter{client: client}
}

// slackManifest declares the Slack config schema. The required/secret rules
// mirror service.NormalizeAndValidateConfig for Slack: bot_token is required;
// channel_id OR incoming_webhook_url is required (the OR is enforced in
// ValidateConfig because a flat schema cannot express it). Field names match the
// intmodel.SlackConfig JSON tags exactly.
func slackManifest() connector.Manifest {
	return connector.Manifest{
		Type:         string(intmodel.IntegrationTypeSlack),
		DisplayName:  "Slack",
		Capabilities: connector.CapabilityNotify,
		AuthKind:     connector.AuthBearerToken,
		ConfigSchema: []connector.FieldSpec{
			{Name: "bot_token", Type: connector.FieldTypeSecret, Required: true, Secret: true, Description: "Slack bot OAuth token (xoxb-...)"},
			{Name: "channel_id", Type: connector.FieldTypeString, Description: "Target channel ID; required unless incoming_webhook_url is set"},
			{Name: "incoming_webhook_url", Type: connector.FieldTypeSecret, Secret: true, Description: "Incoming webhook URL; alternative to channel_id"},
			{Name: "team_id", Type: connector.FieldTypeString, Description: "Slack workspace (team) ID"},
			{Name: "team_name", Type: connector.FieldTypeString, Description: "Slack workspace name"},
			{Name: "signing_secret", Type: connector.FieldTypeSecret, Secret: true, Description: "Signing secret for inbound request verification"},
			{Name: "thread_per_alert", Type: connector.FieldTypeBool, Description: "Open a thread per alert"},
			{Name: "include_explanation", Type: connector.FieldTypeBool, Description: "Include AI explanation in messages"},
		},
	}
}

// Manifest returns the Slack connector descriptor.
func (a *SlackAdapter) Manifest() connector.Manifest { return slackManifest() }

// ValidateConfig enforces the Slack schema (types, unknown fields, required
// bot_token) and then the channel_id OR incoming_webhook_url rule, exactly
// matching the legacy NormalizeAndValidateConfig semantics.
func (a *SlackAdapter) ValidateConfig(cfg map[string]any) error {
	if err := connector.ValidateAgainstSchemaPolicy(slackManifest().ConfigSchema, cfg, connector.IgnoreUnknownFields); err != nil {
		return err
	}
	if strings.TrimSpace(stringField(cfg, "channel_id")) == "" &&
		strings.TrimSpace(stringField(cfg, "incoming_webhook_url")) == "" {
		return fmt.Errorf("slack channel_id or incoming_webhook_url is required")
	}
	return nil
}

// Send decodes cfg into intmodel.SlackConfig and delivers event via the wrapped
// client, returning the same (code, body) the legacy switch produced.
func (a *SlackAdapter) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	var sc intmodel.SlackConfig
	if err := decodeInto(cfg, &sc); err != nil {
		return connector.Result{}, err
	}
	code, body, err := a.client.Send(ctx, sc, event)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// Test decodes cfg and runs the wrapped client's SendTest, matching the legacy
// integration_service.Test path for Slack.
func (a *SlackAdapter) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	var sc intmodel.SlackConfig
	if err := decodeInto(cfg, &sc); err != nil {
		return connector.Result{}, err
	}
	code, body, err := a.client.SendTest(ctx, sc)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// Compile-time conformance: SlackAdapter is a notify connector and a tester.
var (
	_ connector.Connector = (*SlackAdapter)(nil)
	_ connector.Tester    = (*SlackAdapter)(nil)
)
