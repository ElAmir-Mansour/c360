package respond

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

func TestIntegrationRouterCreateConnectorRedactsSecretInput(t *testing.T) {
	tenantID := uuid.New()
	userID := uuid.New()
	connectorID := uuid.New()
	now := time.Now().UTC()
	recorderSvc := &recordingIntegrationService{
		createResponse: &IntegrationConnectorResponse{
			ID:          connectorID,
			TenantID:    tenantID,
			Kind:        IntegrationKindITSM,
			Provider:    IntegrationProviderServiceNow,
			Name:        "ServiceNow Production",
			Enabled:     true,
			EndpointURL: "https://acme.service-now.test",
			Config:      map[string]any{"username": "respond-bot"},
			FieldMapping: map[string]string{
				"short_description": "u_short_description",
			},
			WebhookAuthType: IntegrationWebhookAuthHMACSHA256,
			Secrets: []IntegrationSecretSummary{{
				Name:       serviceNowPasswordSecret,
				Storage:    "encrypted",
				Configured: true,
				KeyID:      "local-aes256gcm",
				CreatedAt:  now,
				UpdatedAt:  now,
			}},
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
	router := (&IntegrationRouter{svc: recorderSvc, logger: zerolog.Nop()}).Routes()
	body := []byte(`{
		"kind":"itsm",
		"provider":"servicenow",
		"name":"ServiceNow Production",
		"enabled":true,
		"endpoint_url":"https://acme.service-now.test",
		"config":{"auth_type":"basic","username":"respond-bot"},
		"field_mapping":{"short_description":"u_short_description"},
		"secrets":[{"name":"password","plaintext":"secret-pass"}]
	}`)
	req := httptest.NewRequest(http.MethodPost, "/integrations/connectors", bytes.NewReader(body))
	req = req.WithContext(auth.WithTenantID(req.Context(), tenantID.String()))
	req = req.WithContext(auth.WithUser(req.Context(), &auth.ContextUser{ID: userID.String(), TenantID: tenantID.String(), Roles: []string{"super_admin"}}))
	res := httptest.NewRecorder()

	router.ServeHTTP(res, req)

	if res.Code != http.StatusCreated {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	if recorderSvc.created.Secrets[0].Plaintext != "secret-pass" {
		t.Fatalf("plaintext was not passed to service for encryption")
	}
	responseBody := res.Body.String()
	for _, forbidden := range []string{"secret-pass", "plaintext", "secret_ref", "env:"} {
		if strings.Contains(responseBody, forbidden) {
			t.Fatalf("response leaked %q: %s", forbidden, responseBody)
		}
	}
}

type recordingIntegrationService struct {
	created        CreateIntegrationConnectorInput
	createResponse *IntegrationConnectorResponse
}

func (s *recordingIntegrationService) CreateIntegrationConnector(_ context.Context, _ uuid.UUID, _ Actor, in CreateIntegrationConnectorInput) (*IntegrationConnectorResponse, error) {
	s.created = in
	return s.createResponse, nil
}

func (s *recordingIntegrationService) ListIntegrationConnectors(context.Context, uuid.UUID, Actor, *IntegrationKind, *IntegrationProvider) ([]IntegrationConnectorResponse, error) {
	return nil, nil
}

func (s *recordingIntegrationService) GetIntegrationConnector(context.Context, uuid.UUID, uuid.UUID, Actor) (*IntegrationConnectorResponse, error) {
	return nil, ErrIntegrationConnectorNotFound
}

func (s *recordingIntegrationService) SyncIncidentToITSM(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (*IntegrationExternalLink, error) {
	return nil, ErrIntegrationConnectorNotFound
}

func (s *recordingIntegrationService) CreateCommsChannel(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (*CommsChannel, error) {
	return nil, ErrIntegrationConnectorNotFound
}

func (s *recordingIntegrationService) PostCommsMessage(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, CommsMessage) (*CommsMessageReceipt, error) {
	return nil, ErrIntegrationConnectorNotFound
}

func (s *recordingIntegrationService) IngestITSMWebhook(context.Context, uuid.UUID, uuid.UUID, http.Header, []byte) (*InboundWebhookResult, error) {
	return nil, ErrIntegrationConnectorNotFound
}
