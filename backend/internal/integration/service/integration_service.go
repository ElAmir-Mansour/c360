package service

import (
	"context"
	"fmt"
	"strings"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/integration/connector"
	"github.com/clario360/platform/internal/integration/connector/adapters"
	"github.com/clario360/platform/internal/integration/dto"
	"github.com/clario360/platform/internal/integration/encryption"
	intmodel "github.com/clario360/platform/internal/integration/model"
	intrepo "github.com/clario360/platform/internal/integration/repository"
	"github.com/clario360/platform/internal/integration/service/jira"
	"github.com/clario360/platform/internal/integration/service/servicenow"
	"github.com/clario360/platform/internal/integration/service/slack"
	"github.com/clario360/platform/internal/integration/service/teams"
	"github.com/clario360/platform/internal/integration/service/webhook"
)

type IntegrationService struct {
	repo          *intrepo.IntegrationRepository
	deliveryRepo  *intrepo.DeliveryRepository
	ticketRepo    *intrepo.TicketLinkRepository
	encryptor     *encryption.ConfigEncryptor
	producer      *events.Producer
	logger        zerolog.Logger
	slackClient   *slack.Client
	teamsClient   *teams.Client
	jiraClient    *jira.Service
	snClient      *servicenow.Service
	webhookClient *webhook.Client
	registry      *connector.Registry
}

// NewIntegrationService builds the integration management service. registry is
// the shared connector.Registry built once in main.go (via
// adapters.BuildDefaultRegistry, from the SAME client instances passed here);
// Test dispatch flows through it. jiraClient/snClient are still required directly
// for the ticket-creation and force-sync paths (ForceSync / CreateJiraTicket /
// CreateServiceNowIncident) that read the originating entity via the client.
func NewIntegrationService(
	repo *intrepo.IntegrationRepository,
	deliveryRepo *intrepo.DeliveryRepository,
	ticketRepo *intrepo.TicketLinkRepository,
	encryptor *encryption.ConfigEncryptor,
	producer *events.Producer,
	registry *connector.Registry,
	slackClient *slack.Client,
	teamsClient *teams.Client,
	jiraClient *jira.Service,
	snClient *servicenow.Service,
	webhookClient *webhook.Client,
	logger zerolog.Logger,
) *IntegrationService {
	if registry == nil {
		registry = adapters.BuildDefaultRegistry(adapters.Clients{
			Slack:      slackClient,
			Teams:      teamsClient,
			Webhook:    webhookClient,
			Jira:       jiraClient,
			ServiceNow: snClient,
		})
	}
	return &IntegrationService{
		repo:          repo,
		deliveryRepo:  deliveryRepo,
		ticketRepo:    ticketRepo,
		encryptor:     encryptor,
		producer:      producer,
		slackClient:   slackClient,
		teamsClient:   teamsClient,
		jiraClient:    jiraClient,
		snClient:      snClient,
		webhookClient: webhookClient,
		registry:      registry,
		logger:        logger.With().Str("component", "integration_service").Logger(),
	}
}

func (s *IntegrationService) Create(ctx context.Context, tenantID, userID string, req *dto.CreateIntegrationRequest, actor *AuditActor) (*intmodel.Integration, error) {
	config, err := NormalizeAndValidateConfig(req.Type, req.Config)
	if err != nil {
		return nil, err
	}
	ciphertext, nonce, keyID, err := s.encryptor.Encrypt(config)
	if err != nil {
		return nil, err
	}

	integration := &intmodel.Integration{
		TenantID:        tenantID,
		Type:            req.Type,
		Name:            strings.TrimSpace(req.Name),
		Description:     strings.TrimSpace(req.Description),
		ConfigEncrypted: ciphertext,
		ConfigNonce:     nonce,
		ConfigKeyID:     keyID,
		Status:          intmodel.IntegrationStatusActive,
		EventFilters:    req.EventFilters,
		CreatedBy:       userID,
	}
	id, err := s.repo.Create(ctx, integration)
	if err != nil {
		return nil, err
	}
	integration.ID = id
	integration.SanitizedConfig = SanitizeConfig(config)

	publishIntegrationEvent(ctx, s.producer, "integration.created", tenantID, userID, map[string]any{
		"integration_id": id,
		"type":           req.Type,
		"name":           req.Name,
	})
	publishIntegrationAudit(ctx, s.producer, "integration.created", tenantID, actor, map[string]any{
		"integration_id": id,
		"type":           req.Type,
		"name":           req.Name,
	})
	return integration, nil
}

func (s *IntegrationService) CreateSetupPending(ctx context.Context, tenantID, userID string, typ intmodel.IntegrationType, name, description string, config map[string]any, actor *AuditActor) (*intmodel.Integration, error) {
	if config == nil {
		config = map[string]any{}
	}
	ciphertext, nonce, keyID, err := s.encryptor.Encrypt(config)
	if err != nil {
		return nil, err
	}

	integration := &intmodel.Integration{
		TenantID:        tenantID,
		Type:            typ,
		Name:            strings.TrimSpace(name),
		Description:     strings.TrimSpace(description),
		ConfigEncrypted: ciphertext,
		ConfigNonce:     nonce,
		ConfigKeyID:     keyID,
		Status:          intmodel.IntegrationStatusSetupPending,
		EventFilters:    []intmodel.EventFilter{},
		CreatedBy:       userID,
	}
	id, err := s.repo.Create(ctx, integration)
	if err != nil {
		return nil, err
	}
	integration.ID = id
	integration.SanitizedConfig = SanitizeConfig(config)

	publishIntegrationEvent(ctx, s.producer, "integration.created", tenantID, userID, map[string]any{
		"integration_id": id,
		"type":           typ,
		"name":           name,
		"status":         integration.Status,
	})
	publishIntegrationAudit(ctx, s.producer, "integration.created", tenantID, actor, map[string]any{
		"integration_id": id,
		"type":           typ,
		"name":           name,
		"status":         integration.Status,
	})
	return integration, nil
}

func (s *IntegrationService) List(ctx context.Context, tenantID string, query *dto.ListQuery) ([]intmodel.Integration, int, error) {
	items, total, err := s.repo.List(ctx, tenantID, query)
	if err != nil {
		return nil, 0, err
	}
	for idx := range items {
		config, err := s.encryptor.Decrypt(items[idx].ConfigEncrypted, items[idx].ConfigNonce)
		if err == nil {
			items[idx].SanitizedConfig = SanitizeConfig(config)
		}
	}
	return items, total, nil
}

func (s *IntegrationService) Get(ctx context.Context, tenantID, id string) (*intmodel.Integration, error) {
	item, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	config, err := s.encryptor.Decrypt(item.ConfigEncrypted, item.ConfigNonce)
	if err == nil {
		item.SanitizedConfig = SanitizeConfig(config)
	}
	return item, nil
}

func (s *IntegrationService) Update(ctx context.Context, tenantID, id string, req *dto.UpdateIntegrationRequest, actor *AuditActor) (*intmodel.Integration, error) {
	item, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	config, err := s.encryptor.Decrypt(item.ConfigEncrypted, item.ConfigNonce)
	if err != nil {
		return nil, err
	}

	if req.Name != nil {
		item.Name = strings.TrimSpace(*req.Name)
	}
	if req.Description != nil {
		item.Description = strings.TrimSpace(*req.Description)
	}
	if req.Config != nil {
		for key, value := range req.Config {
			config[key] = value
		}
	}
	if req.EventFilters != nil {
		item.EventFilters = req.EventFilters
	}

	if item.Status == intmodel.IntegrationStatusSetupPending {
		if validated, validateErr := NormalizeAndValidateConfig(item.Type, cloneConfig(config)); validateErr == nil {
			config = validated
			item.Status = intmodel.IntegrationStatusActive
			item.ErrorMessage = nil
			item.ErrorCount = 0
			item.LastErrorAt = nil
		}
	} else {
		config, err = NormalizeAndValidateConfig(item.Type, config)
		if err != nil {
			return nil, err
		}
	}
	ciphertext, nonce, keyID, err := s.encryptor.Encrypt(config)
	if err != nil {
		return nil, err
	}
	item.ConfigEncrypted = ciphertext
	item.ConfigNonce = nonce
	item.ConfigKeyID = keyID
	if err := s.repo.Update(ctx, item); err != nil {
		return nil, err
	}
	item.SanitizedConfig = SanitizeConfig(config)
	publishIntegrationEvent(ctx, s.producer, "integration.updated", tenantID, item.CreatedBy, map[string]any{"integration_id": id, "type": item.Type})
	publishIntegrationAudit(ctx, s.producer, "integration.updated", tenantID, actor, map[string]any{"integration_id": id, "type": item.Type})
	return item, nil
}

func (s *IntegrationService) Delete(ctx context.Context, tenantID, id string, actor *AuditActor) error {
	if err := s.repo.SoftDelete(ctx, tenantID, id); err != nil {
		return err
	}
	if err := s.deliveryRepo.CancelPendingByIntegration(ctx, tenantID, id); err != nil {
		return err
	}
	publishIntegrationEvent(ctx, s.producer, "integration.deleted", tenantID, "", map[string]any{"integration_id": id})
	publishIntegrationAudit(ctx, s.producer, "integration.deleted", tenantID, actor, map[string]any{"integration_id": id})
	return nil
}

func (s *IntegrationService) UpdateStatus(ctx context.Context, tenantID, id string, status intmodel.IntegrationStatus, actor *AuditActor) error {
	if err := s.repo.UpdateStatus(ctx, tenantID, id, status, nil); err != nil {
		return err
	}
	if status != intmodel.IntegrationStatusActive {
		if err := s.deliveryRepo.CancelPendingByIntegration(ctx, tenantID, id); err != nil {
			return err
		}
	}
	publishIntegrationEvent(ctx, s.producer, "integration.status_changed", tenantID, "", map[string]any{"integration_id": id, "new_status": status})
	publishIntegrationAudit(ctx, s.producer, "integration.status_changed", tenantID, actor, map[string]any{"integration_id": id, "new_status": status})
	return nil
}

func (s *IntegrationService) Test(ctx context.Context, tenantID, id string) (int, string, error) {
	item, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return 0, "", err
	}
	config, err := s.encryptor.Decrypt(item.ConfigEncrypted, item.ConfigNonce)
	if err != nil {
		return 0, "", err
	}

	if _, ok := s.registry.Get(string(item.Type)); !ok {
		return 0, "", fmt.Errorf("unsupported integration type")
	}
	// Carry the tenant ID for connectors whose test payload embeds it (webhook),
	// reproducing the legacy test-event construction exactly.
	testCtx := adapters.WithTenant(ctx, tenantID)
	res, err := s.registry.Test(testCtx, string(item.Type), config)
	return res.ResponseCode, res.ResponseBody, err
}

func (s *IntegrationService) ListDeliveries(ctx context.Context, tenantID, integrationID string, query *dto.DeliveryQuery) ([]intmodel.DeliveryRecord, int, error) {
	return s.deliveryRepo.ListByIntegration(ctx, tenantID, integrationID, query)
}

func (s *IntegrationService) RetryFailed(ctx context.Context, tenantID, integrationID string) (int, error) {
	return s.deliveryRepo.RetryFailedByIntegration(ctx, tenantID, integrationID)
}

func (s *IntegrationService) ListTicketLinks(ctx context.Context, tenantID string, query *dto.TicketLinkQuery) ([]intmodel.ExternalTicketLink, error) {
	return s.ticketRepo.List(ctx, tenantID, query)
}

func (s *IntegrationService) GetTicketLink(ctx context.Context, tenantID, linkID string) (*intmodel.ExternalTicketLink, error) {
	return s.ticketRepo.GetByID(ctx, tenantID, linkID)
}

func (s *IntegrationService) ForceSync(ctx context.Context, tenantID, linkID string) error {
	link, err := s.ticketRepo.GetByID(ctx, tenantID, linkID)
	if err != nil {
		return err
	}
	integration, err := s.repo.GetByID(ctx, tenantID, link.IntegrationID)
	if err != nil {
		return err
	}
	configMap, err := s.encryptor.Decrypt(integration.ConfigEncrypted, integration.ConfigNonce)
	if err != nil {
		return err
	}

	switch link.ExternalSystem {
	case "jira":
		var cfg intmodel.JiraConfig
		if err := DecodeInto(configMap, &cfg); err != nil {
			return err
		}
		return s.jiraClient.SyncLink(ctx, integration, cfg, link)
	case "servicenow":
		var cfg intmodel.ServiceNowConfig
		if err := DecodeInto(configMap, &cfg); err != nil {
			return err
		}
		return s.snClient.SyncLink(ctx, integration, cfg, link)
	default:
		return fmt.Errorf("unsupported external system %q", link.ExternalSystem)
	}
}

func (s *IntegrationService) CreateJiraTicket(ctx context.Context, tenantID, integrationID, entityType, entityID string, actor *AuditActor) (*intmodel.ExternalTicketLink, error) {
	integration, err := s.repo.GetByID(ctx, tenantID, integrationID)
	if err != nil {
		return nil, err
	}
	if integration.Type != intmodel.IntegrationTypeJira {
		return nil, fmt.Errorf("integration %s is not a jira integration", integrationID)
	}

	configMap, err := s.encryptor.Decrypt(integration.ConfigEncrypted, integration.ConfigNonce)
	if err != nil {
		return nil, err
	}
	var cfg intmodel.JiraConfig
	if err := DecodeInto(configMap, &cfg); err != nil {
		return nil, err
	}

	systemToken, err := s.jiraClient.ClarioToken(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	link, _, _, err := s.jiraClient.CreateFromEntity(ctx, integration, cfg, systemToken, entityType, entityID)
	if err != nil {
		return nil, err
	}

	publishIntegrationEvent(ctx, s.producer, "integration.ticket.created", tenantID, "", map[string]any{
		"integration_id":  integration.ID,
		"entity_type":     entityType,
		"entity_id":       entityID,
		"external_system": "jira",
		"external_key":    link.ExternalKey,
	})
	publishIntegrationAudit(ctx, s.producer, "integration.ticket.created", tenantID, actor, map[string]any{
		"integration_id":  integration.ID,
		"entity_type":     entityType,
		"entity_id":       entityID,
		"external_system": "jira",
		"external_key":    link.ExternalKey,
	})
	return link, nil
}

func (s *IntegrationService) CreateServiceNowIncident(ctx context.Context, tenantID, integrationID, entityType, entityID string, actor *AuditActor) (*intmodel.ExternalTicketLink, error) {
	integration, err := s.repo.GetByID(ctx, tenantID, integrationID)
	if err != nil {
		return nil, err
	}
	if integration.Type != intmodel.IntegrationTypeServiceNow {
		return nil, fmt.Errorf("integration %s is not a servicenow integration", integrationID)
	}

	configMap, err := s.encryptor.Decrypt(integration.ConfigEncrypted, integration.ConfigNonce)
	if err != nil {
		return nil, err
	}
	var cfg intmodel.ServiceNowConfig
	if err := DecodeInto(configMap, &cfg); err != nil {
		return nil, err
	}

	systemToken, err := s.snClient.ClarioToken(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	link, _, _, err := s.snClient.CreateFromEntity(ctx, integration, cfg, systemToken, entityType, entityID)
	if err != nil {
		return nil, err
	}

	publishIntegrationEvent(ctx, s.producer, "integration.ticket.created", tenantID, "", map[string]any{
		"integration_id":  integration.ID,
		"entity_type":     entityType,
		"entity_id":       entityID,
		"external_system": "servicenow",
		"external_key":    link.ExternalKey,
	})
	publishIntegrationAudit(ctx, s.producer, "integration.ticket.created", tenantID, actor, map[string]any{
		"integration_id":  integration.ID,
		"entity_type":     entityType,
		"entity_id":       entityID,
		"external_system": "servicenow",
		"external_key":    link.ExternalKey,
	})
	return link, nil
}

func (s *IntegrationService) FindActiveByType(
	ctx context.Context,
	typ intmodel.IntegrationType,
	matcher func(*intmodel.Integration, map[string]any) bool,
) (*intmodel.Integration, map[string]any, error) {
	items, err := s.repo.ListActiveByType(ctx, typ)
	if err != nil {
		return nil, nil, err
	}
	for idx := range items {
		config, err := s.encryptor.Decrypt(items[idx].ConfigEncrypted, items[idx].ConfigNonce)
		if err != nil {
			continue
		}
		if matcher == nil || matcher(&items[idx], config) {
			items[idx].SanitizedConfig = SanitizeConfig(config)
			return &items[idx], config, nil
		}
	}
	return nil, nil, fmt.Errorf("active %s integration not found", typ)
}

func cloneConfig(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	cloned := make(map[string]any, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}
