package gameday

import (
	"context"
	"fmt"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// eventSource is the CloudEvents source for game-day events.
const eventSource = "clario-dr-service"

// Game-day event types. They follow com.clario360.datastream.dr.<entity>.<verb>
// (DESIGN §8) and are staged on the existing datastream.dr.events topic. The
// registry/runbook reconcile consumer filters by its own event types, so these
// do not trigger a runbook regeneration loop.
const (
	// eventRunStarted is emitted when a game-day run passes the safety guard and
	// begins injecting faults.
	eventRunStarted = "com.clario360.datastream.dr.gameday.run.started"
	// eventRunCompleted is emitted when a run reaches a terminal status, carrying
	// the aggregate scorecard.
	eventRunCompleted = "com.clario360.datastream.dr.gameday.run.completed"
	// eventRunRejected is emitted when the safety guard refuses a run for a
	// production scope.
	eventRunRejected = "com.clario360.datastream.dr.gameday.run.rejected"
)

// outboxEmitter stages a game-day lifecycle event in the caller's transaction via
// the transactional outbox, so the event commits atomically with the run/step
// state write (DESIGN §8 — lifecycle events are durable, exactly-once).
type outboxEmitter struct{}

// Emit stages a game-day event in the same transaction as the state change.
func (outboxEmitter) Emit(ctx context.Context, db DBTX, tenantID, eventType string, data map[string]any) error {
	evt, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("gameday: building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, db, events.Topics.DREvents, evt)
}

// compile-time check that the outbox emitter satisfies the orchestrator's
// emitter interface.
var _ eventEmitter = outboxEmitter{}
