DROP POLICY IF EXISTS tenant_delete ON migrate_runbook_binding;
DROP POLICY IF EXISTS tenant_update ON migrate_runbook_binding;
DROP POLICY IF EXISTS tenant_insert ON migrate_runbook_binding;
DROP POLICY IF EXISTS tenant_select ON migrate_runbook_binding;
DROP TABLE IF EXISTS migrate_runbook_binding;

ALTER TABLE migrate_move_group
    DROP COLUMN IF EXISTS dr_topology_group_id;

ALTER TABLE migrate_cutover_window
    DROP COLUMN IF EXISTS dr_run_id,
    DROP COLUMN IF EXISTS dr_runbook_id;

DROP INDEX IF EXISTS idx_migrate_wave_dr_runbook;
DROP INDEX IF EXISTS idx_migrate_window_dr_run;

ALTER TABLE migrate_wave
    DROP COLUMN IF EXISTS runbook_generated_at,
    DROP COLUMN IF EXISTS dr_topology_group_id,
    DROP COLUMN IF EXISTS dr_runbook_id;
