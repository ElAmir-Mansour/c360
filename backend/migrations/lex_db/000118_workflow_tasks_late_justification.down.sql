ALTER TABLE workflow_tasks
    DROP CONSTRAINT IF EXISTS workflow_tasks_late_justification_complete;
ALTER TABLE workflow_tasks
    DROP COLUMN IF EXISTS late_justification,
    DROP COLUMN IF EXISTS late_justification_submitted_by,
    DROP COLUMN IF EXISTS late_justification_submitted_at,
    DROP COLUMN IF EXISTS late_justification_manager_role;
