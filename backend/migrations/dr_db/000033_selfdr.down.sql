DROP POLICY IF EXISTS tenant_delete ON dr_selfdr_artifact;
DROP POLICY IF EXISTS tenant_update ON dr_selfdr_artifact;
DROP POLICY IF EXISTS tenant_insert ON dr_selfdr_artifact;
DROP POLICY IF EXISTS tenant_isolation ON dr_selfdr_artifact;

DROP POLICY IF EXISTS tenant_delete ON dr_selfdr_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_selfdr_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_selfdr_assessment;
DROP POLICY IF EXISTS tenant_isolation ON dr_selfdr_assessment;

DROP TABLE IF EXISTS dr_selfdr_artifact;
DROP TABLE IF EXISTS dr_selfdr_assessment;
