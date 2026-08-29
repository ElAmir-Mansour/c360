package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

func TestHTTPObligationReminderNotificationDispatcherDispatchesAndMapsProof(t *testing.T) {
	now := time.Date(2026, 6, 14, 15, 30, 0, 0, time.UTC)
	tenantID := uuid.New()
	item := testHTTPReminderOutboxItem(tenantID, model.ObligationNotificationChannelEmail, model.ObligationNotificationOutboxPending)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if r.Header.Get("Authorization") != "Bearer reminder-secret" {
			t.Fatalf("authorization header = %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Clario360-Tenant-ID") != tenantID.String() {
			t.Fatalf("tenant header = %q, want %s", r.Header.Get("X-Clario360-Tenant-ID"), tenantID)
		}
		if r.Header.Get("X-Clario360-Obligation-Reminder-Provider") != "mailgun" {
			t.Fatalf("provider header = %q, want mailgun", r.Header.Get("X-Clario360-Obligation-Reminder-Provider"))
		}
		var req httpObligationReminderDispatchRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if req.TenantID != tenantID.String() || req.Provider != "mailgun" {
			t.Fatalf("request tenant/provider = %s/%s", req.TenantID, req.Provider)
		}
		if req.OutboxItem.ID != item.ID.String() || req.OutboxItem.Channel != model.ObligationNotificationChannelEmail {
			t.Fatalf("request outbox item = %#v", req.OutboxItem)
		}
		_ = json.NewEncoder(w).Encode(httpObligationReminderDispatchResponse{
			Status:            model.ObligationNotificationOutboxSent,
			ProviderStatus:    "queued",
			DeliveryStatus:    "accepted",
			ProviderMessageID: "mg-msg-123",
			ProviderMetadata: map[string]any{
				"provider_attempt_id": "mg-attempt-456",
			},
		})
	}))
	defer server.Close()

	dispatcher, err := NewHTTPObligationReminderNotificationDispatcher(HTTPObligationReminderNotificationDispatcherConfig{
		Endpoint: server.URL,
		APIKey:   "reminder-secret",
		Timeout:  time.Second,
	})
	if err != nil {
		t.Fatalf("NewHTTPObligationReminderNotificationDispatcher() error = %v", err)
	}

	dispatch, err := dispatcher.DispatchObligationReminder(context.Background(), tenantID, item, "mailgun", now)
	if err != nil {
		t.Fatalf("DispatchObligationReminder() error = %v", err)
	}
	if dispatch.Provider != "mailgun" || dispatch.ProviderMessageID != "mg-msg-123" {
		t.Fatalf("provider fields = %q %q, want mailgun mg-msg-123", dispatch.Provider, dispatch.ProviderMessageID)
	}
	if dispatch.ProviderStatus != "queued" || dispatch.DeliveryStatus != "accepted" {
		t.Fatalf("provider statuses = %q/%q, want queued/accepted", dispatch.ProviderStatus, dispatch.DeliveryStatus)
	}
	if dispatch.ProviderMetadata["provider_adapter"] != "http" || dispatch.ProviderMetadata["provider_attempt_id"] != "mg-attempt-456" {
		t.Fatalf("provider metadata = %#v", dispatch.ProviderMetadata)
	}
}

func TestHTTPObligationReminderNotificationDispatcherFailsOnProviderRejection(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "invalid adapter credential", http.StatusUnauthorized)
	}))
	defer server.Close()
	dispatcher, err := NewHTTPObligationReminderNotificationDispatcher(HTTPObligationReminderNotificationDispatcherConfig{
		Endpoint: server.URL,
		APIKey:   "reminder-secret",
		Timeout:  time.Second,
	})
	if err != nil {
		t.Fatalf("NewHTTPObligationReminderNotificationDispatcher() error = %v", err)
	}

	_, err = dispatcher.DispatchObligationReminder(context.Background(), uuid.New(), testHTTPReminderOutboxItem(uuid.New(), model.ObligationNotificationChannelEmail, model.ObligationNotificationOutboxPending), "mailgun", time.Now())
	if err == nil {
		t.Fatal("DispatchObligationReminder() error = nil, want provider rejection")
	}
}

func TestObligationServiceHTTPReminderDispatcherIncompleteSentProofFailsClosed(t *testing.T) {
	now := time.Date(2026, 6, 14, 16, 0, 0, 0, time.UTC)
	tenantID := uuid.New()
	item := testHTTPReminderOutboxItem(tenantID, model.ObligationNotificationChannelCalendar, model.ObligationNotificationOutboxPending)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(httpObligationReminderDispatchResponse{
			Status:         model.ObligationNotificationOutboxSent,
			ProviderStatus: "created",
			DeliveryStatus: "accepted",
			ProviderMetadata: map[string]any{
				"provider_attempt_id": "calendar-attempt-1",
			},
		})
	}))
	defer server.Close()
	dispatcher, err := NewHTTPObligationReminderNotificationDispatcher(HTTPObligationReminderNotificationDispatcherConfig{
		Endpoint: server.URL,
		APIKey:   "reminder-secret",
		Timeout:  time.Second,
	})
	if err != nil {
		t.Fatalf("NewHTTPObligationReminderNotificationDispatcher() error = %v", err)
	}
	service := NewObligationService(nil, nil, nil, nil, nil, nil, "", zerolog.Nop(), nil)
	service.SetReminderNotificationDispatcher(dispatcher)

	delivery := service.dispatchObligationReminder(context.Background(), tenantID, item, "calendar-adapter", now)
	if delivery.Status != model.ObligationNotificationOutboxFailed {
		t.Fatalf("status = %q, want failed", delivery.Status)
	}
	if delivery.ErrorMessage == nil || *delivery.ErrorMessage != "reminder notification provider message id is required" {
		t.Fatalf("error_message = %v, want missing message id error", delivery.ErrorMessage)
	}
	if delivery.ProviderMetadata["provider_adapter"] != "http" || delivery.ProviderMetadata["provider_status"] != "created" {
		t.Fatalf("provider metadata = %#v", delivery.ProviderMetadata)
	}
}

func testHTTPReminderOutboxItem(tenantID uuid.UUID, channel model.ObligationNotificationChannel, status model.ObligationNotificationOutboxStatus) model.ObligationNotificationOutboxItem {
	ownerID := uuid.New()
	contact := "owner@example.test"
	return model.ObligationNotificationOutboxItem{
		ID:               uuid.New(),
		TenantID:         tenantID,
		ObligationID:     uuid.New(),
		EventID:          uuid.New(),
		EventType:        model.ObligationNotificationReminder,
		LeadDays:         7,
		Channel:          channel,
		RecipientUserID:  &ownerID,
		RecipientName:    "Contract Owner",
		RecipientContact: &contact,
		ScheduledAt:      time.Date(2026, 6, 14, 9, 30, 0, 0, time.UTC),
		Status:           status,
		ProviderMetadata: map[string]any{},
		CreatedBy:        uuid.New(),
		CreatedAt:        time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC),
		UpdatedAt:        time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC),
	}
}
