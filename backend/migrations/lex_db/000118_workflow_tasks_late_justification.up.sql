-- lex-service embeds its own workflow tables in lex_db (workflow_definitions /
-- workflow_instances / workflow_tasks). The late-justification feature added the
-- private justification columns to workflow_db.workflow_tasks (migration
-- workflow_db/000020) but NOT to lex_db.workflow_tasks, so every lex approval /
-- review task read + decision failed with 42703 (column does not exist). Mirror
-- the workflow_db columns + guard here so lex's embedded workflow matches.
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
