package adapters

import (
	"context"
	"fmt"
	"strings"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	intmodel "github.com/clario360/platform/internal/integration/model"
	"github.com/clario360/platform/internal/integration/service/servicenow"
)

// ServiceNowAdapter wraps the unchanged *servicenow.Service as a
// connector.TicketConnector. CreateFromEntity decodes the config into
// intmodel.ServiceNowConfig and calls Service.CreateFromEntity — the exact
// method the legacy delivery type-switch called — mapping the returned
// *model.ExternalTicketLink into a connector.ExternalRef. Test reproduces the
// legacy integration_service.Test ServiceNow branch.
type ServiceNowAdapter struct {
	service *servicenow.Service
}

// NewServiceNowAdapter wraps service (the same instance main.go already builds).
func NewServiceNowAdapter(service *servicenow.Service) *ServiceNowAdapter {
	return &ServiceNowAdapter{service: service}
}

// servicenowManifest declares the ServiceNow config schema. instance_url is
// required; auth_type is an enum (basic|oauth) defaulting to "basic". The
// credential combination (basic ⇒ username+password, oauth ⇒ oauth_token) is
// enforced in ValidateConfig, mirroring service.NormalizeAndValidateConfig.
func servicenowManifest() connector.Manifest {
	return connector.Manifest{
		Type:         string(intmodel.IntegrationTypeServiceNow),
		DisplayName:  "ServiceNow",
		Capabilities: connector.CapabilityTicket,
		AuthKind:     connector.AuthBasic,
		ConfigSchema: []connector.FieldSpec{
			{Name: "instance_url", Type: connector.FieldTypeString, Required: true, Description: "ServiceNow instance URL"},
			{Name: "auth_type", Type: connector.FieldTypeEnum, Enum: []string{"basic", "oauth"}, Default: "basic", Description: "Authentication mode"},
			{Name: "username", Type: connector.FieldTypeString, Description: "Basic auth username (required for basic auth)"},
			{Name: "password", Type: connector.FieldTypeSecret, Secret: true, Description: "Basic auth password (required for basic auth)"},
			{Name: "oauth_token", Type: connector.FieldTypeSecret, Secret: true, Description: "OAuth token (required for oauth auth)"},
			{Name: "assignment_group", Type: connector.FieldTypeString, Description: "Default assignment group"},
			{Name: "caller_id", Type: connector.FieldTypeString, Description: "Default caller sys_id"},
			{Name: "category", Type: connector.FieldTypeString, Description: "Incident category"},
			{Name: "subcategory", Type: connector.FieldTypeString, Description: "Incident subcategory"},
			{Name: "webhook_secret", Type: connector.FieldTypeSecret, Secret: true, Description: "Secret for inbound webhook verification"},
			{Name: "status_mapping", Type: connector.FieldTypeObject, Description: "State-to-Clario-status map"},
			{Name: "custom_fields", Type: connector.FieldTypeObject, Description: "Additional incident fields"},
		},
	}
}

// Manifest returns the ServiceNow connector descriptor.
func (a *ServiceNowAdapter) Manifest() connector.Manifest { return servicenowManifest() }

// ValidateConfig enforces the ServiceNow schema (types, unknown fields, required
// instance_url, auth_type enum membership) and the credential-combination rule,
// matching service.NormalizeAndValidateConfig exactly. An absent/empty auth_type
// is treated as "basic" (the legacy default) before the credential check.
func (a *ServiceNowAdapter) ValidateConfig(cfg map[string]any) error {
	if err := connector.ValidateAgainstSchemaPolicy(servicenowManifest().ConfigSchema, cfg, connector.IgnoreUnknownFields); err != nil {
		return err
	}
	authType := strings.TrimSpace(stringField(cfg, "auth_type"))
	if authType == "" {
		authType = "basic"
	}
	switch authType {
	case "basic":
		if strings.TrimSpace(stringField(cfg, "username")) == "" || strings.TrimSpace(stringField(cfg, "password")) == "" {
			return fmt.Errorf("servicenow username and password are required for basic auth")
		}
	case "oauth":
		if strings.TrimSpace(stringField(cfg, "oauth_token")) == "" {
			return fmt.Errorf("servicenow oauth_token is required for oauth auth")
		}
	default:
		// Unreachable when schema enum validation passes, but kept to match the
		// legacy validator's explicit error and guard against schema drift.
		return fmt.Errorf("servicenow auth_type must be basic or oauth")
	}
	return nil
}

// Send is not the delivery path for a ticket connector: ServiceNow deliveries
// route through CreateFromEntity. Send returns a directing error.
func (a *ServiceNowAdapter) Send(ctx context.Context, cfg map[string]any, event *events.Event) (connector.Result, error) {
	return connector.Result{}, fmt.Errorf("servicenow connector creates incidents; use CreateFromEntity, not Send")
}

// CreateFromEntity decodes cfg into intmodel.ServiceNowConfig, reads the
// integration from the context (attached by the dispatch via WithIntegration),
// and calls the wrapped service's CreateFromEntity with the identical arguments
// the legacy switch passed. The resulting *model.ExternalTicketLink is projected
// into a connector.ExternalRef.
func (a *ServiceNowAdapter) CreateFromEntity(ctx context.Context, cfg map[string]any, bearerToken, entityType, entityID string) (connector.Result, error) {
	integration, err := requireIntegration(ctx, "servicenow")
	if err != nil {
		return connector.Result{}, err
	}
	var sc intmodel.ServiceNowConfig
	if err := decodeInto(cfg, &sc); err != nil {
		return connector.Result{}, err
	}
	link, code, body, err := a.service.CreateFromEntity(ctx, integration, sc, bearerToken, entityType, entityID)
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

// Test reproduces the legacy integration_service.Test ServiceNow branch: it
// builds the same connectivity-check payload (defaulting category/subcategory)
// and calls the raw client's CreateIncident.
func (a *ServiceNowAdapter) Test(ctx context.Context, cfg map[string]any) (connector.Result, error) {
	var sc intmodel.ServiceNowConfig
	if err := decodeInto(cfg, &sc); err != nil {
		return connector.Result{}, err
	}
	payload := map[string]any{
		"short_description": "[Clario 360 Test] Integration connectivity check",
		"description":       "Generated by Clario 360 to verify ServiceNow connectivity.",
		"urgency":           3,
		"impact":            3,
		"category":          firstNonEmpty(sc.Category, "Security"),
		"subcategory":       firstNonEmpty(sc.Subcategory, "Threat Detection"),
	}
	_, code, body, err := a.service.RawClient().CreateIncident(ctx, sc, payload)
	return connector.Result{ResponseCode: code, ResponseBody: body}, err
}

// firstNonEmpty returns the first non-blank value, matching the legacy
// service.firstNonEmpty used to default the ServiceNow test payload.
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

// Compile-time conformance: ServiceNowAdapter is a ticket connector and a tester.
var (
	_ connector.Connector       = (*ServiceNowAdapter)(nil)
	_ connector.TicketConnector = (*ServiceNowAdapter)(nil)
	_ connector.Tester          = (*ServiceNowAdapter)(nil)
)
