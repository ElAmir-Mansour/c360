-- =============================================================================
-- PROCESS MINING — READ-MODEL SUPPORTING INDEX (moat wave).
--
-- This wave adds a READ-ONLY process-MINING surface (variant discovery,
-- conformance checking, path-frequency heatmap, what-if simulation) on top of
-- the READ-ONLY analytics surface from migration 000012. It mines the ALREADY
-- persisted event trail on workflow_instances + workflow_step_executions and the
-- model step graph on workflow_definitions.steps. No engine / state-model change;
-- no new tables. This ONE index is a purely OPTIONAL performance index for the
-- executed-path reconstruction (array_agg of step_id ORDER BY started_at per
-- instance) that the WorkflowMiningRepository issues.
--
-- The existing analytics index idx_workflow_step_executions_analytics is PARTIAL
-- on completed_at IS NOT NULL, which does NOT cover the mining path scan: mining
-- reconstructs the executed sequence from every STARTED step execution (a still-
-- running step is part of the observed path), and orders by (started_at,
-- created_at, id) for a deterministic sequence. This index matches that access.
--
-- Additive, reversible, idempotent (CREATE INDEX IF NOT EXISTS; the down file
-- drops only what this adds). No data migration. workflow_instances is FORCE-RLS
-- (migration 000008) and workflow_step_executions is joined through it, so the
-- mining queries run tenant-scoped via repository/rls.go — this index only makes
-- the per-instance ordered aggregation cheaper. The migration role must have
-- BYPASSRLS to (re)create indexes on the RLS-forced tables.
--
-- Kept in sync with repository/schema.go SchemaSQL (the same CREATE INDEX IF NOT
-- EXISTS statement was added there so embedding suites get the same shape).
-- =============================================================================

-- VARIANT / CONFORMANCE / HEATMAP reconstruct each instance's executed path as
-- array_agg(step_id ORDER BY started_at, created_at, id) over the STARTED step
-- executions of the instance. This composite covers the join key + the ordering
-- columns for the group-by-instance aggregation.
CREATE INDEX IF NOT EXISTS idx_workflow_step_executions_mining_path
    ON workflow_step_executions (instance_id, started_at, created_at, id)
    WHERE started_at IS NOT NULL;
