//go:build integration

package outbox

import (
	"context"
	"testing"
	"time"

	"github.com/IBM/sarama"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"
	redpandamod "github.com/testcontainers/testcontainers-go/modules/redpanda"

	"github.com/clario360/platform/internal/config"
	"github.com/clario360/platform/internal/events"
)

// TestIntegration_EndToEndDeliveryToKafka proves the full production chain:
// Staged.Publish stages into PostgreSQL, the Relay drives the real
// events.Producer, and the events arrive on a real Kafka-compatible broker —
// CloudEvents envelope, tenant partition key and headers intact.
func TestIntegration_EndToEndDeliveryToKafka(t *testing.T) {
	ctx, pool := startPostgres(t)

	redpandaContainer, err := redpandamod.Run(ctx,
		"docker.redpanda.com/redpandadata/redpanda:v24.1.8",
		redpandamod.WithAutoCreateTopics(),
	)
	if err != nil {
		t.Fatalf("start redpanda: %v", err)
	}
	t.Cleanup(func() { _ = redpandaContainer.Terminate(context.Background()) })

	broker, err := redpandaContainer.KafkaSeedBroker(ctx)
	if err != nil {
		t.Fatalf("resolve kafka seed broker: %v", err)
	}

	kafkaProducer, err := events.NewProducer(config.KafkaConfig{Brokers: []string{broker}}, zerolog.Nop())
	if err != nil {
		t.Fatalf("create kafka producer: %v", err)
	}
	t.Cleanup(func() { _ = kafkaProducer.Close() })

	// Stage events exactly as the workflow engine does — via the Staged
	// publisher — then relay them with the real producer.
	staged := NewStaged(pool)
	first := newIntegrationEvent(t)
	second := newIntegrationEvent(t)
	for _, event := range []*events.Event{first, second} {
		if err := staged.Publish(ctx, events.Topics.WorkflowEvents, event); err != nil {
			t.Fatalf("Staged.Publish() error = %v", err)
		}
	}

	relay := NewRelay(pool, kafkaProducer, Config{}, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))
	claimed, err := relay.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if claimed != 2 {
		t.Fatalf("RunOnce() claimed = %d, want 2", claimed)
	}
	for _, event := range []*events.Event{first, second} {
		status, _ := rowStatus(t, ctx, pool, event.ID)
		if status != StatusPublished {
			t.Fatalf("event %s status = %s, want published", event.ID, status)
		}
	}

	// Consume the topic from the beginning and verify both envelopes.
	received := consumeEvents(t, ctx, broker, events.Topics.WorkflowEvents, 2)

	want := map[string]*events.Event{first.ID: first, second.ID: second}
	for _, got := range received {
		expected, ok := want[got.event.ID]
		if !ok {
			t.Fatalf("received unexpected event %s", got.event.ID)
		}
		delete(want, got.event.ID)

		if got.event.Type != expected.Type {
			t.Errorf("event %s type = %s, want %s", got.event.ID, got.event.Type, expected.Type)
		}
		if got.event.TenantID != testTenantID {
			t.Errorf("event %s tenant = %s, want %s", got.event.ID, got.event.TenantID, testTenantID)
		}
		if string(got.key) != testTenantID {
			t.Errorf("partition key = %s, want tenant ID %s — tenant ordering depends on it", got.key, testTenantID)
		}
		if got.headers["ce-id"] != got.event.ID {
			t.Errorf("ce-id header = %s, want %s", got.headers["ce-id"], got.event.ID)
		}
	}
	if len(want) != 0 {
		t.Fatalf("events never received: %v", want)
	}
}

type receivedMessage struct {
	event   *events.Event
	key     []byte
	headers map[string]string
}

// consumeEvents reads exactly n messages from the topic's partition 0,
// starting at the oldest offset, failing the test on timeout.
func consumeEvents(t *testing.T, ctx context.Context, broker, topic string, n int) []receivedMessage {
	t.Helper()

	saramaCfg := sarama.NewConfig()
	saramaCfg.Consumer.Offsets.Initial = sarama.OffsetOldest
	consumer, err := sarama.NewConsumer([]string{broker}, saramaCfg)
	if err != nil {
		t.Fatalf("create kafka consumer: %v", err)
	}
	t.Cleanup(func() { _ = consumer.Close() })

	partition, err := consumer.ConsumePartition(topic, 0, sarama.OffsetOldest)
	if err != nil {
		t.Fatalf("consume partition: %v", err)
	}
	t.Cleanup(func() { _ = partition.Close() })

	serializer := events.NewSerializer()
	received := make([]receivedMessage, 0, n)
	timeout := time.After(30 * time.Second)

	for len(received) < n {
		select {
		case msg := <-partition.Messages():
			event, err := serializer.Deserialize(msg.Value)
			if err != nil {
				t.Fatalf("deserializing consumed message: %v", err)
			}
			headers := make(map[string]string, len(msg.Headers))
			for _, h := range msg.Headers {
				headers[string(h.Key)] = string(h.Value)
			}
			received = append(received, receivedMessage{event: event, key: msg.Key, headers: headers})
		case err := <-partition.Errors():
			t.Fatalf("partition consumer error: %v", err)
		case <-timeout:
			t.Fatalf("timed out: received %d of %d events", len(received), n)
		case <-ctx.Done():
			t.Fatalf("context done: %v", ctx.Err())
		}
	}
	return received
}
