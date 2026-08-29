package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var allowedServiceChannels = map[model.ServiceChannel]struct{}{
	model.ServiceChannelPlatform: {},
	model.ServiceChannelEmail:    {},
	model.ServiceChannelBoth:     {},
}

var allowedEligibilityRuleTypes = map[model.EligibilityRuleType]struct{}{
	model.EligibilityRuleAll:        {},
	model.EligibilityRuleDepartment: {},
	model.EligibilityRuleRole:       {},
	model.EligibilityRuleDoAMatrix:  {},
}

// ServiceCatalogService owns the admin-editable legal service catalog (CAP-001,
// CAP-005) and the CAP-008 eligibility evaluation. Eligibility resolution reads
// the org registry (org_entity_service) to derive the requester's department and
// role facts, then applies the pure predicates in eligibility.go.
type ServiceCatalogService struct {
	db        *pgxpool.Pool
	catalog   *repository.ServiceCatalogRepository
	orgs      *OrgEntityService
	publisher Publisher
	metrics   *metrics.Metrics
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
}

func NewServiceCatalogService(db *pgxpool.Pool, catalog *repository.ServiceCatalogRepository, orgs *OrgEntityService, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger) *ServiceCatalogService {
	return &ServiceCatalogService{
		db:        db,
		catalog:   catalog,
		orgs:      orgs,
		publisher: publisherOrNoop(publisher),
		metrics:   appMetrics,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-service-catalog").Logger(),
		now:       time.Now,
	}
}

func (s *ServiceCatalogService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateServiceCatalogRequest) (*model.ServiceCatalogEntry, error) {
	req.Normalize()
	if err := validateServiceCatalogCreate(req); err != nil {
		return nil, err
	}
	active := true
	if req.Active != nil {
		active = *req.Active
	}
	entry := &model.ServiceCatalogEntry{
		ID:                    uuid.New(),
		TenantID:              tenantID,
		Code:                  req.Code,
		RequestType:           req.RequestType,
		Name:                  req.Name,
		Description:           req.Description,
		AvailableTo:           req.AvailableTo,
		RequesterApprovalReqd: req.RequesterApprovalReqd,
		ProviderApprovalReqd:  req.ProviderApprovalReqd,
		ApprovalPolicyID:      req.ApprovalPolicyID,
		IntakeEmail:           req.IntakeEmail,
		Channel:               req.Channel,
		Active:                active,
		Metadata:              req.Metadata,
		CreatedBy:             userID,
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start service catalog transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.catalog.Create(ctx, tx, entry); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a service with this code or intake email already exists")
		}
		return nil, internalError("create service catalog entry", err)
	}
	if err := s.insertRules(ctx, tx, tenantID, userID, entry.ID, req.EligibilityRules); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		// A unique constraint enforced as a (deferred) CONSTRAINT rather than an
		// immediate index surfaces the 23505 at COMMIT, not at the INSERT. Route it
		// through the same conflict mapping as the insert so a duplicate code/intake
		// email deterministically returns 409 instead of a 500.
		if isUniqueViolation(err) {
			return nil, conflictError("a service with this code or intake email already exists")
		}
		return nil, internalError("commit service catalog create", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.service_catalog.created", tenantID, &userID, map[string]any{
		"id":           entry.ID,
		"code":         entry.Code,
		"request_type": entry.RequestType,
		"channel":      entry.Channel,
	}, s.logger)
	return s.Get(ctx, tenantID, entry.ID)
}

func (s *ServiceCatalogService) List(ctx context.Context, tenantID uuid.UUID, filters model.ServiceCatalogListFilters) ([]model.ServiceCatalogEntry, int, error) {
	return s.catalog.List(ctx, tenantID, filters)
}

func (s *ServiceCatalogService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.ServiceCatalogEntry, error) {
	entry, err := s.catalog.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("service not found")
		}
		return nil, internalError("load service catalog entry", err)
	}
	rules, err := s.catalog.ListRules(ctx, tenantID, id)
	if err != nil {
		return nil, internalError("load service eligibility rules", err)
	}
	entry.EligibilityRules = rules
	return entry, nil
}

func (s *ServiceCatalogService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateServiceCatalogRequest) (*model.ServiceCatalogEntry, error) {
	req.Normalize()
	entry, err := s.catalog.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("service not found")
		}
		return nil, internalError("load service catalog entry", err)
	}
	applyServiceCatalogUpdate(entry, req)
	if err := validateServiceCatalogEntry(entry); err != nil {
		return nil, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("start service catalog transaction", err)
	}
	defer tx.Rollback(ctx)
	if err := s.catalog.Update(ctx, tx, entry); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("a service with this code or intake email already exists")
		}
		if err == pgx.ErrNoRows {
			return nil, notFoundError("service not found")
		}
		return nil, internalError("update service catalog entry", err)
	}
	// A non-nil rule slice REPLACES the existing rule set (CAP-005).
	if req.EligibilityRules != nil {
		if err := s.catalog.DeleteRules(ctx, tx, tenantID, id); err != nil {
			return nil, internalError("clear service eligibility rules", err)
		}
		if err := s.insertRules(ctx, tx, tenantID, userID, id, req.EligibilityRules); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		// See Create: a deferred unique constraint reports the 23505 at COMMIT.
		if isUniqueViolation(err) {
			return nil, conflictError("a service with this code or intake email already exists")
		}
		return nil, internalError("commit service catalog update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.service_catalog.updated", tenantID, &userID, map[string]any{
		"id":   entry.ID,
		"code": entry.Code,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *ServiceCatalogService) Delete(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	if err := s.catalog.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("service not found")
		}
		return internalError("delete service catalog entry", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.service_catalog.deleted", tenantID, &userID, map[string]any{
		"id": id,
	}, s.logger)
	return nil
}

// CheckEligibility resolves the CAP-008 eligibility decision for a requester
// against a service. The requester's department and role facts are read from the
// org registry (when a beneficiary code is supplied), then the pure predicates
// in eligibility.go are applied.
func (s *ServiceCatalogService) CheckEligibility(ctx context.Context, tenantID, userID uuid.UUID, req dto.EligibilityCheckRequest) (*model.EligibilityDecision, error) {
	req.Normalize()
	if req.ServiceID == uuid.Nil {
		return nil, validationError("service_id is required", map[string]string{"service_id": "required"})
	}
	entry, err := s.Get(ctx, tenantID, req.ServiceID)
	if err != nil {
		return nil, err
	}
	requesterUserID := userID
	if req.RequesterUserID != nil && *req.RequesterUserID != uuid.Nil {
		requesterUserID = *req.RequesterUserID
	}
	input, err := resolveEligibilityInput(ctx, tenantID, s.orgs, requesterUserID, req.Department, req.BeneficiaryCode, nil, entry.EligibilityRules)
	if err != nil {
		return nil, err
	}
	decision := evaluateEligibility(entry, entry.EligibilityRules, input)
	return &decision, nil
}

func (s *ServiceCatalogService) insertRules(ctx context.Context, tx pgx.Tx, tenantID, userID, serviceID uuid.UUID, rules []dto.ServiceEligibilityRuleRequest) error {
	for _, ruleReq := range rules {
		if err := validateEligibilityRuleRequest(ruleReq); err != nil {
			return err
		}
		rule := &model.ServiceEligibilityRule{
			ID:        uuid.New(),
			TenantID:  tenantID,
			ServiceID: serviceID,
			RuleType:  ruleReq.RuleType,
			Value:     ruleReq.Value,
			CreatedBy: userID,
		}
		if err := s.catalog.InsertRule(ctx, tx, rule); err != nil {
			return internalError("insert service eligibility rule", err)
		}
	}
	return nil
}

func validateEligibilityRuleRequest(ruleReq dto.ServiceEligibilityRuleRequest) error {
	if _, ok := allowedEligibilityRuleTypes[ruleReq.RuleType]; !ok {
		return validationError("invalid eligibility rule type", map[string]string{"rule_type": "invalid"})
	}
	value := strings.TrimSpace(ruleReq.Value)
	switch ruleReq.RuleType {
	case model.EligibilityRuleAll:
		return nil
	case model.EligibilityRuleDepartment:
		if value == "" {
			return validationError("eligibility rule value is required", map[string]string{"value": "required"})
		}
	case model.EligibilityRuleRole:
		if value == "" {
			return validationError("eligibility rule value is required", map[string]string{"value": "required"})
		}
		if _, ok := allowedOrgRoleKeys[model.OrgRoleKey(value)]; !ok {
			return validationError("eligibility rule role is invalid", map[string]string{"value": "invalid_role_key"})
		}
	case model.EligibilityRuleDoAMatrix:
		if value != "" {
			if _, ok := allowedOrgRoleKeys[model.OrgRoleKey(value)]; !ok {
				return validationError("eligibility rule DoA role is invalid", map[string]string{"value": "invalid_role_key"})
			}
		}
	}
	return nil
}

func validateServiceCatalogCreate(req dto.CreateServiceCatalogRequest) error {
	if req.Code == "" {
		return validationError("code is required", map[string]string{"code": "required"})
	}
	if req.RequestType == "" {
		return validationError("request_type is required", map[string]string{"request_type": "required"})
	}
	if req.Name.IsEmpty() {
		return validationError("name is required in at least one locale", map[string]string{"name": "required"})
	}
	if _, ok := allowedServiceChannels[req.Channel]; !ok {
		return validationError("invalid channel", map[string]string{"channel": "invalid"})
	}
	if req.Channel.AcceptsEmail() && req.IntakeEmail == nil && !hasSharedIntakeMailbox(req.Metadata) {
		return validationError("intake_email is required for email-capable services", map[string]string{"intake_email": "required"})
	}
	return nil
}

func validateServiceCatalogEntry(entry *model.ServiceCatalogEntry) error {
	if strings.TrimSpace(entry.Code) == "" {
		return validationError("code is required", map[string]string{"code": "required"})
	}
	if strings.TrimSpace(entry.RequestType) == "" {
		return validationError("request_type is required", map[string]string{"request_type": "required"})
	}
	if entry.Name.IsEmpty() {
		return validationError("name is required in at least one locale", map[string]string{"name": "required"})
	}
	if _, ok := allowedServiceChannels[entry.Channel]; !ok {
		return validationError("invalid channel", map[string]string{"channel": "invalid"})
	}
	if entry.Channel.AcceptsEmail() && entry.IntakeEmail == nil && !hasSharedIntakeMailbox(entry.Metadata) {
		return validationError("intake_email is required for email-capable services", map[string]string{"intake_email": "required"})
	}
	return nil
}

// hasSharedIntakeMailbox supports catalogues where one departmental mailbox is
// intentionally shared by multiple services. The actual mailbox and its secret
// remain managed by legal_intake_mailboxes; this metadata value is the routing
// declaration used by the published service catalogue.
func hasSharedIntakeMailbox(metadata map[string]any) bool {
	if metadata == nil {
		return false
	}
	mailbox, ok := metadata["intake_mailbox"].(string)
	return ok && strings.TrimSpace(mailbox) != ""
}

func applyServiceCatalogUpdate(entry *model.ServiceCatalogEntry, req dto.UpdateServiceCatalogRequest) {
	if req.RequestType != nil {
		entry.RequestType = *req.RequestType
	}
	if req.Name != nil {
		entry.Name = *req.Name
	}
	if req.Description != nil {
		entry.Description = *req.Description
	}
	if req.AvailableTo != nil {
		entry.AvailableTo = req.AvailableTo
	}
	if req.RequesterApprovalReqd != nil {
		entry.RequesterApprovalReqd = *req.RequesterApprovalReqd
	}
	if req.ProviderApprovalReqd != nil {
		entry.ProviderApprovalReqd = *req.ProviderApprovalReqd
	}
	if req.ApprovalPolicyID != nil {
		entry.ApprovalPolicyID = req.ApprovalPolicyID
	}
	if req.IntakeEmail != nil {
		entry.IntakeEmail = req.IntakeEmail
	}
	if req.Channel != nil {
		entry.Channel = *req.Channel
	}
	if req.Active != nil {
		entry.Active = *req.Active
	}
	if req.Metadata != nil {
		entry.Metadata = req.Metadata
	}
}
