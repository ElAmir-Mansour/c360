DROP POLICY IF EXISTS tenant_delete ON dr_gameday_step_result;
DROP POLICY IF EXISTS tenant_update ON dr_gameday_step_result;
DROP POLICY IF EXISTS tenant_insert ON dr_gameday_step_result;
DROP POLICY IF EXISTS tenant_isolation ON dr_gameday_step_result;

DROP POLICY IF EXISTS tenant_delete ON dr_gameday_run;
DROP POLICY IF EXISTS tenant_update ON dr_gameday_run;
DROP POLICY IF EXISTS tenant_insert ON dr_gameday_run;
DROP POLICY IF EXISTS tenant_isolation ON dr_gameday_run;

DROP POLICY IF EXISTS tenant_delete ON dr_gameday_scenario;
DROP POLICY IF EXISTS tenant_update ON dr_gameday_scenario;
DROP POLICY IF EXISTS tenant_insert ON dr_gameday_scenario;
DROP POLICY IF EXISTS tenant_isolation ON dr_gameday_scenario;

DROP TABLE IF EXISTS dr_gameday_step_result;
DROP TABLE IF EXISTS dr_gameday_run;
DROP TABLE IF EXISTS dr_gameday_scenario;
