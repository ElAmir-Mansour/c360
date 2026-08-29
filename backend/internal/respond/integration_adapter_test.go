package respond

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func responseJSON(status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Header:     http.Header{"Content-Type": []string{"application/json"}},
		Body:       io.NopCloser(strings.NewReader(body)),
	}
}

func TestServiceNowCreateRequestShapeAndFieldMapping(t *testing.T) {
	incidentID := uuid.New()
	var captured map[string]any
	client := newServiceNowClientWithTransport(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if got := r.URL.String(); got != "https://acme.service-now.test/api/now/table/incident" {
			t.Fatalf("url = %s", got)
		}
		wantAuth := "Basic " + base64.StdEncoding.EncodeToString([]byte("respond-bot:secret-pass"))
		if got := r.Header.Get("Authorization"); got != wantAuth {
			t.Fatalf("Authorization = %q, want %q", got, wantAuth)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return responseJSON(http.StatusCreated, `{"result":{"sys_id":"abc123","number":"INC001234","state":"1","priority":"1"}}`), nil
	}))
	adapter := NewServiceNowAdapter(client)
	cfg := ResolvedConnectorConfig{
		Connector: &IntegrationConnector{
			EndpointURL: "https://acme.service-now.test",
			NonSecretConfig: map[string]any{
				"auth_type":        "basic",
				"username":         "respond-bot",
				"assignment_group": "Major Incident",
				"category":         "software",
				"custom_fields": map[string]any{
					"u_business_service": "payments",
				},
			},
			FieldMapping: map[string]string{
				"short_description": "u_short_summary",
			},
		},
		Secrets: map[string]string{serviceNowPasswordSecret: "secret-pass"},
	}
	incident := &Incident{
		ID:               incidentID,
		Reference:        "INC-2026-0001",
		Title:            "Card payments unavailable",
		Description:      "Checkout authorization is failing.",
		Severity:         SeveritySEV1,
		Status:           StatusInvestigating,
		ImpactedServices: []string{"payments-api", "checkout"},
	}

	link, result, err := adapter.CreateTicket(context.Background(), cfg, incident)
	if err != nil {
		t.Fatalf("CreateTicket() error = %v", err)
	}
	if link.ExternalID != "abc123" || link.ExternalKey != "INC001234" {
		t.Fatalf("link = %+v", link)
	}
	if result.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d", result.StatusCode)
	}
	if got := captured["u_short_summary"]; got != "[INC-2026-0001] Card payments unavailable" {
		t.Fatalf("mapped short description = %v", got)
	}
	if got := captured["urgency"]; got != float64(1) && got != 1 {
		t.Fatalf("urgency = %v, want 1", got)
	}
	if got := captured["impact"]; got != float64(1) && got != 1 {
		t.Fatalf("impact = %v, want 1", got)
	}
	if got := captured["state"]; got != "2" {
		t.Fatalf("state = %v, want 2", got)
	}
	if got := captured["u_clario_incident_id"]; got != incidentID.String() {
		t.Fatalf("clario id = %v, want %s", got, incidentID)
	}
	if got := captured["u_business_service"]; got != "payments" {
		t.Fatalf("custom field = %v", got)
	}
}

func TestServiceNowWebhookSignatureValidationAndMapping(t *testing.T) {
	body := []byte(`{"event_id":"evt-42","result":{"sys_id":"abc123","number":"INC001234","state":"6","priority":"2","short_description":"Restored","description":"Service restored","sys_updated_on":"2026-06-28 10:11:12"}}`)
	timestamp := time.Now().UTC().Format(time.RFC3339)
	cfg := ServiceNowRuntimeConfig{
		InstanceURL:            "https://acme.service-now.test",
		WebhookSecret:          "signing-secret",
		WebhookAuthType:        IntegrationWebhookAuthHMACSHA256,
		WebhookSignatureHeader: "X-ServiceNow-Signature",
		WebhookTimestampHeader: "X-ServiceNow-Timestamp",
	}
	headers := http.Header{}
	headers.Set("X-ServiceNow-Timestamp", timestamp)
	headers.Set("X-ServiceNow-Signature", "sha256="+serviceNowWebhookSignature(cfg.WebhookSecret, timestamp, body))
	adapter := NewServiceNowAdapter(nil)
	event, err := adapter.ParseWebhook(context.Background(), ResolvedConnectorConfig{
		Connector: &IntegrationConnector{
			EndpointURL:       cfg.InstanceURL,
			NonSecretConfig:   map[string]any{"webhook_signature_header": "X-ServiceNow-Signature", "webhook_timestamp_header": "X-ServiceNow-Timestamp"},
			WebhookAuthType:   IntegrationWebhookAuthHMACSHA256,
			WebhookSecretName: serviceNowWebhookSecret,
		},
		Secrets: map[string]string{serviceNowWebhookSecret: cfg.WebhookSecret},
	}, headers, body)
	if err != nil {
		t.Fatalf("ParseWebhook() error = %v", err)
	}
	if event.EventID != "evt-42" || event.ExternalID != "abc123" || event.ExternalKey != "INC001234" {
		t.Fatalf("event identifiers = %+v", event)
	}
	if event.Update.Status == nil || *event.Update.Status != StatusResolved {
		t.Fatalf("mapped status = %v, want Resolved", event.Update.Status)
	}
	if event.Update.Severity == nil || *event.Update.Severity != SeveritySEV2 {
		t.Fatalf("mapped severity = %v, want SEV2", event.Update.Severity)
	}

	badHeaders := headers.Clone()
	badHeaders.Set("X-ServiceNow-Signature", "sha256=bad")
	if _, err := adapter.ParseWebhook(context.Background(), ResolvedConnectorConfig{
		Connector: &IntegrationConnector{
			EndpointURL:       cfg.InstanceURL,
			NonSecretConfig:   map[string]any{"webhook_signature_header": "X-ServiceNow-Signature", "webhook_timestamp_header": "X-ServiceNow-Timestamp"},
			WebhookAuthType:   IntegrationWebhookAuthHMACSHA256,
			WebhookSecretName: serviceNowWebhookSecret,
		},
		Secrets: map[string]string{serviceNowWebhookSecret: cfg.WebhookSecret},
	}, badHeaders, body); !errors.Is(err, ErrIntegrationWebhookAuth) {
		t.Fatalf("bad signature error = %v, want ErrIntegrationWebhookAuth", err)
	}
}

func TestServiceNowRetryClassification(t *testing.T) {
	client := newServiceNowClientWithTransport(roundTripFunc(func(*http.Request) (*http.Response, error) {
		return responseJSON(http.StatusServiceUnavailable, `{"error":{"message":"maintenance"}}`), nil
	}))
	adapter := NewServiceNowAdapter(client)
	incident := &Incident{ID: uuid.New(), Reference: "INC-2026-0002", Title: "API degraded", Severity: SeveritySEV2, Status: StatusMitigating}
	_, result, err := adapter.UpdateTicket(context.Background(), ResolvedConnectorConfig{
		Connector: &IntegrationConnector{EndpointURL: "https://acme.service-now.test", NonSecretConfig: map[string]any{"username": "bot"}},
		Secrets:   map[string]string{serviceNowPasswordSecret: "pass"},
	}, &IntegrationExternalLink{ExternalID: "abc123", ExternalKey: "INC001234"}, incident)
	if err == nil {
		t.Fatalf("UpdateTicket() error = nil")
	}
	var httpErr *IntegrationHTTPError
	if !errors.As(err, &httpErr) || !httpErr.Retryable {
		t.Fatalf("error = %v, want retryable IntegrationHTTPError", err)
	}
	if result.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d", result.StatusCode)
	}
	if auditStatusForError(err) != IntegrationAuditRetryScheduled {
		t.Fatalf("audit status = %s", auditStatusForError(err))
	}
	if retryTimeForError(func() time.Time { return time.Date(2026, 6, 28, 12, 0, 0, 0, time.UTC) }, err) == nil {
		t.Fatalf("retry time was nil")
	}
}

func TestSlackPostMessageRequestShape(t *testing.T) {
	var captured map[string]any
	client := newSlackClientWithTransport(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if !strings.HasSuffix(r.URL.Path, "/chat.postMessage") {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer xoxb-token" {
			t.Fatalf("Authorization = %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return responseJSON(http.StatusOK, `{"ok":true,"channel":"C123","ts":"1719510000.000100"}`), nil
	}))

	receipt, result, err := client.PostMessage(context.Background(), SlackRuntimeConfig{
		BotToken:         "xoxb-token",
		DefaultChannelID: "C123",
	}, CommsMessage{Text: "SEV1 update", Blocks: slackTextBlocks("SEV1 update")})
	if err != nil {
		t.Fatalf("PostMessage() error = %v", err)
	}
	if receipt.ChannelID != "C123" || receipt.MessageTS != "1719510000.000100" {
		t.Fatalf("receipt = %+v", receipt)
	}
	if result.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", result.StatusCode)
	}
	if captured["channel"] != "C123" || captured["text"] != "SEV1 update" {
		t.Fatalf("payload = %+v", captured)
	}
	if captured["unfurl_links"] != false {
		t.Fatalf("unfurl_links = %v", captured["unfurl_links"])
	}
	if _, ok := captured["blocks"].([]any); !ok {
		t.Fatalf("blocks missing from payload: %+v", captured)
	}
}

func TestSlackCreateChannelRequestShape(t *testing.T) {
	var captured map[string]any
	client := newSlackClientWithTransport(roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !strings.HasSuffix(r.URL.Path, "/conversations.create") {
			t.Fatalf("path = %s", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		return responseJSON(http.StatusOK, `{"ok":true,"channel":{"id":"C999","name":"inc-2026-0001"}}`), nil
	}))
	channel, _, err := client.CreateChannel(context.Background(), SlackRuntimeConfig{BotToken: "xoxb-token"}, "INC 2026 0001", true)
	if err != nil {
		t.Fatalf("CreateChannel() error = %v", err)
	}
	if channel.ID != "C999" || channel.Name != "inc-2026-0001" {
		t.Fatalf("channel = %+v", channel)
	}
	if captured["name"] != "inc-2026-0001" || captured["is_private"] != true {
		t.Fatalf("payload = %+v", captured)
	}
}

func TestIntegrationWebhookDedupeRecordsDuplicate(t *testing.T) {
	ctx := context.Background()
	now := time.Now().UTC()
	tenantID := uuid.New()
	connectorID := uuid.New()
	incidentID := uuid.New()
	linkID := uuid.New()
	actorID := uuid.New()
	secretID := uuid.New()
	auditID := uuid.New()
	body := []byte(`{"event_id":"evt-duplicate","result":{"sys_id":"abc123","number":"INC001234","state":"2"}}`)
	timestamp := now.Format(time.RFC3339)
	headers := http.Header{}
	headers.Set("X-Clario-Timestamp", timestamp)
	headers.Set("X-Clario-Signature", serviceNowWebhookSignature("signing-secret", timestamp, body))

	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	defer mock.Close()
	mock.ExpectQuery("FROM respond_integration_connector").
		WithArgs(tenantID, connectorID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "kind", "provider", "name", "enabled", "endpoint_url",
			"non_secret_config", "field_mapping", "webhook_auth_type", "webhook_secret_name",
			"created_by", "row_version", "created_at", "updated_at", "deleted_at",
		}).AddRow(
			connectorID, tenantID, "itsm", "servicenow", "ServiceNow", true, "https://acme.service-now.test",
			[]byte(`{}`), []byte(`{}`), "hmac_sha256", serviceNowWebhookSecret,
			actorID, 1, now, now, nil,
		))
	mock.ExpectQuery("FROM respond_integration_connector_secret").
		WithArgs(tenantID, connectorID).
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "connector_id", "secret_name", "secret_ref", "encrypted_value", "encrypted_nonce", "key_id", "created_at", "updated_at",
		}).AddRow(secretID, tenantID, connectorID, serviceNowWebhookSecret, "vault://respond/servicenow#webhook", nil, nil, "", now, now))
	mock.ExpectQuery("INSERT INTO respond_integration_webhook_dedupe").
		WithArgs(tenantID, connectorID, IntegrationProviderServiceNow, "evt-duplicate", "abc123", pgxmock.AnyArg(), IntegrationAuditPending, pgxmock.AnyArg()).
		WillReturnError(pgx.ErrNoRows)
	mock.ExpectQuery("FROM respond_incident_integration_link").
		WithArgs(tenantID, connectorID, "abc123").
		WillReturnRows(pgxmock.NewRows([]string{
			"id", "tenant_id", "incident_id", "connector_id", "provider", "external_id", "external_key",
			"external_url", "external_status", "external_priority", "sync_direction", "last_synced_at",
			"last_sync_direction", "sync_error", "created_at", "updated_at",
		}).AddRow(
			linkID, tenantID, incidentID, connectorID, "servicenow", "abc123", "INC001234",
			"https://acme.service-now.test/incident.do?sys_id=abc123", "2", "2", "bidirectional",
			nil, "inbound", "", now, now,
		))
	mock.ExpectQuery("INSERT INTO respond_integration_sync_audit").
		WithArgs(
			tenantID,
			connectorID,
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
			IntegrationProviderServiceNow,
			IntegrationSyncInbound,
			"ingest_webhook",
			IntegrationAuditDuplicate,
			pgxmock.AnyArg(),
			0,
			"",
			"evt-duplicate",
			"abc123",
			pgxmock.AnyArg(),
			1,
			pgxmock.AnyArg(),
			"",
			pgxmock.AnyArg(),
			pgxmock.AnyArg(),
		).
		WillReturnRows(pgxmock.NewRows([]string{"id", "created_at"}).AddRow(auditID, now))

	svc := NewRespondIntegrationServiceWithDeps(mockTenantRunner{db: mock}, NewStore(), nil, zerolog.Nop(),
		WithRespondIntegrationSecretRefResolver(IntegrationSecretRefResolverFunc(func(context.Context, string) (string, error) {
			return "signing-secret", nil
		})),
	)
	got, err := svc.IngestITSMWebhook(ctx, tenantID, connectorID, headers, body)
	if !errors.Is(err, ErrIntegrationDuplicateWebhook) {
		t.Fatalf("IngestITSMWebhook() error = %v, want duplicate", err)
	}
	if got == nil || !got.Duplicate || got.ExternalEventID != "evt-duplicate" || got.ExternalID != "abc123" || got.IncidentID != incidentID || got.LinkID != linkID {
		t.Fatalf("result = %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet expectations: %v", err)
	}
}

type mockTenantRunner struct {
	db DBTX
}

func (r mockTenantRunner) RunWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(r.db)
}

func (r mockTenantRunner) RunReadWithTenant(_ context.Context, _ uuid.UUID, fn func(DBTX) error) error {
	return fn(r.db)
}

func (r mockTenantRunner) RunSystemRead(_ context.Context, fn func(DBTX) error) error {
	return fn(r.db)
}
