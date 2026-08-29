package adapters

import (
	"context"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	intmodel "github.com/clario360/platform/internal/integration/model"
	"github.com/clario360/platform/internal/integration/service/teams"
)

// TeamsAdapter wraps the unchanged *teams.Client as a connector.Connector.
// Send/Test decode the config into intmodel.TeamsConfig and call the same client
// methods the legacy type-switch called (Client.Send / Client.SendTest).
type TeamsAdapter struct {
	client *teams.Client
}

// NewTeamsAdapter wraps client (the same instance main.go already builds).
func NewTeamsAdapter(client *teams.Client) *TeamsAdapter {
	return &TeamsAdapter{client: client}
}

// teamsManifest declares the Teams config schema. All four credential/target
// fields are required, mirroring service.NormalizeAndValidateConfig for Teams.
// Field names match intmodel.TeamsConfig JSON tags.
func teamsManifest() connector.Manifest {
	return connector.Manifest{
		Type:         string(intmodel.IntegrationTypeTeams),
		DisplayName:  "Microsoft Teams",
		Capabilities: connector.CapabilityNotify,
		AuthKind:     connector.AuthAppPassword,
		ConfigSchema: []connector.FieldSpec{
			{Name: "bot_app_id", Type: connector.FieldTypeString, Required: true, Description: "Bot Framework app (client) ID"},
			{Name: "bot_password", Type: connector.FieldTypeSecret, Required: true, Secret: true, Description: "Bot Framework client secret"},
			{Name: "service_url", Type: connector.FieldTypeString, Required: true, Description: "Bot Framework service URL for the conversation"},
			{Name: "conversation_id", Type: connector.FieldTypeString, Required: true, Description: "Target conversation ID"},
			{Name: "tenant_id", Type: connector.FieldTypeString, Description: "Azure AD tenant ID"},
		},
	}
}

// Manifest returns the Teams connector descriptor.
func (a *TeamsAdapter) Manifest() connector.Manifest { return teamsManifest() }

// ValidateConfig enforces the Teams schema, which already encodes the four
// required fields the legacy validator checked.
func (a *TeamsAdapter) ValidateConfig(cfg map[string]any) error {
	return connector.ValidateAgainstSchemaPolicy(teamsManifest().ConfigSchema, cfg, connector.IgnoreUnknownFields)
}

// Send decodes cfg into intmodel.TeamsConfig and delivers event via the wrapped
// client.
func (a *TeamsAdapter) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	var tc intmodel.TeamsConfig
	if err := decodeInto(cfg, &tc); err != nil {
		return connector.Result{}, err
	}
	code, body, err := a.client.Send(ctx, tc, event)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// Test decodes cfg and runs the wrapped client's SendTest, matching the legacy
// integration_service.Test path for Teams.
func (a *TeamsAdapter) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	var tc intmodel.TeamsConfig
	if err := decodeInto(cfg, &tc); err != nil {
		return connector.Result{}, err
	}
	code, body, err := a.client.SendTest(ctx, tc)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// Compile-time conformance: TeamsAdapter is a notify connector and a tester.
var (
	_ connector.Connector = (*TeamsAdapter)(nil)
	_ connector.Tester    = (*TeamsAdapter)(nil)
)
