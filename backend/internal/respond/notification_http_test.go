package respond

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
)

func TestHTTPNotificationSenderPostsInternalNotification(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.New()
	recipientID := uuid.New()
	incidentID := uuid.New()
	var got httpNotificationCreateRequest
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/internal/notifications" {
			t.Fatalf("request = %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("X-Service-Token") != "service-token" {
			t.Fatalf("X-Service-Token = %q", r.Header.Get("X-Service-Token"))
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"notification_id":"provider-123"}`))
	}))
	defer server.Close()

	sender, err := NewHTTPNotificationSender(HTTPNotificationSenderConfig{BaseURL: server.URL, Token: "service-token"})
	if err != nil {
		t.Fatalf("NewHTTPNotificationSender: %v", err)
	}
	receipt, err := sender.SendRespondNotification(ctx, RespondNotificationMessage{
		TenantID:        tenantID,
		IncidentID:      incidentID,
		RecipientUserID: recipientID,
		Channel:         NotificationChannelEmail,
		IdempotencyKey:  "mobilize-1",
		Title:           "Mobilize",
		Body:            "Join the bridge.",
		ActionURL:       "/respond/incidents/1",
		Payload:         map[string]any{"email": "responder@example.test"},
	})
	if err != nil {
		t.Fatalf("SendRespondNotification: %v", err)
	}
	if receipt.ProviderMessageID != "provider-123" || receipt.Provider != "notification-service-http" {
		t.Fatalf("receipt = %+v", receipt)
	}
	if got.TenantID != tenantID.String() || got.UserID != recipientID.String() || got.SourceEventID != "mobilize-1" {
		t.Fatalf("request identity fields = %+v", got)
	}
	if len(got.Channels) != 1 || got.Channels[0] != "email" {
		t.Fatalf("channels = %+v", got.Channels)
	}
	if got.Data["incident_id"] != incidentID.String() || got.Data["email"] != "responder@example.test" {
		t.Fatalf("data = %+v", got.Data)
	}
}

func TestHTTPNotificationSenderReturnsTypedDeliveryError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "downstream unavailable", http.StatusBadGateway)
	}))
	defer server.Close()

	sender, err := NewHTTPNotificationSender(HTTPNotificationSenderConfig{BaseURL: server.URL})
	if err != nil {
		t.Fatalf("NewHTTPNotificationSender: %v", err)
	}
	_, err = sender.SendRespondNotification(context.Background(), RespondNotificationMessage{
		TenantID:        uuid.New(),
		IncidentID:      uuid.New(),
		RecipientUserID: uuid.New(),
		Channel:         NotificationChannelInApp,
		IdempotencyKey:  "mobilize-2",
		Title:           "Mobilize",
		Body:            "Join the bridge.",
	})
	if !errors.Is(err, ErrNotificationHTTPDelivery) {
		t.Fatalf("error = %v, want ErrNotificationHTTPDelivery", err)
	}
}
