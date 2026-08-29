-- =============================================================================
-- PROCESS INTELLIGENCE — READ-MODEL SUPPORTING INDEXES.
--
-- This wave adds a READ-ONLY process-analytics surface (per-definition cycle
-- time, per-step bottlenecks, rework rate, throughput) that mines the ALREADY
-- persisted event trail on workflow_instances + workflow_step_executions. No
-- engine / state-model change; no new tables; these are the ONLY structural
-- additions and they are purely OPTIONAL performance indexes for the aggregation
-- queries the WorkflowAnalyticsRepository issues.
--
-- Additive, reversible, idempotent (CREATE INDEX IF NOT EXISTS; the down file
-- drops only what this adds). No data migration. workflow_instances is FORCE-RLS
-- (migration 000008) and workflow_step_executions is joined through it, so the
-- analytics queries run tenant-scoped via repository/rls.go — these indexes only
-- make the group-by/percentile scans cheaper. The migration role must have
-- BYPASSRLS to (re)create indexes on the RLS-forced tables.
--
-- Kept in sync with repository/schema.go SchemaSQL (the same CREATE INDEX IF NOT
-- EXISTS statements were added there so embedding suites get the same shape).
-- =============================================================================

-- (1) CYCLE TIME + (4) THROUGHPUT scan completed/started instances grouped by
-- definition lineage over a time window. A composite index on
-- (tenant_id, definition_id, completed_at) covers the completed-window scan; the
-- partial WHERE keeps it to the rows the percentile_cont(completed_at-started_at)
-- aggregation actually reads.
CREATE INDEX IF NOT EXISTS idx_workflow_instances_analytics_completed
    ON workflow_instances (tenant_id, definition_id, completed_at)
    WHERE completed_at IS NOT NULL;

-- Throughput "started over time" and in-flight/active counts scan by tenant +
-- start time (and status for the active slice). This composite supports the
-- DATE_TRUNC(started_at) group-by and the running/incident count.
CREATE INDEX IF NOT EXISTS idx_workflow_instances_analytics_started
    ON workflow_instances (tenant_id, started_at, status);

-- (2) BOTTLENECKS + (3) REWORK read step executions per instance ordered by
-- start, computing per-step duration percentiles and attempt>1 fractions. The
-- analytics join goes instance -> step_executions on instance_id; this index
-- covers the join + the started_at ordering / duration read.
CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_analytics
    ON workflow_step_executions (instance_id, started_at)
    WHERE completed_at IS NOT NULL;
