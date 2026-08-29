//go:build integration

package outbox

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
)

const testTenantID = "aaaaaaaa-0000-0000-0000-000000000001"

// startPostgresBare launches a disposable postgres with no outbox schema.
func startPostgresBare(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("outbox_it"),
		postgresmod.WithUsername("outbox"),
		postgresmod.WithPassword("outbox"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dbURL := container.MustConnectionString(ctx, "sslmode=disable")
	pool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		t.Fatalf("open postgres pool: %v", err)
	}
	t.Cleanup(pool.Close)
	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping postgres: %v", err)
	}

	return ctx, pool
}

// startPostgres launches a disposable postgres and applies the outbox
// migration exactly as it ships in migrations/platform_core.
func startPostgres(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	ctx, pool := startPostgresBare(t)

	migration, err := os.ReadFile(filepath.Join(migrationsPath(t), "000015_event_outbox.up.sql"))
	if err != nil {
		t.Fatalf("read outbox migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("apply outbox migration: %v", err)
	}

	return ctx, pool
}

func migrationsPath(t *testing.T) string {
	t.Helper()
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolving caller path")
	}
	// internal/events/outbox -> backend/migrations/platform_core
	return filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "platform_core")
}

func newIntegrationEvent(t *testing.T) *events.Event {
	t.Helper()
	event, err := events.NewEvent("workflow.instance.started", "workflow-engine", testTenantID, map[string]string{"k": "v"})
	if err != nil {
		t.Fatalf("NewEvent() error = %v", err)
	}
	return event
}

func rowStatus(t *testing.T, ctx context.Context, pool *pgxpool.Pool, eventID string) (status string, attempts int) {
	t.Helper()
	err := pool.QueryRow(ctx, `SELECT status, attempts FROM event_outbox WHERE event_id = $1`, eventID).
		Scan(&status, &attempts)
	if err != nil {
		t.Fatalf("querying row status for %s: %v", eventID, err)
	}
	return status, attempts
}

func TestIntegration_CommittedWriteIsPublished(t *testing.T) {
	ctx, pool := startPostgres(t)

	publisher := &fakePublisher{}
	relay := NewRelay(pool, publisher, Config{}, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))

	staged := make([]*events.Event, 0, 3)
	err := database.RunInTx(ctx, pool, func(tx pgx.Tx) error {
		for i := 0; i < 3; i++ {
			event := newIntegrationEvent(t)
			if err := Write(ctx, tx, events.Topics.WorkflowEvents, event); err != nil {
				return err
			}
			staged = append(staged, event)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("staging events in tx: %v", err)
	}

	claimed, err := relay.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if claimed != 3 {
		t.Fatalf("RunOnce() claimed = %d, want 3", claimed)
	}
	if publisher.callCount() != 3 {
		t.Fatalf("publisher calls = %d, want 3", publisher.callCount())
	}
	for _, event := range staged {
		status, attempts := rowStatus(t, ctx, pool, event.ID)
		if status != StatusPublished {
			t.Fatalf("event %s status = %s, want published", event.ID, status)
		}
		if attempts != 1 {
			t.Fatalf("event %s attempts = %d, want 1", event.ID, attempts)
		}
	}
}

func TestIntegration_RolledBackWriteIsNeverPublished(t *testing.T) {
	ctx, pool := startPostgres(t)

	publisher := &fakePublisher{}
	relay := NewRelay(pool, publisher, Config{}, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))

	event := newIntegrationEvent(t)
	sentinel := errors.New("business rule violated")
	err := database.RunInTx(ctx, pool, func(tx pgx.Tx) error {
		if err := Write(ctx, tx, events.Topics.WorkflowEvents, event); err != nil {
			return err
		}
		return sentinel // rollback: the business write failed
	})
	if !errors.Is(err, sentinel) {
		t.Fatalf("RunInTx() error = %v, want sentinel rollback error", err)
	}

	claimed, err := relay.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if claimed != 0 {
		t.Fatalf("RunOnce() claimed = %d, want 0 after rollback", claimed)
	}
	if publisher.callCount() != 0 {
		t.Fatalf("publisher calls = %d, want 0 after rollback", publisher.callCount())
	}

	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM event_outbox`).Scan(&count); err != nil {
		t.Fatalf("counting outbox rows: %v", err)
	}
	if count != 0 {
		t.Fatalf("outbox rows = %d, want 0 after rollback", count)
	}
}

func TestIntegration_FailedPublishRetriesWithBackoffThenSucceeds(t *testing.T) {
	ctx, pool := startPostgres(t)

	publisher := &fakePublisher{err: errors.New("broker down")}
	relay := NewRelay(pool, publisher, Config{
		RetryBackoffBase: 50 * time.Millisecond,
		RetryBackoffCap:  time.Second,
	}, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))

	event := newIntegrationEvent(t)
	if err := Write(ctx, pool, events.Topics.WorkflowEvents, event); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	// First pass: publish fails, row is rescheduled into the future.
	if _, err := relay.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	status, attempts := rowStatus(t, ctx, pool, event.ID)
	if status != StatusPending || attempts != 1 {
		t.Fatalf("after failed publish: status=%s attempts=%d, want pending/1", status, attempts)
	}

	// Immediately after, the row is not yet due — nothing claims.
	claimed, err := relay.RunOnce(ctx)
	if err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if claimed != 0 {
		t.Fatalf("claimed %d rows before backoff elapsed, want 0", claimed)
	}

	// After the backoff window the broker is healthy again and publish succeeds.
	time.Sleep(60 * time.Millisecond)
	publisher.mu.Lock()
	publisher.err = nil
	publisher.mu.Unlock()

	if _, err := relay.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	status, attempts = rowStatus(t, ctx, pool, event.ID)
	if status != StatusPublished || attempts != 2 {
		t.Fatalf("after recovery: status=%s attempts=%d, want published/2", status, attempts)
	}
}

func TestIntegration_ConcurrentRelaysNeverDoubleClaim(t *testing.T) {
	ctx, pool := startPostgres(t)

	const total = 50
	for i := 0; i < total; i++ {
		if err := Write(ctx, pool, events.Topics.WorkflowEvents, newIntegrationEvent(t)); err != nil {
			t.Fatalf("Write() error = %v", err)
		}
	}

	// Two relay instances share one recording publisher; FOR UPDATE SKIP
	// LOCKED + the status flip must guarantee disjoint claims.
	publisher := &fakePublisher{}
	cfg := Config{BatchSize: 10}
	relayA := NewRelay(pool, publisher, cfg, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))
	relayB := NewRelay(pool, publisher, cfg, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))

	var wg sync.WaitGroup
	for _, relay := range []*Relay{relayA, relayB} {
		wg.Add(1)
		go func(r *Relay) {
			defer wg.Done()
			for {
				claimed, err := r.RunOnce(ctx)
				if err != nil {
					t.Errorf("RunOnce() error = %v", err)
					return
				}
				if claimed == 0 {
					return
				}
			}
		}(relay)
	}
	wg.Wait()

	if publisher.callCount() != total {
		t.Fatalf("publisher calls = %d, want exactly %d (no double-claims, no losses)", publisher.callCount(), total)
	}
	seen := make(map[string]int)
	publisher.mu.Lock()
	for _, call := range publisher.calls {
		seen[call.eventID]++
	}
	publisher.mu.Unlock()
	for eventID, n := range seen {
		if n != 1 {
			t.Fatalf("event %s published %d times, want exactly once", eventID, n)
		}
	}
}

func TestIntegration_ReaperRecoversStuckRows(t *testing.T) {
	ctx, pool := startPostgres(t)

	publisher := &fakePublisher{}
	relay := NewRelay(pool, publisher, Config{ClaimTimeout: 100 * time.Millisecond}, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))

	event := newIntegrationEvent(t)
	if err := Write(ctx, pool, events.Topics.WorkflowEvents, event); err != nil {
		t.Fatalf("Write() error = %v", err)
	}

	// Simulate a relay that died mid-batch: claimed but never resolved.
	if _, err := pool.Exec(ctx,
		`UPDATE event_outbox SET status = 'publishing', attempts = 1, claimed_at = now() - interval '1 hour' WHERE event_id = $1`,
		event.ID); err != nil {
		t.Fatalf("simulating stuck row: %v", err)
	}

	reaped, err := relay.ReapStuck(ctx)
	if err != nil {
		t.Fatalf("ReapStuck() error = %v", err)
	}
	if reaped != 1 {
		t.Fatalf("ReapStuck() = %d, want 1", reaped)
	}

	// The recovered row is immediately claimable and publishes.
	if _, err := relay.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	status, attempts := rowStatus(t, ctx, pool, event.ID)
	if status != StatusPublished || attempts != 2 {
		t.Fatalf("after reap+republish: status=%s attempts=%d, want published/2", status, attempts)
	}
}

// outboxColumns is the canonical column set of event_outbox; the migration
// file and EnsureSchema must both produce exactly this.
var outboxColumns = []string{
	"attempts", "claimed_at", "created_at", "event_id", "event_type",
	"id", "last_error", "next_attempt_at", "payload", "published_at",
	"status", "tenant_id", "topic",
}

func assertOutboxColumns(t *testing.T, ctx context.Context, pool *pgxpool.Pool, origin string) {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT column_name FROM information_schema.columns WHERE table_name = 'event_outbox' ORDER BY column_name`)
	if err != nil {
		t.Fatalf("querying columns: %v", err)
	}
	defer rows.Close()

	var got []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scanning column name: %v", err)
		}
		got = append(got, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("reading columns: %v", err)
	}

	if len(got) != len(outboxColumns) {
		t.Fatalf("%s produced columns %v, want %v", origin, got, outboxColumns)
	}
	for i := range got {
		if got[i] != outboxColumns[i] {
			t.Fatalf("%s produced columns %v, want %v", origin, got, outboxColumns)
		}
	}
}

func TestIntegration_EnsureSchemaIsIdempotentAndMatchesMigration(t *testing.T) {
	ctx, pool := startPostgresBare(t)

	// EnsureSchema bootstraps a bare database and is idempotent.
	if err := EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("EnsureSchema() first run error = %v", err)
	}
	if err := EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("EnsureSchema() second run error = %v", err)
	}
	assertOutboxColumns(t, ctx, pool, "EnsureSchema")

	// The shipped migration applies cleanly on top — the two definitions
	// have not drifted apart.
	migration, err := os.ReadFile(filepath.Join(migrationsPath(t), "000015_event_outbox.up.sql"))
	if err != nil {
		t.Fatalf("read outbox migration: %v", err)
	}
	if _, err := pool.Exec(ctx, string(migration)); err != nil {
		t.Fatalf("migration on top of EnsureSchema failed — definitions drifted: %v", err)
	}
	assertOutboxColumns(t, ctx, pool, "EnsureSchema+migration")

	// The EnsureSchema-created table is fully functional: stage via the
	// Staged publisher, deliver via the relay.
	publisher := &fakePublisher{}
	relay := NewRelay(pool, publisher, Config{}, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))

	staged := NewStaged(pool)
	event := newIntegrationEvent(t)
	if err := staged.Publish(ctx, events.Topics.WorkflowEvents, event); err != nil {
		t.Fatalf("Staged.Publish() error = %v", err)
	}

	if _, err := relay.RunOnce(ctx); err != nil {
		t.Fatalf("RunOnce() error = %v", err)
	}
	if publisher.callCount() != 1 {
		t.Fatalf("publisher calls = %d, want 1", publisher.callCount())
	}
	status, _ := rowStatus(t, ctx, pool, event.ID)
	if status != StatusPublished {
		t.Fatalf("status = %s, want published", status)
	}
}

func TestIntegration_MigrationThenEnsureSchemaIsCompatible(t *testing.T) {
	ctx, pool := startPostgres(t) // migration applied

	if err := EnsureSchema(ctx, pool); err != nil {
		t.Fatalf("EnsureSchema() on migrated database error = %v", err)
	}
	assertOutboxColumns(t, ctx, pool, "migration+EnsureSchema")
}

func TestIntegration_PurgeRemovesOnlyExpiredPublishedRows(t *testing.T) {
	ctx, pool := startPostgres(t)

	relay := NewRelay(pool, &fakePublisher{}, Config{RetentionPeriod: time.Hour}, zerolog.Nop(), NewMetrics(prometheus.NewRegistry()))

	expired := newIntegrationEvent(t)
	fresh := newIntegrationEvent(t)
	pending := newIntegrationEvent(t)
	for _, event := range []*events.Event{expired, fresh, pending} {
		if err := Write(ctx, pool, events.Topics.WorkflowEvents, event); err != nil {
			t.Fatalf("Write() error = %v", err)
		}
	}
	if _, err := pool.Exec(ctx,
		`UPDATE event_outbox SET status = 'published', published_at = now() - interval '2 hours' WHERE event_id = $1`,
		expired.ID); err != nil {
		t.Fatalf("aging published row: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`UPDATE event_outbox SET status = 'published', published_at = now() WHERE event_id = $1`,
		fresh.ID); err != nil {
		t.Fatalf("marking fresh row published: %v", err)
	}

	purged, err := relay.PurgePublished(ctx)
	if err != nil {
		t.Fatalf("PurgePublished() error = %v", err)
	}
	if purged != 1 {
		t.Fatalf("PurgePublished() = %d, want 1 (only the expired row)", purged)
	}

	var remaining int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM event_outbox`).Scan(&remaining); err != nil {
		t.Fatalf("counting remaining rows: %v", err)
	}
	if remaining != 2 {
		t.Fatalf("remaining rows = %d, want 2 (fresh published + pending)", remaining)
	}
}
