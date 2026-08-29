//go:build integration

package main

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"testing"
	"time"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/require"
	tc "github.com/testcontainers/testcontainers-go"
	postgresmod "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/clario360/platform/internal/database"
)

// TestAutomationMigrationsApplyIdempotently runs the automation_db migration
// chain (the same database.RunMigrations the migrator/service boots with) against
// a throwaway postgres testcontainer and proves apply-from-scratch idempotency
// for the Automation engine schema (Batch 3 assembly verification):
//
//  1. apply cleanly from an empty database to the latest version,
//  2. the Automation engine tables (+ the transactional event_outbox) exist,
//  3. a redundant Up() over the applied schema is a clean no-op — exactly what a
//     re-run against a deployed automation_db does (every 000001 statement is
//     IF NOT EXISTS), so running tenants are unaffected,
//  4. roll the whole chain down to 0 (every .down.sql is valid),
//  5. re-apply from empty to head (the schema is reversible + re-appliable),
//  6. a final redundant Up() is a clean no-op.
func TestAutomationMigrationsApplyIdempotently(t *testing.T) {
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations", "automation_db")
	source := "file://" + migDir
	expectedVersion := latestMigrationVersion(t, migDir, "automation_db")

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("automation_db_throwaway"),
		postgresmod.WithUsername("automation"),
		postgresmod.WithPassword("automation"),
		postgresmod.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn := container.MustConnectionString(ctx, "sslmode=disable")

	// --- 1. Apply all up via the real migrator helper ---
	require.NoError(t, database.RunMigrations(dsn, migDir), "initial up must apply cleanly")
	version, dirty, err := database.MigrationVersion(dsn, migDir)
	require.NoError(t, err)
	require.False(t, dirty, "schema must not be left dirty")
	require.Equal(t, expectedVersion, version, "all automation_db migrations must be applied")

	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	// --- 2. The Automation engine tables (WP-8 domain) + event_outbox exist. ---
	wantTables := []string{
		"automation_runbooks",
		"automation_runbook_steps",
		"automations",
		"automation_rules",
		"automation_runs",
		"automation_run_steps",
		"automation_approval_gates",
		"event_outbox",
	}
	for _, table := range wantTables {
		requireTableExists(t, ctx, pool, table)
	}

	// Spot-check the columns the repository reads/writes so a silent column drift
	// would fail the test.
	wantColumns := map[string][]string{
		"automations":               {"tenant_id", "name", "enabled", "trigger", "runbook_id", "created_by"},
		"automation_rules":          {"tenant_id", "automation_id", "priority", "when_conditions", "action"},
		"automation_runs":           {"tenant_id", "automation_id", "runbook_id", "status", "source_event_id", "replay_of", "current_step", "trigger", "variables", "last_error", "claimed_at"},
		"automation_run_steps":      {"tenant_id", "run_id", "step_index", "action", "input", "output", "status", "attempt", "error"},
		"automation_approval_gates": {"tenant_id", "run_id", "step_index", "status", "quorum", "decisions", "deadline_at", "resolved_at"},
	}
	for table, columns := range wantColumns {
		requireTableColumns(t, ctx, pool, table, columns)
	}

	// --- 3. A redundant Up() over the applied schema is a clean no-op (this is the
	// idempotency guarantee the task asks for). ---
	require.NoError(t, database.RunMigrations(dsn, migDir), "redundant up over applied schema must be a no-op (ErrNoChange swallowed)")
	version, dirty, err = database.MigrationVersion(dsn, migDir)
	require.NoError(t, err)
	require.False(t, dirty)
	require.Equal(t, expectedVersion, version)

	// --- 4. Roll the entire stack back down to 0 ---
	mDown, err := migrate.New(source, dsn)
	require.NoError(t, err)
	require.NoError(t, mDown.Down(), "full down must roll back cleanly")
	_, errSrc := mDown.Close()
	require.NoError(t, errSrc)
	_, _, err = database.MigrationVersion(dsn, migDir)
	require.ErrorIs(t, err, migrate.ErrNilVersion, "after full down there must be no version")
	for _, table := range wantTables {
		requireTableAbsent(t, ctx, pool, table)
	}

	// --- 5. Re-apply from empty to head — reversible + re-appliable. ---
	require.NoError(t, database.RunMigrations(dsn, migDir), "re-up after a full down must apply cleanly")
	version, dirty, err = database.MigrationVersion(dsn, migDir)
	require.NoError(t, err)
	require.False(t, dirty)
	require.Equal(t, expectedVersion, version)
	for _, table := range wantTables {
		requireTableExists(t, ctx, pool, table)
	}

	// --- 6. A final redundant Up() is a clean no-op. ---
	require.NoError(t, database.RunMigrations(dsn, migDir), "redundant up must be a no-op (ErrNoChange swallowed)")
}

// latestMigrationVersion resolves the highest migration version in migDir and
// asserts the chain is complete (every version has both an up and a down file and
// there are no gaps). It is the database-agnostic counterpart to
// latestWorkflowMigrationVersion; dbName is used only for assertion messages.
func latestMigrationVersion(t *testing.T, migDir, dbName string) uint {
	t.Helper()

	entries, err := os.ReadDir(migDir)
	require.NoError(t, err)

	migrationFile := regexp.MustCompile(`^([0-9]{6})_.+\.(up|down)\.sql$`)
	byVersion := make(map[uint]map[string]bool)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		matches := migrationFile.FindStringSubmatch(entry.Name())
		if matches == nil {
			continue
		}
		parsed, err := strconv.ParseUint(matches[1], 10, 32)
		require.NoError(t, err)
		version := uint(parsed)
		if byVersion[version] == nil {
			byVersion[version] = make(map[string]bool)
		}
		byVersion[version][matches[2]] = true
	}
	require.NotEmptyf(t, byVersion, "%s migration directory must contain migrations", dbName)

	var latest uint
	for version, directions := range byVersion {
		require.Truef(t, directions["up"], "%s migration %06d is missing an up file", dbName, version)
		require.Truef(t, directions["down"], "%s migration %06d is missing a down file", dbName, version)
		if version > latest {
			latest = version
		}
	}
	for version := uint(1); version <= latest; version++ {
		_, ok := byVersion[version]
		require.Truef(t, ok, "%s migration chain is missing version %06d", dbName, version)
	}
	return latest
}
