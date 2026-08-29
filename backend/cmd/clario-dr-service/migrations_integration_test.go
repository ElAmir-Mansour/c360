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

// TestDRMigrationsApplyCleanlyAndIdempotently runs the FULL dr_db migrator
// (the same database.RunMigrations the service boots with) against a throwaway
// postgres testcontainer and proves the complete dr_db migration chain:
//
//  1. every numbered migration has both an .up.sql and a .down.sql,
//  2. apply cleanly from an empty database to the latest version,
//  3. roll all the way back down to 0 (every .down.sql is valid + reversible),
//  4. apply again from empty to the orchestration-plane head (000019),
//  5. continue applying to the latest version — proving the 000011+ resilience
//     and orchestration DDL is idempotent across a partial-up boundary and a
//     down/up cycle,
//  6. a second Up() is a clean no-op (migrate.ErrNoChange),
//
// and asserts the intelligence, resilience, and orchestration package-owned
// tables/columns exist after the final Up.
func TestDRMigrationsApplyCleanlyAndIdempotently(t *testing.T) {
	tc.SkipIfProviderIsNotHealthy(t)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()

	_, thisFile, _, _ := runtime.Caller(0)
	migDir := filepath.Join(filepath.Dir(thisFile), "..", "..", "migrations", "dr_db")
	source := "file://" + migDir
	expectedVersion := latestDRMigrationVersion(t, migDir)

	container, err := postgresmod.Run(ctx, "postgres:16-alpine",
		postgresmod.WithDatabase("dr_db_throwaway"),
		postgresmod.WithUsername("dr"),
		postgresmod.WithPassword("dr"),
		postgresmod.BasicWaitStrategies(),
	)
	require.NoError(t, err)
	t.Cleanup(func() { _ = container.Terminate(context.Background()) })

	dsn := container.MustConnectionString(ctx, "sslmode=disable")

	// --- 1. Apply all up via the real service migrator ---
	require.NoError(t, database.RunMigrations(dsn, migDir), "initial up must apply cleanly")
	version, dirty, err := database.MigrationVersion(dsn, migDir)
	require.NoError(t, err)
	require.False(t, dirty, "schema must not be left dirty")
	require.Equal(t, expectedVersion, version, "all dr_db migrations must be applied")

	// --- 2. Roll the entire stack back down to 0 ---
	mDown, err := migrate.New(source, dsn)
	require.NoError(t, err)
	require.NoError(t, mDown.Down(), "full down must roll back cleanly")
	_, errSrc := mDown.Close()
	require.NoError(t, errSrc)
	_, _, err = database.MigrationVersion(dsn, migDir)
	require.ErrorIs(t, err, migrate.ErrNilVersion, "after full down there must be no version")

	// --- 3a. Apply UP exactly to version 19 (the orchestration plane head:
	// 000016 runbook studio, 000017 scheduled drills, 000018 boot dependency,
	// 000019 game-day). This proves the four orchestration migrations apply
	// cleanly from empty and land on a non-dirty version 19 before the later
	// recovery-hardening migrations (000020/000021) run. ---
	mTo19, err := migrate.New(source, dsn)
	require.NoError(t, err)
	require.NoError(t, mTo19.Migrate(19), "up to the orchestration-plane head (19) must apply cleanly")
	_, errSrc = mTo19.Close()
	require.NoError(t, errSrc)
	version, dirty, err = database.MigrationVersion(dsn, migDir)
	require.NoError(t, err)
	require.False(t, dirty, "schema must not be left dirty at the orchestration-plane head")
	require.Equal(t, uint(19), version, "the four orchestration migrations (16-19) must land on version 19")

	pool, err := pgxpool.New(ctx, dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)

	for _, table := range []string{
		"dr_studio_runbook", "dr_studio_task", "dr_studio_run", "dr_studio_task_run", // 000016
		"dr_drill_schedule", "dr_drill_result", // 000017
		"dr_boot_service", "dr_boot_dependency", "dr_boot_run", "dr_boot_service_status", // 000018
		"dr_gameday_scenario", "dr_gameday_run", "dr_gameday_step_result", // 000019
	} {
		requireTableExists(t, ctx, pool, table)
	}

	// --- 3b. Continue applying all up to head (idempotent re-application that
	// also proves 000016-000019 are idempotent across a partial-up boundary) ---
	require.NoError(t, database.RunMigrations(dsn, migDir), "up to head after the partial 19 migrate must apply cleanly")
	version, dirty, err = database.MigrationVersion(dsn, migDir)
	require.NoError(t, err)
	require.False(t, dirty)
	require.Equal(t, expectedVersion, version)

	// --- 4. A redundant Up() is a clean no-op ---
	require.NoError(t, database.RunMigrations(dsn, migDir), "redundant up must be a no-op (ErrNoChange swallowed)")

	// --- Assert the intelligence (000006-000010), resilience (000011-000015,
	// 000020-000021), orchestration (000016-000019), and extended workload /
	// infrastructure / storage surfaces (000022+) exist
	// after the final Up ---
	wantTables := []string{
		"dr_replication_samples",      // 000006 predict
		"dr_predictions",              // 000006 predict
		"dr_recovery_runbook",         // 000007 recovery asset registry
		"dr_recovery_runbook_version", // 000007 recovery asset registry
		"dr_ransomware_baselines",     // 000008 ransomware
		"dr_ransomware_signals",       // 000008 ransomware
		"dr_cleanroom_scan",           // 000009 cleanroom
		"dr_copilot_session",          // 000010 copilot
		"dr_copilot_message",          // 000010 copilot
		"dr_journal_segment",          // 000011 cdp journal
		"dr_journal_bookmark",         // 000011 cdp journal
		"dr_consistency_barrier",      // 000012 app-consistent points
		"dr_instant_session",          // 000013 instant recovery
		"dr_instant_overlay_chunk",    // 000013 instant recovery (COW overlay)
		"dr_failback_run",             // 000014 failback FSM
		"dr_failback_step",            // 000014 failback step timeline
		"dr_topology_node",            // 000015 replication topology
		"dr_topology_edge",            // 000015 replication topology
		"dr_studio_runbook",           // 000016 runbook studio
		"dr_studio_task",              // 000016 runbook studio
		"dr_studio_run",               // 000016 runbook studio (live run)
		"dr_studio_task_run",          // 000016 runbook studio (per-task execution)
		"dr_drill_schedule",           // 000017 scheduled drills (cron)
		"dr_drill_result",             // 000017 scheduled drills (result + diff)
		"dr_boot_service",             // 000018 boot dependency graph
		"dr_boot_dependency",          // 000018 boot dependency graph (edges)
		"dr_boot_run",                 // 000018 boot dependency graph (run)
		"dr_boot_service_status",      // 000018 boot dependency graph (per-service status)
		"dr_gameday_scenario",         // 000019 game-day chaos scenarios
		"dr_gameday_run",              // 000019 game-day chaos run
		"dr_gameday_step_result",      // 000019 game-day per-step scorecard
		"dr_failback_reverse_stream",  // 000020 failback reverse data-plane ledger
		"dr_drill_lag_marker",         // 000023 game-day durable lag marker
		"dr_drill_site_block",         // 000023 game-day durable site block marker
		"dr_workload_capture_source",  // 000024 VM/K8s workload capture source
		"dr_workload_capture_epoch",   // 000024 workload capture epoch ledger
		"dr_vm_capture_state",         // 000024 VM changed-block tracking state
		"dr_iac_snapshot",             // 000025 IaC DR snapshot
		"dr_iac_resource",             // 000025 IaC DR resource graph
		"dr_storage_volume",           // 000026 storage offload volume
		"dr_storage_snapshot",         // 000026 storage offload snapshot
		"dr_bcm_assessment",           // 000027 BCM assessment header
		"dr_bcm_control_result",       // 000027 BCM control result
		"dr_tenant_kek",               // 000028 BYOK tenant KEK
		"dr_wrapped_dek",              // 000028 BYOK wrapped DEK
		"dr_kek_custody_log",          // 000028 BYOK custody log
		"dr_attestation_ledger",       // 000029 attestation ledger chain
		"dr_attestation_checkpoint",   // 000029 attestation ledger checkpoint
		"dr_bcm_pack",                 // 000030 BCM compliance-pack catalog projection
		"dr_bcm_pack_control",         // 000030 BCM compliance-pack catalog controls
		"dr_assurance_assessment",     // 000032 recovery-assurance assessment header
		"dr_assurance_result",         // 000032 recovery-assurance per-control result
	}
	for _, table := range wantTables {
		requireTableExists(t, ctx, pool, table)
	}
	wantColumns := map[string][]string{
		"dr_replication_samples":      {"tenant_id", "stream_id", "observed_at", "lag_seconds", "throughput_bps", "applied_seq"},
		"dr_predictions":              {"tenant_id", "stream_id", "rpo_objective_seconds", "smoothed_lag_seconds", "lag_trend_slope", "throughput_trend_slope", "predicted_breach_seconds", "breach_forecast", "throughput_collapse", "sample_count", "forecast_at"},
		"dr_recovery_runbook":         {"tenant_id", "group_id", "current_version", "template_id"},
		"dr_recovery_runbook_version": {"runbook_id", "tenant_id", "group_id", "version", "template_id", "steps", "asset_snapshot", "content_hash", "diff", "trigger"},
		"dr_ransomware_baselines":     {"tenant_id", "stream_id", "byte_rate_mean", "byte_rate_var", "change_rate_mean", "change_rate_var", "entropy_mean", "entropy_var", "samples"},
		"dr_ransomware_signals":       {"tenant_id", "stream_id", "signal_kind", "severity", "observed", "baseline", "ratio", "threshold", "sample_seq", "source_lsn", "curated_recovery_point_id", "detail", "observed_at"},
		"dr_cleanroom_scan":           {"tenant_id", "recovery_point_id", "group_id", "verdict", "scanner", "chunks_scanned", "bytes_scanned", "detail", "findings"},
		"dr_copilot_session":          {"tenant_id", "user_id", "title", "provider", "model", "message_count"},
		"dr_copilot_message":          {"session_id", "tenant_id", "seq", "role", "content", "tool_name", "tool_call_id", "tool_calls", "proposed_action", "latency_ms"},
		"dr_journal_segment":          {"tenant_id", "stream_id", "min_seq", "max_seq", "frame_count", "min_lsn", "max_lsn", "min_ts", "max_ts", "object_key", "payload_bytes", "content_hash", "pruned", "pruned_at", "sealed_at"},
		"dr_journal_bookmark":         {"tenant_id", "stream_id", "name", "kind", "at_seq", "at_lsn", "at_ts", "note", "created_by"},
		"dr_consistency_barrier":      {"tenant_id", "group_id", "recovery_point_id", "consistency_level", "provider", "barrier_lsn", "success", "quiesced", "thawed", "detail", "error", "requested_by"},
		"dr_instant_session":          {"tenant_id", "recovery_point_id", "group_id", "state", "chunks_total", "chunks_hydrated", "chunk_size", "overlay_location", "finalized_location", "last_error", "ready_at", "finalized_at"},
		"dr_instant_overlay_chunk":    {"session_id", "tenant_id", "chunk_index", "origin", "data", "content_hash", "byte_len", "written_at", "storage_backend", "storage_ref"},
		"dr_failback_run":             {"tenant_id", "group_id", "failover_run_id", "from_site", "to_site", "reverse_stream_id", "status", "delta_bytes_remaining", "delta_seq_remaining", "converge_threshold_bytes", "source_lsn", "applied_lsn", "last_converged_at", "cutover_window_open", "initiated_by", "approved_by", "approved_at", "new_direction", "last_error", "claimed_at"},
		"dr_failback_step":            {"run_id", "step", "status", "detail", "started_at", "finished_at"},
		"dr_topology_node":            {"tenant_id", "group_id", "site_id", "role"},
		"dr_topology_edge":            {"tenant_id", "group_id", "from_node_id", "to_node_id", "stream_id", "mode", "priority", "health", "lag_seconds", "applied_seq", "last_progress_at"},
		"dr_failback_reverse_stream":  {"stream_id", "run_id", "tenant_id", "group_id", "from_site", "to_site", "source_stream_id", "target_stream_id", "head_seq", "applied_seq", "head_lsn", "applied_lsn", "bytes_pending", "cutover_window_open", "status", "last_error"},
		"dr_studio_runbook":           {"tenant_id", "group_id", "name", "description", "status", "source_runbook", "created_by"},
		"dr_studio_task":              {"tenant_id", "runbook_id", "task_key", "name", "task_type", "required", "owner", "team", "instructions", "planned_duration_seconds", "automation_action", "predecessors", "params"},
		"dr_studio_run":               {"tenant_id", "runbook_id", "mode", "status", "planned_critical_path_seconds", "started_by", "completed_at", "actual_duration_seconds", "last_error", "claimed_at"},
		"dr_studio_task_run":          {"tenant_id", "run_id", "task_id", "status", "acted_by", "started_at", "finished_at", "actual_duration_seconds", "detail"},
		"dr_drill_schedule":           {"tenant_id", "group_id", "name", "cron_expr", "profile", "rto_objective_seconds", "enabled", "next_run", "last_fired_at"},
		"dr_drill_result":             {"tenant_id", "group_id", "schedule_id", "run_id", "passed", "rto_achieved_seconds", "rpo_achieved_seconds", "rto_objective_seconds", "recovery_point_id", "validation_ratio", "validation_outcome", "steps", "asset_fingerprint", "observed_at"},
		"dr_boot_service":             {"tenant_id", "group_id", "name", "kind", "boot_action", "site_id", "probe_kind", "probe_target", "probe_expect_status", "boot_timeout_seconds", "health_retries"},
		"dr_boot_dependency":          {"tenant_id", "group_id", "service_id", "depends_on_id"},
		"dr_boot_run":                 {"tenant_id", "group_id", "status", "policy", "total_tiers", "tiers_booted", "initiated_by", "last_error"},
		"dr_boot_service_status":      {"run_id", "service_id", "service_name", "tier", "status", "attempts", "last_error", "booted_at", "healthy_at"},
		"dr_gameday_scenario":         {"tenant_id", "group_id", "name", "description", "scope", "steps"},
		"dr_gameday_run":              {"tenant_id", "scenario_id", "group_id", "scope", "status", "steps_total", "steps_passed", "score", "all_faults_reverted", "safety_verdict", "last_error", "initiated_by", "started_at", "completed_at", "claimed_at"},
		"dr_gameday_step_result":      {"tenant_id", "run_id", "step_index", "action", "target", "expected_signal", "detect_within_ms", "recover_within_ms", "signal_observed", "observed_signal", "detection_latency_ms", "recovery_latency_ms", "fault_reverted", "observability", "passed", "detail", "finished_at"},
		"dr_drill_lag_marker":         {"stream_id", "tenant_id", "lag_seconds", "created_at"},
		"dr_drill_site_block":         {"site_id", "tenant_id", "snapshot", "blocked_at"},
		"dr_workload_capture_source":  {"tenant_id", "stream_id", "name", "source_kind", "binding_kind", "block_size_bytes", "config", "enabled", "epoch_count", "last_run_at", "last_seq"},
		"dr_workload_capture_epoch":   {"tenant_id", "source_id", "stream_id", "epoch", "epoch_kind", "from_seq", "to_seq", "frame_count", "changed_units", "total_units", "payload_bytes", "content_hash", "source_marker", "set_summary"},
		"dr_vm_capture_state":         {"tenant_id", "source_id", "block_size_bytes", "image_bytes", "block_count", "epoch", "block_hashes", "updated_at"},
		"dr_iac_snapshot":             {"tenant_id", "group_id", "name", "source_kind", "version", "content_hash", "resource_count", "metadata", "created_at"},
		"dr_iac_resource":             {"tenant_id", "snapshot_id", "provider", "type", "name", "address", "attributes", "depends_on", "resource_hash", "created_at"},
		"dr_storage_volume":           {"tenant_id", "name", "provider", "array_endpoint", "source_location", "site_id", "retention_max_snapshots", "retention_max_age_seconds", "created_at", "updated_at"},
		"dr_storage_snapshot":         {"tenant_id", "volume_id", "parent_id", "provider_handle", "kind", "state", "manifest_hash", "size_bytes", "changed_bytes", "file_count", "replicated_target", "last_error", "created_at", "ready_at", "replicated_at", "expired_at", "updated_at"},
		"dr_bcm_pack":                 {"pack_key", "standard", "version", "authority", "title", "description", "control_count", "created_at", "updated_at"},
		"dr_bcm_pack_control":         {"pack_key", "control_code", "title", "description", "required_evidence", "rule", "weight", "mandatory", "created_at", "updated_at"},
		"dr_bcm_assessment":           {"tenant_id", "group_id", "pack_key", "standard", "pack_version", "score", "compliant", "total_controls", "satisfied", "partial", "failed", "created_by", "created_at"},
		"dr_bcm_control_result":       {"tenant_id", "assessment_id", "control_code", "control_title", "verdict", "reason", "mandatory", "weight", "evidence_refs", "created_at"},
		"dr_tenant_kek":               {"tenant_id", "key_version", "provider", "reference", "state", "activated_at", "retired_at", "updated_at"},
		"dr_wrapped_dek":              {"tenant_id", "dek_id", "kek_version", "wrapped_dek", "nonce", "rewrapped_at", "updated_at"},
		"dr_kek_custody_log":          {"tenant_id", "seq", "action", "kek_version", "dek_id", "detail", "prev_hash", "entry_hash", "created_at"},
		"dr_attestation_ledger":       {"tenant_id", "seq", "entry_type", "subject_id", "payload", "payload_hash", "prev_hash", "entry_hash", "anchored_root", "created_at"},
		"dr_attestation_checkpoint":   {"tenant_id", "from_seq", "to_seq", "merkle_root", "entry_count", "worm_object_key", "worm_version_id", "created_at"},
		"dr_assurance_assessment":     {"tenant_id", "group_id", "profile_id", "workload_id", "score", "verdict", "total_checks", "satisfied", "partial", "failed", "evidence_snapshot", "created_by", "created_at"},
		"dr_assurance_result":         {"tenant_id", "assessment_id", "control_code", "control_title", "verdict", "severity", "weight", "message", "recommendation", "evidence_refs", "created_at"},
	}
	for table, columns := range wantColumns {
		requireTableColumns(t, ctx, pool, table, columns)
	}
}

func latestDRMigrationVersion(t *testing.T, migDir string) uint {
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
	require.NotEmpty(t, byVersion, "dr_db migration directory must contain migrations")

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
		require.Truef(t, ok, "dr_db migration chain is missing version %06d", version)
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
