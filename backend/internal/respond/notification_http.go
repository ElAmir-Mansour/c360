package respond

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotificationHTTPConfigInvalid = errors.New("respond notification HTTP sender config is invalid")
	ErrNotificationHTTPDelivery      = errors.New("respond notification HTTP delivery failed")
)

type HTTPNotificationSenderConfig struct {
	BaseURL string
	Token   string
	Timeout time.Duration
	Client  *http.Client
}

type HTTPNotificationSender struct {
	baseURL string
	token   string
	client  *http.Client
}

func NewHTTPNotificationSender(cfg HTTPNotificationSenderConfig) (*HTTPNotificationSender, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, fmt.Errorf("base_url is required: %w", ErrNotificationHTTPConfigInvalid)
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	}
	return &HTTPNotificationSender{
		baseURL: baseURL,
		token:   strings.TrimSpace(cfg.Token),
		client:  client,
	}, nil
}

func (s *HTTPNotificationSender) SendRespondNotification(ctx context.Context, message RespondNotificationMessage) (*NotificationSendReceipt, error) {
	channelName, err := notificationServiceChannel(message.Channel)
	if err != nil {
		return nil, err
	}
	data := copyPayload(message.Payload)
	if data == nil {
		data = map[string]any{}
	}
	data["incident_id"] = message.IncidentID.String()
	data["respond_idempotency_key"] = message.IdempotencyKey
	reqBody := httpNotificationCreateRequest{
		TenantID:      message.TenantID.String(),
		UserID:        message.RecipientUserID.String(),
		Type:          "respond.incident.mobilization",
		Category:      "workflow",
		Priority:      "critical",
		Title:         message.Title,
		Body:          message.Body,
		ActionURL:     message.ActionURL,
		SourceEventID: message.IdempotencyKey,
		Data:          data,
		Channels:      []string{channelName},
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("respond: marshal notification request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.baseURL+"/internal/notifications", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("respond: create notification request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if s.token != "" {
		req.Header.Set("X-Service-Token", s.token)
	}
	resp, err := s.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrNotificationHTTPDelivery, err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("%w: status %d: %s", ErrNotificationHTTPDelivery, resp.StatusCode, strings.TrimSpace(string(respBody)))
	}
	var out httpNotificationCreateResponse
	if len(respBody) > 0 {
		_ = json.Unmarshal(respBody, &out)
	}
	providerID := strings.TrimSpace(out.NotificationID)
	if providerID == "" {
		providerID = message.IdempotencyKey
	}
	return &NotificationSendReceipt{ProviderMessageID: providerID, Provider: "notification-service-http"}, nil
}

type httpNotificationCreateRequest struct {
	TenantID      string         `json:"tenant_id"`
	UserID        string         `json:"user_id"`
	Type          string         `json:"type"`
	Category      string         `json:"category"`
	Priority      string         `json:"priority"`
	Title         string         `json:"title"`
	Body          string         `json:"body"`
	ActionURL     string         `json:"action_url,omitempty"`
	SourceEventID string         `json:"source_event_id,omitempty"`
	Data          map[string]any `json:"data,omitempty"`
	Channels      []string       `json:"channels,omitempty"`
}

type httpNotificationCreateResponse struct {
	NotificationID string `json:"notification_id"`
}

func NewPersistentNotificationEngine(pool *pgxpool.Pool, sender NotificationSender, opts ...NotificationEngineOption) (*NotificationEngine, error) {
	store, err := NewPersistentNotificationDispatchStore(pgxTenantRunner{pool: pool}, NewStore())
	if err != nil {
		return nil, err
	}
	return NewNotificationEngine(store, sender, opts...)
}

func NewPersistentResponderResolverForPool(pool *pgxpool.Pool, opts ...ResponderResolverOption) (*PersistentResponderResolver, error) {
	return NewPersistentResponderResolver(pgxTenantRunner{pool: pool}, NewStore(), opts...)
}

var _ NotificationSender = (*HTTPNotificationSender)(nil)
