package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/notification/channel"
	"github.com/clario360/platform/internal/notification/metrics"
	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/repository"
)

// CreateNotificationRequest is the input for creating a notification.
type CreateNotificationRequest struct {
	TenantID      string
	UserID        string
	Type          model.NotificationType
	Category      string
	Priority      string
	Title         string
	Body          string
	ActionURL     string
	SourceEventID string
	Data          map[string]interface{}
	Channels      []string
	// RecipientLocale is the recipient's preferred locale, resolved from their
	// profile/tenant default at enqueue time. When set it is authoritative;
	// otherwise CreateNotification falls back to a locale key already in Data,
	// then to the KSA default (defaultRecipientLocale). It is NOT the actor's
	// request locale — email is async, so the recipient's locale must be
	// captured now and persisted, not read from a request at send time.
	RecipientLocale string
}

// NotificationService is the core orchestration service for creating and dispatching notifications.
type NotificationService struct {
	notifRepo     *repository.NotificationRepository
	prefSvc       *PreferenceService
	dispatcher    *DispatcherService
	tmplSvc       *TemplateService
	producer      *events.Producer
	rdb           *redis.Client
	outboxEnabled bool
	logger        zerolog.Logger
}

// SetOutbox toggles transactional-outbox publication of notification.created
// (#12). When enabled the event is staged in the SAME transaction as the
// notification insert (via the outbox table) and drained to Kafka by the relay,
// so an event can never be lost after the row commits. When disabled the
// service falls back to best-effort direct publish through the producer.
// Additive: default (unset) preserves the original direct-publish behaviour.
func (s *NotificationService) SetOutbox(enabled bool) { s.outboxEnabled = enabled }

// NewNotificationService creates a new NotificationService.
func NewNotificationService(
	notifRepo *repository.NotificationRepository,
	prefSvc *PreferenceService,
	dispatcher *DispatcherService,
	tmplSvc *TemplateService,
	producer *events.Producer,
	rdb *redis.Client,
	logger zerolog.Logger,
) *NotificationService {
	return &NotificationService{
		notifRepo:  notifRepo,
		prefSvc:    prefSvc,
		dispatcher: dispatcher,
		tmplSvc:    tmplSvc,
		producer:   producer,
		rdb:        rdb,
		logger:     logger.With().Str("component", "notification_service").Logger(),
	}
}

// CreateNotification creates, persists, and dispatches a notification.
func (s *NotificationService) CreateNotification(ctx context.Context, req CreateNotificationRequest) error {
	// Resolve the recipient's locale at enqueue time and persist it in Data, so
	// the async email renderer (resolveNotificationLocale) picks it up when the
	// message is actually sent — there is no request context at that point.
	locale := resolveRecipientLocale(req)

	// Render templates.
	title := req.Title
	body := req.Body
	actionURL := req.ActionURL

	if req.Data != nil {
		if rendered, err := s.tmplSvc.RenderText(title, req.Data); err == nil {
			title = rendered
		}
		if rendered, err := s.tmplSvc.RenderText(body, req.Data); err == nil {
			body = rendered
		}
		if rendered, err := s.tmplSvc.RenderText(actionURL, req.Data); err == nil {
			actionURL = rendered
		}
	}

	// Stamp the resolved recipient locale into the persisted payload without
	// disturbing any higher-priority producer-provided locale key. Done after
	// rendering so it never alters the original Data used as template input.
	data := req.Data
	if data == nil {
		data = map[string]interface{}{}
	}
	data["preferred_locale"] = locale

	dataBytes, _ := json.Marshal(data)

	notif := &model.Notification{
		TenantID:  req.TenantID,
		UserID:    req.UserID,
		Type:      req.Type,
		Category:  req.Category,
		Priority:  req.Priority,
		Title:     title,
		Body:      body,
		Data:      dataBytes,
		ActionURL: actionURL,
	}

	// Transactional-outbox staging (#12): when enabled, notification.created is
	// staged in the SAME transaction as the insert, so it cannot be lost if the
	// process crashes after commit but before a direct publish. stage is nil
	// (and the insert path unchanged) when the outbox is disabled.
	stage := s.outboxStage(req)

	// Deduplication.
	var id string
	var err error
	if req.SourceEventID != "" {
		notif.SourceEventID = &req.SourceEventID
		id, err = s.notifRepo.InsertWithDedupStaged(ctx, notif, stage)
		if err != nil {
			return fmt.Errorf("insert notification: %w", err)
		}
		if id == "" {
			// Duplicate — skip silently.
			s.logger.Debug().Str("source_event_id", req.SourceEventID).Msg("duplicate notification skipped")
			metrics.DuplicatesSkipped.Inc()
			return nil
		}
	} else {
		id, err = s.notifRepo.InsertStaged(ctx, notif, stage)
		if err != nil {
			return fmt.Errorf("insert notification: %w", err)
		}
	}

	notif.ID = id
	metrics.NotificationsCreated.WithLabelValues(string(req.Type), req.Category).Inc()

	// Resolve preferences. On error ResolveChannels ALREADY returns the
	// fail-closed set (best-effort in_app only, outbound suppressed); we MUST
	// NOT substitute model.DefaultPreferences here — doing so was the second
	// fall-open (#11). Keep the returned chanPrefs as-is.
	chanPrefs, err := s.prefSvc.ResolveChannels(ctx, req.UserID, req.TenantID, req.Type)
	if err != nil {
		s.logger.Warn().Err(err).Msg("preference resolution failed; delivering in_app only (fail-closed)")
	}

	// Quiet hours check: compute the deferral-until time so a deferred email is
	// released at the end of the window by the flush loop (#10).
	var deferUntil *time.Time
	if req.Priority != model.PriorityCritical {
		if until, dErr := s.prefSvc.QuietHoursDeferUntil(ctx, req.UserID, req.TenantID); dErr == nil {
			deferUntil = until
		}
	}
	inQuietHours := deferUntil != nil

	// Build channel deliveries.
	allowedChannels := normalizeRequestedChannels(req.Channels)
	var deliveries []channel.ChannelDelivery
	if chanPrefs.InApp && channelRequested(allowedChannels, model.ChannelInApp) {
		deliveries = append(deliveries, channel.ChannelDelivery{Channel: model.ChannelInApp})
	}
	if chanPrefs.WebSocket && channelRequested(allowedChannels, model.ChannelWebSocket) {
		deliveries = append(deliveries, channel.ChannelDelivery{Channel: model.ChannelWebSocket})
	}
	if chanPrefs.Email && channelRequested(allowedChannels, model.ChannelEmail) {
		deliveries = append(deliveries, channel.ChannelDelivery{
			Channel:      model.ChannelEmail,
			Deferred:     inQuietHours,
			DeliverAfter: deferUntil,
		})
	}
	if chanPrefs.Webhook && channelRequested(allowedChannels, model.ChannelWebhook) {
		deliveries = append(deliveries, channel.ChannelDelivery{Channel: model.ChannelWebhook})
	}

	// Dispatch.
	if len(deliveries) > 0 {
		s.dispatcher.Dispatch(ctx, notif, deliveries)
	}

	// Publish event. When the outbox is enabled the event was already staged
	// transactionally above and the relay publishes it; direct publish is only
	// the fallback used when the outbox is unavailable.
	if !s.outboxEnabled && s.producer != nil {
		if evt := newNotificationCreatedEvent(req, id); evt != nil {
			if pubErr := s.producer.Publish(ctx, events.Topics.NotificationEvents, evt); pubErr != nil {
				s.logger.Warn().Err(pubErr).Msg("failed to publish notification.created event")
			}
		}
	}

	return nil
}

// outboxStage returns a StageFunc that stages the notification.created event in
// the insert transaction, or nil when the outbox is disabled (leaving the
// insert path and its behaviour unchanged). An empty tenant would fail event
// validation, so it degrades to no staging (the notification insert itself is
// unaffected).
func (s *NotificationService) outboxStage(req CreateNotificationRequest) repository.StageFunc {
	if !s.outboxEnabled || strings.TrimSpace(req.TenantID) == "" {
		return nil
	}
	return func(ctx context.Context, tx pgx.Tx, id string) error {
		evt := newNotificationCreatedEvent(req, id)
		if evt == nil {
			return nil
		}
		return outbox.Write(ctx, tx, events.Topics.NotificationEvents, evt)
	}
}

// newNotificationCreatedEvent builds the notification.created CloudEvent for a
// freshly inserted notification. It returns nil only if event construction
// fails (which cannot happen for a JSON-serialisable payload).
func newNotificationCreatedEvent(req CreateNotificationRequest, id string) *events.Event {
	evt, err := events.NewEvent(
		"com.clario360.notification.created",
		"clario360/notification-service",
		req.TenantID,
		map[string]interface{}{
			"notification_id": id,
			"user_id":         req.UserID,
			"type":            string(req.Type),
			"priority":        req.Priority,
		},
	)
	if err != nil {
		return nil
	}
	return evt
}

// GetByID returns a single notification.
func (s *NotificationService) GetByID(ctx context.Context, tenantID, userID, id string) (*model.Notification, error) {
	return s.notifRepo.FindByID(ctx, tenantID, userID, id)
}

// MarkRead marks a notification as read.
func (s *NotificationService) MarkRead(ctx context.Context, tenantID, userID, id string) error {
	return s.notifRepo.MarkRead(ctx, tenantID, userID, id)
}

// MarkAllRead marks all unread notifications as read.
func (s *NotificationService) MarkAllRead(ctx context.Context, tenantID, userID string) (int64, error) {
	return s.notifRepo.MarkAllRead(ctx, tenantID, userID)
}

// Delete deletes a notification.
func (s *NotificationService) Delete(ctx context.Context, tenantID, userID, id string) error {
	return s.notifRepo.Delete(ctx, tenantID, userID, id)
}

// BulkDelete deletes multiple notifications by ID.
func (s *NotificationService) BulkDelete(ctx context.Context, tenantID, userID string, ids []string) (int64, error) {
	return s.notifRepo.BulkDelete(ctx, tenantID, userID, ids)
}

// UnreadCount returns the unread notification count.
func (s *NotificationService) UnreadCount(ctx context.Context, tenantID, userID string) (int64, error) {
	return s.notifRepo.UnreadCount(ctx, tenantID, userID)
}

// resolveRecipientLocale determines the recipient's locale at enqueue time.
// Precedence: an explicitly-resolved recipient-profile locale (RecipientLocale),
// then any locale-like key the producer already put in Data, else the KSA
// default. It never consults the actor's request locale — only the recipient's.
func resolveRecipientLocale(req CreateNotificationRequest) string {
	if loc := strings.TrimSpace(req.RecipientLocale); loc != "" {
		return normalizeNotificationLocale(loc)
	}
	for _, key := range []string{"locale", "language", "lang", "preferred_locale"} {
		if v, ok := req.Data[key].(string); ok && strings.TrimSpace(v) != "" {
			return normalizeNotificationLocale(v)
		}
	}
	return defaultRecipientLocale
}

func normalizeRequestedChannels(channels []string) map[string]struct{} {
	if len(channels) == 0 {
		return nil
	}

	allowed := make(map[string]struct{}, len(channels))
	for _, channelName := range channels {
		switch strings.TrimSpace(strings.ToLower(channelName)) {
		case "in_app":
			allowed[model.ChannelInApp] = struct{}{}
		case "email":
			allowed[model.ChannelEmail] = struct{}{}
		case "webhook":
			allowed[model.ChannelWebhook] = struct{}{}
		case "push", "websocket":
			allowed[model.ChannelWebSocket] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		return nil
	}
	return allowed
}

func channelRequested(allowed map[string]struct{}, channelName string) bool {
	if len(allowed) == 0 {
		return true
	}
	_, ok := allowed[channelName]
	return ok
}
