//go:build integration

// This integration test exercises the LOAD-BEARING ransomware/clean-room
// promotion-safety gate (SystemRecoveryPointPromotionSafety) against a REAL
// Postgres with the real dr_db migrations applied. The unit test
// (repository_test.go) drives the same method through pgxmock, which only returns
// canned rows for a regex-matched query — it never validates the actual SQL
// (the clean-room "latest verdict" selection and the ransomware signal join
// through replication_stream -> consistency_group_member, with the sealed-at and
// curated-point filters). A wrong join or filter here would pass pgxmock and
// silently promote malware-contaminated recovery points in production, so the
// safety SQL gets a real-DB exercise, per property, here.
//
// Run with: GOWORK=off go test -tags integration ./internal/dr/repository/ -run PromotionSafety

package repository_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/repository"
)

// startPGForSafety spins up postgres:16-alpine and applies all dr_db migrations,
// returning an owner pool. Seeding and the safety query both run through the real
// system path (database.RunSystemTx / RunSystemRead, which set app.bypass_rls) —
// the same RLS-bypass the leader-singleton failover driver uses.
func startPGForSafety(t *testing.T) (context.Context, *pgxpool.Pool) {
	t.Helper()
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("dr_safety_it"),
		postgresmod.WithUsername("dr"),
		postgresmod.WithPassword("dr"),
		postgresmod.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn := container.MustConnectionString(ctx, "sslmode=disable")
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(pool.Close)

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "migrations", "dr_db")
	migs, err := filepath.Glob(filepath.Join(migDir, "*.up.sql"))
	if err != nil {
		t.Fatalf("glob dr_db migrations: %v", err)
	}
	sort.Strings(migs)
	for _, m := range migs {
		b, rerr := os.ReadFile(m)
		if rerr != nil {
			t.Fatalf("read migration %s: %v", m, rerr)
		}
		if _, eerr := pool.Exec(ctx, string(b)); eerr != nil {
			t.Fatalf("apply migration %s: %v", filepath.Base(m), eerr)
		}
	}
	return ctx, pool
}

// safetyFixture is a fully isolated recovery-point graph: its own group, site,
// member and replication stream, so ransomware signals seeded for one scenario
// never bleed into another point's verdict.
type safetyFixture struct {
	tenantID string
	groupID  string
	siteID   string
	streamID string
	rpID     string
	sealedAt time.Time
}

func seedIsolatedRP(t *testing.T, ctx context.Context, pool *pgxpool.Pool, tenantID string, sealedAt time.Time) safetyFixture {
	t.Helper()
	fx := safetyFixture{
		tenantID: tenantID,
		groupID:  uuid.NewString(),
		siteID:   uuid.NewString(),
		streamID: uuid.NewString(),
		rpID:     uuid.NewString(),
		sealedAt: sealedAt,
	}
	suffix := fx.rpID[:8]
	err := database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
		if _, e := tx.Exec(ctx, `INSERT INTO consistency_group (id, tenant_id, name) VALUES ($1,$2,$3)`,
			fx.groupID, tenantID, "grp-"+suffix); e != nil {
			return fmt.Errorf("group: %w", e)
		}
		if _, e := tx.Exec(ctx, `INSERT INTO protected_site (id, tenant_id, name, kind, primary_endpoint) VALUES ($1,$2,$3,'vm','endpoint')`,
			fx.siteID, tenantID, "site-"+suffix); e != nil {
			return fmt.Errorf("site: %w", e)
		}
		if _, e := tx.Exec(ctx, `INSERT INTO consistency_group_member (group_id, site_id) VALUES ($1,$2)`,
			fx.groupID, fx.siteID); e != nil {
			return fmt.Errorf("member: %w", e)
		}
		if _, e := tx.Exec(ctx, `INSERT INTO replication_stream (id, tenant_id, site_id) VALUES ($1,$2,$3)`,
			fx.streamID, tenantID, fx.siteID); e != nil {
			return fmt.Errorf("stream: %w", e)
		}
		if _, e := tx.Exec(ctx, `
INSERT INTO recovery_point (id, tenant_id, group_id, marker_lsn, rpo_seconds, object_keys, content_hash, is_validated, sealed_at, retention_until)
VALUES ($1,$2,$3,'lsn-1',60,'{}'::jsonb,'hash-1',true,$4,$5)`,
			fx.rpID, tenantID, fx.groupID, sealedAt, sealedAt.Add(720*time.Hour)); e != nil {
			return fmt.Errorf("recovery_point: %w", e)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed isolated rp: %v", err)
	}
	return fx
}

func seedScan(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fx safetyFixture, verdict string, finishedAt time.Time) {
	t.Helper()
	if err := database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
INSERT INTO dr_cleanroom_scan (id, tenant_id, recovery_point_id, group_id, verdict, scanner, started_at, finished_at)
VALUES ($1,$2,$3,$4,$5,'clamav',$6,$6)`,
			uuid.NewString(), fx.tenantID, fx.rpID, fx.groupID, verdict, finishedAt)
		return e
	}); err != nil {
		t.Fatalf("seed scan %q: %v", verdict, err)
	}
}

func seedSignal(t *testing.T, ctx context.Context, pool *pgxpool.Pool, fx safetyFixture, severity string, observedAt time.Time, curatedRPID *string) {
	t.Helper()
	if err := database.RunSystemTx(ctx, pool, func(tx pgx.Tx) error {
		_, e := tx.Exec(ctx, `
INSERT INTO dr_ransomware_signals (id, tenant_id, stream_id, signal_kind, severity, observed, threshold, observed_at, curated_recovery_point_id)
VALUES ($1,$2,$3,'entropy',$4,9.5,7.0,$5,$6)`,
			uuid.NewString(), fx.tenantID, fx.streamID, severity, observedAt, curatedRPID)
		return e
	}); err != nil {
		t.Fatalf("seed signal %q: %v", severity, err)
	}
}

func loadSafety(t *testing.T, ctx context.Context, pool *pgxpool.Pool, rpID string) repository.PromotionSafety {
	t.Helper()
	repo := repository.New()
	var safety repository.PromotionSafety
	if err := database.RunSystemRead(ctx, pool, func(tx pgx.Tx) error {
		var e error
		safety, e = repo.SystemRecoveryPointPromotionSafety(ctx, tx, rpID)
		return e
	}); err != nil {
		t.Fatalf("SystemRecoveryPointPromotionSafety: %v", err)
	}
	return safety
}

func TestPromotionSafety_RealDB_PerProperty(t *testing.T) {
	ctx, pool := startPGForSafety(t)
	tenantID := uuid.NewString()
	base := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)

	t.Run("clean scan and no ransomware is safe", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "clean", base)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if !s.Safe() || !s.CleanroomClean() || !s.RansomwareClear() || s.BlockReason() != "" {
			t.Fatalf("want safe, got %+v reason=%q", s, s.BlockReason())
		}
	})

	t.Run("malware verdict blocks", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "malware", base)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if s.Safe() || s.CleanroomClean() {
			t.Fatalf("malware must block, got %+v", s)
		}
		if s.BlockReason() != `latest clean-room verdict is "malware"` {
			t.Fatalf("reason = %q", s.BlockReason())
		}
	})

	t.Run("integrity_failed verdict blocks", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "integrity_failed", base)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if s.Safe() || s.BlockReason() != `latest clean-room verdict is "integrity_failed"` {
			t.Fatalf("integrity_failed must block, got %+v reason=%q", s, s.BlockReason())
		}
	})

	t.Run("no scan blocks fail-closed", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if s.Safe() || s.CleanroomScanFound {
			t.Fatalf("a never-scanned point must block, got %+v", s)
		}
		if s.BlockReason() != "clean-room scan is required before recovery-point promotion" {
			t.Fatalf("reason = %q", s.BlockReason())
		}
	})

	t.Run("confirmed ransomware before seal blocks", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "clean", base)
		seedSignal(t, ctx, pool, fx, "confirmed", base.Add(-time.Hour), nil)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if s.Safe() || s.RansomwareClear() || s.RansomwareBlockingSignals != 1 {
			t.Fatalf("confirmed pre-seal signal must block, got %+v", s)
		}
		if s.BlockReason() != "1 confirmed ransomware signal(s) block this recovery point" {
			t.Fatalf("reason = %q", s.BlockReason())
		}
	})

	t.Run("signal that curated this point does not block it", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "clean", base)
		seedSignal(t, ctx, pool, fx, "confirmed", base.Add(-time.Hour), &fx.rpID)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if !s.Safe() || s.RansomwareBlockingSignals != 0 {
			t.Fatalf("a signal curating THIS point must not block it, got %+v", s)
		}
	})

	t.Run("confirmed signal after seal does not block", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "clean", base)
		seedSignal(t, ctx, pool, fx, "confirmed", base.Add(time.Hour), nil)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if !s.Safe() || s.RansomwareBlockingSignals != 0 {
			t.Fatalf("a signal observed after the seal must not contaminate this point, got %+v", s)
		}
	})

	t.Run("warning severity signal does not block", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "clean", base)
		seedSignal(t, ctx, pool, fx, "warning", base.Add(-time.Hour), nil)
		s := loadSafety(t, ctx, pool, fx.rpID)
		if !s.Safe() || s.RansomwareBlockingSignals != 0 {
			t.Fatalf("only confirmed signals block; warning must not, got %+v", s)
		}
	})

	t.Run("latest clean verdict wins over older malware", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "malware", base.Add(-time.Hour)) // older
		seedScan(t, ctx, pool, fx, "clean", base)                   // newer
		s := loadSafety(t, ctx, pool, fx.rpID)
		if !s.Safe() || !s.CleanroomClean() || s.CleanroomVerdict != "clean" {
			t.Fatalf("newest verdict (clean) must govern, got %+v", s)
		}
	})

	t.Run("latest malware verdict wins over older clean", func(t *testing.T) {
		fx := seedIsolatedRP(t, ctx, pool, tenantID, base)
		seedScan(t, ctx, pool, fx, "clean", base.Add(-time.Hour)) // older
		seedScan(t, ctx, pool, fx, "malware", base)               // newer
		s := loadSafety(t, ctx, pool, fx.rpID)
		if s.Safe() || s.CleanroomVerdict != "malware" {
			t.Fatalf("newest verdict (malware) must govern and block, got %+v", s)
		}
	})
}
