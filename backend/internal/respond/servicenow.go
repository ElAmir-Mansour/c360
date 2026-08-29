package respond

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	serviceNowPasswordSecret = "password"
	serviceNowOAuthSecret    = "oauth_token"
	serviceNowWebhookSecret  = "webhook_secret"
)

type ServiceNowRuntimeConfig struct {
	InstanceURL            string
	AuthType               string
	Username               string
	Password               string
	OAuthToken             string
	AssignmentGroup        string
	CallerID               string
	Category               string
	Subcategory            string
	WebhookSecret          string
	WebhookAuthType        IntegrationWebhookAuthType
	WebhookSignatureHeader string
	WebhookTimestampHeader string
	CustomFields           map[string]any
	FieldMapping           map[string]string
}

type ServiceNowTicket struct {
	SysID       string
	Number      string
	URL         string
	State       string
	Priority    string
	RawResponse map[string]any
}

type ServiceNowClient struct {
	httpClient *http.Client
	apiBaseURL string
}

func NewServiceNowClient() *ServiceNowClient {
	return &ServiceNowClient{
		httpClient: &http.Client{Timeout: 25 * time.Second},
	}
}

func newServiceNowClientWithTransport(transport http.RoundTripper) *ServiceNowClient {
	if transport == nil {
		transport = http.DefaultTransport
	}
	return &ServiceNowClient{httpClient: &http.Client{Transport: transport, Timeout: 25 * time.Second}}
}

func (c *ServiceNowClient) CreateIncident(ctx context.Context, cfg ServiceNowRuntimeConfig, payload map[string]any) (*ServiceNowTicket, IntegrationHTTPResult, error) {
	return c.requestIncident(ctx, cfg, http.MethodPost, "/api/now/table/incident", payload)
}

func (c *ServiceNowClient) UpdateIncident(ctx context.Context, cfg ServiceNowRuntimeConfig, sysID string, payload map[string]any) (*ServiceNowTicket, IntegrationHTTPResult, error) {
	if strings.TrimSpace(sysID) == "" {
		return nil, IntegrationHTTPResult{RequestPayload: payload}, fmt.Errorf("servicenow sys_id is required: %w", ErrIntegrationConfig)
	}
	return c.requestIncident(ctx, cfg, http.MethodPatch, "/api/now/table/incident/"+url.PathEscape(sysID), payload)
}

func (c *ServiceNowClient) requestIncident(ctx context.Context, cfg ServiceNowRuntimeConfig, method, path string, payload map[string]any) (*ServiceNowTicket, IntegrationHTTPResult, error) {
	if c == nil {
		c = NewServiceNowClient()
	}
	endpoint := strings.TrimRight(cfg.InstanceURL, "/")
	if c.apiBaseURL != "" {
		endpoint = strings.TrimRight(c.apiBaseURL, "/")
	}
	if endpoint == "" {
		return nil, IntegrationHTTPResult{RequestPayload: payload}, fmt.Errorf("servicenow instance_url is required: %w", ErrIntegrationConfig)
	}
	bodyBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, IntegrationHTTPResult{RequestPayload: payload}, err
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint+path, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, IntegrationHTTPResult{RequestPayload: payload}, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/json")
	applyServiceNowAuth(req, cfg)

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, IntegrationHTTPResult{RequestPayload: payload}, err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 65536))
	result := IntegrationHTTPResult{
		StatusCode:     resp.StatusCode,
		ResponseBody:   string(body),
		RequestPayload: payload,
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, result, &IntegrationHTTPError{
			StatusCode: resp.StatusCode,
			Body:       string(body),
			Retryable:  resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= http.StatusInternalServerError,
			Message:    "servicenow api returned an error",
		}
	}
	var response map[string]any
	if len(body) > 0 {
		if err := json.Unmarshal(body, &response); err != nil {
			return nil, result, fmt.Errorf("decode servicenow response: %w", err)
		}
	}
	ticket := serviceNowTicketFromResponse(cfg, response)
	result.ExternalID = ticket.SysID
	result.ExternalKey = ticket.Number
	result.ExternalURL = ticket.URL
	return ticket, result, nil
}

func applyServiceNowAuth(req *http.Request, cfg ServiceNowRuntimeConfig) {
	if strings.EqualFold(cfg.AuthType, "oauth") || strings.TrimSpace(cfg.OAuthToken) != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.OAuthToken)
		return
	}
	token := base64.StdEncoding.EncodeToString([]byte(cfg.Username + ":" + cfg.Password))
	req.Header.Set("Authorization", "Basic "+token)
}

func serviceNowTicketFromResponse(cfg ServiceNowRuntimeConfig, response map[string]any) *ServiceNowTicket {
	result, _ := response["result"].(map[string]any)
	if result == nil {
		result = response
	}
	sysID := stringFromAny(result["sys_id"])
	number := stringFromAny(result["number"])
	state := firstNonEmptyString(stringFromAny(result["state"]), displayValue(result["state"]))
	priority := firstNonEmptyString(stringFromAny(result["priority"]), displayValue(result["priority"]))
	return &ServiceNowTicket{
		SysID:       sysID,
		Number:      number,
		URL:         strings.TrimRight(cfg.InstanceURL, "/") + "/incident.do?sys_id=" + url.QueryEscape(sysID),
		State:       state,
		Priority:    priority,
		RawResponse: response,
	}
}

type ServiceNowAdapter struct {
	client *ServiceNowClient
}

func NewServiceNowAdapter(client *ServiceNowClient) *ServiceNowAdapter {
	if client == nil {
		client = NewServiceNowClient()
	}
	return &ServiceNowAdapter{client: client}
}

func (a *ServiceNowAdapter) Provider() IntegrationProvider { return IntegrationProviderServiceNow }

func (a *ServiceNowAdapter) CreateTicket(ctx context.Context, cfg ResolvedConnectorConfig, incident *Incident) (*IntegrationExternalLink, IntegrationHTTPResult, error) {
	snCfg := serviceNowConfigFromResolved(cfg)
	payload := BuildServiceNowCreatePayload(snCfg, incident)
	ticket, result, err := a.client.CreateIncident(ctx, snCfg, payload)
	if err != nil {
		return nil, result, err
	}
	link := &IntegrationExternalLink{
		Provider:         IntegrationProviderServiceNow,
		ExternalID:       ticket.SysID,
		ExternalKey:      ticket.Number,
		ExternalURL:      ticket.URL,
		ExternalStatus:   ticket.State,
		ExternalPriority: ticket.Priority,
		SyncDirection:    IntegrationSyncBidirectional,
	}
	return link, result, nil
}

func (a *ServiceNowAdapter) UpdateTicket(ctx context.Context, cfg ResolvedConnectorConfig, link *IntegrationExternalLink, incident *Incident) (*IntegrationExternalLink, IntegrationHTTPResult, error) {
	snCfg := serviceNowConfigFromResolved(cfg)
	payload := BuildServiceNowUpdatePayload(snCfg, incident)
	ticket, result, err := a.client.UpdateIncident(ctx, snCfg, link.ExternalID, payload)
	if err != nil {
		return nil, result, err
	}
	updated := *link
	updated.ExternalID = firstNonEmptyString(ticket.SysID, link.ExternalID)
	updated.ExternalKey = firstNonEmptyString(ticket.Number, link.ExternalKey)
	updated.ExternalURL = firstNonEmptyString(ticket.URL, link.ExternalURL)
	updated.ExternalStatus = firstNonEmptyString(ticket.State, link.ExternalStatus)
	updated.ExternalPriority = firstNonEmptyString(ticket.Priority, link.ExternalPriority)
	return &updated, result, nil
}

func (a *ServiceNowAdapter) ParseWebhook(_ context.Context, cfg ResolvedConnectorConfig, headers http.Header, body []byte) (*InboundITSMEvent, error) {
	snCfg := serviceNowConfigFromResolved(cfg)
	if err := VerifyServiceNowWebhook(snCfg, headers, body, time.Now().UTC()); err != nil {
		return nil, err
	}
	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("decode servicenow webhook: %w", err)
	}
	result, _ := payload["result"].(map[string]any)
	if result == nil {
		result = payload
	}
	externalID := firstNonEmptyString(stringFromAny(result["sys_id"]), stringFromAny(payload["sys_id"]))
	if externalID == "" {
		return nil, fmt.Errorf("servicenow webhook sys_id is required: %w", ErrIntegrationConfig)
	}
	state := firstNonEmptyString(displayValue(result["state"]), stringFromAny(result["state"]), stringFromAny(payload["state"]))
	eventID := firstNonEmptyString(
		stringFromAny(payload["event_id"]),
		stringFromAny(payload["eventId"]),
		stringFromAny(headers.Get("X-ServiceNow-Event-ID")),
	)
	if eventID == "" {
		eventID = strings.Join([]string{
			"servicenow",
			externalID,
			firstNonEmptyString(stringFromAny(result["sys_updated_on"]), stringFromAny(payload["sys_updated_on"]), state),
		}, ":")
	}
	severity := mapServiceNowInboundSeverity(result)
	status := mapServiceNowInboundStatus(snCfg, state)
	return &InboundITSMEvent{
		EventID:        eventID,
		ExternalID:     externalID,
		ExternalKey:    firstNonEmptyString(stringFromAny(result["number"]), stringFromAny(payload["number"])),
		ExternalStatus: state,
		ExternalURL:    strings.TrimRight(snCfg.InstanceURL, "/") + "/incident.do?sys_id=" + url.QueryEscape(externalID),
		Update: InboundIncidentUpdate{
			Title:       stringFromAny(result["short_description"]),
			Description: stringFromAny(result["description"]),
			Status:      status,
			Severity:    severity,
			OccurredAt:  parseServiceNowTime(firstNonEmptyString(stringFromAny(result["sys_updated_on"]), stringFromAny(payload["sys_updated_on"]))),
		},
		Raw: payload,
	}, nil
}

func serviceNowConfigFromResolved(cfg ResolvedConnectorConfig) ServiceNowRuntimeConfig {
	connector := cfg.Connector
	out := ServiceNowRuntimeConfig{
		AuthType:               "basic",
		WebhookAuthType:        IntegrationWebhookAuthHMACSHA256,
		WebhookSignatureHeader: "X-Clario-Signature",
		WebhookTimestampHeader: "X-Clario-Timestamp",
		CustomFields:           map[string]any{},
		FieldMapping:           cfg.Mapping(),
	}
	if connector != nil {
		out.InstanceURL = firstNonEmptyString(connector.EndpointURL, cfg.String("instance_url"))
		out.AuthType = firstNonEmptyString(cfg.String("auth_type"), out.AuthType)
		out.Username = cfg.String("username")
		out.AssignmentGroup = cfg.String("assignment_group")
		out.CallerID = cfg.String("caller_id")
		out.Category = cfg.String("category")
		out.Subcategory = cfg.String("subcategory")
		if raw, ok := connector.NonSecretConfig["custom_fields"].(map[string]any); ok {
			out.CustomFields = raw
		}
		if header := cfg.String("webhook_signature_header"); header != "" {
			out.WebhookSignatureHeader = header
		}
		if header := cfg.String("webhook_timestamp_header"); header != "" {
			out.WebhookTimestampHeader = header
		}
		if authType := cfg.String("webhook_auth_type"); authType != "" {
			out.WebhookAuthType = IntegrationWebhookAuthType(authType)
		} else if connector.WebhookAuthType != "" {
			out.WebhookAuthType = connector.WebhookAuthType
		}
	}
	out.Password = cfg.Secret(serviceNowPasswordSecret)
	out.OAuthToken = cfg.Secret(serviceNowOAuthSecret)
	out.WebhookSecret = cfg.Secret(firstNonEmptyString(connectorSecretName(connector), serviceNowWebhookSecret))
	return out
}

func connectorSecretName(connector *IntegrationConnector) string {
	if connector == nil {
		return ""
	}
	return strings.TrimSpace(connector.WebhookSecretName)
}

func BuildServiceNowCreatePayload(cfg ServiceNowRuntimeConfig, incident *Incident) map[string]any {
	payload := baseServiceNowPayload(cfg, incident)
	payload[fieldName(cfg, "short_description", "short_description")] = truncateForStorage(fmt.Sprintf("[%s] %s", incident.Reference, incident.Title), 160)
	payload[fieldName(cfg, "description", "description")] = serviceNowDescription(incident)
	payload[fieldName(cfg, "urgency", "urgency")] = serviceNowUrgency(incident.Severity)
	payload[fieldName(cfg, "impact", "impact")] = serviceNowImpact(incident.Severity)
	payload[fieldName(cfg, "state", "state")] = serviceNowStateFromStatus(incident.Status)
	return payload
}

func BuildServiceNowUpdatePayload(cfg ServiceNowRuntimeConfig, incident *Incident) map[string]any {
	payload := baseServiceNowPayload(cfg, incident)
	payload[fieldName(cfg, "short_description", "short_description")] = truncateForStorage(fmt.Sprintf("[%s] %s", incident.Reference, incident.Title), 160)
	payload[fieldName(cfg, "description", "description")] = serviceNowDescription(incident)
	payload[fieldName(cfg, "urgency", "urgency")] = serviceNowUrgency(incident.Severity)
	payload[fieldName(cfg, "impact", "impact")] = serviceNowImpact(incident.Severity)
	payload[fieldName(cfg, "state", "state")] = serviceNowStateFromStatus(incident.Status)
	payload[fieldName(cfg, "work_notes", "work_notes")] = fmt.Sprintf("Clario Respond incident %s synchronized at %s.", incident.Reference, time.Now().UTC().Format(time.RFC3339))
	return payload
}

func baseServiceNowPayload(cfg ServiceNowRuntimeConfig, incident *Incident) map[string]any {
	payload := map[string]any{
		fieldName(cfg, "category", "category"):                         firstNonEmptyString(cfg.Category, "incident"),
		fieldName(cfg, "u_clario_incident_id", "u_clario_incident_id"): incident.ID.String(),
		fieldName(cfg, "u_clario_reference", "u_clario_reference"):     incident.Reference,
	}
	if cfg.Subcategory != "" {
		payload[fieldName(cfg, "subcategory", "subcategory")] = cfg.Subcategory
	}
	if cfg.AssignmentGroup != "" {
		payload[fieldName(cfg, "assignment_group", "assignment_group")] = cfg.AssignmentGroup
	}
	if cfg.CallerID != "" {
		payload[fieldName(cfg, "caller_id", "caller_id")] = cfg.CallerID
	}
	for key, value := range cfg.CustomFields {
		if strings.TrimSpace(key) != "" {
			payload[key] = value
		}
	}
	return payload
}

func fieldName(cfg ServiceNowRuntimeConfig, logical, fallback string) string {
	if cfg.FieldMapping != nil {
		if mapped := strings.TrimSpace(cfg.FieldMapping[logical]); mapped != "" {
			return mapped
		}
	}
	return fallback
}

func serviceNowDescription(incident *Incident) string {
	services := strings.Join(incident.ImpactedServices, ", ")
	parts := []string{
		incident.Description,
		"Clario reference: " + incident.Reference,
		"Severity: " + string(incident.Severity),
		"Status: " + string(incident.Status),
	}
	if services != "" {
		parts = append(parts, "Impacted services: "+services)
	}
	return strings.Join(parts, "\n")
}

func serviceNowUrgency(severity Severity) int {
	switch severity {
	case SeveritySEV1:
		return 1
	case SeveritySEV2:
		return 2
	default:
		return 3
	}
}

func serviceNowImpact(severity Severity) int {
	switch severity {
	case SeveritySEV1, SeveritySEV2:
		return 1
	case SeveritySEV3:
		return 2
	default:
		return 3
	}
}

func serviceNowStateFromStatus(status Status) string {
	switch status {
	case StatusInvestigating, StatusMitigating:
		return "2"
	case StatusMitigated, StatusResolved:
		return "6"
	case StatusClosed:
		return "7"
	case StatusCancelled:
		return "8"
	default:
		return "1"
	}
}

func mapServiceNowInboundStatus(cfg ServiceNowRuntimeConfig, state string) *Status {
	state = strings.TrimSpace(state)
	if state == "" {
		return nil
	}
	if cfg.FieldMapping != nil {
		if mapped := strings.TrimSpace(cfg.FieldMapping["state:"+state]); mapped != "" {
			status := Status(mapped)
			if status.Valid() {
				return &status
			}
		}
	}
	var status Status
	switch strings.ToLower(state) {
	case "1", "new":
		status = StatusDeclared
	case "2", "in progress", "work in progress":
		status = StatusInvestigating
	case "6", "resolved":
		status = StatusResolved
	case "7", "closed":
		status = StatusClosed
	case "8", "canceled", "cancelled":
		status = StatusCancelled
	default:
		return nil
	}
	return &status
}

func mapServiceNowInboundSeverity(result map[string]any) *Severity {
	priority := firstNonEmptyString(displayValue(result["priority"]), stringFromAny(result["priority"]))
	urgency := firstNonEmptyString(displayValue(result["urgency"]), stringFromAny(result["urgency"]))
	value := firstNonEmptyString(priority, urgency)
	var severity Severity
	switch strings.ToLower(value) {
	case "1", "critical", "high":
		severity = SeveritySEV1
	case "2", "moderate", "medium":
		severity = SeveritySEV2
	case "3", "low":
		severity = SeveritySEV3
	default:
		return nil
	}
	return &severity
}

func VerifyServiceNowWebhook(cfg ServiceNowRuntimeConfig, headers http.Header, body []byte, now time.Time) error {
	switch cfg.WebhookAuthType {
	case IntegrationWebhookAuthBearer:
		expected := strings.TrimSpace(cfg.WebhookSecret)
		if expected == "" {
			return fmt.Errorf("webhook bearer secret missing: %w", ErrIntegrationWebhookAuth)
		}
		got := strings.TrimPrefix(strings.TrimSpace(headers.Get("Authorization")), "Bearer ")
		if !hmac.Equal([]byte(expected), []byte(got)) {
			return ErrIntegrationWebhookAuth
		}
		return nil
	default:
		secret := strings.TrimSpace(cfg.WebhookSecret)
		if secret == "" {
			return fmt.Errorf("webhook hmac secret missing: %w", ErrIntegrationWebhookAuth)
		}
		signatureHeader := firstNonEmptyString(cfg.WebhookSignatureHeader, "X-Clario-Signature")
		signature := strings.TrimSpace(headers.Get(signatureHeader))
		if signature == "" && !strings.EqualFold(signatureHeader, "X-ServiceNow-Signature") {
			signature = strings.TrimSpace(headers.Get("X-ServiceNow-Signature"))
		}
		if signature == "" {
			return fmt.Errorf("missing webhook signature: %w", ErrIntegrationWebhookAuth)
		}
		timestampHeader := firstNonEmptyString(cfg.WebhookTimestampHeader, "X-Clario-Timestamp")
		timestamp := strings.TrimSpace(headers.Get(timestampHeader))
		if timestamp != "" {
			if err := validateWebhookTimestamp(timestamp, now); err != nil {
				return err
			}
		}
		expected := serviceNowWebhookSignature(secret, timestamp, body)
		if !hmac.Equal([]byte(expected), []byte(normalizeSignature(signature))) {
			return ErrIntegrationWebhookAuth
		}
		return nil
	}
}

func serviceNowWebhookSignature(secret, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	if timestamp != "" {
		mac.Write([]byte(timestamp))
		mac.Write([]byte("."))
	}
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

func normalizeSignature(signature string) string {
	signature = strings.TrimSpace(signature)
	signature = strings.TrimPrefix(signature, "sha256=")
	signature = strings.TrimPrefix(signature, "v1=")
	return strings.ToLower(signature)
}

func validateWebhookTimestamp(raw string, now time.Time) error {
	if now.IsZero() {
		now = time.Now().UTC()
	}
	var ts time.Time
	if unix, err := strconv.ParseInt(raw, 10, 64); err == nil {
		ts = time.Unix(unix, 0).UTC()
	} else if parsed, err := time.Parse(time.RFC3339, raw); err == nil {
		ts = parsed.UTC()
	} else {
		return fmt.Errorf("invalid webhook timestamp: %w", ErrIntegrationWebhookAuth)
	}
	diff := now.Sub(ts)
	if diff < 0 {
		diff = -diff
	}
	if diff > 5*time.Minute {
		return fmt.Errorf("expired webhook timestamp: %w", ErrIntegrationWebhookAuth)
	}
	return nil
}

func displayValue(value any) string {
	if typed, ok := value.(map[string]any); ok {
		return firstNonEmptyString(stringFromAny(typed["display_value"]), stringFromAny(typed["value"]))
	}
	return ""
}

func parseServiceNowTime(value string) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05"} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed.UTC()
		}
	}
	return time.Time{}
}
