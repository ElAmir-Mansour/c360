package service

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/channel"
	"github.com/clario360/platform/internal/notification/metrics"
	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/repository"
)

// DeliveryResult describes the outcome of delivering to a single channel.
type DeliveryResult struct {
	Channel  string
	Success  bool
	Error    error
	Deferred bool
	Metadata map[string]interface{}
}

// deliveryRecorder is the subset of *repository.DeliveryRepository the
// dispatcher needs. Declaring it as an interface lets the suppression-skip path
// be unit-tested with a fake; production passes the concrete repo unchanged.
type deliveryRecorder interface {
	Insert(ctx context.Context, rec *model.DeliveryRecord) (string, error)
}

// SuppressionChecker reports whether outbound delivery on a channel is
// suppressed for a user (unsubscribe / hard bounce / spam complaint, #17).
// Implemented by *repository.SuppressionRepository and injected via
// SetSuppressionChecker so the dependency stays optional and the constructor
// signature is unchanged.
type SuppressionChecker interface {
	IsSuppressed(ctx context.Context, tenantID, userID, channel string) (bool, error)
}

// DispatcherService fans out notification delivery to all enabled channels concurrently.
type DispatcherService struct {
	channels     map[string]channel.Channel
	deliveryRepo deliveryRecorder
	suppression  SuppressionChecker
	logger       zerolog.Logger
}

// NewDispatcherService creates a new DispatcherService.
func NewDispatcherService(channels map[string]channel.Channel, deliveryRepo *repository.DeliveryRepository, logger zerolog.Logger) *DispatcherService {
	return &DispatcherService{
		channels:     channels,
		deliveryRepo: deliveryRepo,
		logger:       logger.With().Str("component", "dispatcher").Logger(),
	}
}

// SetSuppressionChecker wires the compliance suppression list (#17) consulted
// before dispatching on suppressible outbound channels (email, webhook).
// Additive: a nil checker leaves dispatch behaviour unchanged.
func (d *DispatcherService) SetSuppressionChecker(c SuppressionChecker) { d.suppression = c }

// channelSuppressible reports whether a channel is subject to the compliance
// suppression list. Only outbound external channels (email, webhook) are; the
// in-app/websocket surfaces are the user's own inbox and are never suppressed.
func channelSuppressible(ch string) bool {
	return ch == model.ChannelEmail || ch == model.ChannelWebhook
}

// Dispatch delivers a notification to all specified channels concurrently.
func (d *DispatcherService) Dispatch(ctx context.Context, notif *model.Notification, deliveries []channel.ChannelDelivery) []DeliveryResult {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	var mu sync.Mutex
	var results []DeliveryResult

	sem := make(chan struct{}, 4) // bounded concurrency
	var wg sync.WaitGroup

	for _, delivery := range deliveries {
		delivery := delivery
		wg.Add(1)

		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result := d.deliverToChannel(ctx, notif, delivery)
			mu.Lock()
			results = append(results, result)
			mu.Unlock()
		}()
	}

	wg.Wait()
	return results
}

func (d *DispatcherService) deliverToChannel(ctx context.Context, notif *model.Notification, delivery channel.ChannelDelivery) DeliveryResult {
	start := time.Now()
	result := DeliveryResult{Channel: delivery.Channel}

	// Compliance suppression check (#17): before dispatching (or deferring) on a
	// suppressible outbound channel, skip the delivery entirely if the user is
	// suppressed for it (unsubscribe / hard bounce / spam complaint). A checker
	// error fails OPEN (logs and proceeds) so a suppression-store outage does not
	// silently drop all outbound mail.
	if d.suppression != nil && channelSuppressible(delivery.Channel) && notif.UserID != "" {
		suppressed, sErr := d.suppression.IsSuppressed(ctx, notif.TenantID, notif.UserID, delivery.Channel)
		if sErr != nil {
			d.logger.Warn().Err(sErr).Str("channel", delivery.Channel).Msg("suppression check failed; proceeding with delivery")
		} else if suppressed {
			return d.recordSuppressed(ctx, notif, delivery, result)
		}
	}

	if delivery.Deferred {
		// Create delivery log with pending status. deliver_after (#10) is
		// persisted so the quiet-hours flush loop releases it once now() >= it.
		rec := &model.DeliveryRecord{
			NotificationID: notif.ID,
			TenantID:       notif.TenantID,
			Channel:        delivery.Channel,
			Status:         model.DeliveryPending,
			Attempt:        1,
			DeliverAfter:   delivery.DeliverAfter,
		}
		if id, err := d.deliveryRepo.Insert(ctx, rec); err != nil {
			d.logger.Error().Err(err).Str("channel", delivery.Channel).Msg("failed to create deferred delivery log")
		} else {
			result.Metadata = map[string]interface{}{"delivery_log_id": id}
		}
		result.Deferred = true
		result.Success = true
		metrics.DeliveriesTotal.WithLabelValues(delivery.Channel, "deferred").Inc()
		return result
	}

	ch, ok := d.channels[delivery.Channel]
	if !ok {
		d.logger.Error().Str("channel", delivery.Channel).Msg("unknown channel")
		result.Error = fmt.Errorf("unknown channel: %s", delivery.Channel)
		return result
	}

	chResult := ch.Send(ctx, notif)

	duration := time.Since(start)
	metrics.DeliveryDuration.WithLabelValues(delivery.Channel).Observe(duration.Seconds())

	now := time.Now().UTC()
	rec := &model.DeliveryRecord{
		NotificationID: notif.ID,
		TenantID:       notif.TenantID,
		Channel:        delivery.Channel,
		Attempt:        1,
	}

	if chResult.Success {
		rec.Status = model.DeliveryDelivered
		rec.DeliveredAt = &now
		result.Success = true
		metrics.DeliveriesTotal.WithLabelValues(delivery.Channel, "delivered").Inc()
	} else {
		rec.Status = model.DeliveryFailed
		if chResult.Error != nil {
			errMsg := chResult.Error.Error()
			rec.ErrorMessage = &errMsg
			result.Error = chResult.Error
		}
		// Schedule the first retry (#6) so the durable retry worker claims this
		// row. A terminal failure (channel classified it non-retryable, e.g. a
		// 4xx) leaves next_retry_at NULL so it is never retried. The DB default
		// (max_retries = 3) bounds the total attempts.
		if deliveryFailureRetryable(chResult) {
			next := now.Add(defaultBaseBackoff)
			rec.NextRetryAt = &next
		}
		metrics.DeliveriesTotal.WithLabelValues(delivery.Channel, "failed").Inc()
	}

	result.Metadata = chResult.Metadata

	if id, err := d.deliveryRepo.Insert(ctx, rec); err != nil {
		d.logger.Error().Err(err).Str("channel", delivery.Channel).Msg("failed to create delivery log")
	} else if result.Metadata != nil {
		result.Metadata["delivery_log_id"] = id
	}

	return result
}

// recordSuppressed logs a skipped delivery for a suppressed channel and returns
// a successful (intentionally-skipped) result. The channel Send is never
// invoked, so no outbound email/webhook leaves the process. Counted under the
// "skipped" delivery status.
func (d *DispatcherService) recordSuppressed(ctx context.Context, notif *model.Notification, delivery channel.ChannelDelivery, result DeliveryResult) DeliveryResult {
	d.logger.Debug().
		Str("channel", delivery.Channel).
		Str("user_id", notif.UserID).
		Msg("delivery suppressed (compliance suppression list)")

	reason := "suppressed"
	rec := &model.DeliveryRecord{
		NotificationID: notif.ID,
		TenantID:       notif.TenantID,
		Channel:        delivery.Channel,
		Status:         model.DeliverySkipped,
		Attempt:        1,
		ErrorMessage:   &reason,
	}
	result.Metadata = map[string]interface{}{"reason": reason}
	if id, err := d.deliveryRepo.Insert(ctx, rec); err != nil {
		d.logger.Error().Err(err).Str("channel", delivery.Channel).Msg("failed to record suppressed delivery")
	} else {
		result.Metadata["delivery_log_id"] = id
	}
	// Intentionally skipped, not a failure: report success so the caller does not
	// schedule a retry.
	result.Success = true
	metrics.DeliveriesTotal.WithLabelValues(delivery.Channel, "skipped").Inc()
	return result
}
