DROP POLICY IF EXISTS tenant_delete ON dr_applied_frame;
DROP POLICY IF EXISTS tenant_update ON dr_applied_frame;
DROP POLICY IF EXISTS tenant_insert ON dr_applied_frame;
DROP POLICY IF EXISTS tenant_isolation ON dr_applied_frame;

DROP TRIGGER IF EXISTS dr_applied_frame_append_only_guard ON dr_applied_frame;
DROP FUNCTION IF EXISTS prevent_dr_applied_frame_mutation();

DROP TABLE IF EXISTS dr_applied_frame;
