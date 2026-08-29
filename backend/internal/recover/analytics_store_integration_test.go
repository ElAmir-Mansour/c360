package recover

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// analytics_store_integration_test.go exercises the REAL SQL analytics store
// against a real Postgres, validating the snapshot model<->column alignment, the
// append-only readiness trend (multiple appends accumulate and read back
// newest-first), and the trailing-window filter — the parts the in-memory fake
// cannot. It is guarded by RECOVER_DB_DSN so it is a no-op in normal CI; run it
// with a throwaway Postgres DSN (a superuser bypasses the FORCE RLS policies, so
// no tenant context is needed to drive the raw store directly).
func connectAnalyticsStore(t *testing.T) (context.Context, *pgx.Conn) {
	t.Helper()
	dsn := os.Getenv("RECOVER_DB_DSN")
	if dsn == "" {
		t.Skip("set RECOVER_DB_DSN to run the analytics store integration test")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { conn.Close(ctx) })

	up, err := os.ReadFile("../../migrations/dr_db/000039_recover_analytics_snapshot.up.sql")
	if err != nil {
		t.Fatalf("reading up migration: %v", err)
	}
	if _, err := conn.Exec(ctx, string(up)); err != nil {
		t.Fatalf("applying up migration: %v", err)
	}
	t.Cleanup(func() {
		down, derr := os.ReadFile("../../migrations/dr_db/000039_recover_analytics_snapshot.down.sql")
		if derr == nil {
			_, _ = conn.Exec(context.Background(), string(down))
		}
	})
	return ctx, conn
}

func TestAnalyticsStore_SnapshotRoundTripAndTrend(t *testing.T) {
	ctx, conn := connectAnalyticsStore(t)
	st := NewAnalyticsStore()
	tenant := uuid.New()
	base := time.Unix(1700000000, 0).UTC()

	// Append three snapshots at increasing captured_at instants.
	for i, score := range []int{40, 55, 70} {
		snap := ReadinessSnapshot{
			Score:            score,
			ApplicationCount: 3,
			BreachingCount:   2 - i,
			Components:       map[string]float64{"tested_coverage": float64(i) / 3},
		}
		if err := st.AppendReadinessSnapshot(ctx, conn, tenant, snap, base.Add(time.Duration(i)*time.Hour)); err != nil {
			t.Fatalf("append %d: %v", i, err)
		}
	}

	// Read back the trend over a generous trailing window, newest-first.
	trend, err := st.ReadinessTrend(ctx, conn, base.Add(-24*time.Hour), 60)
	if err != nil {
		t.Fatalf("trend: %v", err)
	}
	if len(trend) != 3 {
		t.Fatalf("trend points = %d, want 3", len(trend))
	}
	if trend[0].Score != 70 {
		t.Errorf("newest score = %d, want 70 (newest-first)", trend[0].Score)
	}
	if trend[0].CapturedAt.Before(trend[1].CapturedAt) {
		t.Errorf("trend not ordered newest-first")
	}

	// The trailing-window filter excludes snapshots older than `since`.
	recent, err := st.ReadinessTrend(ctx, conn, base.Add(90*time.Minute), 60)
	if err != nil {
		t.Fatalf("recent trend: %v", err)
	}
	if len(recent) != 1 || recent[0].Score != 70 {
		t.Errorf("windowed trend = %+v, want only the newest (70)", recent)
	}
}

func TestAnalyticsStore_RecoveryEventsEmptyLinksNoQuery(t *testing.T) {
	ctx, conn := connectAnalyticsStore(t)
	st := NewAnalyticsStore()

	// No linked runbooks → every requested application gets an empty (non-nil)
	// slice and no execution query is issued.
	out, err := st.RecoveryEventsForApplications(ctx, conn, map[string][]string{
		uuid.NewString(): nil,
	}, 10)
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(out) != 1 {
		t.Fatalf("result keys = %d, want 1", len(out))
	}
	for _, evs := range out {
		if evs == nil || len(evs) != 0 {
			t.Errorf("expected an empty non-nil slice, got %v", evs)
		}
	}
}
