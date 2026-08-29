-- Reverse of 000006_activity_idempotency.up.sql. Drops only what that migration
-- created; no existing table is touched.
DROP INDEX IF EXISTS idx_workflow_activity_executions_instance_step;
DROP INDEX IF EXISTS idx_workflow_activity_executions_instance;
DROP TABLE IF EXISTS workflow_activity_executions;
