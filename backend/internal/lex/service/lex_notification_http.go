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

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// CAP-157 — live email dispatch.
//
// HTTPLexEmailDispatcher is the production adapter for the LexNotificationService
// email fan-out seam (LexEmailDispatcher). It POSTs the inbox row to a configured
// notification-service endpoint, deliberately mirroring
// HTTPObligationReminderNotificationDispatcher / HTTPSLANotificationDispatcher so
// email is ONE provider contract across the suite rather than a bespoke channel
// layer. The DeterministicLexEmailDispatcher (in lex_notification_service.go)
// stays the default; this adapter is wired only when
// LEX_LEX_NOTIFICATION_PROVIDER_MODE=http.
//
// Delivery is best-effort from the caller's perspective: Notify() already
// committed the durable in-app row before invoking the dispatcher and logs (does
// not fail) on a dispatch error, so a transient provider outage never loses the
// in-app notification.

const defaultLexEmailDispatchProvider = "notification-service"

// HTTPLexEmailDispatcherConfig configures the production HTTP email dispatcher.
// It mirrors HTTPObligationReminderNotificationDispatcherConfig field-for-field.
type HTTPLexEmailDispatcherConfig struct {
	Endpoint string
	APIKey   string
	Timeout  time.Duration
	Client   *http.Client
	// Provider is the logical provider label stamped into the request and the
	// returned proof metadata; defaults to "notification-service".
	Provider string
}

// HTTPLexEmailDispatcher implements LexEmailDispatcher against an external
// notification-service HTTP endpoint.
type HTTPLexEmailDispatcher struct {
	endpoint string
	apiKey   string
	provider string
	client   *http.Client
}

// NewHTTPLexEmailDispatcher constructs the HTTP email dispatcher. Endpoint and
// APIKey are required (mirrors the obligation/SLA dispatchers); a zero timeout
// defaults to 10s.
func NewHTTPLexEmailDispatcher(cfg HTTPLexEmailDispatcherConfig) (*HTTPLexEmailDispatcher, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		return nil, validationError("lex notification provider endpoint is required", map[string]string{"endpoint": "required"})
	}
	apiKey := strings.TrimSpace(cfg.APIKey)
	if apiKey == "" {
		return nil, validationError("lex notification provider API key is required", map[string]string{"api_key": "required"})
	}
	provider := strings.TrimSpace(cfg.Provider)
	if provider == "" {
		provider = defaultLexEmailDispatchProvider
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		dup := *client
		dup.Timeout = timeout
		client = &dup
	}
	return &HTTPLexEmailDispatcher{
		endpoint: endpoint,
		apiKey:   apiKey,
		provider: provider,
		client:   client,
	}, nil
}

// DispatchNotificationEmail POSTs the inbox row to the configured endpoint and
// returns a normalized delivery proof (merged with the provider's own response
// metadata). The proof shape is compatible with the deterministic default so
// callers/tests see a stable record either way.
func (d *HTTPLexEmailDispatcher) DispatchNotificationEmail(ctx context.Context, tenantID uuid.UUID, item model.NotificationInboxItem, recipientID uuid.UUID, recipientEmail string, now time.Time) (map[string]any, error) {
	payload := httpLexEmailDispatchRequest{
		TenantID:       tenantID.String(),
		RecipientID:    recipientID.String(),
		RecipientEmail: strings.TrimSpace(recipientEmail),
		Provider:       d.provider,
		Channel:        string(model.NotificationChannelEmail),
		RequestedAt:    now.UTC(),
		Subject:        item.Title.Localize("en"),
		SubjectAR:      item.Title.Localize("ar"),
		Body:           item.Body.Localize("en"),
		BodyAR:         item.Body.Localize("ar"),
		InboxItem:      httpLexEmailInboxItemFromModel(item),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, internalError("marshal lex notification email dispatch", err)
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, d.endpoint, bytes.NewReader(body))
	if err != nil {
		return nil, validationError("lex notification provider endpoint is invalid", map[string]string{"endpoint": "invalid"})
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+d.apiKey)
	httpReq.Header.Set("X-Clario360-Tenant-ID", tenantID.String())
	httpReq.Header.Set("X-Clario360-Lex-Notification-Provider", d.provider)

	resp, err := d.client.Do(httpReq)
	if err != nil {
		return nil, internalError("dispatch lex notification email to HTTP provider", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, internalError("read lex notification provider response", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, internalError("lex notification provider rejected dispatch", fmt.Errorf("status %d: %s", resp.StatusCode, strings.TrimSpace(string(respBody))))
	}

	var providerResp httpLexEmailDispatchResponse
	// A 2xx with an empty/unparseable body is still a success: synthesise a proof.
	if len(bytes.TrimSpace(respBody)) > 0 {
		if err := json.Unmarshal(respBody, &providerResp); err != nil {
			return nil, internalError("decode lex notification provider response", err)
		}
	}

	dispatchProvider := strings.TrimSpace(providerResp.Provider)
	if dispatchProvider == "" {
		dispatchProvider = d.provider
	}
	deliveryStatus := strings.TrimSpace(providerResp.DeliveryStatus)
	if deliveryStatus == "" {
		deliveryStatus = "queued"
	}

	proof := mergeMetadata(providerResp.ProviderMetadata, map[string]any{
		"provider_adapter":       "http",
		"provider":               dispatchProvider,
		"provider_endpoint":      d.endpoint,
		"provider_status":        strings.TrimSpace(providerResp.ProviderStatus),
		"provider_message_id":    strings.TrimSpace(providerResp.ProviderMessageID),
		"delivery_status":        deliveryStatus,
		"tenant_id":              tenantID.String(),
		"recipient_id":           recipientID.String(),
		"recipient_email":        strings.TrimSpace(recipientEmail),
		"notification_id":        item.ID.String(),
		"category":               string(item.Category),
		"subject":                item.Title.Localize("en"),
		"dispatched_at":          now.UTC().Format(time.RFC3339Nano),
		"provider_dispatched_at": now.UTC().Format(time.RFC3339Nano),
	})
	if msg := strings.TrimSpace(providerResp.ErrorMessage); msg != "" {
		proof["error_message"] = msg
	}
	return proof, nil
}

type httpLexEmailDispatchRequest struct {
	TenantID       string                `json:"tenant_id"`
	RecipientID    string                `json:"recipient_id"`
	RecipientEmail string                `json:"recipient_email,omitempty"`
	Provider       string                `json:"provider"`
	Channel        string                `json:"channel"`
	RequestedAt    time.Time             `json:"requested_at"`
	Subject        string                `json:"subject"`
	SubjectAR      string                `json:"subject_ar"`
	Body           string                `json:"body"`
	BodyAR         string                `json:"body_ar"`
	InboxItem      httpLexEmailInboxItem `json:"inbox_item"`
}

type httpLexEmailInboxItem struct {
	ID          string                     `json:"id"`
	TenantID    string                     `json:"tenant_id"`
	RecipientID string                     `json:"recipient_id"`
	Category    model.NotificationCategory `json:"category"`
	Title       any                        `json:"title"`
	Body        any                        `json:"body"`
	EntityType  *string                    `json:"entity_type,omitempty"`
	EntityID    *string                    `json:"entity_id,omitempty"`
	ActionURL   *string                    `json:"action_url,omitempty"`
	EventID     *string                    `json:"event_id,omitempty"`
	DedupKey    *string                    `json:"dedup_key,omitempty"`
	Metadata    map[string]any             `json:"metadata,omitempty"`
	CreatedAt   time.Time                  `json:"created_at"`
}

func httpLexEmailInboxItemFromModel(item model.NotificationInboxItem) httpLexEmailInboxItem {
	return httpLexEmailInboxItem{
		ID:          item.ID.String(),
		TenantID:    item.TenantID.String(),
		RecipientID: item.RecipientID.String(),
		Category:    item.Category,
		Title:       item.Title,
		Body:        item.Body,
		EntityType:  item.EntityType,
		EntityID:    lexEmailUUIDPtrString(item.EntityID),
		ActionURL:   item.ActionURL,
		EventID:     lexEmailUUIDPtrString(item.EventID),
		DedupKey:    item.DedupKey,
		Metadata:    item.Metadata,
		CreatedAt:   item.CreatedAt,
	}
}

func lexEmailUUIDPtrString(id *uuid.UUID) *string {
	if id == nil {
		return nil
	}
	value := id.String()
	return &value
}

type httpLexEmailDispatchResponse struct {
	Provider          string         `json:"provider"`
	ProviderStatus    string         `json:"provider_status"`
	DeliveryStatus    string         `json:"delivery_status"`
	ProviderMessageID string         `json:"provider_message_id"`
	ProviderMetadata  map[string]any `json:"provider_metadata"`
	ErrorMessage      string         `json:"error_message"`
}
