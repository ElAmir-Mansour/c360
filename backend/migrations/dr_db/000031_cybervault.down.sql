DROP POLICY IF EXISTS tenant_delete ON dr_cybervault_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_cybervault_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_cybervault_assessment;
DROP POLICY IF EXISTS tenant_isolation ON dr_cybervault_assessment;

DROP POLICY IF EXISTS tenant_delete ON dr_cybervault_vault;
DROP POLICY IF EXISTS tenant_update ON dr_cybervault_vault;
DROP POLICY IF EXISTS tenant_insert ON dr_cybervault_vault;
DROP POLICY IF EXISTS tenant_isolation ON dr_cybervault_vault;

DROP TABLE IF EXISTS dr_cybervault_assessment;
DROP TABLE IF EXISTS dr_cybervault_vault;
