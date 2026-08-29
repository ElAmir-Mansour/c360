DROP INDEX IF EXISTS idx_migrate_connector_invocation_window;
DROP INDEX IF EXISTS idx_migrate_connector_invocation_run;

ALTER TABLE migrate_connector_invocation
    DROP COLUMN IF EXISTS task_key,
    DROP COLUMN IF EXISTS dr_task_id,
    DROP COLUMN IF EXISTS dr_run_id,
    DROP COLUMN IF EXISTS source;
