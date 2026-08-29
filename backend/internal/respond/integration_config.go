package respond

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
)

type CreateIntegrationConnectorInput struct {
	Kind              IntegrationKind
	Provider          IntegrationProvider
	Name              string
	Enabled           *bool
	EndpointURL       string
	Config            map[string]any
	FieldMapping      map[string]string
	WebhookAuthType   IntegrationWebhookAuthType
	WebhookSecretName string
	Secrets           []IntegrationSecretInput
}

type IntegrationConnectorResponse struct {
	ID                uuid.UUID                  `json:"id"`
	TenantID          uuid.UUID                  `json:"tenant_id"`
	Kind              IntegrationKind            `json:"kind"`
	Provider          IntegrationProvider        `json:"provider"`
	Name              string                     `json:"name"`
	Enabled           bool                       `json:"enabled"`
	EndpointURL       string                     `json:"endpoint_url,omitempty"`
	Config            map[string]any             `json:"config"`
	FieldMapping      map[string]string          `json:"field_mapping"`
	WebhookAuthType   IntegrationWebhookAuthType `json:"webhook_auth_type"`
	WebhookSecretName string                     `json:"webhook_secret_name,omitempty"`
	Secrets           []IntegrationSecretSummary `json:"secrets"`
	RowVersion        int                        `json:"row_version"`
	CreatedAt         time.Time                  `json:"created_at"`
	UpdatedAt         time.Time                  `json:"updated_at"`
}

type IntegrationSecretSummary struct {
	Name       string    `json:"name"`
	Storage    string    `json:"storage"`
	Configured bool      `json:"configured"`
	KeyID      string    `json:"key_id,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type EnvironmentIntegrationSecretRefResolver struct{}

func (EnvironmentIntegrationSecretRefResolver) ResolveIntegrationSecret(_ context.Context, ref string) (string, error) {
	key := strings.TrimSpace(ref)
	switch {
	case strings.HasPrefix(key, "env://"):
		key = strings.TrimSpace(strings.TrimPrefix(key, "env://"))
	case strings.HasPrefix(key, "env:"):
		key = strings.TrimSpace(strings.TrimPrefix(key, "env:"))
	default:
		return "", fmt.Errorf("secret reference %q is not an environment reference: %w", ref, ErrIntegrationSecretUnavailable)
	}
	if key == "" {
		return "", fmt.Errorf("environment secret reference is empty: %w", ErrIntegrationConfig)
	}
	value, ok := os.LookupEnv(key)
	if !ok || strings.TrimSpace(value) == "" {
		return "", fmt.Errorf("environment secret %q is not configured: %w", key, ErrIntegrationSecretUnavailable)
	}
	return value, nil
}

func (s *RespondIntegrationService) CreateIntegrationConnector(ctx context.Context, tenantID uuid.UUID, actor Actor, in CreateIntegrationConnectorInput) (*IntegrationConnectorResponse, error) {
	if !actor.Can(PermRespondAdmin) {
		return nil, ErrUnauthorized
	}
	connector, err := buildIntegrationConnector(tenantID, actor.UserID, in)
	if err != nil {
		return nil, err
	}
	if err := validateIntegrationConnectorConfig(connector, in.Secrets); err != nil {
		return nil, err
	}
	secrets, err := PrepareIntegrationSecrets(ctx, uuid.Nil, tenantID, s.cipher, in.Secrets)
	if err != nil {
		return nil, err
	}
	err = s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		return s.store.CreateIntegrationConnector(ctx, tx, connector, secrets)
	})
	if err != nil {
		return nil, err
	}
	return integrationConnectorResponse(connector, secrets), nil
}

func (s *RespondIntegrationService) ListIntegrationConnectors(ctx context.Context, tenantID uuid.UUID, actor Actor, kind *IntegrationKind, provider *IntegrationProvider) ([]IntegrationConnectorResponse, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	if kind != nil && !kind.Valid() {
		return nil, fmt.Errorf("kind %q: %w", *kind, ErrIntegrationConfig)
	}
	if provider != nil && !provider.Valid() {
		return nil, fmt.Errorf("provider %q: %w", *provider, ErrIntegrationUnsupported)
	}
	var connectors []IntegrationConnector
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		connectors, err = s.store.ListIntegrationConnectors(ctx, tx, tenantID, kind, provider)
		return err
	})
	if err != nil {
		return nil, err
	}
	out := make([]IntegrationConnectorResponse, 0, len(connectors))
	for idx := range connectors {
		out = append(out, *integrationConnectorResponse(&connectors[idx], nil))
	}
	return out, nil
}

func (s *RespondIntegrationService) GetIntegrationConnector(ctx context.Context, tenantID, connectorID uuid.UUID, actor Actor) (*IntegrationConnectorResponse, error) {
	if !actor.Can(PermRespondRead) {
		return nil, ErrUnauthorized
	}
	var connector *IntegrationConnector
	var secrets []IntegrationConnectorSecret
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		connector, secrets, err = s.store.GetIntegrationConnectorWithSecrets(ctx, tx, tenantID, connectorID)
		return err
	})
	if err != nil {
		return nil, err
	}
	return integrationConnectorResponse(connector, secrets), nil
}

func buildIntegrationConnector(tenantID, actorID uuid.UUID, in CreateIntegrationConnectorInput) (*IntegrationConnector, error) {
	enabled := true
	if in.Enabled != nil {
		enabled = *in.Enabled
	}
	connector := &IntegrationConnector{
		TenantID:          tenantID,
		Kind:              in.Kind,
		Provider:          in.Provider,
		Name:              in.Name,
		Enabled:           enabled,
		EndpointURL:       strings.TrimSpace(in.EndpointURL),
		NonSecretConfig:   copyIntegrationConfig(in.Config),
		FieldMapping:      copyIntegrationFieldMapping(in.FieldMapping),
		WebhookAuthType:   in.WebhookAuthType,
		WebhookSecretName: strings.TrimSpace(in.WebhookSecretName),
		CreatedBy:         actorID,
	}
	if err := connector.Validate(); err != nil {
		return nil, err
	}
	if connector.EndpointURL == "" {
		connector.EndpointURL = strings.TrimSpace(stringFromAny(connector.NonSecretConfig["instance_url"]))
	}
	return connector, nil
}

func validateIntegrationConnectorConfig(connector *IntegrationConnector, secrets []IntegrationSecretInput) error {
	if connector == nil {
		return fmt.Errorf("connector is required: %w", ErrIntegrationConfig)
	}
	if err := rejectSecretLikeConfig(connector.NonSecretConfig); err != nil {
		return err
	}
	switch connector.Provider {
	case IntegrationProviderServiceNow:
		return validateServiceNowConnector(connector, secrets)
	case IntegrationProviderSlack:
		return validateSlackConnector(connector, secrets)
	default:
		return ErrIntegrationUnsupported
	}
}

func validateServiceNowConnector(connector *IntegrationConnector, secrets []IntegrationSecretInput) error {
	if err := validateHTTPURL(firstNonEmptyString(connector.EndpointURL, stringFromAny(connector.NonSecretConfig["instance_url"])), "servicenow endpoint_url"); err != nil {
		return err
	}
	authType := strings.ToLower(firstNonEmptyString(stringFromAny(connector.NonSecretConfig["auth_type"]), "basic"))
	switch authType {
	case "basic":
		if strings.TrimSpace(stringFromAny(connector.NonSecretConfig["username"])) == "" {
			return fmt.Errorf("servicenow username is required for basic auth: %w", ErrIntegrationConfig)
		}
		if !hasSecretInput(secrets, serviceNowPasswordSecret) {
			return fmt.Errorf("servicenow password secret is required: %w", ErrIntegrationConfig)
		}
	case "oauth":
		if !hasSecretInput(secrets, serviceNowOAuthSecret) {
			return fmt.Errorf("servicenow oauth token secret is required: %w", ErrIntegrationConfig)
		}
	default:
		return fmt.Errorf("servicenow auth_type %q: %w", authType, ErrIntegrationConfig)
	}
	if connector.WebhookSecretName != "" && !hasSecretInput(secrets, connector.WebhookSecretName) {
		return fmt.Errorf("webhook secret %q is required: %w", connector.WebhookSecretName, ErrIntegrationConfig)
	}
	return nil
}

func validateSlackConnector(connector *IntegrationConnector, secrets []IntegrationSecretInput) error {
	if connector.Kind != IntegrationKindComms {
		return fmt.Errorf("slack connectors must use comms kind: %w", ErrIntegrationUnsupported)
	}
	if apiBase := strings.TrimSpace(stringFromAny(connector.NonSecretConfig["api_base_url"])); apiBase != "" {
		if err := validateHTTPURL(apiBase, "slack api_base_url"); err != nil {
			return err
		}
	}
	if appBase := strings.TrimSpace(stringFromAny(connector.NonSecretConfig["app_base_url"])); appBase != "" {
		if err := validateHTTPURL(appBase, "slack app_base_url"); err != nil {
			return err
		}
	}
	if !hasSecretInput(secrets, slackBotTokenSecret) {
		return fmt.Errorf("slack bot token secret is required: %w", ErrIntegrationConfig)
	}
	return nil
}

func rejectSecretLikeConfig(config map[string]any) error {
	for key, value := range config {
		lower := strings.ToLower(strings.TrimSpace(key))
		if lower == "" {
			continue
		}
		if strings.Contains(lower, "password") ||
			strings.Contains(lower, "secret") ||
			strings.Contains(lower, "token") ||
			strings.Contains(lower, "credential") ||
			strings.Contains(lower, "api_key") ||
			strings.Contains(lower, "private_key") {
			return fmt.Errorf("config field %q must be supplied through secrets: %w", key, ErrIntegrationConfig)
		}
		if nested, ok := value.(map[string]any); ok {
			if err := rejectSecretLikeConfig(nested); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateHTTPURL(raw, label string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed == nil || parsed.Host == "" {
		return fmt.Errorf("%s must be an absolute URL: %w", label, ErrIntegrationConfig)
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return fmt.Errorf("%s must use http or https: %w", label, ErrIntegrationConfig)
	}
	return nil
}

func hasSecretInput(secrets []IntegrationSecretInput, name string) bool {
	name = strings.TrimSpace(name)
	for _, secret := range secrets {
		if strings.TrimSpace(secret.Name) != name {
			continue
		}
		if strings.TrimSpace(secret.Plaintext) != "" || strings.TrimSpace(secret.SecretRef) != "" {
			return true
		}
	}
	return false
}

func integrationConnectorResponse(connector *IntegrationConnector, secrets []IntegrationConnectorSecret) *IntegrationConnectorResponse {
	if connector == nil {
		return nil
	}
	out := &IntegrationConnectorResponse{
		ID:                connector.ID,
		TenantID:          connector.TenantID,
		Kind:              connector.Kind,
		Provider:          connector.Provider,
		Name:              connector.Name,
		Enabled:           connector.Enabled,
		EndpointURL:       connector.EndpointURL,
		Config:            copyIntegrationConfig(connector.NonSecretConfig),
		FieldMapping:      copyIntegrationFieldMapping(connector.FieldMapping),
		WebhookAuthType:   connector.WebhookAuthType,
		WebhookSecretName: connector.WebhookSecretName,
		Secrets:           integrationSecretSummaries(secrets),
		RowVersion:        connector.RowVersion,
		CreatedAt:         connector.CreatedAt,
		UpdatedAt:         connector.UpdatedAt,
	}
	if out.Config == nil {
		out.Config = map[string]any{}
	}
	if out.FieldMapping == nil {
		out.FieldMapping = map[string]string{}
	}
	if out.Secrets == nil {
		out.Secrets = []IntegrationSecretSummary{}
	}
	return out
}

func integrationSecretSummaries(secrets []IntegrationConnectorSecret) []IntegrationSecretSummary {
	out := make([]IntegrationSecretSummary, 0, len(secrets))
	for _, secret := range secrets {
		storage := "encrypted"
		if strings.TrimSpace(secret.SecretRef) != "" {
			storage = "secret_ref"
		}
		out = append(out, IntegrationSecretSummary{
			Name:       secret.Name,
			Storage:    storage,
			Configured: true,
			KeyID:      secret.KeyID,
			CreatedAt:  secret.CreatedAt,
			UpdatedAt:  secret.UpdatedAt,
		})
	}
	return out
}

func copyIntegrationConfig(in map[string]any) map[string]any {
	if in == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(in))
	for k, v := range in {
		if nested, ok := v.(map[string]any); ok {
			out[k] = copyIntegrationConfig(nested)
			continue
		}
		out[k] = v
	}
	return out
}

func copyIntegrationFieldMapping(in map[string]string) map[string]string {
	if in == nil {
		return map[string]string{}
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		out[strings.TrimSpace(k)] = strings.TrimSpace(v)
	}
	return out
}
