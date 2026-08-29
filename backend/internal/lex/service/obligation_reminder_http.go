package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/google/uuid"
)

type HTTPObligationReminderNotificationDispatcherConfig struct {
	Endpoint string
	APIKey   string
	Timeout  time.Duration
	Client   *http.Client
}

type HTTPObligationReminderNotificationDispatcher struct {
	endpoint string
	apiKey   string
	client   *http.Client
}

func NewHTTPObligationReminderNotificationDispatcher(cfg HTTPObligationReminderNotificationDispatcherConfig) (*HTTPObligationReminderNotificationDispatcher, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		return nil, validationError("obligation reminder provider endpoint is required", map[string]string{"endpoint": "required"})
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return nil, validationError("obligation reminder provider API key is required", map[string]string{"api_key": "required"})
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copy := *client
		copy.Timeout = timeout
		client = &copy
	}
	return &HTTPObligationReminderNotificationDispatcher{
		endpoint: endpoint,
		apiKey:   apiKey,
		client:   client,
	}, nil
}

func (d *HTTPObligationReminderNotificationDispatcher) DispatchObligationReminder(ctx context.Context, tenantID uuid.UUID, item model.ObligationNotificationOutboxItem, provider string, now time.Time) (*ObligationReminderProviderDispatch, error) {
	provider = normalizeReminderDispatchProvider(provider)
	payload := httpObligationReminderDispatchRequest{
		TenantID:    tenantID.String(),
		Provider:    provider,
		RequestedAt: now.UTC(),
		OutboxItem:  httpObligationReminderOutboxItemFromModel(item),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, internalError("marshal obligation reminder provider dispatch", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, d.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, validationError("obligation reminder provider endpoint is invalid", map[string]string{"endpoint": "invalid"})
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+d.apiKey)
	httpReq.Header.Set("X-Clario360-Tenant-ID", tenantID.String())
	httpReq.Header.Set("X-Clario360-Obligation-Reminder-Provider", provider)

	resp, err := d.client.Do(httpReq)
	if err != nil {
		return nil, internalError("dispatch obligation reminder to HTTP provider", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, internalError("read obligation reminder provider response", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, internalError("obligation reminder provider rejected dispatch", fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody))))
	}
	var providerResp httpObligationReminderDispatchResponse
	if err := json.Unmarshal(respBody, &providerResp); err != nil {
		return nil, internalError("decode obligation reminder provider response", err)
	}

	dispatchProvider := strings.TrimSpace(providerResp.Provider)
	if dispatchProvider == "" {
		dispatchProvider = provider
	}
	dispatch := &ObligationReminderProviderDispatch{
		Status:            providerResp.Status,
		Provider:          dispatchProvider,
		ProviderStatus:    strings.TrimSpace(providerResp.ProviderStatus),
		DeliveryStatus:    strings.TrimSpace(providerResp.DeliveryStatus),
		ProviderMessageID: strings.TrimSpace(providerResp.ProviderMessageID),
		ProviderMetadata: mergeMetadata(providerResp.ProviderMetadata, map[string]any{
			"provider_adapter":       "http",
			"provider_endpoint":      d.endpoint,
			"provider_dispatched_at": now.UTC().Format(time.RFC3339Nano),
		}),
		ErrorMessage: strings.TrimSpace(providerResp.ErrorMessage),
	}
	return dispatch, nil
}

type httpObligationReminderDispatchRequest struct {
	TenantID    string                           `json:"tenant_id"`
	Provider    string                           `json:"provider"`
	RequestedAt time.Time                        `json:"requested_at"`
	OutboxItem  httpObligationReminderOutboxItem `json:"outbox_item"`
}

type httpObligationReminderOutboxItem struct {
	ID                string                                   `json:"id"`
	TenantID          string                                   `json:"tenant_id"`
	ObligationID      string                                   `json:"obligation_id"`
	EventID           string                                   `json:"event_id"`
	EventType         model.ObligationNotificationType         `json:"event_type"`
	LeadDays          int                                      `json:"lead_days"`
	Channel           model.ObligationNotificationChannel      `json:"channel"`
	RecipientUserID   *string                                  `json:"recipient_user_id,omitempty"`
	RecipientName     string                                   `json:"recipient_name"`
	RecipientContact  *string                                  `json:"recipient_contact,omitempty"`
	ScheduledAt       time.Time                                `json:"scheduled_at"`
	Status            model.ObligationNotificationOutboxStatus `json:"status"`
	Provider          string                                   `json:"provider"`
	ProviderMessageID *string                                  `json:"provider_message_id,omitempty"`
	ProviderMetadata  map[string]any                           `json:"provider_metadata,omitempty"`
	ErrorMessage      *string                                  `json:"error_message,omitempty"`
	AttemptCount      int                                      `json:"attempt_count"`
	LastAttemptAt     *time.Time                               `json:"last_attempt_at,omitempty"`
	SentAt            *time.Time                               `json:"sent_at,omitempty"`
	CreatedBy         string                                   `json:"created_by"`
	CreatedAt         time.Time                                `json:"created_at"`
	UpdatedAt         time.Time                                `json:"updated_at"`
}

func httpObligationReminderOutboxItemFromModel(item model.ObligationNotificationOutboxItem) httpObligationReminderOutboxItem {
	return httpObligationReminderOutboxItem{
		ID:                item.ID.String(),
		TenantID:          item.TenantID.String(),
		ObligationID:      item.ObligationID.String(),
		EventID:           item.EventID.String(),
		EventType:         item.EventType,
		LeadDays:          item.LeadDays,
		Channel:           item.Channel,
		RecipientUserID:   reminderUUIDPtrString(item.RecipientUserID),
		RecipientName:     item.RecipientName,
		RecipientContact:  item.RecipientContact,
		ScheduledAt:       item.ScheduledAt,
		Status:            item.Status,
		Provider:          item.Provider,
		ProviderMessageID: item.ProviderMessageID,
		ProviderMetadata:  item.ProviderMetadata,
		ErrorMessage:      item.ErrorMessage,
		AttemptCount:      item.AttemptCount,
		LastAttemptAt:     item.LastAttemptAt,
		SentAt:            item.SentAt,
		CreatedBy:         item.CreatedBy.String(),
		CreatedAt:         item.CreatedAt,
		UpdatedAt:         item.UpdatedAt,
	}
}

func reminderUUIDPtrString(id *uuid.UUID) *string {
	if id == nil {
		return nil
	}
	value := id.String()
	return &value
}

type httpObligationReminderDispatchResponse struct {
	Status            model.ObligationNotificationOutboxStatus `json:"status"`
	Provider          string                                   `json:"provider"`
	ProviderStatus    string                                   `json:"provider_status"`
	DeliveryStatus    string                                   `json:"delivery_status"`
	ProviderMessageID string                                   `json:"provider_message_id"`
	ProviderMetadata  map[string]any                           `json:"provider_metadata"`
	ErrorMessage      string                                   `json:"error_message"`
}
