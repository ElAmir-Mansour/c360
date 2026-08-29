// Package outbox implements the transactional outbox pattern for event
// publication (Solution Architecture E2E, slide 40: "exactly-once effects").
//
// Services stage events with Write/WriteBatch inside the same database
// transaction as their business write. A Relay then claims staged rows and
// publishes them to Kafka. Because the event row commits or rolls back
// atomically with the business data, the dual-write failure modes (event
// published but write rolled back; write committed but event lost) are
// designed out.
//
// Delivery to the bus is at-least-once: if the relay crashes between a
// successful publish and marking the row published, the row is reaped and
// republished. Consumers deduplicate with the existing events.IdempotencyGuard
// keyed on the event ID, which is stable across republications.
package outbox

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/clario360/platform/internal/events"
)

// Status values for an outbox row's lifecycle:
// pending → publishing → published, with retries returning a row to pending
// and exhausted or poisoned rows parked as failed for operator triage.
const (
	StatusPending    = "pending"
	StatusPublishing = "publishing"
	StatusPublished  = "published"
	StatusFailed     = "failed"
)

// Row is one staged event awaiting publication.
type Row struct {
	ID            string
	EventID       string
	TenantID      string
	Topic         string
	EventType     string
	Payload       []byte
	Status        string
	Attempts      int
	LastError     string
	CreatedAt     time.Time
	NextAttemptAt time.Time
	ClaimedAt     *time.Time
	PublishedAt   *time.Time
}

// Querier is the subset of pgx.Tx (and *pgxpool.Pool) the writer needs.
// Passing the caller's open transaction is what makes the write transactional
// with the business data.
type Querier interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

const insertSQL = `INSERT INTO event_outbox (event_id, tenant_id, topic, event_type, payload) VALUES ($1, $2, $3, $4, $5)`

// Write stages a single event for publication to topic. It must be called
// with the transaction that carries the business write the event describes;
// the event is then staged and published if — and only if — that transaction
// commits.
func Write(ctx context.Context, q Querier, topic string, event *events.Event) error {
	if err := validate(topic, event); err != nil {
		return err
	}

	payload, err := event.Marshal()
	if err != nil {
		return fmt.Errorf("marshaling outbox event %s: %w", event.ID, err)
	}

	if _, err := q.Exec(ctx, insertSQL, event.ID, event.TenantID, topic, event.Type, payload); err != nil {
		return fmt.Errorf("staging outbox event %s to %s: %w", event.ID, topic, err)
	}

	return nil
}

// WriteBatch stages multiple events for publication to topic within the
// caller's transaction. Events are staged in order; relative ordering within
// a tenant is preserved through to the bus because the relay claims oldest
// first and the producer partitions by tenant ID.
func WriteBatch(ctx context.Context, q Querier, topic string, batch []*events.Event) error {
	for _, event := range batch {
		if err := Write(ctx, q, topic, event); err != nil {
			return err
		}
	}
	return nil
}

func validate(topic string, event *events.Event) error {
	if topic == "" {
		return fmt.Errorf("outbox: topic is required")
	}
	if event == nil {
		return fmt.Errorf("outbox: event is required")
	}
	if err := event.Validate(); err != nil {
		return fmt.Errorf("outbox: invalid event: %w", err)
	}
	return nil
}
