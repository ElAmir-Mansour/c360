//go:build integration
// +build integration

// Integration smoke test for the siem-service binary. Spins up
// Postgres + Redis via testcontainers, runs the migrations, and
// asserts that the service can:
//
//  1. Apply migrations idempotently.
//  2. Insert and count rows in siem.health_check under tenant
//     isolation.
//  3. Build the production audit-bootstrap entry and route it
//     through the emitter (no-op + in-memory observers).
//
// Run with: GOWORK=off go test -tags=integration ./backend/cmd/siem-service/...
// Or: make siem-test-integration
//
// The test honours the SIEM_INTEGRATION=1 env var as an additional
// safety gate so a stray `-tags=integration` build does not start
// containers on a dev box.
package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"
	"github.com/testcontainers/testcontainers-go"
	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"

	"github.com/clario360/platform/internal/database"
	siemaudit "github.com/clario360/platform/internal/siem/audit"
	siemrepo "github.com/clario360/platform/internal/siem/repository"
)

func TestSIEM01_Foundation_Integration(t *testing.T) {
	if os.Getenv("SIEM_INTEGRATION") != "1" {
		t.Skip("SIEM_INTEGRATION!=1; skipping containerised SIEM-01 integration test")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	// 1. Postgres container.
	pg, err := tcpostgres.RunContainer(ctx,
		testcontainers.WithImage("postgres:16-alpine"),
		tcpostgres.WithDatabase("siem_db"),
		tcpostgres.WithUsername("clario"),
		tcpostgres.WithPassword("clario_dev_pass"),
		testcontainers.WithWaitStrategy(wait.ForLog("database system is ready to accept connections").WithOccurrence(2).WithStartupTimeout(2*time.Minute)),
	)
	require.NoError(t, err, "start postgres")
	t.Cleanup(func() { _ = pg.Terminate(context.Background()) })

	dsn, err := pg.ConnectionString(ctx, "sslmode=disable")
	require.NoError(t, err)

	// 2. Apply migrations.
	migPath := absMigrationPath(t)
	require.NoError(t, database.RunMigrations(dsn, migPath), "apply migrations")

	// 3. Idempotency check.
	require.NoError(t, database.RunMigrations(dsn, migPath), "re-apply migrations should be a no-op")

	// 4. Repository round-trip.
	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	// siem.health_check.tenant_id is UUID NOT NULL; use real UUIDs.
	const (
		tenantA = "00000000-0000-0000-0000-00000000000a"
		tenantB = "00000000-0000-0000-0000-00000000000b"
	)
	repo := siemrepo.NewHealthCheckRepository(pool)
	idA, err := repo.Insert(ctx, tenantA)
	require.NoError(t, err)
	require.NotEmpty(t, idA)
	_, err = repo.Insert(ctx, tenantB)
	require.NoError(t, err)
	_, err = repo.Insert(ctx, tenantB)
	require.NoError(t, err)

	countA, err := repo.CountByTenant(ctx, tenantA)
	require.NoError(t, err)
	require.Equal(t, int64(1), countA)
	countB, err := repo.CountByTenant(ctx, tenantB)
	require.NoError(t, err)
	require.Equal(t, int64(2), countB)

	// 5. Synthetic audit bootstrap entry.
	em := siemaudit.NewInMemory()
	entry := siemaudit.NewSyntheticBootstrapEntry(tenantA, "ops@clario360.local")
	require.NoError(t, em.Emit(ctx, entry))
	require.Equal(t, 1, em.Len())

	// 6. Optional Redis check — skipped if REDIS_ADDR unset, since the
	//    SIEM-01 readiness path treats Redis as soft-required.
	if addr := os.Getenv("SIEM_INTEGRATION_REDIS"); addr != "" {
		rdb := redis.NewClient(&redis.Options{Addr: addr, DB: 7})
		t.Cleanup(func() { _ = rdb.Close() })
		require.NoError(t, rdb.Ping(ctx).Err())
	}
}

// absMigrationPath finds backend/migrations/siem_db relative to the
// test working directory. Tests run from the package dir.
func absMigrationPath(t *testing.T) string {
	t.Helper()
	cwd, err := os.Getwd()
	require.NoError(t, err)
	// From backend/cmd/siem-service walk up to backend/.
	dir := cwd
	for i := 0; i < 6; i++ {
		candidate := filepath.Join(dir, "migrations", "siem_db")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return candidate
		}
		dir = filepath.Dir(dir)
	}
	require.Failf(t, "migrations dir not found", "searched up from %s", cwd)
	return ""
}

// failHard is a guard ensuring the package can build even with the
// integration build tag absent; the import list above is otherwise
// unused outside the test function.
var _ = fmt.Sprint

// keep strings import used.
var _ = strings.TrimSpace
