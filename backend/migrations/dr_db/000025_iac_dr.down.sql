DROP POLICY IF EXISTS tenant_delete ON dr_iac_resource;
DROP POLICY IF EXISTS tenant_update ON dr_iac_resource;
DROP POLICY IF EXISTS tenant_insert ON dr_iac_resource;
DROP POLICY IF EXISTS tenant_isolation ON dr_iac_resource;

DROP POLICY IF EXISTS tenant_delete ON dr_iac_snapshot;
DROP POLICY IF EXISTS tenant_update ON dr_iac_snapshot;
DROP POLICY IF EXISTS tenant_insert ON dr_iac_snapshot;
DROP POLICY IF EXISTS tenant_isolation ON dr_iac_snapshot;

DROP TABLE IF EXISTS dr_iac_resource;
DROP TABLE IF EXISTS dr_iac_snapshot;
