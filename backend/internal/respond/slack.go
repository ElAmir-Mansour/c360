package respond

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const slackBotTokenSecret = "bot_token"

type SlackRuntimeConfig struct {
	BotToken              string
	DefaultChannelID      string
	IncidentChannelPrefix string
	PrivateChannels       bool
	APIBaseURL            string
	AppBaseURL            string
}

type SlackClient struct {
	httpClient *http.Client
	apiBaseURL string
}

func NewSlackClient() *SlackClient {
	return &SlackClient{
		httpClient: &http.Client{Timeout: 15 * time.Second},
		apiBaseURL: "https://slack.com/api",
	}
}

func newSlackClientWithTransport(transport http.RoundTripper) *SlackClient {
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &SlackClient{
		httpClient: &http.Client{Transport: transport, Timeout: 15 * time.Second},
		apiBaseURL: "https://slack.com/api",
	}
}

func (c *SlackClient) CreateChannel(ctx context.Context, cfg SlackRuntimeConfig, name string, private bool) (*CommsChannel, IntegrationHTTPResult, error) {
	payload := map[string]any{
		"name":       normalizeSlackChannelName(name),
		"is_private": private,
	}
	var response map[string]any
	result, err := c.api(ctx, cfg, "conversations.create", payload, &response)
	if err != nil {
		return nil, result, err
	}
	channelPayload, _ := response["channel"].(map[string]any)
	channel := &CommsChannel{
		ID:   stringFromAny(channelPayload["id"]),
		Name: stringFromAny(channelPayload["name"]),
	}
	if channel.Name == "" {
		channel.Name = stringFromAny(payload["name"])
	}
	return channel, result, nil
}

func (c *SlackClient) PostMessage(ctx context.Context, cfg SlackRuntimeConfig, message CommsMessage) (*CommsMessageReceipt, IntegrationHTTPResult, error) {
	payload := map[string]any{
		"channel":      firstNonEmptyString(message.ChannelID, cfg.DefaultChannelID),
		"text":         message.Text,
		"unfurl_links": false,
		"unfurl_media": false,
	}
	if len(message.Blocks) > 0 {
		payload["blocks"] = message.Blocks
	}
	if message.ThreadTS != "" {
		payload["thread_ts"] = message.ThreadTS
	}
	var response map[string]any
	result, err := c.api(ctx, cfg, "chat.postMessage", payload, &response)
	if err != nil {
		return nil, result, err
	}
	receipt := &CommsMessageReceipt{
		ChannelID: firstNonEmptyString(stringFromAny(response["channel"]), stringFromAny(payload["channel"])),
		MessageTS: stringFromAny(response["ts"]),
	}
	if receipt.ChannelID != "" && receipt.MessageTS != "" && cfg.AppBaseURL != "" {
		receipt.URL = strings.TrimRight(cfg.AppBaseURL, "/") + "/archives/" + url.PathEscape(receipt.ChannelID) + "/p" + strings.ReplaceAll(receipt.MessageTS, ".", "")
	}
	return receipt, result, nil
}

func (c *SlackClient) api(ctx context.Context, cfg SlackRuntimeConfig, method string, payload map[string]any, response any) (IntegrationHTTPResult, error) {
	if c == nil {
		c = NewSlackClient()
	}
	if strings.TrimSpace(cfg.BotToken) == "" {
		return IntegrationHTTPResult{RequestPayload: payload}, fmt.Errorf("slack bot token is required: %w", ErrIntegrationConfig)
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return IntegrationHTTPResult{RequestPayload: payload}, err
	}
	apiBase := firstNonEmptyString(cfg.APIBaseURL, c.apiBaseURL, "https://slack.com/api")
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(apiBase, "/")+"/"+method, bytes.NewReader(bodyBytes))
	if err != nil {
		return IntegrationHTTPResult{RequestPayload: payload}, err
	}
	req.Header.Set("Authorization", "Bearer "+cfg.BotToken)
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Accept", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return IntegrationHTTPResult{RequestPayload: payload}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 65536))
	result := IntegrationHTTPResult{
		StatusCode:     resp.StatusCode,
		ResponseBody:   string(body),
		RequestPayload: payload,
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return result, &IntegrationHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(body),
			Retryable:  resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= http.StatusInternalServerError,
			Message:    "slack api returned an error",
		}
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, response); err != nil {
			return result, fmt.Errorf("decode slack response: %w", err)
		}
	}
	if responseMap, ok := response.(*map[string]any); ok {
		if slackOK, exists := (*responseMap)["ok"].(bool); exists && !slackOK {
			return result, &IntegrationHTTPError{StatusCode: resp.StatusCode, Body: string(body), Message: "slack api returned ok=false"}
		}
	}
	return result, nil
}

type SlackAdapter struct {
	client *SlackClient
}

func NewSlackAdapter(client *SlackClient) *SlackAdapter {
	if client == nil {
		client = NewSlackClient()
	}
	return &SlackAdapter{client: client}
}

func (a *SlackAdapter) Provider() IntegrationProvider { return IntegrationProviderSlack }

func (a *SlackAdapter) CreateChannel(ctx context.Context, cfg ResolvedConnectorConfig, incident *Incident, name string) (*CommsChannel, IntegrationHTTPResult, error) {
	slackCfg := slackConfigFromResolved(cfg)
	if name == "" {
		name = slackIncidentChannelName(slackCfg, incident)
	}
	return a.client.CreateChannel(ctx, slackCfg, name, slackCfg.PrivateChannels)
}

func (a *SlackAdapter) PostMessage(ctx context.Context, cfg ResolvedConnectorConfig, incident *Incident, message CommsMessage) (*CommsMessageReceipt, IntegrationHTTPResult, error) {
	slackCfg := slackConfigFromResolved(cfg)
	if strings.TrimSpace(message.Text) == "" {
		message = BuildSlackIncidentMessage(slackCfg, incident, message)
	} else if len(message.Blocks) == 0 {
		message.Blocks = slackTextBlocks(message.Text)
	}
	return a.client.PostMessage(ctx, slackCfg, message)
}

func slackConfigFromResolved(cfg ResolvedConnectorConfig) SlackRuntimeConfig {
	out := SlackRuntimeConfig{
		BotToken:              cfg.Secret(slackBotTokenSecret),
		DefaultChannelID:      cfg.String("channel_id"),
		IncidentChannelPrefix: firstNonEmptyString(cfg.String("incident_channel_prefix"), "inc"),
		PrivateChannels:       cfg.Bool("private_channels"),
		APIBaseURL:            cfg.String("api_base_url"),
		AppBaseURL:            cfg.String("app_base_url"),
	}
	return out
}

func BuildSlackIncidentMessage(_ SlackRuntimeConfig, incident *Incident, message CommsMessage) CommsMessage {
	text := fmt.Sprintf("%s %s is %s (%s)", incident.Reference, incident.Title, incident.Status, incident.Severity)
	message.Text = text
	message.Blocks = []map[string]any{
		{
			"type": "header",
			"text": map[string]any{"type": "plain_text", "text": truncateForStorage(incident.Reference+" "+incident.Title, 150)},
		},
		{
			"type": "section",
			"fields": []map[string]any{
				{"type": "mrkdwn", "text": "*Severity*\n" + string(incident.Severity)},
				{"type": "mrkdwn", "text": "*Status*\n" + string(incident.Status)},
			},
		},
		{
			"type": "section",
			"text": map[string]any{"type": "mrkdwn", "text": firstNonEmptyString(incident.Description, "No incident description recorded.")},
		},
	}
	return message
}

func slackTextBlocks(text string) []map[string]any {
	return []map[string]any{{
		"type": "section",
		"text": map[string]any{"type": "mrkdwn", "text": text},
	}}
}

func slackIncidentChannelName(cfg SlackRuntimeConfig, incident *Incident) string {
	name := strings.ToLower(cfg.IncidentChannelPrefix + "-" + incident.Reference)
	return normalizeSlackChannelName(name)
}

func normalizeSlackChannelName(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	var b strings.Builder
	lastDash := false
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			b.WriteRune(r)
			lastDash = false
		default:
			if !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "incident"
	}
	if len(out) > 80 {
		return out[:80]
	}
	return out
}
