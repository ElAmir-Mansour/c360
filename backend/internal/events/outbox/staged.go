package outbox

import (
	"context"

	"github.com/clario360/platform/internal/events"
)

// Staged is a drop-in publisher that stages events in the outbox table
// instead of sending them to the bus. It satisfies the narrow
// Publish(ctx, topic, event) interfaces services already inject (e.g. the
// workflow engine's eventPublisher), so adopting the outbox is a wiring
// change, not a service rewrite: inject Staged where the Kafka producer was,
// and run a Relay against the same database.
//
// Staging is a single local INSERT, so an event survives broker outages,
// service crashes after commit, and restarts — the relay delivers it when
// the bus is reachable. Callers holding an open transaction should prefer
// Write/WriteBatch directly with their pgx.Tx for full atomicity with the
// business write; Staged covers call sites that publish outside any
// transaction, replacing fire-and-forget Kafka calls with durable staging.
type Staged struct {
	db Querier
}

// NewStaged returns a publisher staging into the outbox via db
// (typically the service's *pgxpool.Pool).
func NewStaged(db Querier) *Staged {
	return &Staged{db: db}
}

// Publish stages the event for delivery to topic. It returns an error only
// if the local INSERT fails; delivery itself is the relay's responsibility.
func (s *Staged) Publish(ctx context.Context, topic string, event *events.Event) error {
	return Write(ctx, s.db, topic, event)
}
