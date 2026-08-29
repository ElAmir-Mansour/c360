DROP POLICY IF EXISTS tenant_delete ON dr_studio_task_run;
DROP POLICY IF EXISTS tenant_update ON dr_studio_task_run;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_task_run;
DROP POLICY IF EXISTS tenant_isolation ON dr_studio_task_run;

DROP POLICY IF EXISTS tenant_delete ON dr_studio_run;
DROP POLICY IF EXISTS tenant_update ON dr_studio_run;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_run;
DROP POLICY IF EXISTS tenant_isolation ON dr_studio_run;

DROP POLICY IF EXISTS tenant_delete ON dr_studio_task;
DROP POLICY IF EXISTS tenant_update ON dr_studio_task;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_task;
DROP POLICY IF EXISTS tenant_isolation ON dr_studio_task;

DROP POLICY IF EXISTS tenant_delete ON dr_studio_runbook;
DROP POLICY IF EXISTS tenant_update ON dr_studio_runbook;
DROP POLICY IF EXISTS tenant_insert ON dr_studio_runbook;
DROP POLICY IF EXISTS tenant_isolation ON dr_studio_runbook;

DROP TABLE IF EXISTS dr_studio_task_run;
DROP TABLE IF EXISTS dr_studio_run;
DROP TABLE IF EXISTS dr_studio_task;
DROP TABLE IF EXISTS dr_studio_runbook;
