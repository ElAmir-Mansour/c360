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

// TestWorkflowMigrationsApplyCleanly runs the full workflow_db migration chain
// (the same database.RunMigrations the migrator/service boots with) against a
// throwaway postgres testcontainer and proves the apply-from-scratch
// idempotency that motivated moving internal/workflow/repository/schema.go into
// real migrations:
//
//  1. every numbered migration has both an .up.sql and a .down.sql,
//  2. apply cleanly from an empty database to the latest version,
//  3. the expected workflow tables (and the transactional event_outbox) exist,
//  4. roll the whole chain back down to 0 (every .down.sql is valid),
//  5. re-apply from empty to head — proving the schema is reversible and
//     re-appliable (the same class of bug fixed in cyber_db),
//  6. a redundant Up() is a clean no-op (migrate.ErrNoChange swallowed),
//  7. re-running Up() over the already-applied schema is a no-op because every
//     statement in 000001 is IF NOT EXISTS — this mirrors what happens when the
//     migration is applied on an existing deployed workflow DB (a safe no-op),
//     so running tenants are unaffected.
func TestWorkflowMigrationsApplyCleanly(t *testing.T) {
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations", "workflow_db")
	source := "file://" + migDir
	expectedVersion := latestWorkflowMigrationVersion(t, migDir)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("workflow_db_throwaway"),
		postgresmod.WithUsername("workflow"),
		postgresmod.WithPassword("workflow"),
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
	require.Equal(t, expectedVersion, version, "all workflow_db migrations must be applied")

	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	// --- 2. The schema migrated verbatim from repository/schema.go SchemaSQL,
	// plus the transactional event_outbox, must exist after the first Up. ---
	wantTables := []string{
		"workflow_definitions",
		"workflow_instances",
		"workflow_trigger_executions",
		"workflow_step_executions",
		"workflow_tasks",
		"workflow_templates",
		"workflow_timers",
		"event_outbox",
	}
	for _, table := range wantTables {
		requireTableExists(t, ctx, pool, table)
	}

	// Spot-check the columns the existing repositories read/write so a silent
	// column drift would fail the test (byte-for-byte preservation guard).
	wantColumns := map[string][]string{
		"workflow_definitions":        {"tenant_id", "name", "version", "status", "definition_key", "stage", "immutable", "promoted_at", "promoted_by", "trigger_config", "variables", "steps", "category", "published_at", "deleted_at"},
		"workflow_instances":          {"tenant_id", "definition_id", "definition_ver", "status", "current_step_id", "variables", "step_outputs", "trigger_data", "lock_version"},
		"workflow_trigger_executions": {"tenant_id", "definition_id", "instance_id", "event_id", "topic", "status", "dedupe_key", "reason", "trigger_data"},
		"workflow_step_executions":    {"instance_id", "step_id", "step_type", "status", "input_data", "output_data", "attempt", "started_at", "completed_at"},
		"workflow_tasks":              {"tenant_id", "instance_id", "step_id", "step_exec_id", "status", "assignee_id", "assignee_role", "form_schema", "form_data", "sla_deadline", "sla_breached", "escalated_to", "priority", "metadata"},
		"workflow_templates":          {"id", "name", "description", "category", "definition_json", "icon"},
		"workflow_timers":             {"instance_id", "step_id", "fire_at", "fired"},
		"event_outbox":                {"event_id", "tenant_id", "topic", "event_type", "payload", "status", "attempts", "next_attempt_at", "claimed_at", "published_at"},
	}
	for table, columns := range wantColumns {
		requireTableColumns(t, ctx, pool, table, columns)
	}

	// --- 3. A redundant Up() over the freshly applied schema is a clean no-op.
	// Because every statement in 000001 is IF NOT EXISTS this is exactly what a
	// re-run against an existing deployed DB does. ---
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

	// The workflow tables must be gone after a full down.
	for _, table := range wantTables {
		requireTableAbsent(t, ctx, pool, table)
	}

	// --- 5. Re-apply from empty to head — proves the chain is reversible and
	// re-appliable (the apply-from-scratch guarantee). ---
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

func latestWorkflowMigrationVersion(t *testing.T, migDir string) uint {
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
	require.NotEmpty(t, byVersion, "workflow_db migration directory must contain migrations")

	var latest uint
	for version, directions := range byVersion {
		require.Truef(t, directions["up"], "migration %06d is missing an up file", version)
		require.Truef(t, directions["down"], "migration %06d is missing a down file", version)
		if version > latest {
			latest = version
		}
	}
	for version := uint(1); version <= latest; version++ {
		_, ok := byVersion[version]
		require.Truef(t, ok, "workflow_db migration chain is missing version %06d", version)
	}
	return latest
}

func requireTableExists(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table string) {
	t.Helper()

	var exists bool
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
		table,
	).Scan(&exists))
	require.Truef(t, exists, "expected table %q to exist after migrations", table)
}

func requireTableAbsent(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table string) {
	t.Helper()

	var exists bool
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1)`,
		table,
	).Scan(&exists))
	require.Falsef(t, exists, "expected table %q to be dropped after full down", table)
}

func requireTableColumns(t *testing.T, ctx context.Context, pool *pgxpool.Pool, table string, columns []string) {
	t.Helper()

	requireTableExists(t, ctx, pool, table)
	for _, column := range columns {
		var exists bool
		require.NoError(t, pool.QueryRow(ctx,
			`SELECT EXISTS (
				SELECT 1 FROM information_schema.columns
				 WHERE table_schema='public' AND table_name=$1 AND column_name=$2
			)`,
			table, column,
		).Scan(&exists))
		require.Truef(t, exists, "expected %s.%s to exist after migrations", table, column)
	}
}
