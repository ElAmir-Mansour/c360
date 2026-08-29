-- Reverse 000012_analytics_indexes: drop the process-analytics supporting
-- indexes. Idempotent; drops only what the up migration added (no table/column
-- change, so nothing else to undo).
DROP INDEX IF EXISTS idx_workflow_step_executions_analytics;
DROP INDEX IF EXISTS idx_workflow_instances_analytics_started;
DROP INDEX IF EXISTS idx_workflow_instances_analytics_completed;
