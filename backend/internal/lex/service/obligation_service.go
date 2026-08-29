package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/analyzer/llm"
	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/metrics"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

var allowedObligationTypes = map[model.ObligationType]struct{}{
	model.ObligationTypeContractual:        {},
	model.ObligationTypeRenewal:            {},
	model.ObligationTypeNotice:             {},
	model.ObligationTypePayment:            {},
	model.ObligationTypeDelivery:           {},
	model.ObligationTypeReporting:          {},
	model.ObligationTypeCompliance:         {},
	model.ObligationTypeCovenant:           {},
	model.ObligationTypeConditionPrecedent: {},
	model.ObligationTypeRegulatory:         {},
	model.ObligationTypeOther:              {},
}

var allowedObligationStatuses = map[model.ObligationStatus]struct{}{
	model.ObligationStatusOpen:       {},
	model.ObligationStatusInProgress: {},
	model.ObligationStatusBlocked:    {},
	model.ObligationStatusCompleted:  {},
	model.ObligationStatusWaived:     {},
	model.ObligationStatusCancelled:  {},
}

const (
	obligationReportDueSoonDays     = 30
	defaultReminderDispatchProvider = "local"
	defaultReminderDispatchLimit    = 100
	maxReminderDispatchLimit        = 500
)

type ObligationService struct {
	db          *pgxpool.Pool
	obligations *repository.ObligationRepository
	contracts   *repository.ContractRepository
	matters     *repository.MatterRepository
	publisher   Publisher
	metrics     *metrics.Metrics
	topic       string
	logger      zerolog.Logger
	now         func() time.Time
	enricher    *llm.Enricher // optional governed LLM enricher, may be nil
	dispatcher  ObligationReminderNotificationDispatcher
}

func NewObligationService(db *pgxpool.Pool, obligations *repository.ObligationRepository, contracts *repository.ContractRepository, matters *repository.MatterRepository, publisher Publisher, appMetrics *metrics.Metrics, topic string, logger zerolog.Logger, enricher *llm.Enricher) *ObligationService {
	return &ObligationService{
		db:          db,
		obligations: obligations,
		contracts:   contracts,
		matters:     matters,
		publisher:   publisherOrNoop(publisher),
		metrics:     appMetrics,
		topic:       topic,
		logger:      logger.With().Str("service", "lex-obligations").Logger(),
		now:         time.Now,
		enricher:    enricher,
		dispatcher:  DeterministicObligationReminderNotificationDispatcher{},
	}
}

func (s *ObligationService) SetReminderNotificationDispatcher(dispatcher ObligationReminderNotificationDispatcher) {
	if dispatcher == nil {
		s.dispatcher = DeterministicObligationReminderNotificationDispatcher{}
		return
	}
	s.dispatcher = dispatcher
}

type ObligationReminderNotificationDispatcher interface {
	DispatchObligationReminder(ctx context.Context, tenantID uuid.UUID, item model.ObligationNotificationOutboxItem, provider string, now time.Time) (*ObligationReminderProviderDispatch, error)
}

type ObligationReminderProviderDispatch struct {
	Status            model.ObligationNotificationOutboxStatus
	Provider          string
	ProviderStatus    string
	DeliveryStatus    string
	ProviderMessageID string
	ProviderMetadata  map[string]any
	ErrorMessage      string
}

type DeterministicObligationReminderNotificationDispatcher struct{}

func (DeterministicObligationReminderNotificationDispatcher) DispatchObligationReminder(_ context.Context, tenantID uuid.UUID, item model.ObligationNotificationOutboxItem, provider string, now time.Time) (*ObligationReminderProviderDispatch, error) {
	delivery := buildLocalReminderDeliveryAttempt(tenantID, item, provider, now)
	dispatch := &ObligationReminderProviderDispatch{
		Status:           delivery.Status,
		Provider:         delivery.Provider,
		ProviderMetadata: delivery.ProviderMetadata,
	}
	if delivery.ProviderMessageID != nil {
		dispatch.ProviderMessageID = *delivery.ProviderMessageID
	}
	if delivery.ErrorMessage != nil {
		dispatch.ErrorMessage = *delivery.ErrorMessage
	}
	if delivery.Status == model.ObligationNotificationOutboxSent {
		dispatch.ProviderStatus = "sent"
		dispatch.DeliveryStatus = "accepted"
	} else {
		dispatch.ProviderStatus = "failed"
		dispatch.DeliveryStatus = "failed"
	}
	return dispatch, nil
}

func (s *ObligationService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateObligationRequest) (*model.Obligation, error) {
	req.Normalize()
	if err := validateObligationCreate(req); err != nil {
		return nil, err
	}
	if err := s.validateObligationLinks(ctx, tenantID, req.ContractID, req.MatterID); err != nil {
		return nil, err
	}
	obligation := &model.Obligation{
		ID:                 uuid.New(),
		TenantID:           tenantID,
		Title:              req.Title,
		Description:        req.Description,
		Type:               req.Type,
		Status:             req.Status,
		Priority:           req.Priority,
		ContractID:         req.ContractID,
		MatterID:           req.MatterID,
		ClauseID:           req.ClauseID,
		OwnerUserID:        req.OwnerUserID,
		OwnerName:          req.OwnerName,
		DueDate:            normalizeDate(req.DueDate),
		ReminderEnabled:    req.ReminderEnabled,
		ReminderLeadDays:   normalizeLeadDays(req.ReminderLeadDays),
		EscalationEnabled:  req.EscalationEnabled,
		EscalationLeadDays: normalizeLeadDays(req.EscalationLeadDays),
		EscalationTarget:   normalizeOptionalString(req.EscalationTarget),
		Tags:               req.Tags,
		Metadata:           req.Metadata,
		CreatedBy:          userID,
	}
	if obligation.Status == model.ObligationStatusCompleted {
		completedAt := s.now().UTC()
		obligation.CompletedAt = &completedAt
	}
	if err := s.obligations.Create(ctx, s.db, obligation); err != nil {
		return nil, internalError("create obligation", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligation.created", tenantID, &userID, map[string]any{
		"id":            obligation.ID,
		"title":         obligation.Title,
		"status":        obligation.Status,
		"due_date":      obligation.DueDate,
		"owner_user_id": obligation.OwnerUserID,
		"contract_id":   obligation.ContractID,
		"matter_id":     obligation.MatterID,
	}, s.logger)
	return s.Get(ctx, tenantID, obligation.ID)
}

func (s *ObligationService) List(ctx context.Context, tenantID uuid.UUID, filters model.ObligationListFilters) ([]model.Obligation, int, error) {
	return s.obligations.List(ctx, tenantID, filters)
}

func (s *ObligationService) ObligationReport(ctx context.Context, tenantID uuid.UUID, filters model.ObligationListFilters) (*model.ObligationReport, error) {
	filters.Page = 1
	if filters.PerPage <= 0 || filters.PerPage > 1000 {
		filters.PerPage = 1000
	}
	items, total, err := s.obligations.List(ctx, tenantID, filters)
	if err != nil {
		return nil, internalError("list report obligations", err)
	}
	return buildObligationReport(items, total, filters, s.now().UTC()), nil
}

func (s *ObligationService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.Obligation, error) {
	obligation, err := s.obligations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("obligation not found")
		}
		return nil, internalError("load obligation", err)
	}
	return obligation, nil
}

func (s *ObligationService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateObligationRequest) (*model.Obligation, error) {
	obligation, err := s.obligations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("obligation not found")
		}
		return nil, internalError("load obligation", err)
	}
	applyObligationUpdate(obligation, req, s.now().UTC())
	if err := validateObligation(obligation); err != nil {
		return nil, err
	}
	if err := s.validateObligationLinks(ctx, tenantID, obligation.ContractID, obligation.MatterID); err != nil {
		return nil, err
	}
	if err := s.obligations.Update(ctx, s.db, obligation); err != nil {
		return nil, internalError("update obligation", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligation.updated", tenantID, &userID, map[string]any{
		"id":       obligation.ID,
		"status":   obligation.Status,
		"due_date": obligation.DueDate,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *ObligationService) UpdateStatus(ctx context.Context, tenantID, userID, id uuid.UUID, status model.ObligationStatus) (*model.Obligation, error) {
	if _, ok := allowedObligationStatuses[status]; !ok {
		return nil, validationError("invalid obligation status", map[string]string{"status": "invalid"})
	}
	if _, err := s.obligations.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("obligation not found")
		}
		return nil, internalError("load obligation", err)
	}
	var completedAt *time.Time
	if status == model.ObligationStatusCompleted {
		value := s.now().UTC()
		completedAt = &value
	}
	if err := s.obligations.UpdateStatus(ctx, s.db, tenantID, id, status, completedAt); err != nil {
		return nil, internalError("update obligation status", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligation.status_changed", tenantID, &userID, map[string]any{
		"id":     id,
		"status": status,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *ObligationService) Delete(ctx context.Context, tenantID, id uuid.UUID) error {
	if err := s.obligations.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("obligation not found")
		}
		return internalError("delete obligation", err)
	}
	return nil
}

func (s *ObligationService) ExtractFromContract(ctx context.Context, tenantID, userID, contractID uuid.UUID, req dto.ExtractObligationsRequest) (*model.ObligationExtractionResult, error) {
	req.Normalize()
	if err := validateExtractionRequest(req); err != nil {
		return nil, err
	}
	contract, err := s.contracts.Get(ctx, tenantID, contractID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("contract not found")
		}
		return nil, internalError("load extraction contract", err)
	}
	if req.MatterID != nil {
		if err := s.validateExtractionMatterLink(ctx, tenantID, contractID, *req.MatterID); err != nil {
			return nil, err
		}
	}

	committedAt := s.now().UTC()
	detItems := buildExtractionItems(contract, req)
	strategy := "payload_or_contract_metadata_plus_renewal_dates"
	items := detItems
	// Hybrid LLM enrichment: governed, tenant-scoped, additive. On ANY error
	// (disabled, governance-unavailable, timeout, provider error, decode error)
	// keep the deterministic items unchanged.
	if s.enricher != nil && strings.TrimSpace(contract.DocumentText) != "" {
		if llmItems, lerr := s.enricher.SuggestObligations(ctx, tenantID, contract, contract.DocumentText, detItems); lerr == nil {
			merged := llm.MergeObligations(detItems, llmItems)
			if len(merged) > len(detItems) {
				items = merged
				strategy = "hybrid_llm_enriched"
			}
		} else {
			s.logger.Debug().Err(lerr).Str("contract_id", contractID.String()).Msg("llm obligation enrichment fell back to deterministic items")
		}
	}
	drafts, skipped := draftsFromItems(contract, req, items, committedAt)
	if len(drafts) == 0 && len(skipped) == 0 {
		return nil, validationError("no obligation extraction candidates supplied", map[string]string{"items": "required"})
	}

	created := make([]model.Obligation, 0, len(drafts))
	for _, draft := range drafts {
		obligation, err := s.Create(ctx, tenantID, userID, draft)
		if err != nil {
			return nil, err
		}
		created = append(created, *obligation)
	}
	planned := planNotificationEvents(created, normalizeDate(committedAt), 30, true)
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligations.extracted", tenantID, &userID, map[string]any{
		"contract_id":   contractID,
		"matter_id":     req.MatterID,
		"created_count": len(created),
		"skipped_count": len(skipped),
	}, s.logger)
	return &model.ObligationExtractionResult{
		ContractID:            contractID,
		CreatedCount:          len(created),
		Created:               created,
		Skipped:               skipped,
		PlannedNotifications:  planned,
		CommittedAt:           committedAt,
		DeterministicStrategy: strategy,
	}, nil
}

func (s *ObligationService) PlanNotifications(ctx context.Context, tenantID uuid.UUID, asOf time.Time, horizonDays int, includeEscalations bool) (*model.ObligationReminderPlan, error) {
	if asOf.IsZero() {
		asOf = s.now().UTC()
	}
	if horizonDays < 0 || horizonDays > 365 {
		return nil, validationError("horizon_days must be between 0 and 365", map[string]string{"horizon_days": "invalid"})
	}
	asOf = normalizeDate(asOf)
	candidates, err := s.obligations.ListNotificationCandidates(ctx, tenantID, asOf, horizonDays)
	if err != nil {
		return nil, internalError("list obligation notification candidates", err)
	}
	events := planNotificationEvents(candidates, asOf, horizonDays, includeEscalations)
	return &model.ObligationReminderPlan{
		AsOf:        asOf,
		HorizonDays: horizonDays,
		Total:       len(events),
		Events:      events,
	}, nil
}

func (s *ObligationService) EnqueueDueReminderOutbox(ctx context.Context, tenantID, userID uuid.UUID, req dto.EnqueueObligationRemindersRequest) (*model.ObligationReminderEnqueueResult, error) {
	req.Normalize()
	asOf := s.now().UTC()
	if req.AsOf != nil {
		asOf = req.AsOf.UTC()
	}
	horizonDays := 30
	if req.HorizonDays != nil {
		horizonDays = *req.HorizonDays
	}
	includeEscalations := true
	if req.IncludeEscalations != nil {
		includeEscalations = *req.IncludeEscalations
	}
	channels, err := normalizeNotificationChannels(req.Channels)
	if err != nil {
		return nil, err
	}
	plan, err := s.PlanNotifications(ctx, tenantID, asOf, horizonDays, includeEscalations)
	if err != nil {
		return nil, err
	}
	drafts := outboxItemsFromNotificationEvents(tenantID, userID, plan.Events, channels)
	result := &model.ObligationReminderEnqueueResult{
		Plan:           *plan,
		RequestedCount: len(drafts),
		Queued:         []model.ObligationNotificationOutboxItem{},
	}
	if len(drafts) == 0 {
		return result, nil
	}
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin obligation reminder enqueue", err)
	}
	defer tx.Rollback(ctx)

	queued, skipped, err := s.obligations.EnqueueNotificationOutboxItems(ctx, tx, drafts)
	if err != nil {
		return nil, internalError("enqueue obligation reminder outbox", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit obligation reminder enqueue", err)
	}
	result.Queued = queued
	result.QueuedCount = len(queued)
	result.SkippedDuplicateCount = skipped
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligation_reminders.enqueued", tenantID, &userID, map[string]any{
		"planned_count":           plan.Total,
		"requested_count":         result.RequestedCount,
		"queued_count":            result.QueuedCount,
		"skipped_duplicate_count": result.SkippedDuplicateCount,
		"channels":                channels,
		"as_of":                   plan.AsOf,
		"horizon_days":            plan.HorizonDays,
		"include_escalations":     includeEscalations,
	}, s.logger)
	return result, nil
}

func (s *ObligationService) MarkReminderDelivery(ctx context.Context, tenantID, userID, outboxID uuid.UUID, req dto.MarkObligationReminderDeliveryRequest) (*model.ObligationNotificationOutboxItem, error) {
	req.Normalize()
	if err := validateObligationReminderDeliveryRequest(req); err != nil {
		return nil, err
	}
	attemptedAt := s.now().UTC()
	if req.AttemptedAt != nil {
		attemptedAt = req.AttemptedAt.UTC()
	}
	providerMessageID := normalizeOptionalString(&req.ProviderMessageID)
	errorMessage := normalizeOptionalString(&req.ErrorMessage)

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin obligation reminder delivery update", err)
	}
	defer tx.Rollback(ctx)

	item, err := s.obligations.MarkNotificationOutboxDelivery(ctx, tx, tenantID, outboxID, req.Status, attemptedAt, req.Provider, providerMessageID, req.ProviderMetadata, errorMessage)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("obligation reminder outbox item not found")
		}
		return nil, internalError("mark obligation reminder delivery", err)
	}
	if req.Status == model.ObligationNotificationOutboxSent {
		if err := s.obligations.MarkReminderSent(ctx, tx, tenantID, item.ObligationID, attemptedAt); err != nil {
			if err == pgx.ErrNoRows {
				return nil, notFoundError("obligation not found")
			}
			return nil, internalError("mark obligation reminder sent", err)
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit obligation reminder delivery update", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligation_reminder.delivery_recorded", tenantID, &userID, map[string]any{
		"outbox_id":           outboxID,
		"obligation_id":       item.ObligationID,
		"status":              req.Status,
		"channel":             item.Channel,
		"provider":            req.Provider,
		"provider_message_id": providerMessageID,
		"attempted_at":        attemptedAt,
	}, s.logger)
	return item, nil
}

func (s *ObligationService) DispatchReminderOutbox(ctx context.Context, tenantID, userID uuid.UUID, req dto.DispatchObligationReminderOutboxRequest) (*model.ObligationReminderDispatchResult, error) {
	req.Normalize()
	limit, err := normalizeReminderDispatchLimit(req.Limit)
	if err != nil {
		return nil, err
	}
	asOf := s.now().UTC()
	if req.AsOf != nil {
		asOf = req.AsOf.UTC()
	}
	provider := normalizeReminderDispatchProvider(req.Provider)

	items, err := s.obligations.ListNotificationOutboxDispatchCandidates(ctx, tenantID, asOf, limit, req.Retry)
	if err != nil {
		return nil, internalError("list obligation reminder outbox dispatch candidates", err)
	}
	result, err := s.dispatchReminderOutboxItems(ctx, tenantID, userID, provider, req.Retry, items)
	if err != nil {
		return nil, err
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligation_reminder.dispatch_completed", tenantID, &userID, map[string]any{
		"provider":         result.Provider,
		"retry":            result.Retry,
		"requested_count":  result.RequestedCount,
		"dispatched_count": result.DispatchedCount,
		"sent_count":       result.SentCount,
		"failed_count":     result.FailedCount,
		"skipped_count":    result.SkippedCount,
	}, s.logger)
	return result, nil
}

func (s *ObligationService) DispatchReminderOutboxItem(ctx context.Context, tenantID, userID, outboxID uuid.UUID, req dto.DispatchObligationReminderOutboxRequest) (*model.ObligationReminderDispatchResult, error) {
	req.Normalize()
	provider := normalizeReminderDispatchProvider(req.Provider)
	item, err := s.obligations.GetNotificationOutboxItem(ctx, tenantID, outboxID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("obligation reminder outbox item not found")
		}
		return nil, internalError("load obligation reminder outbox item", err)
	}
	return s.dispatchReminderOutboxItems(ctx, tenantID, userID, provider, req.Retry, []model.ObligationNotificationOutboxItem{*item})
}

func (s *ObligationService) dispatchReminderOutboxItems(ctx context.Context, tenantID, userID uuid.UUID, provider string, retry bool, items []model.ObligationNotificationOutboxItem) (*model.ObligationReminderDispatchResult, error) {
	result := &model.ObligationReminderDispatchResult{
		Provider:       provider,
		Retry:          retry,
		RequestedCount: len(items),
		Attempts:       []model.ObligationReminderDispatchAttempt{},
	}
	for _, item := range items {
		attempt, err := s.dispatchReminderOutboxItem(ctx, tenantID, userID, provider, retry, item)
		if err != nil {
			return nil, err
		}
		result.Attempts = append(result.Attempts, attempt)
		switch {
		case attempt.SkippedReason != "":
			result.SkippedCount++
		case attempt.Status == model.ObligationNotificationOutboxSent:
			result.DispatchedCount++
			result.SentCount++
		case attempt.Status == model.ObligationNotificationOutboxFailed:
			result.DispatchedCount++
			result.FailedCount++
		}
	}
	return result, nil
}

func (s *ObligationService) dispatchReminderOutboxItem(ctx context.Context, tenantID, userID uuid.UUID, provider string, retry bool, item model.ObligationNotificationOutboxItem) (model.ObligationReminderDispatchAttempt, error) {
	attempt := model.ObligationReminderDispatchAttempt{
		OutboxID:       item.ID,
		ObligationID:   item.ObligationID,
		Channel:        item.Channel,
		PreviousStatus: item.Status,
		Status:         item.Status,
		Provider:       provider,
	}
	if reason := reminderDispatchSkipReason(item.Status, retry); reason != "" {
		attempt.SkippedReason = reason
		return attempt, nil
	}

	delivery := s.dispatchObligationReminder(ctx, tenantID, item, provider, s.now().UTC())
	req := dto.MarkObligationReminderDeliveryRequest{
		Status:           delivery.Status,
		AttemptedAt:      &delivery.AttemptedAt,
		Provider:         delivery.Provider,
		ProviderMetadata: delivery.ProviderMetadata,
	}
	if delivery.ProviderMessageID != nil {
		req.ProviderMessageID = *delivery.ProviderMessageID
	}
	if delivery.ErrorMessage != nil {
		req.ErrorMessage = *delivery.ErrorMessage
	}
	recorded, err := s.MarkReminderDelivery(ctx, tenantID, userID, item.ID, req)
	if err != nil {
		return model.ObligationReminderDispatchAttempt{}, err
	}
	attempt.Status = recorded.Status
	attempt.Provider = recorded.Provider
	attempt.ProviderMessageID = recorded.ProviderMessageID
	attempt.ProviderMetadata = recorded.ProviderMetadata
	attempt.ErrorMessage = recorded.ErrorMessage
	attempt.Item = recorded
	return attempt, nil
}

func (s *ObligationService) dispatchObligationReminder(ctx context.Context, tenantID uuid.UUID, item model.ObligationNotificationOutboxItem, provider string, attemptedAt time.Time) localReminderDeliveryAttempt {
	dispatcher := s.dispatcher
	if dispatcher == nil {
		dispatcher = DeterministicObligationReminderNotificationDispatcher{}
	}
	provider = normalizeReminderDispatchProvider(provider)
	attemptedAt = attemptedAt.UTC()
	dispatch, err := dispatcher.DispatchObligationReminder(ctx, tenantID, item, provider, attemptedAt)
	if err != nil {
		return failClosedReminderProviderAttempt(provider, item, attemptedAt, "reminder notification dispatch failed", map[string]any{
			"provider_error": err.Error(),
		})
	}
	return providerDispatchDeliveryAttempt(provider, item, attemptedAt, dispatch)
}

func (s *ObligationService) MarkReminderSent(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.MarkObligationReminderSentRequest) (*model.Obligation, error) {
	req.Normalize()
	obligation, err := s.obligations.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("obligation not found")
		}
		return nil, internalError("load obligation", err)
	}
	if req.EventType == "" {
		req.EventType = model.ObligationNotificationReminder
	}
	if req.EventType != model.ObligationNotificationReminder && req.EventType != model.ObligationNotificationEscalation {
		return nil, validationError("invalid reminder event type", map[string]string{"event_type": "invalid"})
	}
	if req.LeadDays < 0 || req.LeadDays > 3650 {
		return nil, validationError("lead_days must be between 0 and 3650", map[string]string{"lead_days": "invalid"})
	}
	channel, err := normalizeSingleNotificationChannel(req.Channel, model.ObligationNotificationChannelEmail)
	if err != nil {
		return nil, err
	}
	sentAt := s.now().UTC()
	if req.SentAt != nil {
		sentAt = req.SentAt.UTC()
	}
	scheduledAt := normalizeDate(sentAt)
	if req.ScheduledAt != nil {
		scheduledAt = normalizeDate(*req.ScheduledAt)
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, internalError("begin mark obligation reminder sent", err)
	}
	defer tx.Rollback(ctx)

	if err := s.obligations.MarkReminderSent(ctx, tx, tenantID, id, sentAt); err != nil {
		return nil, internalError("mark obligation reminder sent", err)
	}
	outboxItem := manualReminderSentOutboxItem(tenantID, userID, *obligation, req, channel, scheduledAt, sentAt)
	if _, err := s.obligations.MarkNotificationOutboxSentForReminder(ctx, tx, outboxItem); err != nil {
		return nil, internalError("record obligation reminder outbox sent", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, internalError("commit mark obligation reminder sent", err)
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.obligation.notification_marked_sent", tenantID, &userID, map[string]any{
		"id":         id,
		"type":       req.EventType,
		"lead_days":  req.LeadDays,
		"channel":    channel,
		"sent_at":    sentAt,
		"due_date":   obligation.DueDate,
		"owner_name": obligation.OwnerName,
	}, s.logger)
	return s.Get(ctx, tenantID, id)
}

func (s *ObligationService) validateObligationLinks(ctx context.Context, tenantID uuid.UUID, contractID, matterID *uuid.UUID) error {
	if contractID == nil && matterID == nil {
		return validationError("contract_id or matter_id is required", map[string]string{"contract_id": "required_without_matter_id", "matter_id": "required_without_contract_id"})
	}
	if contractID != nil {
		if _, err := s.contracts.Get(ctx, tenantID, *contractID); err != nil {
			if err == pgx.ErrNoRows {
				return validationError("linked contract not found", map[string]string{"contract_id": "not found"})
			}
			return internalError("load linked contract", err)
		}
	}
	if matterID != nil {
		if _, err := s.matters.Get(ctx, tenantID, *matterID); err != nil {
			if err == pgx.ErrNoRows {
				return validationError("linked matter not found", map[string]string{"matter_id": "not found"})
			}
			return internalError("load linked matter", err)
		}
	}
	return nil
}

func (s *ObligationService) validateExtractionMatterLink(ctx context.Context, tenantID, contractID, matterID uuid.UUID) error {
	if _, err := s.matters.Get(ctx, tenantID, matterID); err != nil {
		if err == pgx.ErrNoRows {
			return validationError("linked matter not found", map[string]string{"matter_id": "not found"})
		}
		return internalError("load linked matter", err)
	}
	linked, err := s.matters.HasContractLink(ctx, tenantID, matterID, contractID)
	if err != nil {
		return internalError("check matter contract link", err)
	}
	return validateMatterExtractionLink(&matterID, linked)
}

func validateExtractionRequest(req dto.ExtractObligationsRequest) error {
	if req.OwnerUserID == uuid.Nil {
		return validationError("owner_user_id is required", map[string]string{"owner_user_id": "required"})
	}
	if req.OwnerName == "" {
		return validationError("owner_name is required", map[string]string{"owner_name": "required"})
	}
	if err := validateLeadDays(req.DefaultReminderLeadDays, req.DefaultEscalationLeadDays); err != nil {
		return err
	}
	for i, item := range req.Items {
		if err := validateLeadDays(item.ReminderLeadDays, item.EscalationLeadDays); err != nil {
			return validationError("invalid extraction lead days", map[string]string{fmt.Sprintf("items[%d].lead_days", i): "invalid"})
		}
	}
	return nil
}

func validateMatterExtractionLink(matterID *uuid.UUID, linked bool) error {
	if matterID == nil {
		return nil
	}
	if !linked {
		return validationError("matter is not linked to contract", map[string]string{"matter_id": "not linked to contract"})
	}
	return nil
}

// buildExtractionItems assembles the deterministic obligation extraction items
// from the request payload, contract metadata, and renewal dates. It is the
// single source of items so the LLM enricher can merge against the same set.
func buildExtractionItems(contract *model.Contract, req dto.ExtractObligationsRequest) []dto.ObligationExtractionItem {
	items := make([]dto.ObligationExtractionItem, 0, len(req.Items)+2)
	items = append(items, req.Items...)
	if len(items) == 0 {
		items = append(items, extractionItemsFromMetadata(contract.Metadata)...)
	}
	if includeContractRenewal(req) {
		if item, ok := renewalExtractionItem(contract); ok {
			items = append(items, item)
		}
	}
	return items
}

// draftsFromItems maps each extraction item through extractionDraft, collecting
// valid drafts and skips. Malformed LLM rows (missing title/due_date) end up in
// skipped, not created.
func draftsFromItems(contract *model.Contract, req dto.ExtractObligationsRequest, items []dto.ObligationExtractionItem, now time.Time) ([]dto.CreateObligationRequest, []model.ObligationExtractionSkip) {
	drafts := make([]dto.CreateObligationRequest, 0, len(items))
	skipped := make([]model.ObligationExtractionSkip, 0)
	for _, item := range items {
		item.Normalize()
		draft, skip, ok := extractionDraft(contract, req, item, now)
		if !ok {
			skipped = append(skipped, skip)
			continue
		}
		drafts = append(drafts, draft)
	}
	return drafts, skipped
}

func buildExtractionDrafts(contract *model.Contract, req dto.ExtractObligationsRequest, now time.Time) ([]dto.CreateObligationRequest, []model.ObligationExtractionSkip) {
	items := buildExtractionItems(contract, req)
	return draftsFromItems(contract, req, items, now)
}

func extractionDraft(contract *model.Contract, req dto.ExtractObligationsRequest, item dto.ObligationExtractionItem, now time.Time) (dto.CreateObligationRequest, model.ObligationExtractionSkip, bool) {
	source := item.Source
	if source == "" {
		source = "payload"
	}
	skip := model.ObligationExtractionSkip{Source: source, Title: item.Title}
	if item.Title == "" {
		skip.Reason = "title is required"
		return dto.CreateObligationRequest{}, skip, false
	}
	if item.DueDate == nil || item.DueDate.IsZero() {
		skip.Reason = "due_date is required"
		return dto.CreateObligationRequest{}, skip, false
	}

	contractID := contract.ID
	reminderLeadDays := normalizeLeadDays(firstNonEmptyIntSlice(item.ReminderLeadDays, req.DefaultReminderLeadDays, []int{30, 7, 1}))
	escalationLeadDays := normalizeLeadDays(firstNonEmptyIntSlice(item.EscalationLeadDays, req.DefaultEscalationLeadDays))
	reminderEnabled := true
	if item.ReminderEnabled != nil {
		reminderEnabled = *item.ReminderEnabled
	}
	escalationTarget := normalizeOptionalString(firstNonNilString(item.EscalationTarget, req.DefaultEscalationTarget))
	escalationEnabled := escalationTarget != nil || len(escalationLeadDays) > 0
	if item.EscalationEnabled != nil {
		escalationEnabled = *item.EscalationEnabled
	}
	if escalationEnabled && len(escalationLeadDays) == 0 {
		escalationLeadDays = []int{7, 1}
	}
	metadata := mergeMetadata(req.Metadata, item.Metadata)
	deterministic := item.Source != "llm"
	strategy := "payload_or_contract_metadata_plus_renewal_dates"
	if !deterministic {
		strategy = "hybrid_llm_enriched"
	}
	extraction := map[string]any{
		"source":              source,
		"source_reference":    item.SourceReference,
		"contract_id":         contract.ID.String(),
		"contract_version":    contract.CurrentVersion,
		"deterministic":       deterministic,
		"extracted_at":        now.UTC(),
		"extraction_strategy": strategy,
	}
	// Preserve any LLM confidence already stamped onto the item by the merge step.
	if existing, ok := item.Metadata["extraction"].(map[string]any); ok {
		if conf, ok := existing["llm_confidence"]; ok {
			extraction["llm_confidence"] = conf
		}
	}
	metadata["extraction"] = extraction
	tags := mergeTags(req.Tags, item.Tags, []string{"extracted"})

	draft := dto.CreateObligationRequest{
		Title:              item.Title,
		Description:        item.Description,
		Type:               item.Type,
		Status:             model.ObligationStatusOpen,
		Priority:           item.Priority,
		ContractID:         &contractID,
		MatterID:           req.MatterID,
		ClauseID:           item.ClauseID,
		OwnerUserID:        req.OwnerUserID,
		OwnerName:          req.OwnerName,
		DueDate:            normalizeDate(*item.DueDate),
		ReminderEnabled:    reminderEnabled,
		ReminderLeadDays:   reminderLeadDays,
		EscalationEnabled:  escalationEnabled,
		EscalationLeadDays: escalationLeadDays,
		EscalationTarget:   escalationTarget,
		Tags:               tags,
		Metadata:           metadata,
	}
	draft.Normalize()
	return draft, model.ObligationExtractionSkip{}, true
}

func includeContractRenewal(req dto.ExtractObligationsRequest) bool {
	return req.IncludeContractRenewal == nil || *req.IncludeContractRenewal
}

func renewalExtractionItem(contract *model.Contract) (dto.ObligationExtractionItem, bool) {
	var dueDate *time.Time
	sourceReference := "renewal_date"
	if contract.RenewalDate != nil {
		normalized := normalizeDate(*contract.RenewalDate)
		dueDate = &normalized
	} else if contract.ExpiryDate != nil {
		noticeDays := contract.RenewalNoticeDays
		normalized := normalizeDate(*contract.ExpiryDate)
		if noticeDays > 0 {
			normalized = normalized.AddDate(0, 0, -noticeDays)
			sourceReference = "expiry_date_minus_renewal_notice_days"
		} else {
			sourceReference = "expiry_date"
		}
		dueDate = &normalized
	}
	if dueDate == nil {
		return dto.ObligationExtractionItem{}, false
	}
	priority := model.LegalPriorityMedium
	if contract.AutoRenew {
		priority = model.LegalPriorityHigh
	}
	return dto.ObligationExtractionItem{
		Title:           fmt.Sprintf("مراجعة إشعار تجديد العقد «%s»", contract.Title),
		Description:     "التزام تجديد مُولَّد تلقائيًا من بيانات تجديد العقد.",
		Type:            model.ObligationTypeRenewal,
		Priority:        priority,
		DueDate:         dueDate,
		Source:          "contract_renewal_metadata",
		SourceReference: sourceReference,
		Tags:            []string{"renewal", "early-warning"},
		Metadata: map[string]any{
			"auto_renew":          contract.AutoRenew,
			"renewal_notice_days": contract.RenewalNoticeDays,
		},
	}, true
}

func extractionItemsFromMetadata(metadata map[string]any) []dto.ObligationExtractionItem {
	if len(metadata) == 0 {
		return nil
	}
	keys := []string{"obligations", "obligation_candidates", "watheeq_obligations"}
	items := make([]dto.ObligationExtractionItem, 0)
	for _, key := range keys {
		rawItems, ok := metadata[key].([]any)
		if !ok {
			continue
		}
		for _, raw := range rawItems {
			rawMap, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			if item, ok := extractionItemFromMetadata(rawMap, key); ok {
				items = append(items, item)
			}
		}
	}
	return items
}

func extractionItemFromMetadata(raw map[string]any, source string) (dto.ObligationExtractionItem, bool) {
	title := metadataString(raw, "title")
	dueDate := metadataTime(raw, "due_date")
	if title == "" && dueDate == nil {
		return dto.ObligationExtractionItem{}, false
	}
	return dto.ObligationExtractionItem{
		Title:           title,
		Description:     metadataString(raw, "description"),
		Type:            model.ObligationType(metadataString(raw, "type")),
		Priority:        model.LegalPriority(metadataString(raw, "priority")),
		DueDate:         dueDate,
		Source:          source,
		SourceReference: metadataString(raw, "source_reference"),
		ClauseID:        metadataUUID(raw, "clause_id"),
		Tags:            metadataStringSlice(raw, "tags"),
		Metadata:        raw,
	}, true
}

func planNotificationEvents(obligations []model.Obligation, asOf time.Time, horizonDays int, includeEscalations bool) []model.ObligationNotificationEvent {
	asOf = normalizeDate(asOf)
	events := make([]model.ObligationNotificationEvent, 0)
	for _, obligation := range obligations {
		if isTerminalObligationStatus(obligation.Status) {
			continue
		}
		daysUntilDue := daysBetween(asOf, obligation.DueDate)
		if daysUntilDue > horizonDays || sameUTCDate(obligation.LastReminderAt, asOf) {
			continue
		}
		if obligation.ReminderEnabled {
			if lead, ok := matchingLeadDay(obligation.ReminderLeadDays, daysUntilDue); ok {
				events = append(events, notificationEvent(obligation, model.ObligationNotificationReminder, asOf, daysUntilDue, lead, "lead day matched"))
			}
		}
		if includeEscalations && obligation.EscalationEnabled {
			if lead, ok := matchingLeadDay(obligation.EscalationLeadDays, daysUntilDue); ok {
				events = append(events, notificationEvent(obligation, model.ObligationNotificationEscalation, asOf, daysUntilDue, lead, "escalation lead day matched"))
			} else if daysUntilDue < 0 {
				events = append(events, notificationEvent(obligation, model.ObligationNotificationEscalation, asOf, daysUntilDue, 0, "obligation overdue"))
			}
		}
	}
	sort.SliceStable(events, func(i, j int) bool {
		if !events[i].DueDate.Equal(events[j].DueDate) {
			return events[i].DueDate.Before(events[j].DueDate)
		}
		if events[i].Type != events[j].Type {
			return events[i].Type < events[j].Type
		}
		return events[i].ObligationTitle < events[j].ObligationTitle
	})
	return events
}

func notificationEvent(obligation model.Obligation, eventType model.ObligationNotificationType, asOf time.Time, daysUntilDue, leadDays int, reason string) model.ObligationNotificationEvent {
	return model.ObligationNotificationEvent{
		EventID:          plannedNotificationID(obligation.ID, eventType, leadDays, asOf),
		Type:             eventType,
		ObligationID:     obligation.ID,
		ObligationTitle:  obligation.Title,
		ContractID:       obligation.ContractID,
		ContractTitle:    obligation.ContractTitle,
		MatterID:         obligation.MatterID,
		MatterTitle:      obligation.MatterTitle,
		OwnerUserID:      obligation.OwnerUserID,
		OwnerName:        obligation.OwnerName,
		DueDate:          obligation.DueDate,
		DaysUntilDue:     daysUntilDue,
		LeadDays:         leadDays,
		PlannedFor:       asOf,
		Channel:          "planned",
		EscalationTarget: obligation.EscalationTarget,
		Reason:           reason,
	}
}

func outboxItemsFromNotificationEvents(tenantID, userID uuid.UUID, events []model.ObligationNotificationEvent, channels []model.ObligationNotificationChannel) []model.ObligationNotificationOutboxItem {
	items := make([]model.ObligationNotificationOutboxItem, 0, len(events)*len(channels))
	seen := map[string]struct{}{}
	for _, event := range events {
		scheduledAt := normalizeDate(event.PlannedFor)
		recipientUserID, recipientName, recipientContact := notificationRecipient(event)
		for _, channel := range channels {
			key := notificationOutboxDedupeKey(tenantID, event.ObligationID, channel, scheduledAt)
			if _, ok := seen[key]; ok {
				continue
			}
			seen[key] = struct{}{}
			items = append(items, model.ObligationNotificationOutboxItem{
				ID:               uuid.New(),
				TenantID:         tenantID,
				ObligationID:     event.ObligationID,
				EventID:          event.EventID,
				EventType:        event.Type,
				LeadDays:         event.LeadDays,
				Channel:          channel,
				RecipientUserID:  recipientUserID,
				RecipientName:    recipientName,
				RecipientContact: recipientContact,
				ScheduledAt:      scheduledAt,
				Status:           model.ObligationNotificationOutboxPending,
				ProviderMetadata: map[string]any{},
				CreatedBy:        userID,
			})
		}
	}
	return items
}

func manualReminderSentOutboxItem(tenantID, userID uuid.UUID, obligation model.Obligation, req dto.MarkObligationReminderSentRequest, channel model.ObligationNotificationChannel, scheduledAt, sentAt time.Time) model.ObligationNotificationOutboxItem {
	recipientUserID := obligation.OwnerUserID
	recipientContact := req.RecipientContact
	if recipientContact == nil && req.EventType == model.ObligationNotificationEscalation {
		recipientContact = normalizeOptionalString(obligation.EscalationTarget)
	}
	recipientName := obligation.OwnerName
	if strings.TrimSpace(recipientName) == "" && recipientContact != nil {
		recipientName = *recipientContact
	}
	sentAt = sentAt.UTC()
	lastAttemptAt := sentAt
	providerMessageID := normalizeOptionalString(&req.ProviderMessageID)
	return model.ObligationNotificationOutboxItem{
		ID:                uuid.New(),
		TenantID:          tenantID,
		ObligationID:      obligation.ID,
		EventID:           plannedNotificationID(obligation.ID, req.EventType, req.LeadDays, scheduledAt),
		EventType:         req.EventType,
		LeadDays:          req.LeadDays,
		Channel:           channel,
		RecipientUserID:   &recipientUserID,
		RecipientName:     recipientName,
		RecipientContact:  recipientContact,
		ScheduledAt:       normalizeDate(scheduledAt),
		Status:            model.ObligationNotificationOutboxSent,
		Provider:          req.Provider,
		ProviderMessageID: providerMessageID,
		ProviderMetadata:  req.ProviderMetadata,
		AttemptCount:      1,
		LastAttemptAt:     &lastAttemptAt,
		SentAt:            &sentAt,
		CreatedBy:         userID,
	}
}

func notificationRecipient(event model.ObligationNotificationEvent) (*uuid.UUID, string, *string) {
	var recipientUserID *uuid.UUID
	if event.OwnerUserID != uuid.Nil {
		value := event.OwnerUserID
		recipientUserID = &value
	}
	recipientName := strings.TrimSpace(event.OwnerName)
	recipientContact := normalizeOptionalString(event.EscalationTarget)
	if event.Type != model.ObligationNotificationEscalation {
		recipientContact = nil
	}
	if recipientName == "" && recipientContact != nil {
		recipientName = *recipientContact
	}
	return recipientUserID, recipientName, recipientContact
}

func notificationOutboxDedupeKey(tenantID, obligationID uuid.UUID, channel model.ObligationNotificationChannel, scheduledAt time.Time) string {
	return fmt.Sprintf("%s:%s:%s:%s", tenantID, obligationID, channel, normalizeDate(scheduledAt).Format("2006-01-02"))
}

func normalizeNotificationChannels(channels []model.ObligationNotificationChannel) ([]model.ObligationNotificationChannel, error) {
	if len(channels) == 0 {
		return []model.ObligationNotificationChannel{
			model.ObligationNotificationChannelEmail,
			model.ObligationNotificationChannelCalendar,
		}, nil
	}
	out := make([]model.ObligationNotificationChannel, 0, len(channels))
	seen := map[model.ObligationNotificationChannel]struct{}{}
	for _, raw := range channels {
		channel := model.ObligationNotificationChannel(strings.ToLower(strings.TrimSpace(string(raw))))
		if channel == "" {
			continue
		}
		if !validNotificationChannel(channel) {
			return nil, validationError("invalid notification channel", map[string]string{"channels": "invalid"})
		}
		if _, ok := seen[channel]; ok {
			continue
		}
		seen[channel] = struct{}{}
		out = append(out, channel)
	}
	if len(out) == 0 {
		return nil, validationError("at least one notification channel is required", map[string]string{"channels": "required"})
	}
	return out, nil
}

func normalizeSingleNotificationChannel(value string, fallback model.ObligationNotificationChannel) (model.ObligationNotificationChannel, error) {
	channel := model.ObligationNotificationChannel(strings.ToLower(strings.TrimSpace(value)))
	if channel == "" {
		channel = fallback
	}
	if !validNotificationChannel(channel) {
		return "", validationError("invalid notification channel", map[string]string{"channel": "invalid"})
	}
	return channel, nil
}

func validNotificationChannel(channel model.ObligationNotificationChannel) bool {
	return channel == model.ObligationNotificationChannelEmail ||
		channel == model.ObligationNotificationChannelCalendar ||
		channel == model.ObligationNotificationChannelInApp
}

type localReminderDeliveryAttempt struct {
	Status            model.ObligationNotificationOutboxStatus
	AttemptedAt       time.Time
	Provider          string
	ProviderMessageID *string
	ProviderMetadata  map[string]any
	ErrorMessage      *string
}

func buildLocalReminderDeliveryAttempt(tenantID uuid.UUID, item model.ObligationNotificationOutboxItem, provider string, attemptedAt time.Time) localReminderDeliveryAttempt {
	provider = normalizeReminderDispatchProvider(provider)
	attemptedAt = attemptedAt.UTC()
	metadata := reminderDispatchProviderMetadata(provider, item, attemptedAt)
	fail := func(message string) localReminderDeliveryAttempt {
		metadata["failure_reason"] = message
		return localReminderDeliveryAttempt{
			Status:           model.ObligationNotificationOutboxFailed,
			AttemptedAt:      attemptedAt,
			Provider:         provider,
			ProviderMetadata: metadata,
			ErrorMessage:     &message,
		}
	}

	if item.TenantID != tenantID {
		return fail("tenant mismatch")
	}
	if !supportedReminderDispatchProvider(provider) {
		return fail("unsupported reminder dispatch provider")
	}
	if !validNotificationChannel(item.Channel) {
		return fail("unsupported reminder notification channel")
	}

	providerID := localReminderDispatchProviderID(provider, item)
	switch item.Channel {
	case model.ObligationNotificationChannelCalendar:
		metadata["calendar_event_id"] = providerID
	default:
		metadata["message_id"] = providerID
	}
	metadata["dry_run"] = true
	return localReminderDeliveryAttempt{
		Status:            model.ObligationNotificationOutboxSent,
		AttemptedAt:       attemptedAt,
		Provider:          provider,
		ProviderMessageID: &providerID,
		ProviderMetadata:  metadata,
	}
}

func providerDispatchDeliveryAttempt(requestedProvider string, item model.ObligationNotificationOutboxItem, attemptedAt time.Time, dispatch *ObligationReminderProviderDispatch) localReminderDeliveryAttempt {
	requestedProvider = normalizeReminderDispatchProvider(requestedProvider)
	attemptedAt = attemptedAt.UTC()
	if dispatch == nil {
		return failClosedReminderProviderAttempt(requestedProvider, item, attemptedAt, "reminder notification dispatcher returned no attempt", nil)
	}

	provider := strings.ToLower(strings.TrimSpace(dispatch.Provider))
	if provider == "" {
		provider = requestedProvider
	} else {
		provider = normalizeReminderDispatchProvider(provider)
	}
	if provider != requestedProvider {
		return failClosedReminderProviderAttempt(requestedProvider, item, attemptedAt, "reminder notification provider mismatch", map[string]any{
			"reported_provider": provider,
		})
	}

	metadata := mergeReminderProviderMetadata(reminderDispatchProviderMetadata(provider, item, attemptedAt), dispatch.ProviderMetadata)
	providerStatus := strings.TrimSpace(dispatch.ProviderStatus)
	deliveryStatus := strings.TrimSpace(dispatch.DeliveryStatus)
	if providerStatus != "" {
		metadata["provider_status"] = providerStatus
	}
	if deliveryStatus != "" {
		metadata["delivery_status"] = deliveryStatus
	}

	switch dispatch.Status {
	case model.ObligationNotificationOutboxSent:
		providerMessageID := strings.TrimSpace(dispatch.ProviderMessageID)
		if providerStatus == "" {
			return failClosedReminderProviderAttempt(provider, item, attemptedAt, "reminder notification provider status is required", metadata)
		}
		if deliveryStatus == "" {
			return failClosedReminderProviderAttempt(provider, item, attemptedAt, "reminder notification delivery status is required", metadata)
		}
		if providerMessageID == "" {
			return failClosedReminderProviderAttempt(provider, item, attemptedAt, "reminder notification provider message id is required", metadata)
		}
		if len(dispatch.ProviderMetadata) == 0 {
			return failClosedReminderProviderAttempt(provider, item, attemptedAt, "reminder notification provider metadata is required", metadata)
		}
		return localReminderDeliveryAttempt{
			Status:            model.ObligationNotificationOutboxSent,
			AttemptedAt:       attemptedAt,
			Provider:          provider,
			ProviderMessageID: &providerMessageID,
			ProviderMetadata:  metadata,
		}
	case model.ObligationNotificationOutboxFailed:
		errorMessage := strings.TrimSpace(dispatch.ErrorMessage)
		if errorMessage == "" {
			errorMessage = "reminder notification provider reported failed delivery"
		}
		metadata["failure_reason"] = errorMessage
		if providerStatus == "" {
			metadata["provider_status"] = "failed"
		}
		if deliveryStatus == "" {
			metadata["delivery_status"] = "failed"
		}
		return localReminderDeliveryAttempt{
			Status:           model.ObligationNotificationOutboxFailed,
			AttemptedAt:      attemptedAt,
			Provider:         provider,
			ProviderMetadata: metadata,
			ErrorMessage:     &errorMessage,
		}
	default:
		return failClosedReminderProviderAttempt(provider, item, attemptedAt, "reminder notification provider returned invalid status", metadata)
	}
}

func failClosedReminderProviderAttempt(provider string, item model.ObligationNotificationOutboxItem, attemptedAt time.Time, message string, metadata map[string]any) localReminderDeliveryAttempt {
	provider = normalizeReminderDispatchProvider(provider)
	base := reminderDispatchProviderMetadata(provider, item, attemptedAt)
	merged := mergeReminderProviderMetadata(base, metadata)
	merged["failure_reason"] = message
	if _, ok := merged["provider_status"]; !ok {
		merged["provider_status"] = "failed"
	}
	if _, ok := merged["delivery_status"]; !ok {
		merged["delivery_status"] = "failed"
	}
	return localReminderDeliveryAttempt{
		Status:           model.ObligationNotificationOutboxFailed,
		AttemptedAt:      attemptedAt.UTC(),
		Provider:         provider,
		ProviderMetadata: merged,
		ErrorMessage:     &message,
	}
}

func mergeReminderProviderMetadata(base map[string]any, provider map[string]any) map[string]any {
	merged := make(map[string]any, len(base)+len(provider))
	for key, value := range base {
		merged[key] = value
	}
	for key, value := range provider {
		merged[key] = value
	}
	return merged
}

func reminderDispatchProviderMetadata(provider string, item model.ObligationNotificationOutboxItem, attemptedAt time.Time) map[string]any {
	return map[string]any{
		"provider":        provider,
		"channel":         string(item.Channel),
		"attempted_at":    attemptedAt.UTC().Format(time.RFC3339Nano),
		"payload_summary": reminderDispatchPayloadSummary(item),
	}
}

func reminderDispatchPayloadSummary(item model.ObligationNotificationOutboxItem) map[string]any {
	summary := map[string]any{
		"outbox_id":                 item.ID.String(),
		"obligation_id":             item.ObligationID.String(),
		"event_id":                  item.EventID.String(),
		"event_type":                string(item.EventType),
		"lead_days":                 item.LeadDays,
		"channel":                   string(item.Channel),
		"scheduled_date":            normalizeDate(item.ScheduledAt).Format("2006-01-02"),
		"recipient_name":            item.RecipientName,
		"recipient_contact_present": item.RecipientContact != nil,
		"payload_hash":              reminderDispatchPayloadHash(item),
	}
	if item.RecipientUserID != nil {
		summary["recipient_user_id"] = item.RecipientUserID.String()
	}
	if item.RecipientContact != nil {
		summary["recipient_contact_hash"] = shortReminderDispatchHash("contact:" + *item.RecipientContact)
	}
	return summary
}

func reminderDispatchPayloadHash(item model.ObligationNotificationOutboxItem) string {
	recipientUserID := ""
	if item.RecipientUserID != nil {
		recipientUserID = item.RecipientUserID.String()
	}
	recipientContactHash := ""
	if item.RecipientContact != nil {
		recipientContactHash = shortReminderDispatchHash("contact:" + *item.RecipientContact)
	}
	parts := []string{
		item.ID.String(),
		item.TenantID.String(),
		item.ObligationID.String(),
		item.EventID.String(),
		string(item.EventType),
		fmt.Sprintf("%d", item.LeadDays),
		string(item.Channel),
		normalizeDate(item.ScheduledAt).Format("2006-01-02"),
		recipientUserID,
		strings.TrimSpace(item.RecipientName),
		recipientContactHash,
	}
	return shortReminderDispatchHash(strings.Join(parts, "|"))
}

func localReminderDispatchProviderID(provider string, item model.ObligationNotificationOutboxItem) string {
	prefix := "local-message"
	switch item.Channel {
	case model.ObligationNotificationChannelEmail:
		prefix = "local-email"
	case model.ObligationNotificationChannelCalendar:
		prefix = "local-calendar"
	case model.ObligationNotificationChannelInApp:
		prefix = "local-in-app"
	}
	key := strings.Join([]string{
		provider,
		item.TenantID.String(),
		item.ID.String(),
		item.EventID.String(),
		string(item.Channel),
	}, "|")
	return fmt.Sprintf("%s-%s", prefix, shortReminderDispatchHash(key))
}

func shortReminderDispatchHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])[:16]
}

func reminderDispatchSkipReason(status model.ObligationNotificationOutboxStatus, retry bool) string {
	switch status {
	case model.ObligationNotificationOutboxSent:
		return "already_sent"
	case model.ObligationNotificationOutboxFailed:
		if !retry {
			return "retry_required"
		}
		return ""
	case model.ObligationNotificationOutboxPending:
		return ""
	default:
		return "unsupported_status"
	}
}

func normalizeReminderDispatchProvider(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	switch provider {
	case "":
		return defaultReminderDispatchProvider
	case "dry-run", "dryrun":
		return "dry_run"
	default:
		return provider
	}
}

func supportedReminderDispatchProvider(provider string) bool {
	return provider == "local" || provider == "dry_run"
}

func normalizeReminderDispatchLimit(limit *int) (int, error) {
	if limit == nil {
		return defaultReminderDispatchLimit, nil
	}
	if *limit <= 0 || *limit > maxReminderDispatchLimit {
		return 0, validationError("limit must be between 1 and 500", map[string]string{"limit": "invalid"})
	}
	return *limit, nil
}

func validateObligationReminderDeliveryRequest(req dto.MarkObligationReminderDeliveryRequest) error {
	switch req.Status {
	case model.ObligationNotificationOutboxSent:
		return nil
	case model.ObligationNotificationOutboxFailed:
		if strings.TrimSpace(req.ErrorMessage) == "" {
			return validationError("error_message is required for failed reminder delivery", map[string]string{"error_message": "required"})
		}
		return nil
	default:
		return validationError("invalid reminder delivery status", map[string]string{"status": "invalid"})
	}
}

func plannedNotificationID(obligationID uuid.UUID, eventType model.ObligationNotificationType, leadDays int, asOf time.Time) uuid.UUID {
	key := fmt.Sprintf("lex-obligation-notification:%s:%s:%d:%s", obligationID, eventType, leadDays, normalizeDate(asOf).Format("2006-01-02"))
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(key))
}

func matchingLeadDay(leadDays []int, daysUntilDue int) (int, bool) {
	if daysUntilDue < 0 {
		return 0, false
	}
	for _, lead := range leadDays {
		if lead == daysUntilDue {
			return lead, true
		}
	}
	return 0, false
}

func daysBetween(asOf, dueDate time.Time) int {
	asOf = normalizeDate(asOf)
	dueDate = normalizeDate(dueDate)
	return int(dueDate.Sub(asOf).Hours() / 24)
}

func isTerminalObligationStatus(status model.ObligationStatus) bool {
	return status == model.ObligationStatusCompleted || status == model.ObligationStatusWaived || status == model.ObligationStatusCancelled
}

func sameUTCDate(value *time.Time, date time.Time) bool {
	if value == nil {
		return false
	}
	return normalizeDate(*value).Equal(normalizeDate(date))
}

func buildObligationReport(items []model.Obligation, total int, filters model.ObligationListFilters, generatedAt time.Time) *model.ObligationReport {
	asOf := normalizeDate(generatedAt)
	report := &model.ObligationReport{
		GeneratedAt: generatedAt.UTC(),
		Total:       total,
		Filters:     obligationReportFilters(filters),
		Obligations: make([]model.ObligationSummary, 0, len(items)),
		ByStatus:    map[string]int{},
		ByType:      map[string]int{},
		ByPriority:  map[string]int{},
	}
	for _, item := range items {
		summary := obligationReportSummary(item, asOf)
		report.Obligations = append(report.Obligations, summary)
		report.ByStatus[string(item.Status)]++
		report.ByType[string(item.Type)]++
		report.ByPriority[string(item.Priority)]++
		if item.Status == model.ObligationStatusCompleted {
			report.Completed++
		}
		if isTerminalObligationStatus(item.Status) {
			continue
		}
		switch {
		case summary.DaysUntilDue < 0:
			report.Overdue++
		case summary.DaysUntilDue <= obligationReportDueSoonDays:
			report.DueSoon++
		}
	}
	return report
}

func obligationReportSummary(obligation model.Obligation, asOf time.Time) model.ObligationSummary {
	return model.ObligationSummary{
		ID:            obligation.ID,
		Title:         obligation.Title,
		Type:          obligation.Type,
		Status:        obligation.Status,
		Priority:      obligation.Priority,
		OwnerUserID:   obligation.OwnerUserID,
		OwnerName:     obligation.OwnerName,
		ContractID:    obligation.ContractID,
		ContractTitle: obligation.ContractTitle,
		MatterID:      obligation.MatterID,
		MatterTitle:   obligation.MatterTitle,
		DueDate:       obligation.DueDate,
		DaysUntilDue:  daysBetween(asOf, obligation.DueDate),
		CompletedAt:   obligation.CompletedAt,
		CreatedAt:     obligation.CreatedAt,
	}
}

func obligationReportFilters(filters model.ObligationListFilters) map[string]string {
	out := map[string]string{}
	if filters.Search != "" {
		out["search"] = filters.Search
	}
	if filters.Status != nil {
		out["status"] = string(*filters.Status)
	}
	if filters.Type != nil {
		out["type"] = string(*filters.Type)
	}
	if filters.Priority != nil {
		out["priority"] = string(*filters.Priority)
	}
	if filters.OwnerUserID != nil {
		out["owner_user_id"] = filters.OwnerUserID.String()
	}
	if filters.ContractID != nil {
		out["contract_id"] = filters.ContractID.String()
	}
	if filters.MatterID != nil {
		out["matter_id"] = filters.MatterID.String()
	}
	if filters.DueBefore != nil {
		out["due_before"] = normalizeDate(*filters.DueBefore).Format("2006-01-02")
	}
	if filters.DueAfter != nil {
		out["due_after"] = normalizeDate(*filters.DueAfter).Format("2006-01-02")
	}
	if filters.Overdue {
		out["overdue"] = "true"
	}
	if filters.Tag != "" {
		out["tag"] = filters.Tag
	}
	return out
}

func firstNonEmptyIntSlice(groups ...[]int) []int {
	for _, group := range groups {
		if len(group) > 0 {
			return group
		}
	}
	return []int{}
}

func firstNonNilString(values ...*string) *string {
	for _, value := range values {
		if normalizeOptionalString(value) != nil {
			return value
		}
	}
	return nil
}

func mergeTags(groups ...[]string) []string {
	merged := make([]string, 0)
	for _, group := range groups {
		merged = append(merged, group...)
	}
	return dto.NormalizeTags(merged)
}

func mergeMetadata(groups ...map[string]any) map[string]any {
	merged := make(map[string]any)
	for _, group := range groups {
		for key, value := range group {
			merged[key] = value
		}
	}
	return merged
}

func metadataString(raw map[string]any, key string) string {
	value, ok := raw[key]
	if !ok || value == nil {
		return ""
	}
	return strings.TrimSpace(fmt.Sprintf("%v", value))
}

func metadataTime(raw map[string]any, key string) *time.Time {
	value, ok := raw[key]
	if !ok || value == nil {
		return nil
	}
	switch typed := value.(type) {
	case time.Time:
		normalized := normalizeDate(typed)
		return &normalized
	case string:
		for _, layout := range []string{time.RFC3339, "2006-01-02"} {
			parsed, err := time.Parse(layout, strings.TrimSpace(typed))
			if err == nil {
				normalized := normalizeDate(parsed)
				return &normalized
			}
		}
	}
	return nil
}

func metadataUUID(raw map[string]any, key string) *uuid.UUID {
	value := metadataString(raw, key)
	if value == "" {
		return nil
	}
	parsed, err := uuid.Parse(value)
	if err != nil {
		return nil
	}
	return &parsed
}

func metadataStringSlice(raw map[string]any, key string) []string {
	value, ok := raw[key]
	if !ok || value == nil {
		return []string{}
	}
	switch typed := value.(type) {
	case []string:
		return dto.NormalizeTags(typed)
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			out = append(out, fmt.Sprintf("%v", item))
		}
		return dto.NormalizeTags(out)
	default:
		return []string{}
	}
}

func validateObligationCreate(req dto.CreateObligationRequest) error {
	if req.Title == "" {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if req.OwnerUserID == uuid.Nil {
		return validationError("owner_user_id is required", map[string]string{"owner_user_id": "required"})
	}
	if req.OwnerName == "" {
		return validationError("owner_name is required", map[string]string{"owner_name": "required"})
	}
	if req.DueDate.IsZero() {
		return validationError("due_date is required", map[string]string{"due_date": "required"})
	}
	if req.ContractID == nil && req.MatterID == nil {
		return validationError("contract_id or matter_id is required", map[string]string{"contract_id": "required_without_matter_id", "matter_id": "required_without_contract_id"})
	}
	if _, ok := allowedObligationTypes[req.Type]; !ok {
		return validationError("invalid obligation type", map[string]string{"type": "invalid"})
	}
	if _, ok := allowedObligationStatuses[req.Status]; !ok {
		return validationError("invalid obligation status", map[string]string{"status": "invalid"})
	}
	if _, ok := allowedLegalPriorities[req.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return validateLeadDays(req.ReminderLeadDays, req.EscalationLeadDays)
}

func validateObligation(obligation *model.Obligation) error {
	if strings.TrimSpace(obligation.Title) == "" {
		return validationError("title is required", map[string]string{"title": "required"})
	}
	if obligation.OwnerUserID == uuid.Nil {
		return validationError("owner_user_id is required", map[string]string{"owner_user_id": "required"})
	}
	if strings.TrimSpace(obligation.OwnerName) == "" {
		return validationError("owner_name is required", map[string]string{"owner_name": "required"})
	}
	if obligation.DueDate.IsZero() {
		return validationError("due_date is required", map[string]string{"due_date": "required"})
	}
	if obligation.ContractID == nil && obligation.MatterID == nil {
		return validationError("contract_id or matter_id is required", map[string]string{"contract_id": "required_without_matter_id", "matter_id": "required_without_contract_id"})
	}
	if _, ok := allowedObligationTypes[obligation.Type]; !ok {
		return validationError("invalid obligation type", map[string]string{"type": "invalid"})
	}
	if _, ok := allowedObligationStatuses[obligation.Status]; !ok {
		return validationError("invalid obligation status", map[string]string{"status": "invalid"})
	}
	if _, ok := allowedLegalPriorities[obligation.Priority]; !ok {
		return validationError("invalid priority", map[string]string{"priority": "invalid"})
	}
	return validateLeadDays(obligation.ReminderLeadDays, obligation.EscalationLeadDays)
}

func applyObligationUpdate(obligation *model.Obligation, req dto.UpdateObligationRequest, now time.Time) {
	if req.Title != nil {
		obligation.Title = strings.TrimSpace(*req.Title)
	}
	if req.Description != nil {
		obligation.Description = strings.TrimSpace(*req.Description)
	}
	if req.Type != nil {
		obligation.Type = *req.Type
	}
	if req.Status != nil {
		obligation.Status = *req.Status
		if obligation.Status == model.ObligationStatusCompleted {
			obligation.CompletedAt = &now
		} else {
			obligation.CompletedAt = nil
		}
	}
	if req.Priority != nil {
		obligation.Priority = *req.Priority
	}
	if req.ContractID != nil {
		obligation.ContractID = req.ContractID
	}
	if req.MatterID != nil {
		obligation.MatterID = req.MatterID
	}
	if req.ClauseID != nil {
		obligation.ClauseID = req.ClauseID
	}
	if req.OwnerUserID != nil {
		obligation.OwnerUserID = *req.OwnerUserID
	}
	if req.OwnerName != nil {
		obligation.OwnerName = strings.TrimSpace(*req.OwnerName)
	}
	if req.DueDate != nil {
		obligation.DueDate = normalizeDate(*req.DueDate)
	}
	if req.ReminderEnabled != nil {
		obligation.ReminderEnabled = *req.ReminderEnabled
	}
	if req.ReminderLeadDays != nil {
		obligation.ReminderLeadDays = normalizeLeadDays(req.ReminderLeadDays)
	}
	if req.EscalationEnabled != nil {
		obligation.EscalationEnabled = *req.EscalationEnabled
	}
	if req.EscalationLeadDays != nil {
		obligation.EscalationLeadDays = normalizeLeadDays(req.EscalationLeadDays)
	}
	if req.EscalationTarget != nil {
		obligation.EscalationTarget = normalizeOptionalString(req.EscalationTarget)
	}
	if req.Tags != nil {
		obligation.Tags = dto.NormalizeTags(req.Tags)
	}
	if req.Metadata != nil {
		obligation.Metadata = req.Metadata
	}
}

func validateLeadDays(groups ...[]int) error {
	for _, group := range groups {
		for _, value := range group {
			if value < 0 || value > 3650 {
				return validationError("lead days must be between 0 and 3650", map[string]string{"lead_days": "invalid"})
			}
		}
	}
	return nil
}

func normalizeLeadDays(values []int) []int {
	if len(values) == 0 {
		return []int{}
	}
	out := make([]int, 0, len(values))
	seen := map[int]struct{}{}
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		out = append(out, value)
	}
	return out
}
