DROP POLICY IF EXISTS tenant_delete ON dr_recovery_runbook_version;
DROP POLICY IF EXISTS tenant_update ON dr_recovery_runbook_version;
DROP POLICY IF EXISTS tenant_insert ON dr_recovery_runbook_version;
DROP POLICY IF EXISTS tenant_isolation ON dr_recovery_runbook_version;

DROP POLICY IF EXISTS tenant_delete ON dr_recovery_runbook;
DROP POLICY IF EXISTS tenant_update ON dr_recovery_runbook;
DROP POLICY IF EXISTS tenant_insert ON dr_recovery_runbook;
DROP POLICY IF EXISTS tenant_isolation ON dr_recovery_runbook;

DROP TABLE IF EXISTS dr_recovery_runbook_version;
DROP TABLE IF EXISTS dr_recovery_runbook;
