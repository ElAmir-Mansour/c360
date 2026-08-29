DROP POLICY IF EXISTS tenant_delete ON dr_bcm_control_result;
DROP POLICY IF EXISTS tenant_update ON dr_bcm_control_result;
DROP POLICY IF EXISTS tenant_insert ON dr_bcm_control_result;
DROP POLICY IF EXISTS tenant_isolation ON dr_bcm_control_result;

DROP POLICY IF EXISTS tenant_delete ON dr_bcm_assessment;
DROP POLICY IF EXISTS tenant_update ON dr_bcm_assessment;
DROP POLICY IF EXISTS tenant_insert ON dr_bcm_assessment;
DROP POLICY IF EXISTS tenant_isolation ON dr_bcm_assessment;

DROP TABLE IF EXISTS dr_bcm_control_result;
DROP TABLE IF EXISTS dr_bcm_assessment;
