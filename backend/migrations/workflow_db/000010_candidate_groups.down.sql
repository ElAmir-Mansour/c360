-- Reverse of 000010_candidate_groups.up.sql. Drops the candidate-group /
-- work-queue columns and their indexes. Idempotent; removes only what the up
-- migration added. Existing single-assignee / single-role tasks are unaffected.

DROP INDEX IF EXISTS idx_workflow_tasks_candidate_users;
DROP INDEX IF EXISTS idx_workflow_tasks_candidate_groups;

ALTER TABLE workflow_tasks DROP COLUMN IF EXISTS candidate_users;
ALTER TABLE workflow_tasks DROP COLUMN IF EXISTS candidate_groups;
