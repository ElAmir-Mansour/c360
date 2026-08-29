package consumer

import (
	"context"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// deadLetterSink persists a parsed dead-letter entry durably. The Postgres-backed
// repository.DeadLetterRepository satisfies it.
type deadLetterSink interface {
	Store(ctx context.Context, entry *events.DeadLetterEntry) error
}

// DLQConsumer subscribes to the DLQ topics fed by the notification consumers'
// SetDeadLetterProducer path and persists each failed event durably (#14), so
// operators can inspect/replay/ack them across restarts. It is intentionally
// separate from the main NotificationConsumer (own consumer group) so DLQ
// ingestion never competes with live event processing.
type DLQConsumer struct {
	consumer *events.Consumer
	store    deadLetterSink
	topics   []string
	logger   zerolog.Logger
}

// NewDLQConsumer creates a DLQConsumer for the given DLQ topics.
func NewDLQConsumer(consumer *events.Consumer, store deadLetterSink, topics []string, logger zerolog.Logger) *DLQConsumer {
	return &DLQConsumer{
		consumer: consumer,
		store:    store,
		topics:   topics,
		logger:   logger.With().Str("component", "dlq_consumer").Logger(),
	}
}

// Start subscribes to all DLQ topics and begins persisting entries. A store
// failure returns an error so the offset is not committed and the entry is
// redelivered (fail-closed: a DLQ event is never silently dropped).
func (c *DLQConsumer) Start(ctx context.Context) error {
	handler := events.EventHandlerFunc(func(ctx context.Context, event *events.Event) error {
		entry := events.ParseDeadLetterEvent(event)
		if err := c.store.Store(ctx, entry); err != nil {
			c.logger.Error().Err(err).Str("dlq_id", entry.ID).Str("original_type", entry.OriginalType).
				Msg("failed to persist dead-letter entry; will retry")
			return err
		}
		c.logger.Warn().
			Str("dlq_id", entry.ID).
			Str("original_event_id", entry.OriginalEventID).
			Str("original_type", entry.OriginalType).
			Str("tenant_id", entry.TenantID).
			Msg("dead-letter event persisted")
		return nil
	})

	for _, topic := range c.topics {
		c.consumer.Subscribe(topic, handler)
	}
	c.logger.Info().Strs("topics", c.topics).Msg("dlq consumer starting")
	return c.consumer.Start(ctx)
}

// Stop gracefully shuts down the consumer.
func (c *DLQConsumer) Stop() error {
	return c.consumer.Stop()
}

// DLQTopics returns the set of DLQ topics that receive failed events for the
// topics the notification consumer subscribes to. It mirrors the consumer's
// publishToDLQ target resolution: a topic's DLQ is overrides[topic] when present,
// otherwise topic + ".dlq". Keep overrides in sync with the SetDLQTopicOverrides
// passed to the live consumer.
func DLQTopics(overrides map[string]string) []string {
	seen := make(map[string]struct{})
	topics := make([]string, 0)
	for _, topic := range ExtractEventTopics() {
		dlq := topic + ".dlq"
		if override, ok := overrides[topic]; ok && override != "" {
			dlq = override
		}
		if _, dup := seen[dlq]; dup {
			continue
		}
		seen[dlq] = struct{}{}
		topics = append(topics, dlq)
	}
	return topics
}
