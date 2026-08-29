DROP POLICY IF EXISTS tenant_delete ON dr_drill_result;
DROP POLICY IF EXISTS tenant_update ON dr_drill_result;
DROP POLICY IF EXISTS tenant_insert ON dr_drill_result;
DROP POLICY IF EXISTS tenant_isolation ON dr_drill_result;

DROP POLICY IF EXISTS tenant_delete ON dr_drill_schedule;
DROP POLICY IF EXISTS tenant_update ON dr_drill_schedule;
DROP POLICY IF EXISTS tenant_insert ON dr_drill_schedule;
DROP POLICY IF EXISTS tenant_isolation ON dr_drill_schedule;

DROP TABLE IF EXISTS dr_drill_result;
DROP TABLE IF EXISTS dr_drill_schedule;
