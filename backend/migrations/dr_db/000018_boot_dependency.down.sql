DROP POLICY IF EXISTS tenant_delete ON dr_boot_service_status;
DROP POLICY IF EXISTS tenant_update ON dr_boot_service_status;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_service_status;
DROP POLICY IF EXISTS tenant_isolation ON dr_boot_service_status;

DROP POLICY IF EXISTS tenant_delete ON dr_boot_run;
DROP POLICY IF EXISTS tenant_update ON dr_boot_run;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_run;
DROP POLICY IF EXISTS tenant_isolation ON dr_boot_run;

DROP POLICY IF EXISTS tenant_delete ON dr_boot_dependency;
DROP POLICY IF EXISTS tenant_update ON dr_boot_dependency;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_dependency;
DROP POLICY IF EXISTS tenant_isolation ON dr_boot_dependency;

DROP POLICY IF EXISTS tenant_delete ON dr_boot_service;
DROP POLICY IF EXISTS tenant_update ON dr_boot_service;
DROP POLICY IF EXISTS tenant_insert ON dr_boot_service;
DROP POLICY IF EXISTS tenant_isolation ON dr_boot_service;

DROP TABLE IF EXISTS dr_boot_service_status;
DROP TABLE IF EXISTS dr_boot_run;
DROP TABLE IF EXISTS dr_boot_dependency;
DROP TABLE IF EXISTS dr_boot_service;
