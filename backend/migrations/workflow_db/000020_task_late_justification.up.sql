-- Private justification required when an SLA-bearing human task is completed
-- after its materialised deadline. Kept outside form_data/metadata so ordinary
-- task participants never receive it through existing task payloads.
ALTER TABLE workflow_tasks
    ADD COLUMN IF NOT EXISTS late_justification TEXT,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_by UUID,
    ADD COLUMN IF NOT EXISTS late_justification_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS late_justification_manager_role TEXT;

ALTER TABLE workflow_tasks
    DROP CONSTRAINT IF EXISTS workflow_tasks_late_justification_complete;
ALTER TABLE workflow_tasks
    ADD CONSTRAINT workflow_tasks_late_justification_complete CHECK (
        (late_justification IS NULL
         AND late_justification_submitted_by IS NULL
         AND late_justification_submitted_at IS NULL
         AND late_justification_manager_role IS NULL)
        OR
        (length(btrim(late_justification)) > 0
         AND late_justification_submitted_by IS NOT NULL
         AND late_justification_submitted_at IS NOT NULL
         AND length(btrim(late_justification_manager_role)) > 0)
    );
