DROP POLICY IF EXISTS tenant_delete ON dr_ransomware_signals;
DROP POLICY IF EXISTS tenant_update ON dr_ransomware_signals;
DROP POLICY IF EXISTS tenant_insert ON dr_ransomware_signals;
DROP POLICY IF EXISTS tenant_isolation ON dr_ransomware_signals;

DROP POLICY IF EXISTS tenant_delete ON dr_ransomware_baselines;
DROP POLICY IF EXISTS tenant_update ON dr_ransomware_baselines;
DROP POLICY IF EXISTS tenant_insert ON dr_ransomware_baselines;
DROP POLICY IF EXISTS tenant_isolation ON dr_ransomware_baselines;

DROP INDEX IF EXISTS idx_dr_ransomware_signals_severity;
DROP INDEX IF EXISTS idx_dr_ransomware_signals_stream_time;
DROP INDEX IF EXISTS idx_dr_ransomware_signals_tenant_time;

DROP TABLE IF EXISTS dr_ransomware_signals;
DROP TABLE IF EXISTS dr_ransomware_baselines;
