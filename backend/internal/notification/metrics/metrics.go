package metrics

import "github.com/prometheus/client_golang/prometheus"

var (
	NotificationsCreated = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "created_total",
			Help:      "Total notifications created, by type and category.",
		},
		[]string{"type", "category"},
	)

	DeliveriesTotal = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "deliveries_total",
			Help:      "Total delivery attempts, by channel and status.",
		},
		[]string{"channel", "status"},
	)

	DeliveryDuration = prometheus.NewHistogramVec(
		prometheus.HistogramOpts{
			Namespace: "notification",
			Name:      "delivery_duration_seconds",
			Help:      "Time to deliver a notification per channel.",
			Buckets:   []float64{0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10},
		},
		[]string{"channel"},
	)

	WSConnectionsActive = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "notification",
			Name:      "ws_connections_active",
			Help:      "Current active WebSocket connections by tenant.",
		},
		[]string{"tenant_id"},
	)

	WSConnectionsTotal = prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "ws_connections_total",
			Help:      "Total WebSocket connections established.",
		},
	)

	WSMessagesSent = prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "ws_messages_sent_total",
			Help:      "Total WebSocket messages sent.",
		},
	)

	EmailSent = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "email_sent_total",
			Help:      "Total emails sent, by provider and status.",
		},
		[]string{"provider", "status"},
	)

	WebhookDeliveries = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "webhook_deliveries_total",
			Help:      "Total webhook delivery attempts, by status.",
		},
		[]string{"status"},
	)

	ConsumerEventsProcessed = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "consumer_events_processed_total",
			Help:      "Total events consumed from Kafka, by topic and result.",
		},
		[]string{"topic", "result"},
	)

	DuplicatesSkipped = prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "duplicates_skipped_total",
			Help:      "Total duplicate notifications skipped via dedup.",
		},
	)

	RateLimitRejected = prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "rate_limit_rejected_total",
			Help:      "Total requests rejected by rate limiter.",
		},
	)

	DigestsSent = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "digests_sent_total",
			Help:      "Total digest emails sent, by frequency.",
		},
		[]string{"frequency"},
	)

	// DeliveryRetryBacklog is the current number of delivery-log rows that are
	// due for retry (status failed/retrying, next_retry_at <= now, attempts
	// remaining). Metric name coordinated with Wave E:
	// notification_delivery_retry_backlog.
	DeliveryRetryBacklog = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "notification",
			Name:      "delivery_retry_backlog",
			Help:      "Current number of delivery-log rows due for retry.",
		},
	)

	// DeliveryRetries counts retry-worker delivery attempts by channel and
	// outcome (delivered | rescheduled | exhausted).
	DeliveryRetries = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "delivery_retries_total",
			Help:      "Total retry-worker delivery attempts, by channel and outcome.",
		},
		[]string{"channel", "outcome"},
	)

	// DeliveryDeadLettered counts deliveries that exhausted their retry budget
	// (or hit a terminal error) and were dead-lettered by the retry worker.
	DeliveryDeadLettered = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "delivery_dead_lettered_total",
			Help:      "Total deliveries dead-lettered after exhausting retries, by channel.",
		},
		[]string{"channel"},
	)

	// DeferredFlushed counts quiet-hours-deferred deliveries released by the
	// flush loop, by channel and outcome (delivered | rescheduled).
	DeferredFlushed = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "deferred_flushed_total",
			Help:      "Total quiet-hours-deferred deliveries flushed, by channel and outcome.",
		},
		[]string{"channel", "outcome"},
	)

	// PrefResolutionFallback counts notifications whose channel preferences
	// could not be resolved and that fell CLOSED to best-effort in_app only
	// (outbound channels suppressed) instead of substituting all-on defaults.
	PrefResolutionFallback = prometheus.NewCounter(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "pref_resolution_fallback_total",
			Help:      "Total notifications that failed preference resolution and fell closed to in_app only.",
		},
	)

	// DLQDepth is the current number of durable dead-letter entries still
	// pending operator action (status='pending') in notification_dead_letters.
	// Sampled periodically by the notification-service metrics sampler (Wave E
	// #12) so a growing durable DLQ is visible without scanning Kafka.
	DLQDepth = prometheus.NewGauge(
		prometheus.GaugeOpts{
			Namespace: "notification",
			Name:      "dlq_depth",
			Help:      "Current number of durable dead-letter entries pending operator action.",
		},
	)

	// KafkaConsumerLag is the estimated per-topic consumer lag (latest offset
	// minus committed offset, summed across partitions) for the notification
	// consumer group. Sampled periodically (Wave E #12); previously the shared
	// events consumer-lag signal was never exported for this service.
	KafkaConsumerLag = prometheus.NewGaugeVec(
		prometheus.GaugeOpts{
			Namespace: "notification",
			Name:      "consumer_lag",
			Help:      "Estimated Kafka consumer lag (uncommitted messages) per subscribed topic.",
		},
		[]string{"topic"},
	)

	// EventSchemaFieldMissing counts consumed events whose payload is missing a
	// field the rule engine branches on (#13). A producer renaming/removing such
	// a field would silently stop matching rules and drop notifications; this
	// makes that drift visible per event type and field.
	EventSchemaFieldMissing = prometheus.NewCounterVec(
		prometheus.CounterOpts{
			Namespace: "notification",
			Name:      "event_schema_field_missing_total",
			Help:      "Total consumed events missing a rule-engine field, by event type and field name.",
		},
		[]string{"event_type", "field"},
	)
)

func init() {
	prometheus.MustRegister(
		NotificationsCreated,
		DeliveriesTotal,
		DeliveryDuration,
		WSConnectionsActive,
		WSConnectionsTotal,
		WSMessagesSent,
		EmailSent,
		WebhookDeliveries,
		ConsumerEventsProcessed,
		DuplicatesSkipped,
		RateLimitRejected,
		DigestsSent,
		DeliveryRetryBacklog,
		DeliveryRetries,
		DeliveryDeadLettered,
		DeferredFlushed,
		PrefResolutionFallback,
		DLQDepth,
		KafkaConsumerLag,
		EventSchemaFieldMissing,
	)
}
