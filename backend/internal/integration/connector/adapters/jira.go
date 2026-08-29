package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	intmodel "github.com/clario360/platform/internal/integration/model"
	"github.com/clario360/platform/internal/integration/service/jira"
)

// JiraAdapter wraps the unchanged *jira.Service as a connector.TicketConnector.
// CreateFromEntity decodes the config into intmodel.JiraConfig and calls
// Service.CreateFromEntity — the exact method the legacy delivery type-switch
// called — mapping the returned *model.ExternalTicketLink into a
// connector.ExternalRef. Test reproduces the legacy integration_service.Test
// Jira branch (RawClient().CreateIssue with a connectivity-check payload).
type JiraAdapter struct {
	service *jira.Service
}

// NewJiraAdapter wraps service (the same instance main.go already builds).
func NewJiraAdapter(service *jira.Service) *JiraAdapter {
	return &JiraAdapter{service: service}
}

// jiraManifest declares the Jira config schema. base_url and project_key are
// required; auth_token OR refresh_token is required (the OR is enforced in
// ValidateConfig). Field names match intmodel.JiraConfig JSON tags.
func jiraManifest() connector.Manifest {
	return connector.Manifest{
		Type:         string(intmodel.IntegrationTypeJira),
		DisplayName:  "Jira Cloud",
		Capabilities: connector.CapabilityTicket,
		AuthKind:     connector.AuthOAuth2,
		ConfigSchema: []connector.FieldSpec{
			{Name: "base_url", Type: connector.FieldTypeString, Required: true, Description: "Jira site base URL"},
			{Name: "project_key", Type: connector.FieldTypeString, Required: true, Description: "Target project key"},
			{Name: "cloud_id", Type: connector.FieldTypeString, Description: "Atlassian cloud ID"},
			{Name: "issue_type_id", Type: connector.FieldTypeString, Description: "Issue type ID to create"},
			{Name: "auth_token", Type: connector.FieldTypeSecret, Secret: true, Description: "OAuth access token; required unless refresh_token is set"},
			{Name: "refresh_token", Type: connector.FieldTypeSecret, Secret: true, Description: "OAuth refresh token; alternative to auth_token"},
			{Name: "webhook_secret", Type: connector.FieldTypeSecret, Secret: true, Description: "Secret for inbound webhook verification"},
			{Name: "priority_mapping", Type: connector.FieldTypeObject, Description: "Severity-to-priority name map"},
			{Name: "status_mapping", Type: connector.FieldTypeObject, Description: "Jira-status-to-Clario-status map"},
			{Name: "custom_fields", Type: connector.FieldTypeObject, Description: "Additional issue fields"},
		},
	}
}

// Manifest returns the Jira connector descriptor.
func (a *JiraAdapter) Manifest() connector.Manifest { return jiraManifest() }

// ValidateConfig enforces the Jira schema (types, unknown fields, required
// base_url/project_key) and the auth_token OR refresh_token rule, matching the
// legacy NormalizeAndValidateConfig semantics for Jira.
func (a *JiraAdapter) ValidateConfig(cfg map[string]any) error {
	if err := connector.ValidateAgainstSchemaPolicy(jiraManifest().ConfigSchema, cfg, connector.IgnoreUnknownFields); err != nil {
		return err
	}
	if strings.TrimSpace(stringField(cfg, "auth_token")) == "" &&
		strings.TrimSpace(stringField(cfg, "refresh_token")) == "" {
		return fmt.Errorf("jira auth_token or refresh_token is required")
	}
	return nil
}

// Send is not the delivery path for a ticket connector: the registry-driven
// dispatch routes Jira deliveries through CreateFromEntity (as the legacy switch
// did). Send returns a directing error so any accidental notify dispatch fails
// loudly rather than silently no-op'ing.
func (a *JiraAdapter) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	return connector.Result{}, fmt.Errorf("jira connector creates tickets; use CreateFromEntity, not Send")
}

// CreateFromEntity decodes cfg into intmodel.JiraConfig, reads the integration
// from the context (attached by the dispatch via WithIntegration), and calls the
// wrapped service's CreateFromEntity with the identical arguments the legacy
// switch passed. The resulting *model.ExternalTicketLink is projected into a
// connector.ExternalRef.
func (a *JiraAdapter) CreateFromEntity(ctx context.Context, cfg map[string]any, bearerToken, entityType, entityID string) (connector.Result, error) {
	integration, err := requireIntegration(ctx, "jira")
	if err != nil {
		return connector.Result{}, err
	}
	var jc intmodel.JiraConfig
	if err := decodeInto(cfg, &jc); err != nil {
		return connector.Result{}, err
	}
	link, code, body, err := a.service.CreateFromEntity(ctx, integration, jc, bearerToken, entityType, entityID)
	res := connector.Result{ResponseCode: code, ResponseBody: body}
	if link != nil {
		res.ExternalRef = &connector.ExternalRef{
			System:      link.ExternalSystem,
			ExternalID:  link.ExternalID,
			ExternalKey: link.ExternalKey,
			URL:         link.ExternalURL,
		}
	}
	return res, err
}

// Test reproduces the legacy integration_service.Test Jira branch: it builds the
// same connectivity-check payload (with optional issuetype) and calls the raw
// client's CreateIssue.
func (a *JiraAdapter) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	var jc intmodel.JiraConfig
	if err := decodeInto(cfg, &jc); err != nil {
		return connector.Result{}, err
	}
	payload := map[string]any{
		"fields": map[string]any{
			"project":     map[string]any{"key": jc.ProjectKey},
			"summary":     "[Clario 360 Test] Integration connectivity check",
			"description": jira.BuildADF(map[string]any{"title": "Integration test", "description": "Generated by Clario 360"}, ""),
		},
	}
	if jc.IssueTypeID != "" {
		payload["fields"].(map[string]any)["issuetype"] = map[string]any{"id": jc.IssueTypeID}
	}
	_, code, body, err := a.service.RawClient().CreateIssue(ctx, jc, payload)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// Compile-time conformance: JiraAdapter is a ticket connector and a tester.
var (
	_ connector.Connector       = (*JiraAdapter)(nil)
	_ connector.TicketConnector = (*JiraAdapter)(nil)
	_ connector.Tester          = (*JiraAdapter)(nil)
)
