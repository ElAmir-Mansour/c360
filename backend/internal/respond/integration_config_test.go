package respond

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestCreateIntegrationConnectorRequiresCipherForPlaintextSecret(t *testing.T) {
	svc := NewRespondIntegrationServiceWithDeps(nil, NewStore(), nil, zerolog.Nop())
	enabled := true
	_, err := svc.CreateIntegrationConnector(context.Background(), uuid.New(), Actor{
		UserID:            uuid.New(),
		GlobalPermissions: []string{PermRespondAdmin},
	}, CreateIntegrationConnectorInput{
		Kind:        IntegrationKindITSM,
		Provider:    IntegrationProviderServiceNow,
		Name:        "ServiceNow",
		Enabled:     &enabled,
		EndpointURL: "https://acme.service-now.test",
		Config: map[string]any{
			"auth_type": "basic",
			"username":  "respond-bot",
		},
		Secrets: []IntegrationSecretInput{{Name: serviceNowPasswordSecret, Plaintext: "secret-pass"}},
	})
	if !errors.Is(err, ErrIntegrationSecretUnavailable) {
		t.Fatalf("CreateIntegrationConnector() error = %v, want ErrIntegrationSecretUnavailable", err)
	}
}

func TestIntegrationConnectorResponseRedactsSecrets(t *testing.T) {
	now := time.Now().UTC()
	response := integrationConnectorResponse(&IntegrationConnector{
		ID:              uuid.New(),
		TenantID:        uuid.New(),
		Kind:            IntegrationKindITSM,
		Provider:        IntegrationProviderServiceNow,
		Name:            "ServiceNow",
		Enabled:         true,
		EndpointURL:     "https://acme.service-now.test",
		NonSecretConfig: map[string]any{"username": "respond-bot"},
		FieldMapping:    map[string]string{"short_description": "u_short_description"},
		WebhookAuthType: IntegrationWebhookAuthHMACSHA256,
		CreatedAt:       now,
		UpdatedAt:       now,
	}, []IntegrationConnectorSecret{{
		Name:      serviceNowPasswordSecret,
		SecretRef: "env:SN_PASSWORD",
		KeyID:     "local-aes256gcm",
		CreatedAt: now,
		UpdatedAt: now,
	}})
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal response: %v", err)
	}
	body := string(raw)
	for _, forbidden := range []string{"SN_PASSWORD", "secret-pass", "encrypted_value", "encrypted_nonce"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("response leaked %q: %s", forbidden, body)
		}
	}
	if len(response.Secrets) != 1 || response.Secrets[0].Storage != "secret_ref" || !response.Secrets[0].Configured {
		t.Fatalf("secret summary = %+v", response.Secrets)
	}
}

func TestIntegrationConnectorConfigRejectsSecretFields(t *testing.T) {
	err := validateIntegrationConnectorConfig(&IntegrationConnector{
		Kind:            IntegrationKindComms,
		Provider:        IntegrationProviderSlack,
		Name:            "Slack",
		Enabled:         true,
		NonSecretConfig: map[string]any{"bot_token": "xoxb-token"},
	}, []IntegrationSecretInput{{Name: slackBotTokenSecret, SecretRef: "env:SLACK_BOT_TOKEN"}})
	if !errors.Is(err, ErrIntegrationConfig) {
		t.Fatalf("validateIntegrationConnectorConfig() error = %v, want ErrIntegrationConfig", err)
	}
}

func TestEnvironmentIntegrationSecretRefResolver(t *testing.T) {
	t.Setenv("RESPOND_SN_PASSWORD", "secret-pass")
	value, err := (EnvironmentIntegrationSecretRefResolver{}).ResolveIntegrationSecret(context.Background(), "env:RESPOND_SN_PASSWORD")
	if err != nil {
		t.Fatalf("ResolveIntegrationSecret() error = %v", err)
	}
	if value != "secret-pass" {
		t.Fatalf("value = %q", value)
	}
	if _, err := (EnvironmentIntegrationSecretRefResolver{}).ResolveIntegrationSecret(context.Background(), "vault://respond/servicenow#password"); !errors.Is(err, ErrIntegrationSecretUnavailable) {
		t.Fatalf("unsupported ref error = %v, want ErrIntegrationSecretUnavailable", err)
	}
	if _, exists := os.LookupEnv("RESPOND_SN_PASSWORD"); !exists {
		t.Fatalf("test env was not set")
	}
}
