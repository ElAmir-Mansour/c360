package service

import (
	"context"
	"math/rand"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/channel"
	"github.com/clario360/platform/internal/notification/metrics"
	"github.com/clario360/platform/internal/notification/model"
	"github.com/clario360/platform/internal/notification/repository"
)

const (
	// defaultBaseBackoff is the first-retry delay and the exponential-backoff
	// base for non-webhook channels (webhooks use their retry policy's
	// initial_delay_seconds). Shared with the dispatcher so an initial failure
	// becomes claimable at the same cadence.
	defaultBaseBackoff = 30 * time.Second
	// defaultMaxBackoff caps the exponential backoff.
	defaultMaxBackoff = 60 * time.Minute
	// defaultRetryLease is the visibility timeout applied to a claimed row: it
	// is pushed this far into the future on claim so a sibling worker (or the
	// next tick) does not re-claim it mid-send. If the worker crashes, the row
	// becomes claimable again once the lease expires.
	defaultRetryLease = 5 * time.Minute
	// defaultRetryInterval is the worker tick cadence.
	defaultRetryInterval = 30 * time.Second
	// defaultRetryBatch bounds how many rows a single tick claims.
	defaultRetryBatch = 50
)

// statusCodeRe extracts an HTTP-style status code embedded in a channel error
// message so the retry worker can classify 4xx (terminal) vs 5xx (retryable).
var statusCodeRe = regexp.MustCompile(`\b([45]\d\d)\b`)

// deliveryFailureRetryable classifies a channel failure for the retry pipeline.
// A channel may set ChannelResult.Retryable explicitly; otherwise the error
// text is inspected. Provider 429 and 5xx are retryable; 4xx (except 429) are
// terminal; network/transport errors default to retryable.
func deliveryFailureRetryable(res *channel.ChannelResult) bool {
	if res == nil {
		return false
	}
	if res.Retryable != nil {
		return *res.Retryable
	}
	if res.Success || res.Error == nil {
		return true
	}
	return deliveryErrorRetryable(res.Error.Error())
}

func deliveryErrorRetryable(msg string) bool {
	lower := strings.ToLower(msg)
	if strings.Contains(lower, "429") {
		return true
	}
	if strings.Contains(lower, "retriable") || strings.Contains(lower, "retryable") {
		return true
	}
	if strings.Contains(lower, "permanent") {
		return false
	}
	if sm := statusCodeRe.FindStringSubmatch(msg); sm != nil {
		code := sm[1]
		if code == "429" {
			return true
		}
		if strings.HasPrefix(code, "4") {
			return false
		}
		return true // 5xx
	}
	// Timeouts / connection resets / DNS failures are transient.
	return true
}

// RetryWorker drives durable delivery retries (#6) and the quiet-hours deferred
// flush (#10). It claims due delivery-log rows, re-invokes the channel, and
// either records success, reschedules with exponential backoff + jitter, or
// dead-letters the row after its retry budget is exhausted.
type RetryWorker struct {
	deliveryRepo *repository.DeliveryRepository
	webhookRepo  *repository.WebhookRepository
	channels     map[string]channel.Channel
	logger       zerolog.Logger

	interval    time.Duration
	batchSize   int
	baseBackoff time.Duration
	maxBackoff  time.Duration
	lease       time.Duration
}

// NewRetryWorker creates a RetryWorker. interval and batchSize fall back to
// sane defaults when non-positive.
func NewRetryWorker(
	deliveryRepo *repository.DeliveryRepository,
	webhookRepo *repository.WebhookRepository,
	channels map[string]channel.Channel,
	interval time.Duration,
	batchSize int,
	logger zerolog.Logger,
) *RetryWorker {
	if interval <= 0 {
		interval = defaultRetryInterval
	}
	if batchSize <= 0 {
		batchSize = defaultRetryBatch
	}
	return &RetryWorker{
		deliveryRepo: deliveryRepo,
		webhookRepo:  webhookRepo,
		channels:     channels,
		logger:       logger.With().Str("component", "retry_worker").Logger(),
		interval:     interval,
		batchSize:    batchSize,
		baseBackoff:  defaultBaseBackoff,
		maxBackoff:   defaultMaxBackoff,
		lease:        defaultRetryLease,
	}
}

// Run ticks until the context is cancelled, each tick flushing due deferred
// deliveries, retrying due failed deliveries, and refreshing the backlog gauge.
func (w *RetryWorker) Run(ctx context.Context) error {
	ticker := time.NewTicker(w.interval)
	defer ticker.Stop()

	w.logger.Info().Dur("interval", w.interval).Int("batch", w.batchSize).Msg("delivery retry worker started")

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-ticker.C:
			w.processDeferred(ctx)
			w.processRetries(ctx)
			w.updateBacklogGauge(ctx)
		}
	}
}

func (w *RetryWorker) processRetries(ctx context.Context) {
	recs, err := w.deliveryRepo.ClaimDueRetries(ctx, w.batchSize, time.Now().Add(w.lease))
	if err != nil {
		w.logger.Error().Err(err).Msg("failed to claim due retries")
		return
	}
	for i := range recs {
		w.attemptDelivery(ctx, &recs[i], false)
	}
}

func (w *RetryWorker) processDeferred(ctx context.Context) {
	recs, err := w.deliveryRepo.ClaimDueDeferred(ctx, w.batchSize, time.Now().Add(w.lease))
	if err != nil {
		w.logger.Error().Err(err).Msg("failed to claim due deferred deliveries")
		return
	}
	for i := range recs {
		w.attemptDelivery(ctx, &recs[i], true)
	}
}

func (w *RetryWorker) updateBacklogGauge(ctx context.Context) {
	n, err := w.deliveryRepo.CountRetryBacklog(ctx)
	if err != nil {
		w.logger.Warn().Err(err).Msg("failed to count retry backlog")
		return
	}
	metrics.DeliveryRetryBacklog.Set(float64(n))
}

// attemptDelivery re-invokes the channel for a single claimed delivery row and
// records the outcome. isFlush distinguishes the quiet-hours flush path (#10)
// from the retry path (#6) for metrics.
func (w *RetryWorker) attemptDelivery(ctx context.Context, rec *model.DeliveryRecord, isFlush bool) {
	newAttempt := rec.Attempt + 1

	// A row must carry its tenant to safely load the parent notification. Rows
	// predating the tenant backfill are terminal (cannot re-dispatch safely).
	if rec.TenantID == "" {
		w.exhaust(ctx, rec, newAttempt, "delivery row has no tenant; cannot re-dispatch", isFlush)
		return
	}

	notif, err := w.deliveryRepo.GetNotificationByID(ctx, rec.TenantID, rec.NotificationID)
	if err != nil || notif == nil {
		// Parent notification is gone (deleted/retention) — terminal.
		w.exhaust(ctx, rec, newAttempt, "parent notification not found", isFlush)
		return
	}

	ch, ok := w.channels[rec.Channel]
	if !ok {
		w.exhaust(ctx, rec, newAttempt, "unknown channel: "+rec.Channel, isFlush)
		return
	}

	res := ch.Send(ctx, notif)
	if res != nil && res.Success {
		if err := w.deliveryRepo.MarkDeliverySucceeded(ctx, rec.ID, newAttempt); err != nil {
			w.logger.Error().Err(err).Str("delivery_id", rec.ID).Msg("failed to mark delivery succeeded")
		}
		w.record(isFlush, rec.Channel, "delivered")
		return
	}

	errMsg := "delivery failed"
	if res != nil && res.Error != nil {
		errMsg = res.Error.Error()
	}

	policy := w.effectivePolicy(ctx, rec, notif)
	effectiveMax := rec.MaxRetries
	if rec.Channel == model.ChannelWebhook && policy.MaxRetries > 0 && policy.MaxRetries < effectiveMax {
		// Honor the (stricter) per-webhook retry budget.
		effectiveMax = policy.MaxRetries
	}

	retryable := deliveryFailureRetryable(res)
	if !retryable || newAttempt >= effectiveMax {
		w.exhaust(ctx, rec, newAttempt, errMsg, isFlush)
		return
	}

	next := time.Now().Add(w.backoff(rec.Channel, newAttempt, policy))
	if err := w.deliveryRepo.RescheduleDelivery(ctx, rec.ID, newAttempt, next, &errMsg); err != nil {
		w.logger.Error().Err(err).Str("delivery_id", rec.ID).Msg("failed to reschedule delivery")
		return
	}
	w.logger.Debug().
		Str("delivery_id", rec.ID).
		Str("channel", rec.Channel).
		Int("attempt", newAttempt).
		Time("next_retry_at", next).
		Msg("delivery rescheduled")
	w.record(isFlush, rec.Channel, "rescheduled")
}

// exhaust terminally fails a delivery (dead-letter in the delivery log).
func (w *RetryWorker) exhaust(ctx context.Context, rec *model.DeliveryRecord, attempt int, errMsg string, isFlush bool) {
	if err := w.deliveryRepo.MarkDeliveryExhausted(ctx, rec.ID, attempt, &errMsg); err != nil {
		w.logger.Error().Err(err).Str("delivery_id", rec.ID).Msg("failed to mark delivery exhausted")
	}
	metrics.DeliveryDeadLettered.WithLabelValues(rec.Channel).Inc()
	w.record(isFlush, rec.Channel, "exhausted")
	w.logger.Error().
		Str("delivery_id", rec.ID).
		Str("channel", rec.Channel).
		Str("notification_id", rec.NotificationID).
		Int("attempt", attempt).
		Str("error", errMsg).
		Msg("delivery dead-lettered after exhausting retries")
}

func (w *RetryWorker) record(isFlush bool, channelName, outcome string) {
	if isFlush {
		metrics.DeferredFlushed.WithLabelValues(channelName, outcome).Inc()
		return
	}
	metrics.DeliveryRetries.WithLabelValues(channelName, outcome).Inc()
}

// effectivePolicy returns the retry policy governing a delivery. For webhook
// deliveries it uses the first active webhook's configured policy; otherwise a
// default exponential policy.
func (w *RetryWorker) effectivePolicy(ctx context.Context, rec *model.DeliveryRecord, notif *model.Notification) model.WebhookRetryPolicy {
	if rec.Channel != model.ChannelWebhook || w.webhookRepo == nil {
		return model.DefaultRetryPolicy()
	}
	whs, err := w.webhookRepo.GetActiveForEvent(ctx, rec.TenantID, string(notif.Type))
	if err != nil || len(whs) == 0 {
		return model.DefaultRetryPolicy()
	}
	return whs[0].RetryPolicy
}

// backoff computes the next retry delay: exponential in the attempt number,
// capped at maxBackoff, with full jitter. Webhook deliveries seed the base from
// the webhook's initial_delay_seconds and honor a "fixed" backoff_type.
func (w *RetryWorker) backoff(channelName string, attempt int, policy model.WebhookRetryPolicy) time.Duration {
	base := w.baseBackoff
	if channelName == model.ChannelWebhook && policy.InitialDelaySeconds > 0 {
		base = time.Duration(policy.InitialDelaySeconds) * time.Second
	}

	d := base
	if !(channelName == model.ChannelWebhook && policy.BackoffType == "fixed") {
		exp := attempt - 1
		if exp < 0 {
			exp = 0
		}
		if exp > 20 {
			exp = 20
		}
		d = base * time.Duration(int64(1)<<uint(exp))
	}
	if d > w.maxBackoff || d <= 0 {
		d = w.maxBackoff
	}

	// Full jitter in [d/2, d] to spread concurrent retries.
	half := d / 2
	if half <= 0 {
		return d
	}
	return half + time.Duration(rand.Int63n(int64(half)+1))
}
