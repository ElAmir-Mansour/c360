//go:build integration

package respond

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestIntegrationConnectorConfigSyncAndWebhook(t *testing.T) {
	ctx, pool := startRespondPostgres(t)
	tenantID := uuid.New()
	userID := uuid.New()
	actor := Actor{UserID: userID, GlobalPermissions: []string{
		PermRespondAdmin, PermRespondDeclare, PermRespondRead, PermRespondUpdate,
	}}

	incidentSvc := NewService(pool, zerolog.Nop())
	incident, err := incidentSvc.DeclareIncident(ctx, tenantID, DeclareIncidentInput{
		Title:            "Card payments unavailable",
		Description:      "Checkout authorization is failing.",
		Severity:         SeveritySEV1,
		ImpactedServices: []string{"payments-api"},
		Actor:            actor,
	})
	if err != nil {
		t.Fatalf("DeclareIncident() error = %v", err)
	}

	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.URL.Path != "/api/now/table/incident" {
			t.Fatalf("path = %s", r.URL.Path)
		}
		username, password, ok := r.BasicAuth()
		if !ok || username != "respond-bot" || password != "secret-pass" {
			t.Fatalf("basic auth = %q/%q/%v", username, password, ok)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"result":{"sys_id":"abc123","number":"INC001234","state":"2","priority":"1"}}`))
	}))
	defer server.Close()

	cipher, err := NewConfigIntegrationSecretCipher(strings.Repeat("k", 32), "test-key")
	if err != nil {
		t.Fatalf("NewConfigIntegrationSecretCipher() error = %v", err)
	}
	integrationSvc := NewRespondIntegrationService(pool, zerolog.Nop(), WithRespondIntegrationSecretCipher(cipher))
	connector, err := integrationSvc.CreateIntegrationConnector(ctx, tenantID, actor, CreateIntegrationConnectorInput{
		Kind:              IntegrationKindITSM,
		Provider:          IntegrationProviderServiceNow,
		Name:              "ServiceNow Production",
		EndpointURL:       server.URL,
		WebhookAuthType:   IntegrationWebhookAuthHMACSHA256,
		WebhookSecretName: serviceNowWebhookSecret,
		Config: map[string]any{
			"auth_type":                "basic",
			"username":                 "respond-bot",
			"webhook_signature_header": "X-Clario-Signature",
			"webhook_timestamp_header": "X-Clario-Timestamp",
		},
		FieldMapping: map[string]string{"short_description": "u_short_description"},
		Secrets: []IntegrationSecretInput{
			{Name: serviceNowPasswordSecret, Plaintext: "secret-pass"},
			{Name: serviceNowWebhookSecret, Plaintext: "webhook-secret"},
		},
	})
	if err != nil {
		t.Fatalf("CreateIntegrationConnector() error = %v", err)
	}
	if len(connector.Secrets) != 2 {
		t.Fatalf("secret summaries = %+v", connector.Secrets)
	}
	rawConnector, _ := json.Marshal(connector)
	if strings.Contains(string(rawConnector), "secret-pass") || strings.Contains(string(rawConnector), "webhook-secret") {
		t.Fatalf("connector response leaked secret material: %s", string(rawConnector))
	}

	listed, err := integrationSvc.ListIntegrationConnectors(ctx, tenantID, actor, nil, nil)
	if err != nil {
		t.Fatalf("ListIntegrationConnectors() error = %v", err)
	}
	if len(listed) != 1 || listed[0].ID != connector.ID || len(listed[0].Secrets) != 0 {
		t.Fatalf("listed connectors = %+v", listed)
	}

	detail, err := integrationSvc.GetIntegrationConnector(ctx, tenantID, connector.ID, actor)
	if err != nil {
		t.Fatalf("GetIntegrationConnector() error = %v", err)
	}
	if len(detail.Secrets) != 2 || detail.Secrets[0].Storage != "encrypted" {
		t.Fatalf("detail secret summaries = %+v", detail.Secrets)
	}

	link, err := integrationSvc.SyncIncidentToITSM(ctx, tenantID, connector.ID, incident.ID, "auto")
	if err != nil {
		t.Fatalf("SyncIncidentToITSM() error = %v", err)
	}
	if link.ExternalID != "abc123" || link.ExternalKey != "INC001234" {
		t.Fatalf("link = %+v", link)
	}
	if got := captured["u_short_description"]; got != "[INC-2026-0001] Card payments unavailable" {
		t.Fatalf("short description = %v", got)
	}

	body := []byte(`{"event_id":"evt-resolved","result":{"sys_id":"abc123","number":"INC001234","state":"6","priority":"2","short_description":"Restored","description":"Payments restored","sys_updated_on":"2026-06-29 12:00:00"}}`)
	timestamp := time.Now().UTC().Format(time.RFC3339)
	headers := http.Header{}
	headers.Set("X-Clario-Timestamp", timestamp)
	headers.Set("X-Clario-Signature", serviceNowWebhookSignature("webhook-secret", timestamp, body))
	result, err := integrationSvc.IngestITSMWebhook(ctx, tenantID, connector.ID, headers, body)
	if err != nil {
		t.Fatalf("IngestITSMWebhook() error = %v", err)
	}
	if result.ExternalEventID != "evt-resolved" || result.IncidentID != incident.ID {
		t.Fatalf("webhook result = %+v", result)
	}
	updated, err := incidentSvc.GetIncident(ctx, tenantID, incident.ID, actor)
	if err != nil {
		t.Fatalf("GetIncident() error = %v", err)
	}
	if updated.Status != StatusResolved {
		t.Fatalf("incident status = %s, want %s", updated.Status, StatusResolved)
	}
}
