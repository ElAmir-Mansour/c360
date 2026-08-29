package migrate

import (
	"context"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

// events.go (Wave 5, H1) stages Clario Migrate lifecycle events into the SHARED
// transactional outbox (internal/events/outbox) so they are published to the
// migrate.events Kafka topic by the SHARED relay and turned into notifications by
// the SHARED notification-service consumer. It does NOT build a second event bus,
// a second relay, or a second notification pipeline — it REUSES the platform
// primitives exactly as license-service, workflow-engine and clario-dr-service do.
//
// Every stageEvent call is made with the migrate tx (a DBTX, which satisfies
// outbox.Querier via Exec) INSIDE the same database.RunWithTenant closure as the
// business write it describes, so the event row commits or rolls back atomically
// with the state change. There is no fire-and-forget publish.

// eventSource is the CloudEvents `source` for every migrate-emitted event.
const eventSource = "migrate-service"

// Migrate CloudEvent types. These are the NORMALIZED types the events package
// produces (events.NewEvent prefixes "com.clario360." when absent) and the
// notification rule engine matches on. Keeping them as constants means the
// service emission and the notification rules cannot drift.
const (
	// Move-group approval lifecycle. SubmittedMoveGroup routes an approval
	// request to migrate-approver; the decision is broadcast for audit/UI.
	EventMoveGroupSubmitted = "com.clario360.migrate.move_group.submitted"
	EventMoveGroupDecided   = "com.clario360.migrate.move_group.decided"

	// Gate go/no-go decision on a cutover window.
	EventGateDecided = "com.clario360.migrate.gate.decided"

	// Cutover execution lifecycle. Started == the live cutover DR run kicked off
	// (workloads entering cutover); Completed == the run succeeded and workloads
	// are live; Failed == the run failed.
	EventCutoverStarted   = "com.clario360.migrate.cutover.started"
	EventCutoverCompleted = "com.clario360.migrate.cutover.completed"
	EventCutoverFailed    = "com.clario360.migrate.cutover.failed"

	// Rollback execution lifecycle.
	EventRollbackInitiated = "com.clario360.migrate.rollback.initiated"
	EventRollbackCompleted = "com.clario360.migrate.rollback.completed"
)

// MoveGroupEvent is the payload for move-group submit/decide events. The
// recipient-resolution fields (program owner, submitter) travel in the payload so
// the notification consumer can route/direct without a second lookup.
type MoveGroupEvent struct {
	ProgramID     uuid.UUID `json:"program_id"`
	MoveGroupID   uuid.UUID `json:"move_group_id"`
	Reference     string    `json:"reference"`
	Name          string    `json:"name"`
	Status        string    `json:"status"`
	SubmittedBy   string    `json:"submitted_by,omitempty"`
	DecidedBy     string    `json:"decided_by,omitempty"`
	Approved      *bool     `json:"approved,omitempty"`
	Rationale     string    `json:"rationale,omitempty"`
	WorkloadCount int       `json:"workload_count,omitempty"`
}

// GateEvent is the payload for a window go/no-go decision.
type GateEvent struct {
	ProgramID uuid.UUID `json:"program_id"`
	WaveID    uuid.UUID `json:"wave_id"`
	WindowID  uuid.UUID `json:"window_id"`
	Reference string    `json:"reference"`
	Decision  string    `json:"decision"`
	Rationale string    `json:"rationale,omitempty"`
	DecidedBy string    `json:"decided_by,omitempty"`
}

// CutoverEvent is the payload for cutover-run start/complete/fail events.
type CutoverEvent struct {
	ProgramID   uuid.UUID `json:"program_id"`
	WaveID      uuid.UUID `json:"wave_id"`
	WindowID    uuid.UUID `json:"window_id"`
	Reference   string    `json:"reference"`
	Mode        string    `json:"mode,omitempty"`
	DRRunbookID string    `json:"dr_runbook_id,omitempty"`
	DRRunID     string    `json:"dr_run_id,omitempty"`
	RunStatus   string    `json:"run_status,omitempty"`
	ActorID     string    `json:"actor_id,omitempty"`
}

// RollbackEvent is the payload for rollback-run initiate/complete events.
type RollbackEvent struct {
	ProgramID   uuid.UUID `json:"program_id"`
	WaveID      uuid.UUID `json:"wave_id"`
	WindowID    uuid.UUID `json:"window_id"`
	Reference   string    `json:"reference"`
	Reason      string    `json:"reason,omitempty"`
	DRRunbookID string    `json:"dr_runbook_id,omitempty"`
	DRRunID     string    `json:"dr_run_id,omitempty"`
	RunStatus   string    `json:"run_status,omitempty"`
	TriggeredBy string    `json:"triggered_by,omitempty"`
}

// stageEvent stages a migrate CloudEvent to the migrate.events topic through the
// shared outbox, INSIDE the caller's open transaction. tx is the migrate DBTX,
// whose Exec(ctx, sql, args) (pgconn.CommandTag, error) satisfies outbox.Querier,
// so the caller's open transaction is what makes the write transactional with the
// business data. It MUST be called from within a database.RunWithTenant closure
// (never with the pool) so the event row commits or rolls back atomically with
// the state change — there is no fire-and-forget publish.
func (s *Service) stageEvent(ctx context.Context, tx DBTX, tenantID uuid.UUID, eventType string, actor *uuid.UUID, data any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID.String(), data)
	if err != nil {
		return err
	}
	if actor != nil && *actor != uuid.Nil {
		event.UserID = actor.String()
	}
	return outbox.Write(ctx, tx, events.Topics.MigrateEvents, event)
}

// drRunIDString renders an optional DR run id for an event payload.
func drRunIDString(id *uuid.UUID) string {
	if id == nil || *id == uuid.Nil {
		return ""
	}
	return id.String()
}

// actorIDString renders a non-nil actor id for an event payload.
func actorIDString(id uuid.UUID) string {
	if id == uuid.Nil {
		return ""
	}
	return id.String()
}
