package respond

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	configcrypto "github.com/clario360/platform/internal/integration/encryption"
)

var (
	ErrIntegrationConnectorNotFound = errors.New("respond integration connector not found")
	ErrIntegrationLinkNotFound      = errors.New("respond integration link not found")
	ErrIntegrationUnsupported       = errors.New("respond integration provider is not supported")
	ErrIntegrationConfig            = errors.New("respond integration config is invalid")
	ErrIntegrationSecretUnavailable = errors.New("respond integration secret is unavailable")
	ErrIntegrationWebhookAuth       = errors.New("respond integration webhook authenticity validation failed")
	ErrIntegrationDuplicateWebhook  = errors.New("respond integration webhook event already processed")
)

type IntegrationKind string

const (
	IntegrationKindITSM  IntegrationKind = "itsm"
	IntegrationKindComms IntegrationKind = "comms"
)

func (k IntegrationKind) Valid() bool {
	return k == IntegrationKindITSM || k == IntegrationKindComms
}

type IntegrationProvider string

const (
	IntegrationProviderServiceNow IntegrationProvider = "servicenow"
	IntegrationProviderSlack      IntegrationProvider = "slack"
)

func (p IntegrationProvider) Valid() bool {
	return p == IntegrationProviderServiceNow || p == IntegrationProviderSlack
}

type IntegrationSyncDirection string

const (
	IntegrationSyncOutbound      IntegrationSyncDirection = "outbound"
	IntegrationSyncInbound       IntegrationSyncDirection = "inbound"
	IntegrationSyncBidirectional IntegrationSyncDirection = "bidirectional"
)

type IntegrationAuditStatus string

const (
	IntegrationAuditPending        IntegrationAuditStatus = "pending"
	IntegrationAuditSucceeded      IntegrationAuditStatus = "succeeded"
	IntegrationAuditFailed         IntegrationAuditStatus = "failed"
	IntegrationAuditRetryScheduled IntegrationAuditStatus = "retry_scheduled"
	IntegrationAuditDuplicate      IntegrationAuditStatus = "duplicate"
)

type IntegrationWebhookAuthType string

const (
	IntegrationWebhookAuthHMACSHA256 IntegrationWebhookAuthType = "hmac_sha256"
	IntegrationWebhookAuthBearer     IntegrationWebhookAuthType = "bearer"
)

func (t IntegrationWebhookAuthType) Valid() bool {
	return t == IntegrationWebhookAuthHMACSHA256 || t == IntegrationWebhookAuthBearer
}

const (
	EventIntegrationOutbound       = "respond.integration.outbound"
	EventIntegrationInbound        = "respond.integration.inbound"
	EventIntegrationLinked         = "respond.integration.linked"
	EventIntegrationMessageSent    = "respond.integration.message_sent"
	EventIntegrationChannelCreated = "respond.integration.channel_created"
	EventIntegrationWebhookIgnored = "respond.integration.webhook_duplicate"
)

type IntegrationConnector struct {
	ID                uuid.UUID                  `json:"id"`
	TenantID          uuid.UUID                  `json:"tenant_id"`
	Kind              IntegrationKind            `json:"kind"`
	Provider          IntegrationProvider        `json:"provider"`
	Name              string                     `json:"name"`
	Enabled           bool                       `json:"enabled"`
	EndpointURL       string                     `json:"endpoint_url,omitempty"`
	NonSecretConfig   map[string]any             `json:"config,omitempty"`
	FieldMapping      map[string]string          `json:"field_mapping,omitempty"`
	WebhookAuthType   IntegrationWebhookAuthType `json:"webhook_auth_type,omitempty"`
	WebhookSecretName string                     `json:"webhook_secret_name,omitempty"`
	CreatedBy         uuid.UUID                  `json:"created_by"`
	RowVersion        int                        `json:"row_version"`
	CreatedAt         time.Time                  `json:"created_at"`
	UpdatedAt         time.Time                  `json:"updated_at"`
	DeletedAt         *time.Time                 `json:"-"`
}

func (c *IntegrationConnector) Validate() error {
	if c == nil {
		return fmt.Errorf("connector is required: %w", ErrIntegrationConfig)
	}
	c.Name = strings.TrimSpace(c.Name)
	c.EndpointURL = strings.TrimSpace(c.EndpointURL)
	c.WebhookSecretName = strings.TrimSpace(c.WebhookSecretName)
	if c.TenantID == uuid.Nil || c.CreatedBy == uuid.Nil {
		return fmt.Errorf("tenant_id and created_by are required: %w", ErrValidation)
	}
	if !c.Kind.Valid() {
		return fmt.Errorf("kind %q: %w", c.Kind, ErrIntegrationConfig)
	}
	if !c.Provider.Valid() {
		return fmt.Errorf("provider %q: %w", c.Provider, ErrIntegrationUnsupported)
	}
	if c.Kind == IntegrationKindITSM && c.Provider != IntegrationProviderServiceNow {
		return fmt.Errorf("itsm provider %q: %w", c.Provider, ErrIntegrationUnsupported)
	}
	if c.Kind == IntegrationKindComms && c.Provider != IntegrationProviderSlack {
		return fmt.Errorf("comms provider %q: %w", c.Provider, ErrIntegrationUnsupported)
	}
	if c.Name == "" {
		return fmt.Errorf("name is required: %w", ErrValidation)
	}
	if c.NonSecretConfig == nil {
		c.NonSecretConfig = map[string]any{}
	}
	if c.FieldMapping == nil {
		c.FieldMapping = map[string]string{}
	}
	if c.WebhookAuthType == "" {
		c.WebhookAuthType = IntegrationWebhookAuthHMACSHA256
	}
	if !c.WebhookAuthType.Valid() {
		return fmt.Errorf("webhook auth type %q: %w", c.WebhookAuthType, ErrIntegrationConfig)
	}
	return nil
}

type IntegrationConnectorSecret struct {
	ID             uuid.UUID `json:"id"`
	TenantID       uuid.UUID `json:"tenant_id"`
	ConnectorID    uuid.UUID `json:"connector_id"`
	Name           string    `json:"name"`
	SecretRef      string    `json:"-"`
	EncryptedValue []byte    `json:"-"`
	EncryptedNonce []byte    `json:"-"`
	KeyID          string    `json:"-"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type IntegrationSecretInput struct {
	Name      string
	Plaintext string
	SecretRef string
}

type IntegrationExternalLink struct {
	ID                uuid.UUID                `json:"id"`
	TenantID          uuid.UUID                `json:"tenant_id"`
	IncidentID        uuid.UUID                `json:"incident_id"`
	ConnectorID       uuid.UUID                `json:"connector_id"`
	Provider          IntegrationProvider      `json:"provider"`
	ExternalID        string                   `json:"external_id"`
	ExternalKey       string                   `json:"external_key"`
	ExternalURL       string                   `json:"external_url"`
	ExternalStatus    string                   `json:"external_status,omitempty"`
	ExternalPriority  string                   `json:"external_priority,omitempty"`
	SyncDirection     IntegrationSyncDirection `json:"sync_direction"`
	LastSyncedAt      *time.Time               `json:"last_synced_at,omitempty"`
	LastSyncDirection string                   `json:"last_sync_direction,omitempty"`
	SyncError         string                   `json:"sync_error,omitempty"`
	CreatedAt         time.Time                `json:"created_at"`
	UpdatedAt         time.Time                `json:"updated_at"`
}

type IntegrationWebhookDedupeRecord struct {
	ID              uuid.UUID              `json:"id"`
	TenantID        uuid.UUID              `json:"tenant_id"`
	ConnectorID     uuid.UUID              `json:"connector_id"`
	Provider        IntegrationProvider    `json:"provider"`
	ExternalEventID string                 `json:"external_event_id"`
	ExternalID      string                 `json:"external_id"`
	PayloadHash     []byte                 `json:"-"`
	Status          IntegrationAuditStatus `json:"status"`
	ReceivedAt      time.Time              `json:"received_at"`
	ProcessedAt     *time.Time             `json:"processed_at,omitempty"`
	LastError       string                 `json:"last_error,omitempty"`
}

type IntegrationSyncAudit struct {
	ID              uuid.UUID                `json:"id"`
	TenantID        uuid.UUID                `json:"tenant_id"`
	ConnectorID     uuid.UUID                `json:"connector_id"`
	IncidentID      *uuid.UUID               `json:"incident_id,omitempty"`
	LinkID          *uuid.UUID               `json:"link_id,omitempty"`
	Provider        IntegrationProvider      `json:"provider"`
	Direction       IntegrationSyncDirection `json:"direction"`
	Action          string                   `json:"action"`
	Status          IntegrationAuditStatus   `json:"status"`
	RequestPayload  map[string]any           `json:"request_payload,omitempty"`
	ResponseStatus  int                      `json:"response_status,omitempty"`
	ResponseBody    string                   `json:"response_body,omitempty"`
	ExternalEventID string                   `json:"external_event_id,omitempty"`
	ExternalID      string                   `json:"external_id,omitempty"`
	IdempotencyKey  string                   `json:"idempotency_key,omitempty"`
	Attempt         int                      `json:"attempt"`
	NextRetryAt     *time.Time               `json:"next_retry_at,omitempty"`
	ErrorMessage    string                   `json:"error_message,omitempty"`
	StartedAt       time.Time                `json:"started_at"`
	CompletedAt     *time.Time               `json:"completed_at,omitempty"`
	CreatedAt       time.Time                `json:"created_at"`
}

type IntegrationHTTPResult struct {
	StatusCode     int
	ResponseBody   string
	RequestPayload map[string]any
	ExternalID     string
	ExternalKey    string
	ExternalURL    string
}

type IntegrationHTTPError struct {
	StatusCode int
	Body       string
	Retryable  bool
	Message    string
}

func (e *IntegrationHTTPError) Error() string {
	if e == nil {
		return ""
	}
	message := e.Message
	if message == "" {
		message = "integration http request failed"
	}
	if e.StatusCode > 0 {
		return fmt.Sprintf("%s: status %d", message, e.StatusCode)
	}
	return message
}

type ResolvedConnectorConfig struct {
	Connector *IntegrationConnector
	Secrets   map[string]string
}

func (c ResolvedConnectorConfig) String(key string) string {
	if c.Connector == nil || c.Connector.NonSecretConfig == nil {
		return ""
	}
	return stringFromAny(c.Connector.NonSecretConfig[key])
}

func (c ResolvedConnectorConfig) Bool(key string) bool {
	if c.Connector == nil || c.Connector.NonSecretConfig == nil {
		return false
	}
	v, _ := c.Connector.NonSecretConfig[key].(bool)
	return v
}

func (c ResolvedConnectorConfig) Secret(name string) string {
	if c.Secrets == nil {
		return ""
	}
	return strings.TrimSpace(c.Secrets[name])
}

func (c ResolvedConnectorConfig) Mapping() map[string]string {
	if c.Connector == nil || c.Connector.FieldMapping == nil {
		return map[string]string{}
	}
	out := make(map[string]string, len(c.Connector.FieldMapping))
	for k, v := range c.Connector.FieldMapping {
		out[k] = v
	}
	return out
}

type ITSMAdapter interface {
	Provider() IntegrationProvider
	CreateTicket(ctx context.Context, cfg ResolvedConnectorConfig, incident *Incident) (*IntegrationExternalLink, IntegrationHTTPResult, error)
	UpdateTicket(ctx context.Context, cfg ResolvedConnectorConfig, link *IntegrationExternalLink, incident *Incident) (*IntegrationExternalLink, IntegrationHTTPResult, error)
	ParseWebhook(ctx context.Context, cfg ResolvedConnectorConfig, headers http.Header, body []byte) (*InboundITSMEvent, error)
}

type CommsAdapter interface {
	Provider() IntegrationProvider
	CreateChannel(ctx context.Context, cfg ResolvedConnectorConfig, incident *Incident, name string) (*CommsChannel, IntegrationHTTPResult, error)
	PostMessage(ctx context.Context, cfg ResolvedConnectorConfig, incident *Incident, message CommsMessage) (*CommsMessageReceipt, IntegrationHTTPResult, error)
}

type InboundITSMEvent struct {
	EventID        string
	ExternalID     string
	ExternalKey    string
	ExternalStatus string
	ExternalURL    string
	Update         InboundIncidentUpdate
	Raw            map[string]any
}

type InboundIncidentUpdate struct {
	Title       string
	Description string
	Status      *Status
	Severity    *Severity
	OccurredAt  time.Time
}

type CommsChannel struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	URL  string `json:"url,omitempty"`
}

type CommsMessage struct {
	ChannelID string
	Text      string
	Blocks    []map[string]any
	ThreadTS  string
}

type CommsMessageReceipt struct {
	ChannelID string `json:"channel_id"`
	MessageTS string `json:"message_ts"`
	URL       string `json:"url,omitempty"`
}

type InboundWebhookResult struct {
	IncidentID      uuid.UUID              `json:"incident_id,omitempty"`
	LinkID          uuid.UUID              `json:"link_id,omitempty"`
	ExternalEventID string                 `json:"external_event_id"`
	ExternalID      string                 `json:"external_id"`
	Duplicate       bool                   `json:"duplicate"`
	Status          IntegrationAuditStatus `json:"status"`
}

type IntegrationSecretCipher interface {
	EncryptSecret(ctx context.Context, name, plaintext string) (encryptedValue, nonce []byte, keyID string, err error)
	DecryptSecret(ctx context.Context, secret IntegrationConnectorSecret) (string, error)
}

type ConfigIntegrationSecretCipher struct {
	encryptor *configcrypto.ConfigEncryptor
}

func NewConfigIntegrationSecretCipher(rawKey, keyID string) (*ConfigIntegrationSecretCipher, error) {
	encryptor, err := configcrypto.NewConfigEncryptor(rawKey, keyID)
	if err != nil {
		return nil, err
	}
	return &ConfigIntegrationSecretCipher{encryptor: encryptor}, nil
}

func (c *ConfigIntegrationSecretCipher) EncryptSecret(_ context.Context, name, plaintext string) ([]byte, []byte, string, error) {
	if c == nil || c.encryptor == nil {
		return nil, nil, "", ErrIntegrationSecretUnavailable
	}
	payload := map[string]any{"name": name, "value": plaintext}
	return c.encryptor.Encrypt(payload)
}

func (c *ConfigIntegrationSecretCipher) DecryptSecret(_ context.Context, secret IntegrationConnectorSecret) (string, error) {
	if c == nil || c.encryptor == nil {
		return "", ErrIntegrationSecretUnavailable
	}
	payload, err := c.encryptor.Decrypt(secret.EncryptedValue, secret.EncryptedNonce)
	if err != nil {
		return "", fmt.Errorf("respond: decrypt integration secret %q: %w", secret.Name, err)
	}
	return stringFromAny(payload["value"]), nil
}

type IntegrationSecretRefResolver interface {
	ResolveIntegrationSecret(ctx context.Context, ref string) (string, error)
}

type IntegrationSecretRefResolverFunc func(ctx context.Context, ref string) (string, error)

func (f IntegrationSecretRefResolverFunc) ResolveIntegrationSecret(ctx context.Context, ref string) (string, error) {
	return f(ctx, ref)
}

func PrepareIntegrationSecrets(ctx context.Context, connectorID, tenantID uuid.UUID, cipher IntegrationSecretCipher, inputs []IntegrationSecretInput) ([]IntegrationConnectorSecret, error) {
	secrets := make([]IntegrationConnectorSecret, 0, len(inputs))
	for _, input := range inputs {
		name := strings.TrimSpace(input.Name)
		ref := strings.TrimSpace(input.SecretRef)
		plaintext := strings.TrimSpace(input.Plaintext)
		if name == "" {
			return nil, fmt.Errorf("secret name is required: %w", ErrValidation)
		}
		if ref != "" && plaintext != "" {
			return nil, fmt.Errorf("secret %q has both secret_ref and plaintext: %w", name, ErrIntegrationConfig)
		}
		secret := IntegrationConnectorSecret{
			TenantID:    tenantID,
			ConnectorID: connectorID,
			Name:        name,
			SecretRef:   ref,
		}
		if plaintext != "" {
			if cipher == nil {
				return nil, fmt.Errorf("secret %q requires encryption: %w", name, ErrIntegrationSecretUnavailable)
			}
			encrypted, nonce, keyID, err := cipher.EncryptSecret(ctx, name, plaintext)
			if err != nil {
				return nil, err
			}
			secret.EncryptedValue = encrypted
			secret.EncryptedNonce = nonce
			secret.KeyID = keyID
		}
		if secret.SecretRef == "" && len(secret.EncryptedValue) == 0 {
			return nil, fmt.Errorf("secret %q requires secret_ref or encrypted value: %w", name, ErrIntegrationConfig)
		}
		secrets = append(secrets, secret)
	}
	return secrets, nil
}

func ResolveIntegrationSecrets(ctx context.Context, cipher IntegrationSecretCipher, resolver IntegrationSecretRefResolver, stored []IntegrationConnectorSecret) (map[string]string, error) {
	resolved := make(map[string]string, len(stored))
	for _, secret := range stored {
		switch {
		case strings.TrimSpace(secret.SecretRef) != "":
			if resolver == nil {
				return nil, fmt.Errorf("secret %q uses a secret reference but no resolver is configured: %w", secret.Name, ErrIntegrationSecretUnavailable)
			}
			value, err := resolver.ResolveIntegrationSecret(ctx, secret.SecretRef)
			if err != nil {
				return nil, fmt.Errorf("resolve secret reference for %q: %w", secret.Name, err)
			}
			resolved[secret.Name] = value
		case len(secret.EncryptedValue) > 0:
			if cipher == nil {
				return nil, fmt.Errorf("secret %q is encrypted but no cipher is configured: %w", secret.Name, ErrIntegrationSecretUnavailable)
			}
			value, err := cipher.DecryptSecret(ctx, secret)
			if err != nil {
				return nil, err
			}
			resolved[secret.Name] = value
		default:
			return nil, fmt.Errorf("secret %q has no stored material: %w", secret.Name, ErrIntegrationSecretUnavailable)
		}
	}
	return resolved, nil
}

type TimelineEmitter interface {
	EmitIntegrationTimeline(ctx context.Context, tenantID, incidentID, actorID uuid.UUID, eventType string, payload map[string]any) error
}

type StoreTimelineEmitter struct {
	runner tenantRunner
	store  *Store
	feed   *TimelineFeed
	now    func() time.Time
}

func NewStoreTimelineEmitter(pool *pgxpool.Pool, feed *TimelineFeed) *StoreTimelineEmitter {
	return NewStoreTimelineEmitterWithDeps(pgxTenantRunner{pool: pool}, NewStore(), feed)
}

func NewStoreTimelineEmitterWithDeps(runner tenantRunner, store *Store, feed *TimelineFeed) *StoreTimelineEmitter {
	if store == nil {
		store = NewStore()
	}
	return &StoreTimelineEmitter{
		runner: runner,
		store:  store,
		feed:   feed,
		now:    func() time.Time { return time.Now().UTC() },
	}
}

func (e *StoreTimelineEmitter) EmitIntegrationTimeline(ctx context.Context, tenantID, incidentID, actorID uuid.UUID, eventType string, payload map[string]any) error {
	if e == nil || e.runner == nil {
		return nil
	}
	ev := TimelineEvent{
		TenantID:   tenantID,
		IncidentID: incidentID,
		ActorID:    actorID,
		OccurredAt: e.now(),
		EventType:  eventType,
		Payload:    payload,
	}
	err := e.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if _, err := e.store.GetIncident(ctx, tx, tenantID, incidentID); err != nil {
			return err
		}
		return e.store.AppendTimelineEvent(ctx, tx, &ev)
	})
	if err != nil {
		return err
	}
	if e.feed != nil {
		e.feed.Publish(ev)
	}
	return nil
}

type RespondIntegrationService struct {
	runner        tenantRunner
	store         *Store
	itsmAdapters  map[IntegrationProvider]ITSMAdapter
	commsAdapters map[IntegrationProvider]CommsAdapter
	cipher        IntegrationSecretCipher
	secretRefs    IntegrationSecretRefResolver
	timeline      TimelineEmitter
	logger        zerolog.Logger
	now           func() time.Time
}

type RespondIntegrationOption func(*RespondIntegrationService)

func NewRespondIntegrationService(pool *pgxpool.Pool, logger zerolog.Logger, opts ...RespondIntegrationOption) *RespondIntegrationService {
	return NewRespondIntegrationServiceWithDeps(pgxTenantRunner{pool: pool}, NewStore(), NewStoreTimelineEmitter(pool, nil), logger, opts...)
}

func NewRespondIntegrationServiceWithDeps(runner tenantRunner, store *Store, timeline TimelineEmitter, logger zerolog.Logger, opts ...RespondIntegrationOption) *RespondIntegrationService {
	if store == nil {
		store = NewStore()
	}
	svc := &RespondIntegrationService{
		runner:        runner,
		store:         store,
		itsmAdapters:  map[IntegrationProvider]ITSMAdapter{},
		commsAdapters: map[IntegrationProvider]CommsAdapter{},
		timeline:      timeline,
		logger:        logger.With().Str("component", "respond-integration").Logger(),
		now:           func() time.Time { return time.Now().UTC() },
	}
	svc.RegisterITSMAdapter(NewServiceNowAdapter(NewServiceNowClient()))
	svc.RegisterCommsAdapter(NewSlackAdapter(NewSlackClient()))
	for _, opt := range opts {
		opt(svc)
	}
	return svc
}

func WithRespondIntegrationSecretCipher(cipher IntegrationSecretCipher) RespondIntegrationOption {
	return func(s *RespondIntegrationService) { s.cipher = cipher }
}

func WithRespondIntegrationSecretRefResolver(resolver IntegrationSecretRefResolver) RespondIntegrationOption {
	return func(s *RespondIntegrationService) { s.secretRefs = resolver }
}

func WithRespondITSMAdapter(adapter ITSMAdapter) RespondIntegrationOption {
	return func(s *RespondIntegrationService) { s.RegisterITSMAdapter(adapter) }
}

func WithRespondCommsAdapter(adapter CommsAdapter) RespondIntegrationOption {
	return func(s *RespondIntegrationService) { s.RegisterCommsAdapter(adapter) }
}

func (s *RespondIntegrationService) RegisterITSMAdapter(adapter ITSMAdapter) {
	if adapter != nil {
		s.itsmAdapters[adapter.Provider()] = adapter
	}
}

func (s *RespondIntegrationService) RegisterCommsAdapter(adapter CommsAdapter) {
	if adapter != nil {
		s.commsAdapters[adapter.Provider()] = adapter
	}
}

func (s *RespondIntegrationService) SyncIncidentToITSM(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID, action string) (*IntegrationExternalLink, error) {
	started := s.now()
	connector, cfg, incident, existing, err := s.loadITSMContext(ctx, tenantID, connectorID, incidentID)
	if err != nil {
		return nil, err
	}
	adapter := s.itsmAdapters[connector.Provider]
	if adapter == nil {
		return nil, ErrIntegrationUnsupported
	}
	if action == "" || action == "auto" {
		if existing == nil {
			action = "create_ticket"
		} else {
			action = "update_ticket"
		}
	}

	var link *IntegrationExternalLink
	var result IntegrationHTTPResult
	if action == "create_ticket" {
		link, result, err = adapter.CreateTicket(ctx, cfg, incident)
	} else if action == "update_ticket" {
		if existing == nil {
			return nil, ErrIntegrationLinkNotFound
		}
		link, result, err = adapter.UpdateTicket(ctx, cfg, existing, incident)
	} else {
		return nil, fmt.Errorf("action %q: %w", action, ErrIntegrationConfig)
	}

	completed := s.now()
	if err != nil {
		_ = s.recordAudit(ctx, IntegrationSyncAudit{
			TenantID:       tenantID,
			ConnectorID:    connectorID,
			IncidentID:     &incidentID,
			Provider:       connector.Provider,
			Direction:      IntegrationSyncOutbound,
			Action:         action,
			Status:         auditStatusForError(err),
			RequestPayload: result.RequestPayload,
			ResponseStatus: result.StatusCode,
			ResponseBody:   truncateForStorage(result.ResponseBody, 8192),
			IdempotencyKey: outboundIdempotencyKey(connectorID, incidentID, action),
			Attempt:        1,
			NextRetryAt:    retryTimeForError(s.now, err),
			ErrorMessage:   safeErrorMessage(err),
			StartedAt:      started,
			CompletedAt:    &completed,
		})
		return nil, err
	}
	link.TenantID = tenantID
	link.IncidentID = incidentID
	link.ConnectorID = connectorID
	link.Provider = connector.Provider
	if link.SyncDirection == "" {
		link.SyncDirection = IntegrationSyncBidirectional
	}
	now := s.now()
	link.LastSyncedAt = &now
	link.LastSyncDirection = string(IntegrationSyncOutbound)
	link.SyncError = ""

	err = s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		if err := s.store.UpsertIntegrationLink(ctx, tx, link); err != nil {
			return err
		}
		linkID := link.ID
		return s.store.RecordIntegrationSyncAudit(ctx, tx, &IntegrationSyncAudit{
			TenantID:       tenantID,
			ConnectorID:    connectorID,
			IncidentID:     &incidentID,
			LinkID:         &linkID,
			Provider:       connector.Provider,
			Direction:      IntegrationSyncOutbound,
			Action:         action,
			Status:         IntegrationAuditSucceeded,
			RequestPayload: result.RequestPayload,
			ResponseStatus: result.StatusCode,
			ResponseBody:   truncateForStorage(result.ResponseBody, 8192),
			ExternalID:     link.ExternalID,
			IdempotencyKey: outboundIdempotencyKey(connectorID, incidentID, action),
			Attempt:        1,
			StartedAt:      started,
			CompletedAt:    &completed,
		})
	})
	if err != nil {
		return nil, err
	}
	_ = s.emitTimeline(ctx, tenantID, incidentID, connector.CreatedBy, EventIntegrationOutbound, map[string]any{
		"connector_id": connectorID.String(),
		"provider":     connector.Provider,
		"action":       action,
		"external_id":  link.ExternalID,
		"external_key": link.ExternalKey,
	})
	if action == "create_ticket" {
		_ = s.emitTimeline(ctx, tenantID, incidentID, connector.CreatedBy, EventIntegrationLinked, map[string]any{
			"connector_id": connectorID.String(),
			"provider":     connector.Provider,
			"external_id":  link.ExternalID,
			"external_key": link.ExternalKey,
			"external_url": link.ExternalURL,
		})
	}
	return link, nil
}

func (s *RespondIntegrationService) CreateCommsChannel(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID, name string) (*CommsChannel, error) {
	started := s.now()
	connector, cfg, incident, err := s.loadCommsContext(ctx, tenantID, connectorID, incidentID)
	if err != nil {
		return nil, err
	}
	adapter := s.commsAdapters[connector.Provider]
	if adapter == nil {
		return nil, ErrIntegrationUnsupported
	}
	channel, result, err := adapter.CreateChannel(ctx, cfg, incident, name)
	completed := s.now()
	status := IntegrationAuditSucceeded
	if err != nil {
		status = auditStatusForError(err)
	}
	_ = s.recordAudit(ctx, IntegrationSyncAudit{
		TenantID:       tenantID,
		ConnectorID:    connectorID,
		IncidentID:     &incidentID,
		Provider:       connector.Provider,
		Direction:      IntegrationSyncOutbound,
		Action:         "create_channel",
		Status:         status,
		RequestPayload: result.RequestPayload,
		ResponseStatus: result.StatusCode,
		ResponseBody:   truncateForStorage(result.ResponseBody, 8192),
		IdempotencyKey: outboundIdempotencyKey(connectorID, incidentID, "create_channel:"+strings.TrimSpace(name)),
		Attempt:        1,
		NextRetryAt:    retryTimeForError(s.now, err),
		ErrorMessage:   safeErrorMessage(err),
		StartedAt:      started,
		CompletedAt:    &completed,
	})
	if err != nil {
		return nil, err
	}
	_ = s.emitTimeline(ctx, tenantID, incidentID, connector.CreatedBy, EventIntegrationChannelCreated, map[string]any{
		"connector_id": connectorID.String(),
		"provider":     connector.Provider,
		"channel_id":   channel.ID,
		"channel_name": channel.Name,
	})
	return channel, nil
}

func (s *RespondIntegrationService) PostCommsMessage(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID, message CommsMessage) (*CommsMessageReceipt, error) {
	started := s.now()
	connector, cfg, incident, err := s.loadCommsContext(ctx, tenantID, connectorID, incidentID)
	if err != nil {
		return nil, err
	}
	adapter := s.commsAdapters[connector.Provider]
	if adapter == nil {
		return nil, ErrIntegrationUnsupported
	}
	receipt, result, err := adapter.PostMessage(ctx, cfg, incident, message)
	completed := s.now()
	status := IntegrationAuditSucceeded
	if err != nil {
		status = auditStatusForError(err)
	}
	_ = s.recordAudit(ctx, IntegrationSyncAudit{
		TenantID:       tenantID,
		ConnectorID:    connectorID,
		IncidentID:     &incidentID,
		Provider:       connector.Provider,
		Direction:      IntegrationSyncOutbound,
		Action:         "post_message",
		Status:         status,
		RequestPayload: result.RequestPayload,
		ResponseStatus: result.StatusCode,
		ResponseBody:   truncateForStorage(result.ResponseBody, 8192),
		IdempotencyKey: outboundIdempotencyKey(connectorID, incidentID, "post_message:"+message.Text),
		Attempt:        1,
		NextRetryAt:    retryTimeForError(s.now, err),
		ErrorMessage:   safeErrorMessage(err),
		StartedAt:      started,
		CompletedAt:    &completed,
	})
	if err != nil {
		return nil, err
	}
	_ = s.emitTimeline(ctx, tenantID, incidentID, connector.CreatedBy, EventIntegrationMessageSent, map[string]any{
		"connector_id": connectorID.String(),
		"provider":     connector.Provider,
		"channel_id":   receipt.ChannelID,
		"message_ts":   receipt.MessageTS,
	})
	return receipt, nil
}

func (s *RespondIntegrationService) IngestITSMWebhook(ctx context.Context, tenantID, connectorID uuid.UUID, headers http.Header, body []byte) (*InboundWebhookResult, error) {
	started := s.now()
	connector, cfg, err := s.loadConnectorConfig(ctx, tenantID, connectorID)
	if err != nil {
		return nil, err
	}
	if connector.Kind != IntegrationKindITSM {
		return nil, ErrIntegrationUnsupported
	}
	adapter := s.itsmAdapters[connector.Provider]
	if adapter == nil {
		return nil, ErrIntegrationUnsupported
	}
	event, err := adapter.ParseWebhook(ctx, cfg, headers, body)
	if err != nil {
		completed := s.now()
		_ = s.recordAudit(ctx, IntegrationSyncAudit{
			TenantID:       tenantID,
			ConnectorID:    connectorID,
			Provider:       connector.Provider,
			Direction:      IntegrationSyncInbound,
			Action:         "ingest_webhook",
			Status:         IntegrationAuditFailed,
			ResponseBody:   truncateForStorage(string(body), 8192),
			Attempt:        1,
			ErrorMessage:   safeErrorMessage(err),
			StartedAt:      started,
			CompletedAt:    &completed,
			IdempotencyKey: webhookIdempotencyKey(connectorID, integrationPayloadHash(body)),
		})
		return nil, err
	}
	hash := integrationPayloadHash(body)

	var result InboundWebhookResult
	err = s.runner.RunWithTenant(ctx, tenantID, func(tx DBTX) error {
		inserted, err := s.store.RegisterIntegrationWebhookEvent(ctx, tx, &IntegrationWebhookDedupeRecord{
			TenantID:        tenantID,
			ConnectorID:     connectorID,
			Provider:        connector.Provider,
			ExternalEventID: event.EventID,
			ExternalID:      event.ExternalID,
			PayloadHash:     hash,
			Status:          IntegrationAuditPending,
			ReceivedAt:      s.now(),
		})
		if err != nil {
			return err
		}
		if !inserted {
			var incidentIDPtr *uuid.UUID
			var linkIDPtr *uuid.UUID
			if link, linkErr := s.store.GetIntegrationLinkByExternal(ctx, tx, tenantID, connectorID, event.ExternalID); linkErr == nil {
				incidentIDPtr = &link.IncidentID
				linkIDPtr = &link.ID
				result.IncidentID = link.IncidentID
				result.LinkID = link.ID
			}
			completed := s.now()
			if err := s.store.RecordIntegrationSyncAudit(ctx, tx, &IntegrationSyncAudit{
				TenantID:        tenantID,
				ConnectorID:     connectorID,
				IncidentID:      incidentIDPtr,
				LinkID:          linkIDPtr,
				Provider:        connector.Provider,
				Direction:       IntegrationSyncInbound,
				Action:          "ingest_webhook",
				Status:          IntegrationAuditDuplicate,
				ExternalEventID: event.EventID,
				ExternalID:      event.ExternalID,
				IdempotencyKey:  webhookIdempotencyKey(connectorID, event.EventID),
				Attempt:         1,
				StartedAt:       started,
				CompletedAt:     &completed,
			}); err != nil {
				return err
			}
			result = InboundWebhookResult{
				IncidentID:      result.IncidentID,
				LinkID:          result.LinkID,
				ExternalEventID: event.EventID,
				ExternalID:      event.ExternalID,
				Duplicate:       true,
				Status:          IntegrationAuditDuplicate,
			}
			return nil
		}

		link, err := s.store.GetIntegrationLinkByExternal(ctx, tx, tenantID, connectorID, event.ExternalID)
		if err != nil {
			_ = s.store.MarkIntegrationWebhookEvent(ctx, tx, tenantID, connectorID, event.EventID, IntegrationAuditFailed, safeErrorMessage(err))
			return err
		}
		updated, err := s.store.ApplyInboundIncidentUpdate(ctx, tx, tenantID, link.IncidentID, event.Update)
		if err != nil {
			_ = s.store.MarkIntegrationWebhookEvent(ctx, tx, tenantID, connectorID, event.EventID, IntegrationAuditFailed, safeErrorMessage(err))
			return err
		}
		now := s.now()
		link.ExternalKey = firstNonEmptyString(event.ExternalKey, link.ExternalKey)
		link.ExternalURL = firstNonEmptyString(event.ExternalURL, link.ExternalURL)
		link.ExternalStatus = firstNonEmptyString(event.ExternalStatus, link.ExternalStatus)
		link.LastSyncedAt = &now
		link.LastSyncDirection = string(IntegrationSyncInbound)
		link.SyncError = ""
		if err := s.store.UpsertIntegrationLink(ctx, tx, link); err != nil {
			return err
		}
		if err := s.store.MarkIntegrationWebhookEvent(ctx, tx, tenantID, connectorID, event.EventID, IntegrationAuditSucceeded, ""); err != nil {
			return err
		}
		linkID := link.ID
		completed := s.now()
		if err := s.store.RecordIntegrationSyncAudit(ctx, tx, &IntegrationSyncAudit{
			TenantID:        tenantID,
			ConnectorID:     connectorID,
			IncidentID:      &updated.ID,
			LinkID:          &linkID,
			Provider:        connector.Provider,
			Direction:       IntegrationSyncInbound,
			Action:          "ingest_webhook",
			Status:          IntegrationAuditSucceeded,
			RequestPayload:  event.Raw,
			ExternalEventID: event.EventID,
			ExternalID:      event.ExternalID,
			IdempotencyKey:  webhookIdempotencyKey(connectorID, event.EventID),
			Attempt:         1,
			StartedAt:       started,
			CompletedAt:     &completed,
		}); err != nil {
			return err
		}
		result = InboundWebhookResult{
			IncidentID:      updated.ID,
			LinkID:          linkID,
			ExternalEventID: event.EventID,
			ExternalID:      event.ExternalID,
			Status:          IntegrationAuditSucceeded,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if result.Duplicate {
		_ = s.emitTimeline(ctx, tenantID, result.IncidentID, connector.CreatedBy, EventIntegrationWebhookIgnored, map[string]any{
			"connector_id":      connectorID.String(),
			"provider":          connector.Provider,
			"external_event_id": result.ExternalEventID,
			"external_id":       result.ExternalID,
			"duplicate_webhook": true,
		})
		return &result, ErrIntegrationDuplicateWebhook
	}
	_ = s.emitTimeline(ctx, tenantID, result.IncidentID, connector.CreatedBy, EventIntegrationInbound, map[string]any{
		"connector_id":      connectorID.String(),
		"provider":          connector.Provider,
		"external_event_id": result.ExternalEventID,
		"external_id":       result.ExternalID,
	})
	return &result, nil
}

func (s *RespondIntegrationService) loadConnectorConfig(ctx context.Context, tenantID, connectorID uuid.UUID) (*IntegrationConnector, ResolvedConnectorConfig, error) {
	var connector *IntegrationConnector
	var storedSecrets []IntegrationConnectorSecret
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		connector, storedSecrets, err = s.store.GetIntegrationConnectorWithSecrets(ctx, tx, tenantID, connectorID)
		return err
	})
	if err != nil {
		return nil, ResolvedConnectorConfig{}, err
	}
	if !connector.Enabled {
		return nil, ResolvedConnectorConfig{}, fmt.Errorf("connector is disabled: %w", ErrIntegrationConfig)
	}
	secrets, err := ResolveIntegrationSecrets(ctx, s.cipher, s.secretRefs, storedSecrets)
	if err != nil {
		return nil, ResolvedConnectorConfig{}, err
	}
	return connector, ResolvedConnectorConfig{Connector: connector, Secrets: secrets}, nil
}

func (s *RespondIntegrationService) loadITSMContext(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID) (*IntegrationConnector, ResolvedConnectorConfig, *Incident, *IntegrationExternalLink, error) {
	connector, cfg, err := s.loadConnectorConfig(ctx, tenantID, connectorID)
	if err != nil {
		return nil, ResolvedConnectorConfig{}, nil, nil, err
	}
	if connector.Kind != IntegrationKindITSM {
		return nil, ResolvedConnectorConfig{}, nil, nil, ErrIntegrationUnsupported
	}
	var incident *Incident
	var link *IntegrationExternalLink
	err = s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		incident, err = s.store.GetIncident(ctx, tx, tenantID, incidentID)
		if err != nil {
			return err
		}
		link, err = s.store.GetIntegrationLinkByIncidentConnector(ctx, tx, tenantID, incidentID, connectorID)
		if errors.Is(err, ErrIntegrationLinkNotFound) {
			link = nil
			return nil
		}
		return err
	})
	return connector, cfg, incident, link, err
}

func (s *RespondIntegrationService) loadCommsContext(ctx context.Context, tenantID, connectorID, incidentID uuid.UUID) (*IntegrationConnector, ResolvedConnectorConfig, *Incident, error) {
	connector, cfg, err := s.loadConnectorConfig(ctx, tenantID, connectorID)
	if err != nil {
		return nil, ResolvedConnectorConfig{}, nil, err
	}
	if connector.Kind != IntegrationKindComms {
		return nil, ResolvedConnectorConfig{}, nil, ErrIntegrationUnsupported
	}
	var incident *Incident
	err = s.runner.RunReadWithTenant(ctx, tenantID, func(tx DBTX) error {
		var err error
		incident, err = s.store.GetIncident(ctx, tx, tenantID, incidentID)
		return err
	})
	return connector, cfg, incident, err
}

func (s *RespondIntegrationService) recordAudit(ctx context.Context, audit IntegrationSyncAudit) error {
	if s.runner == nil {
		return nil
	}
	return s.runner.RunWithTenant(ctx, audit.TenantID, func(tx DBTX) error {
		return s.store.RecordIntegrationSyncAudit(ctx, tx, &audit)
	})
}

func (s *RespondIntegrationService) emitTimeline(ctx context.Context, tenantID, incidentID, actorID uuid.UUID, eventType string, payload map[string]any) error {
	if s.timeline == nil || incidentID == uuid.Nil {
		return nil
	}
	return s.timeline.EmitIntegrationTimeline(ctx, tenantID, incidentID, actorID, eventType, payload)
}

func auditStatusForError(err error) IntegrationAuditStatus {
	if err == nil {
		return IntegrationAuditSucceeded
	}
	if isRetryableIntegrationError(err) {
		return IntegrationAuditRetryScheduled
	}
	return IntegrationAuditFailed
}

func retryTimeForError(now func() time.Time, err error) *time.Time {
	if err == nil || !isRetryableIntegrationError(err) {
		return nil
	}
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	next := now().Add(time.Minute)
	return &next
}

func isRetryableIntegrationError(err error) bool {
	if err == nil {
		return false
	}
	var httpErr *IntegrationHTTPError
	if errors.As(err, &httpErr) {
		return httpErr.Retryable || httpErr.StatusCode == http.StatusTooManyRequests || httpErr.StatusCode >= http.StatusInternalServerError
	}
	var netErr net.Error
	return errors.As(err, &netErr) && (netErr.Timeout() || netErr.Temporary())
}

func safeErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	return truncateForStorage(err.Error(), 2048)
}

func outboundIdempotencyKey(connectorID, incidentID uuid.UUID, action string) string {
	sum := sha256.Sum256([]byte(connectorID.String() + ":" + incidentID.String() + ":" + strings.TrimSpace(action)))
	return hex.EncodeToString(sum[:])
}

func webhookIdempotencyKey(connectorID uuid.UUID, eventID any) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s:%v", connectorID, eventID)))
	return hex.EncodeToString(sum[:])
}

func integrationPayloadHash(body []byte) []byte {
	sum := sha256.Sum256(body)
	return sum[:]
}

func mapToJSONBytes(value any) ([]byte, error) {
	if value == nil {
		return []byte(`{}`), nil
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return raw, nil
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	case nil:
		return ""
	default:
		return strings.TrimSpace(fmt.Sprintf("%v", typed))
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func truncateForStorage(value string, max int) string {
	if max <= 0 || len(value) <= max {
		return value
	}
	return value[:max]
}
