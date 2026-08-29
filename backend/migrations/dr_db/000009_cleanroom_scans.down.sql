DROP POLICY IF EXISTS tenant_delete ON dr_cleanroom_scan;
DROP POLICY IF EXISTS tenant_update ON dr_cleanroom_scan;
DROP POLICY IF EXISTS tenant_insert ON dr_cleanroom_scan;
DROP POLICY IF EXISTS tenant_isolation ON dr_cleanroom_scan;

DROP INDEX IF EXISTS idx_dr_cleanroom_scan_clean;
DROP INDEX IF EXISTS idx_dr_cleanroom_scan_group;
DROP INDEX IF EXISTS idx_dr_cleanroom_scan_rp;

DROP TABLE IF EXISTS dr_cleanroom_scan;
