package channel

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/metrics"
	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/repository"
)

// WebhookChannel delivers notifications to external HTTP endpoints.
type WebhookChannel struct {
	webhookRepo *repository.WebhookRepository
	client      *http.Client
	hmacSecret  string
	environment string
	logger      zerolog.Logger
}

// NewWebhookChannel creates a new WebhookChannel.
func NewWebhookChannel(
	webhookRepo *repository.WebhookRepository,
	timeout time.Duration,
	hmacSecret string,
	environment string,
	logger zerolog.Logger,
) *WebhookChannel {
	// SSRF-hardened client: never follows redirects and re-validates every
	// dialed IP at connect time (see ssrf.go) to defeat DNS rebinding.
	client := newSafeHTTPClient(timeout)

	return &WebhookChannel{
		webhookRepo: webhookRepo,
		client:      client,
		hmacSecret:  hmacSecret,
		environment: environment,
		logger:      logger.With().Str("channel", "webhook").Logger(),
	}
}

// Name returns the channel name.
func (c *WebhookChannel) Name() string { return model.ChannelWebhook }

// Send delivers the notification to all matching webhooks for the tenant.
func (c *WebhookChannel) Send(ctx context.Context, notif *model.Notification) *ChannelResult {
	webhooks, err := c.webhookRepo.GetActiveForEvent(ctx, notif.TenantID, string(notif.Type))
	if err != nil {
		return &ChannelResult{Success: false, Error: fmt.Errorf("load webhooks: %w", err)}
	}

	if len(webhooks) == 0 {
		return &ChannelResult{
			Success:  true,
			Metadata: map[string]interface{}{"webhooks_matched": 0},
		}
	}

	var errs []string
	delivered := 0

	for _, wh := range webhooks {
		if err := c.deliverToWebhook(ctx, &wh, notif); err != nil {
			errs = append(errs, fmt.Sprintf("webhook %s: %v", wh.ID, err))
			metrics.WebhookDeliveries.WithLabelValues("failed").Inc()
		} else {
			delivered++
			metrics.WebhookDeliveries.WithLabelValues("delivered").Inc()
		}
	}

	if len(errs) > 0 && delivered == 0 {
		return &ChannelResult{
			Success:  false,
			Error:    fmt.Errorf("all webhooks failed: %s", strings.Join(errs, "; ")),
			Metadata: map[string]interface{}{"webhooks_matched": len(webhooks), "delivered": delivered},
		}
	}

	return &ChannelResult{
		Success:  true,
		Metadata: map[string]interface{}{"webhooks_matched": len(webhooks), "delivered": delivered},
	}
}

func (c *WebhookChannel) deliverToWebhook(ctx context.Context, wh *model.Webhook, notif *model.Notification) error {
	// Validate webhook URL (DNS-aware SSRF check).
	if err := c.validateURL(ctx, wh.URL); err != nil {
		return fmt.Errorf("invalid url: %w", err)
	}

	// Build payload.
	payload := map[string]interface{}{
		"event":      string(notif.Type),
		"data":       notif,
		"timestamp":  time.Now().UTC().Format(time.RFC3339),
		"webhook_id": wh.ID,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, "POST", wh.URL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Clario360-Event", string(notif.Type))
	req.Header.Set("User-Agent", "Clario360-Webhook/1.0")

	// HMAC signing.
	signingSecret := c.hmacSecret
	if wh.Secret != nil && *wh.Secret != "" {
		signingSecret = *wh.Secret
	}
	if signingSecret != "" {
		mac := hmac.New(sha256.New, []byte(signingSecret))
		mac.Write(body)
		sig := hex.EncodeToString(mac.Sum(nil))
		req.Header.Set("X-Clario360-Signature", "sha256="+sig)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		return fmt.Errorf("webhook returned %d (permanent)", resp.StatusCode)
	}

	return fmt.Errorf("webhook returned %d (retriable)", resp.StatusCode)
}

// validateURL delegates to the shared DNS-aware SSRF validator so the delivery
// path and the handler test path enforce an identical policy.
func (c *WebhookChannel) validateURL(ctx context.Context, rawURL string) error {
	return ValidateWebhookURL(ctx, rawURL, c.environment)
}
