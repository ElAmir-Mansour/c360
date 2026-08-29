-- 000004_cutover_execution (down): reverse the Wave-3 execution provenance.
DROP TABLE IF EXISTS migrate_rollback_run;

ALTER TABLE migrate_cutover_window
    DROP COLUMN IF EXISTS run_started_at,
    DROP COLUMN IF EXISTS run_started_by;
