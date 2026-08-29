package repository

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/clario360/platform/internal/workflow/dto"
)

// analyticsDBTX is the pool capability the WorkflowAnalyticsRepository needs:
// the RLS-scoped Exec/Query/QueryRow surface. In production it is a *scopedPool
// wrapping the real *pgxpool.Pool, so EVERY statement runs inside a short
// transaction carrying SET LOCAL app.current_tenant_id (the scope is placed on
// the context via WithTenantScope in each method). Unit tests inject a raw
// pgxmock pool directly through the newWorkflowAnalyticsRepositoryWithDB seam and
// pin the ExpectBegin -> set_config -> SELECT -> ExpectCommit sequence, proving
// the query runs tenant-scoped rather than against a raw pool (which would return
// zero rows under the 000008 FORCE-RLS policies).
type analyticsDBTX interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// WorkflowAnalyticsRepository is a READ-ONLY process-intelligence read model over
// the already-persisted workflow_instances + workflow_step_executions event
// trail. It performs NO writes and does not touch the engine state model; every
// query is tenant-scoped through the scopedPool (RLS). It computes the four
// process dimensions the analytics surface exposes: cycle time, step bottlenecks,
// rework rate, and throughput.
type WorkflowAnalyticsRepository struct {
	db analyticsDBTX
}

// NewWorkflowAnalyticsRepository creates a repository backed by the provided
// pool. The pool is wrapped in a scopedPool so every read runs inside an
// RLS-scoped transaction (SET LOCAL app.current_tenant_id) — the scope is carried
// on the context each method sets via WithTenantScope. Mirrors
// NewDefinitionRepository.
func NewWorkflowAnalyticsRepository(pool *pgxpool.Pool) *WorkflowAnalyticsRepository {
	return &WorkflowAnalyticsRepository{db: newScopedPool(pool)}
}

// newWorkflowAnalyticsRepositoryWithDB is the unexported unit-test seam: it
// injects a pgxmock pool (or any analyticsDBTX) directly, so the recorded
// expectations (ExpectBegin/set_config/SELECT/ExpectCommit when a scopedPool is
// used, or bare Query when a raw mock is used) match. Production always goes
// through NewWorkflowAnalyticsRepository.
func newWorkflowAnalyticsRepositoryWithDB(db analyticsDBTX) *WorkflowAnalyticsRepository {
	return &WorkflowAnalyticsRepository{db: db}
}

// clampWindowDays defaults and bounds the lookback window so a caller cannot ask
// for an unbounded (or nonsensical) range.
func clampWindowDays(days int) int {
	if days <= 0 {
		return 90
	}
	if days > 365 {
		return 365
	}
	return days
}

// CycleTime returns the end-to-end duration distribution (mean + p50/p90/p95 +
// min/max, in seconds) for COMPLETED instances of the given definition lineage,
// grouped by definition version, over the last windowDays. Grouped by the
// definition lineage key so all versions of the same logical workflow roll up
// under one report, broken out per version so a regression between versions is
// visible. Runs tenant-scoped (WithTenantScope) — a raw-pool call would see zero
// rows under RLS.
func (r *WorkflowAnalyticsRepository) CycleTime(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]dto.CycleTimeStats, error) {
	windowDays = clampWindowDays(windowDays)

	// percentile_cont interpolates between samples, matching the "continuous"
	// percentile semantics teams expect for latency SLAs. Duration is extracted
	// as EPOCH seconds (float) from the completed - started interval.
	const query = `
		SELECT d.definition_key::text                                                    AS definition_key,
		       MAX(d.name)                                                               AS definition_name,
		       i.definition_ver                                                          AS version,
		       COUNT(*)::int                                                             AS completed_count,
		       COALESCE(AVG(EXTRACT(EPOCH FROM (i.completed_at - i.started_at))), 0)     AS mean_seconds,
		       COALESCE(percentile_cont(0.5)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.completed_at - i.started_at))), 0) AS p50_seconds,
		       COALESCE(percentile_cont(0.9)  WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.completed_at - i.started_at))), 0) AS p90_seconds,
		       COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (i.completed_at - i.started_at))), 0) AS p95_seconds,
		       COALESCE(MIN(EXTRACT(EPOCH FROM (i.completed_at - i.started_at))), 0)     AS min_seconds,
		       COALESCE(MAX(EXTRACT(EPOCH FROM (i.completed_at - i.started_at))), 0)     AS max_seconds
		FROM workflow_instances i
		JOIN workflow_definitions d ON d.id = i.definition_id
		WHERE i.tenant_id = $1
		  AND d.definition_key = $2::uuid
		  AND i.status = 'completed'
		  AND i.completed_at IS NOT NULL
		  AND i.started_at >= NOW() - ($3::int * INTERVAL '1 day')
		GROUP BY d.definition_key, i.definition_ver
		ORDER BY i.definition_ver DESC`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(sctx, query, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, fmt.Errorf("querying cycle-time distribution: %w", err)
	}
	defer rows.Close()

	var out []dto.CycleTimeStats
	for rows.Next() {
		var s dto.CycleTimeStats
		if err := rows.Scan(
			&s.DefinitionKey, &s.DefinitionName, &s.Version, &s.CompletedCount,
			&s.MeanSeconds, &s.P50Seconds, &s.P90Seconds, &s.P95Seconds,
			&s.MinSeconds, &s.MaxSeconds,
		); err != nil {
			return nil, fmt.Errorf("scanning cycle-time row: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating cycle-time rows: %w", err)
	}
	return out, nil
}

// Bottlenecks returns the per-step duration distribution (median/p90/mean/max),
// a wait-vs-work split (queue time before a human task is claimed vs. active
// time), and the per-step rework rate, across the tenant's completed step
// executions over windowDays. When definitionKey is non-empty the report is
// filtered to that lineage. Steps are ranked slowest-first by p90 so the biggest
// constraints surface at the top. Runs tenant-scoped.
//
// The wait split joins each step execution to its human task (if any) on
// (instance_id, step_id): the wait portion is claimed_at - started_at (queue
// time) and the work portion is completed_at - claimed_at. For steps with no
// task (or unclaimed) the wait is 0 and the whole duration counts as work, so
// the two medians still sum sensibly to roughly the median duration.
func (r *WorkflowAnalyticsRepository) Bottlenecks(ctx context.Context, tenantID, definitionKey string, windowDays int) ([]dto.StepBottleneck, error) {
	windowDays = clampWindowDays(windowDays)

	// Left-join tasks so non-human steps still appear; the wait/work split is
	// derived from the task claim timestamp when present. rework counts attempt>1
	// step executions. Filtering by definition lineage is optional: when
	// $2::text = '' the definition predicate is a no-op.
	const query = `
		WITH step_durations AS (
			SELECT se.step_id,
			       se.step_type,
			       se.attempt,
			       EXTRACT(EPOCH FROM (se.completed_at - se.started_at)) AS dur_seconds,
			       CASE
			           WHEN t.claimed_at IS NOT NULL AND t.claimed_at >= se.started_at
			           THEN EXTRACT(EPOCH FROM (t.claimed_at - se.started_at))
			           ELSE 0
			       END AS wait_seconds,
			       CASE
			           WHEN t.claimed_at IS NOT NULL AND t.claimed_at >= se.started_at AND se.completed_at >= t.claimed_at
			           THEN EXTRACT(EPOCH FROM (se.completed_at - t.claimed_at))
			           ELSE EXTRACT(EPOCH FROM (se.completed_at - se.started_at))
			       END AS work_seconds
			FROM workflow_step_executions se
			JOIN workflow_instances i ON i.id = se.instance_id
			JOIN workflow_definitions d ON d.id = i.definition_id
			LEFT JOIN LATERAL (
			    SELECT tk.claimed_at
			    FROM workflow_tasks tk
			    WHERE tk.instance_id = se.instance_id
			      AND tk.step_id = se.step_id
			    ORDER BY tk.created_at DESC
			    LIMIT 1
			) t ON true
			WHERE i.tenant_id = $1
			  AND ($2::text = '' OR d.definition_key = NULLIF($2, '')::uuid)
			  AND se.completed_at IS NOT NULL
			  AND se.started_at IS NOT NULL
			  AND se.started_at >= NOW() - ($3::int * INTERVAL '1 day')
		)
		SELECT step_id,
		       MAX(step_type)                                                            AS step_type,
		       COUNT(*)::int                                                             AS execution_count,
		       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY dur_seconds), 0)     AS median_seconds,
		       COALESCE(percentile_cont(0.9) WITHIN GROUP (ORDER BY dur_seconds), 0)     AS p90_seconds,
		       COALESCE(AVG(dur_seconds), 0)                                             AS mean_seconds,
		       COALESCE(MAX(dur_seconds), 0)                                             AS max_seconds,
		       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY wait_seconds), 0)    AS wait_seconds,
		       COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY work_seconds), 0)    AS work_seconds,
		       COALESCE(SUM(CASE WHEN attempt > 1 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) AS rework_rate
		FROM step_durations
		GROUP BY step_id
		ORDER BY p90_seconds DESC, execution_count DESC`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(sctx, query, tenantID, definitionKey, windowDays)
	if err != nil {
		return nil, fmt.Errorf("querying step bottlenecks: %w", err)
	}
	defer rows.Close()

	var out []dto.StepBottleneck
	for rows.Next() {
		var b dto.StepBottleneck
		if err := rows.Scan(
			&b.StepID, &b.StepType, &b.ExecutionCount,
			&b.MedianSeconds, &b.P90Seconds, &b.MeanSeconds, &b.MaxSeconds,
			&b.WaitSeconds, &b.WorkSeconds, &b.ReworkRate,
		); err != nil {
			return nil, fmt.Errorf("scanning bottleneck row: %w", err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating bottleneck rows: %w", err)
	}
	return out, nil
}

// ReworkPerDefinition returns the fraction of step executions that ran on
// attempt > 1, aggregated per definition lineage, over windowDays. Runs
// tenant-scoped.
func (r *WorkflowAnalyticsRepository) ReworkPerDefinition(ctx context.Context, tenantID string, windowDays int) ([]dto.ReworkStat, error) {
	windowDays = clampWindowDays(windowDays)

	const query = `
		SELECT d.definition_key::text                                                    AS definition_key,
		       MAX(d.name)                                                               AS definition_name,
		       COUNT(*)::int                                                             AS total_executions,
		       COALESCE(SUM(CASE WHEN se.attempt > 1 THEN 1 ELSE 0 END), 0)::int         AS rework_executions,
		       COALESCE(SUM(CASE WHEN se.attempt > 1 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) AS rework_rate
		FROM workflow_step_executions se
		JOIN workflow_instances i ON i.id = se.instance_id
		JOIN workflow_definitions d ON d.id = i.definition_id
		WHERE i.tenant_id = $1
		  AND se.created_at >= NOW() - ($2::int * INTERVAL '1 day')
		GROUP BY d.definition_key
		ORDER BY rework_rate DESC`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(sctx, query, tenantID, windowDays)
	if err != nil {
		return nil, fmt.Errorf("querying rework per definition: %w", err)
	}
	defer rows.Close()

	return scanReworkRows(rows)
}

// ReworkPerStep returns the attempt>1 fraction broken out per (definition, step)
// over windowDays. Runs tenant-scoped.
func (r *WorkflowAnalyticsRepository) ReworkPerStep(ctx context.Context, tenantID string, windowDays int) ([]dto.ReworkStat, error) {
	windowDays = clampWindowDays(windowDays)

	const query = `
		SELECT d.definition_key::text                                                    AS definition_key,
		       MAX(d.name)                                                               AS definition_name,
		       se.step_id                                                                AS step_id,
		       COUNT(*)::int                                                             AS total_executions,
		       COALESCE(SUM(CASE WHEN se.attempt > 1 THEN 1 ELSE 0 END), 0)::int         AS rework_executions,
		       COALESCE(SUM(CASE WHEN se.attempt > 1 THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0), 0) AS rework_rate
		FROM workflow_step_executions se
		JOIN workflow_instances i ON i.id = se.instance_id
		JOIN workflow_definitions d ON d.id = i.definition_id
		WHERE i.tenant_id = $1
		  AND se.created_at >= NOW() - ($2::int * INTERVAL '1 day')
		GROUP BY d.definition_key, se.step_id
		ORDER BY rework_rate DESC, total_executions DESC`

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(sctx, query, tenantID, windowDays)
	if err != nil {
		return nil, fmt.Errorf("querying rework per step: %w", err)
	}
	defer rows.Close()

	return scanReworkRows(rows)
}

// scanReworkRows scans a rework result set whose column list is
// (definition_key, definition_name, [step_id,] total, rework, rate). Both the
// per-definition and per-step queries share the same projection except the
// per-step query adds step_id in the 3rd position; to keep one scanner, the
// per-definition query selects an empty step_id column implicitly via the shared
// shape. Here we detect the column count from the row description.
func scanReworkRows(rows pgx.Rows) ([]dto.ReworkStat, error) {
	// The two queries differ only by whether step_id is present. We branch on the
	// number of returned columns (5 = per-definition, 6 = per-step).
	fields := rows.FieldDescriptions()
	hasStep := len(fields) == 6

	var out []dto.ReworkStat
	for rows.Next() {
		var s dto.ReworkStat
		if hasStep {
			if err := rows.Scan(
				&s.DefinitionKey, &s.DefinitionName, &s.StepID,
				&s.TotalExecutions, &s.ReworkExecutions, &s.ReworkRate,
			); err != nil {
				return nil, fmt.Errorf("scanning per-step rework row: %w", err)
			}
		} else {
			if err := rows.Scan(
				&s.DefinitionKey, &s.DefinitionName,
				&s.TotalExecutions, &s.ReworkExecutions, &s.ReworkRate,
			); err != nil {
				return nil, fmt.Errorf("scanning per-definition rework row: %w", err)
			}
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating rework rows: %w", err)
	}
	return out, nil
}

// Throughput returns started vs. completed vs. failed instance counts bucketed
// by DATE_TRUNC(interval, started_at) over windowDays, zero-filling empty
// buckets via generate_series. interval must be 'day' or 'week' (validated by
// the caller). Runs tenant-scoped.
func (r *WorkflowAnalyticsRepository) Throughput(ctx context.Context, tenantID, interval string, windowDays int) ([]dto.ThroughputBucket, error) {
	windowDays = clampWindowDays(windowDays)

	// The interval keyword is validated/whitelisted by the service before it
	// reaches here; it is interpolated (not a bind parameter) because DATE_TRUNC's
	// first argument is a keyword literal, not a value. $2 is the interval string
	// again for generate_series' step, $3 the window.
	//
	// A completed instance is bucketed by its completed_at, a started instance by
	// its started_at, so the same bucket shows both the arrivals (started) and the
	// departures (completed) that fell in that period.
	query := fmt.Sprintf(`
		WITH buckets AS (
			SELECT generate_series(
				DATE_TRUNC('%[1]s', NOW() - ($2::int - 1) * INTERVAL '1 day'),
				DATE_TRUNC('%[1]s', NOW()),
				INTERVAL '1 %[1]s'
			) AS bucket_start
		),
		started AS (
			SELECT DATE_TRUNC('%[1]s', started_at) AS b, COUNT(*) AS cnt
			FROM workflow_instances
			WHERE tenant_id = $1
			  AND started_at >= NOW() - ($2::int * INTERVAL '1 day')
			GROUP BY DATE_TRUNC('%[1]s', started_at)
		),
		completed AS (
			SELECT DATE_TRUNC('%[1]s', completed_at) AS b,
			       COUNT(*) FILTER (WHERE status = 'completed')            AS done,
			       COUNT(*) FILTER (WHERE status IN ('failed', 'incident')) AS failed
			FROM workflow_instances
			WHERE tenant_id = $1
			  AND completed_at IS NOT NULL
			  AND completed_at >= NOW() - ($2::int * INTERVAL '1 day')
			GROUP BY DATE_TRUNC('%[1]s', completed_at)
		)
		SELECT to_char(b.bucket_start, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS bucket_start,
		       COALESCE(s.cnt, 0)::int   AS started,
		       COALESCE(c.done, 0)::int  AS completed,
		       COALESCE(c.failed, 0)::int AS failed
		FROM buckets b
		LEFT JOIN started   s ON s.b = b.bucket_start
		LEFT JOIN completed c ON c.b = b.bucket_start
		ORDER BY b.bucket_start ASC`, interval)

	sctx := WithTenantScope(ctx, tenantID)
	rows, err := r.db.Query(sctx, query, tenantID, windowDays)
	if err != nil {
		return nil, fmt.Errorf("querying throughput buckets: %w", err)
	}
	defer rows.Close()

	var out []dto.ThroughputBucket
	for rows.Next() {
		var b dto.ThroughputBucket
		if err := rows.Scan(&b.BucketStart, &b.Started, &b.Completed, &b.Failed); err != nil {
			return nil, fmt.Errorf("scanning throughput row: %w", err)
		}
		out = append(out, b)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterating throughput rows: %w", err)
	}
	return out, nil
}

// ActiveCount returns the current in-flight instance count (running + suspended
// + incident) for the tenant. Runs tenant-scoped.
func (r *WorkflowAnalyticsRepository) ActiveCount(ctx context.Context, tenantID string) (int, error) {
	const query = `
		SELECT COUNT(*)::int
		FROM workflow_instances
		WHERE tenant_id = $1
		  AND status IN ('running', 'suspended', 'incident')`

	sctx := WithTenantScope(ctx, tenantID)
	var n int
	if err := r.db.QueryRow(sctx, query, tenantID).Scan(&n); err != nil {
		return 0, fmt.Errorf("querying active instance count: %w", err)
	}
	return n, nil
}
