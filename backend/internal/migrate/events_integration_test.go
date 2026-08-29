//go:build integration

package migrate

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
)

// outboxRowsFor returns the staged event_outbox rows for a tenant of a given
// event_type, ordered oldest first. Reading straight from the table proves the
// event was COMMITTED by the business transaction — the relay is not involved.
func outboxRowsFor(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID uuid.UUID, eventType string) []outboxTestRow {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT event_id, topic, event_type, status, payload FROM event_outbox
		   WHERE tenant_id=$1 AND event_type=$2 ORDER BY created_at`, tenantID, eventType)
	if err != nil {
		t.Fatalf("query event_outbox for %s: %v", eventType, err)
	}
	defer rows.Close()
	var out []outboxTestRow
	for rows.Next() {
		var r outboxTestRow
		if err := rows.Scan(&r.EventID, &r.Topic, &r.EventType, &r.Status, &r.Payload); err != nil {
			t.Fatalf("scan event_outbox row: %v", err)
		}
		out = append(out, r)
	}
	return out
}

type outboxTestRow struct {
	EventID   uuid.UUID
	Topic     string
	EventType string
	Status    string
	Payload   []byte
}

func countOutbox(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM event_outbox WHERE tenant_id=$1`, tenantID).Scan(&n); err != nil {
		t.Fatalf("count event_outbox: %v", err)
	}
	return n
}

// requireStaged asserts exactly one pending outbox row of eventType exists for
// the tenant, staged to the migrate.events topic.
func requireStaged(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID uuid.UUID, eventType string) outboxTestRow {
	t.Helper()
	rows := outboxRowsFor(t, ctx, pool, tenantID, eventType)
	if len(rows) != 1 {
		t.Fatalf("expected exactly 1 staged %s event, got %d", eventType, len(rows))
	}
	r := rows[0]
	if r.Topic != "migrate.events" {
		t.Fatalf("%s staged to topic %q, want migrate.events", eventType, r.Topic)
	}
	if r.Status != "pending" {
		t.Fatalf("%s staged with status %q, want pending", eventType, r.Status)
	}
	return r
}

// TestIntegrationMoveGroupSubmitStagesEventInTx proves that SubmitMoveGroup and
// DecideMoveGroup each stage their CloudEvent into event_outbox in the SAME
// committed transaction as the business write — a real row is present after the
// call, on the migrate.events topic, still pending (the relay has not run).
func TestIntegrationMoveGroupSubmitStagesEventInTx(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	tenantID := uuid.New()
	actor := fullActor()

	programID, _, _ := seedWaveForCutover(t, ctx, svc, tenantID, actor)
	_ = programID

	// seedWaveForCutover already ran submit + approve on its move group, so both
	// the submitted and decided events must be staged.
	sub := requireStaged(t, ctx, pool, tenantID, EventMoveGroupSubmitted)
	if sub.EventID == uuid.Nil {
		t.Fatal("submitted event has no event_id")
	}
	requireStaged(t, ctx, pool, tenantID, EventMoveGroupDecided)
}

// TestIntegrationCutoverLifecycleStagesEventsInTx drives the real gate + cutover
// + rollback transitions (non-DR-bridge path) and proves each terminal state
// change stages its migrate.* event transactionally: gate.decided on go/no-go,
// cutover.started on StartCutover, cutover.completed on CompleteCutover, and
// rollback.completed on RollbackCutover.
func TestIntegrationCutoverLifecycleStagesEventsInTx(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	tenantID := uuid.New()
	actor := fullActor()

	programID, _, windowID := seedWaveForCutover(t, ctx, svc, tenantID, actor)

	// Drive workloads discovered -> planned so the cutover has legal starting state.
	wls, _, err := svc.ListWorkloads(ctx, tenantID, programID, actor, "", nil, 100, 0)
	if err != nil {
		t.Fatalf("list workloads: %v", err)
	}
	for _, w := range wls {
		cur := w
		for _, to := range []WorkloadStatus{WorkloadAssessed, WorkloadPlanned} {
			updated, err := svc.TransitionWorkload(ctx, tenantID, cur.ID, to, cur.RowVersion, "prep", actor)
			if err != nil {
				t.Fatalf("transition %s -> %s: %v", cur.AppKey, to, err)
			}
			cur = *updated
		}
	}

	// Go decision → gate.decided staged.
	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckReadiness, actor)
	if _, err := svc.DecideGoNoGo(ctx, tenantID, DecisionInput{ID: windowID, Decision: DecisionGo, ExpectedVersion: 1, Actor: actor}); err != nil {
		t.Fatalf("go decision: %v", err)
	}
	gate := requireStaged(t, ctx, pool, tenantID, EventGateDecided)
	if gate.EventID == uuid.Nil {
		t.Fatal("gate.decided event has no event_id")
	}

	// StartCutover → cutover.started staged.
	if _, err := svc.StartCutover(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("start cutover: %v", err)
	}
	requireStaged(t, ctx, pool, tenantID, EventCutoverStarted)

	// CompleteCutover → cutover.completed staged.
	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckValidation, actor)
	if _, err := svc.CompleteCutover(ctx, tenantID, windowID, actor); err != nil {
		t.Fatalf("complete cutover: %v", err)
	}
	requireStaged(t, ctx, pool, tenantID, EventCutoverCompleted)

	// RollbackCutover → rollback.completed staged.
	seedReadyGate(t, ctx, svc, tenantID, programID, windowID, CheckRollbackSuccess, actor)
	if _, err := svc.RollbackCutover(ctx, tenantID, windowID, "post-cutover regression", actor); err != nil {
		t.Fatalf("rollback cutover: %v", err)
	}
	requireStaged(t, ctx, pool, tenantID, EventRollbackCompleted)
}

// rollbackAfterRunner wraps the real pgx tenant runner but forces the write
// transaction to ROLL BACK after the service closure has run successfully (by
// returning a sentinel error from the wrapping fn). Reads pass through unchanged.
// This lets a test observe what a service method staged and then prove none of it
// — the business write AND the outbox event — survives, because they share one tx.
type rollbackAfterRunner struct {
	pool  *pgxpool.Pool
	arm   bool
	fired bool
}

var errForcedRollback = errors.New("forced rollback for atomicity test")

func (r *rollbackAfterRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	err := database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error {
		if ferr := fn(tx); ferr != nil {
			return ferr
		}
		if r.arm {
			r.fired = true
			return errForcedRollback // aborts the tx: BEGIN..ROLLBACK
		}
		return nil
	})
	if r.arm && errors.Is(err, errForcedRollback) {
		return nil // swallow the sentinel so the service call "succeeds" from the caller's view
	}
	return err
}

func (r *rollbackAfterRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// TestIntegrationStagedEventRollsBackWithBusinessTx proves the transactional-
// outbox guarantee end to end: the gate.decided event stages successfully INSIDE
// the DecideGoNoGo transaction, but because that transaction is then rolled back,
// the staged event_outbox row does NOT survive. The event never outlives a
// rolled-back business write — there is no fire-and-forget publish.
func TestIntegrationStagedEventRollsBackWithBusinessTx(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	tenantID := uuid.New()
	actor := fullActor()

	// Seed with a normal service so the fixtures commit.
	seedSvc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	programID, _, windowID := seedWaveForCutover(t, ctx, seedSvc, tenantID, actor)

	before := countOutbox(t, ctx, pool, tenantID)

	// Now run DecideGoNoGo through a runner that forces the write tx to roll back
	// AFTER the closure (staging + business write) has succeeded.
	runner := &rollbackAfterRunner{pool: pool, arm: true}
	rbSvc := NewServiceWithDeps(runner, NewStore(), zerolog.Nop(), allowAllEntitlements{})
	if _, err := rbSvc.DecideGoNoGo(ctx, tenantID, DecisionInput{
		ID: windowID, Decision: DecisionGo, ExpectedVersion: 1, Actor: actor,
	}); err != nil {
		t.Fatalf("decide go/no-go (rollback runner): %v", err)
	}
	if !runner.fired {
		t.Fatal("rollback runner never forced a rollback — closure did not run")
	}

	// The staged event was rolled back with the business write: no new outbox row.
	if after := countOutbox(t, ctx, pool, tenantID); after != before {
		t.Fatalf("a rolled-back tx left %d new outbox row(s); the event outlived the write", after-before)
	}
	if got := len(outboxRowsFor(t, ctx, pool, tenantID, EventGateDecided)); got != 0 {
		t.Fatalf("gate.decided survived a rolled-back write: %d rows", got)
	}

	// And the business write itself rolled back too (window is still undecided).
	windows, _, err := seedSvc.ListWindows(ctx, tenantID, programID, actor, 50, 0)
	if err != nil {
		t.Fatalf("list windows: %v", err)
	}
	for _, w := range windows {
		if w.ID == windowID && w.Decision == DecisionGo {
			t.Fatal("window decision committed despite forced rollback")
		}
	}
}

// TestIntegrationFailedBusinessTxStagesNoEvent proves atomicity from the other
// direction: when the business write is rejected INSIDE the tx (stale expected
// version), the transaction — event included — rolls back and NO event_outbox row
// is committed.
func TestIntegrationFailedBusinessTxStagesNoEvent(t *testing.T) {
	ctx, pool := startMigratePostgres(t)
	svc := NewService(pool, zerolog.Nop(), allowAllEntitlements{})
	tenantID := uuid.New()
	actor := fullActor()

	programID, _, windowID := seedWaveForCutover(t, ctx, svc, tenantID, actor)
	_ = programID

	before := countOutbox(t, ctx, pool, tenantID)

	_, err := svc.DecideGoNoGo(ctx, tenantID, DecisionInput{
		ID: windowID, Decision: DecisionGo, ExpectedVersion: 999, Actor: actor,
	})
	if err == nil {
		t.Fatal("expected version conflict, got nil")
	}

	after := countOutbox(t, ctx, pool, tenantID)
	if after != before {
		t.Fatalf("a rolled-back business tx staged %d new outbox row(s); want 0", after-before)
	}
	if got := len(outboxRowsFor(t, ctx, pool, tenantID, EventGateDecided)); got != 0 {
		t.Fatalf("gate.decided was staged despite a rolled-back write: %d rows", got)
	}
}
