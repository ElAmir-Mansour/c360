-- Reverse 000011_task_at_risk: drop the at-risk index and columns. Idempotent.
DROP INDEX IF EXISTS idx_workflow_tasks_at_risk;

ALTER TABLE workflow_tasks
    DROP COLUMN IF EXISTS at_risk_since;

ALTER TABLE workflow_tasks
    DROP COLUMN IF EXISTS at_risk;
