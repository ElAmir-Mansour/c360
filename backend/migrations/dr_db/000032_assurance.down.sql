DROP POLICY IF EXISTS tenant_delete ON dr_assurance_result;
DROP POLICY IF EXISTS tenant_update ON dr_assurance_result;
DROP POLICY IF EXISTS tenant_insert ON dr_assurance_result;
DROP POLICY IF EXISTS tenant_isolation ON dr_assurance_result;

DROP POLICY IF EXISTS tenant_delete ON dr_assurance_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_assurance_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_assurance_assessment;
DROP POLICY IF EXISTS tenant_isolation ON dr_assurance_assessment;

DROP TABLE IF EXISTS dr_assurance_result;
DROP TABLE IF EXISTS dr_assurance_assessment;
