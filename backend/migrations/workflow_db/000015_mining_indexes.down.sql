-- Reverse 000015_mining_indexes: drop the process-mining path-reconstruction
-- supporting index. Idempotent; drops only what the up migration added (no
-- table/column change, so nothing else to undo).
DROP INDEX IF EXISTS idx_workflow_step_executions_mining_path;
