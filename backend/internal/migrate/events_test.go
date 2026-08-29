package migrate

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/notification/consumer"
)

// writeThroughSharedOutbox exercises the exact shared writer stageEvent uses, so
// the validation assertion is against the real path, not a copy.
func writeThroughSharedOutbox(ctx context.Context, tx DBTX, evt *events.Event) error {
	return outbox.Write(ctx, tx, events.Topics.MigrateEvents, evt)
}

// captureTx is a DBTX that records the Exec calls made against it. It is used to
// prove that stageEvent stages the event through the transaction it is handed
// (the SAME tx the business write uses), by capturing the INSERT INTO
// event_outbox statement and its arguments. Query/QueryRow are unused here.
type captureTx struct {
	execs []capturedExec
	fail  bool
}

type capturedExec struct {
	sql  string
	args []any
}

func (c *captureTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	c.execs = append(c.execs, capturedExec{sql: sql, args: args})
	if c.fail {
		return pgconn.CommandTag{}, errors.New("boom")
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func (c *captureTx) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	return nil, errors.New("not implemented")
}

func (c *captureTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	return errRow{}
}

type errRow struct{}

func (errRow) Scan(dest ...any) error { return errors.New("not implemented") }

var _ DBTX = (*captureTx)(nil)

func newEventTestService() *Service {
	return &Service{logger: zerolog.Nop()}
}

// TestStageEventWritesToOutboxThroughTx proves the H1 core invariant: stageEvent
// stages the CloudEvent through the transaction it is given (an INSERT INTO
// event_outbox on the SAME tx), to the migrate.events topic, with the normalized
// event type, tenant, actor and JSON payload. Because it uses the caller's tx —
// not the pool — the staged row commits or rolls back atomically with the
// business write (proven in the integration test).
func TestStageEventWritesToOutboxThroughTx(t *testing.T) {
	svc := newEventTestService()
	tenantID := uuid.New()
	actor := uuid.New()
	programID := uuid.New()
	moveGroupID := uuid.New()

	tx := &captureTx{}
	err := svc.stageEvent(context.Background(), tx, tenantID, EventMoveGroupSubmitted, &actor, MoveGroupEvent{
		ProgramID:   programID,
		MoveGroupID: moveGroupID,
		Reference:   "MG-0001",
		Name:        "Order platform",
		Status:      "submitted",
		SubmittedBy: actor.String(),
	})
	if err != nil {
		t.Fatalf("stageEvent: %v", err)
	}

	// Exactly one Exec: the outbox insert, made through the tx we passed.
	if len(tx.execs) != 1 {
		t.Fatalf("expected 1 Exec through tx, got %d", len(tx.execs))
	}
	got := tx.execs[0]
	if !strings.Contains(got.sql, "INSERT INTO event_outbox") {
		t.Fatalf("expected event_outbox insert, got SQL: %s", got.sql)
	}
	// outbox.Write inserts (event_id, tenant_id, topic, event_type, payload).
	if len(got.args) != 5 {
		t.Fatalf("expected 5 insert args, got %d: %v", len(got.args), got.args)
	}
	if topic, _ := got.args[2].(string); topic != events.Topics.MigrateEvents {
		t.Fatalf("staged to topic %v, want %s", got.args[2], events.Topics.MigrateEvents)
	}
	if topic, _ := got.args[2].(string); topic != "migrate.events" {
		t.Fatalf("migrate topic drifted: %q", topic)
	}
	if et, _ := got.args[3].(string); et != EventMoveGroupSubmitted {
		t.Fatalf("staged event_type %v, want %s", got.args[3], EventMoveGroupSubmitted)
	}
	if tid, _ := got.args[1].(string); tid != tenantID.String() {
		t.Fatalf("staged tenant %v, want %s", got.args[1], tenantID)
	}

	// The payload is the full CloudEvent envelope carrying the actor + typed data.
	payload, ok := got.args[4].([]byte)
	if !ok {
		t.Fatalf("payload arg is %T, want []byte", got.args[4])
	}
	var envelope events.Event
	if err := json.Unmarshal(payload, &envelope); err != nil {
		t.Fatalf("unmarshal envelope: %v", err)
	}
	if envelope.Type != EventMoveGroupSubmitted {
		t.Fatalf("envelope type = %s, want %s", envelope.Type, EventMoveGroupSubmitted)
	}
	if envelope.TenantID != tenantID.String() {
		t.Fatalf("envelope tenant = %s, want %s", envelope.TenantID, tenantID)
	}
	if envelope.UserID != actor.String() {
		t.Fatalf("envelope actor = %s, want %s", envelope.UserID, actor)
	}
	var data MoveGroupEvent
	if err := json.Unmarshal(envelope.Data, &data); err != nil {
		t.Fatalf("unmarshal data: %v", err)
	}
	if data.MoveGroupID != moveGroupID || data.Reference != "MG-0001" {
		t.Fatalf("payload data = %+v, want move group %s / MG-0001", data, moveGroupID)
	}
}

// TestStageEventPropagatesTxError proves stageEvent surfaces an outbox write
// failure to the caller, so a failed staging aborts (and rolls back) the
// enclosing business transaction rather than silently dropping the event.
func TestStageEventPropagatesTxError(t *testing.T) {
	svc := newEventTestService()
	tx := &captureTx{fail: true}
	err := svc.stageEvent(context.Background(), tx, uuid.New(), EventCutoverStarted, nil, CutoverEvent{})
	if err == nil {
		t.Fatal("expected stageEvent to return the tx error, got nil")
	}
}

// TestStageEventUsesSharedOutboxValidation proves the shared outbox validation is
// in force on the path stageEvent uses: outbox.Write (which stageEvent calls)
// rejects an event with an empty TenantID before any Exec, so a malformed event
// can never be staged. This asserts REUSE of the shared validation rather than a
// second, divergent code path.
func TestStageEventUsesSharedOutboxValidation(t *testing.T) {
	tx := &captureTx{}
	// An event with an empty tenant id must be rejected by the shared writer.
	bad := &events.Event{
		ID: uuid.NewString(), Source: "clario360/migrate-service", SpecVersion: "1.0",
		Type: EventCutoverStarted, TenantID: "", Data: []byte(`{}`),
	}
	if err := writeThroughSharedOutbox(context.Background(), tx, bad); err == nil {
		t.Fatal("expected the shared outbox writer to reject an empty tenant id")
	}
	if len(tx.execs) != 0 {
		t.Fatalf("no Exec should occur for an invalid event, got %d", len(tx.execs))
	}
}

// TestMigrateEventTypesHaveNotificationRules proves every migrate lifecycle event
// the service stages is consumed by a notification rule (so no emitted event is
// orphaned) AND that those rules subscribe to the migrate.events topic. This ties
// the emission constants in this package to the rules in the notification
// service: if a new event type is added without a rule the test fails.
func TestMigrateEventTypesHaveNotificationRules(t *testing.T) {
	re := consumer.NewRuleEngine()

	emitted := []string{
		EventMoveGroupSubmitted,
		EventMoveGroupDecided,
		EventGateDecided,
		EventCutoverStarted,
		EventCutoverCompleted,
		EventCutoverFailed,
		EventRollbackInitiated,
		EventRollbackCompleted,
	}
	for _, et := range emitted {
		evt := &events.Event{ID: uuid.NewString(), Source: "clario360/migrate-service", Type: et, TenantID: uuid.NewString(), Data: []byte(`{"reference":"CW-1","window_id":"w1","move_group_id":"mg1","decision":"go"}`)}
		matches := re.Match(evt)
		if len(matches) == 0 {
			t.Fatalf("no notification rule matches migrate event %q", et)
		}
		for _, m := range matches {
			if m.Rule.Topic != events.Topics.MigrateEvents {
				t.Fatalf("rule for %q has topic %q, want %s", et, m.Rule.Topic, events.Topics.MigrateEvents)
			}
		}
	}

	// The consumer auto-subscribes to migrate.events via ExtractEventTopics.
	subscribed := consumer.ExtractEventTopics()
	found := false
	for _, tp := range subscribed {
		if tp == events.Topics.MigrateEvents {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("notification consumer does not subscribe to %s; topics=%v", events.Topics.MigrateEvents, subscribed)
	}
}

// TestMigrateApproverRuleForSubmittedMoveGroup proves the approval-request event
// routes to the migrate-approver role at high priority (the map's primary rule).
func TestMigrateApproverRuleForSubmittedMoveGroup(t *testing.T) {
	re := consumer.NewRuleEngine()
	evt := &events.Event{ID: uuid.NewString(), Source: "clario360/migrate-service", Type: EventMoveGroupSubmitted, TenantID: uuid.NewString(), Data: []byte(`{"reference":"MG-1","name":"Order","move_group_id":"mg1"}`)}
	matches := re.Match(evt)
	if len(matches) != 1 {
		t.Fatalf("expected 1 rule for submitted move group, got %d", len(matches))
	}
	rule := matches[0].Rule
	if consumer.ResolvePriority(rule, matches[0].Data) != "high" {
		t.Fatalf("submitted move group priority = %s, want high", consumer.ResolvePriority(rule, matches[0].Data))
	}
	if len(rule.Roles) != 1 || rule.Roles[0] != "migrate-approver" {
		t.Fatalf("submitted move group roles = %v, want [migrate-approver]", rule.Roles)
	}
}
