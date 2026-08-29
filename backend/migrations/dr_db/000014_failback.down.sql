-- Reverse of 000014_failback.up.sql. Drop policies then tables in dependency
-- order (dr_failback_step references dr_failback_run).
DROP POLICY IF EXISTS tenant_delete ON dr_failback_step;
DROP POLICY IF EXISTS tenant_update ON dr_failback_step;
DROP POLICY IF EXISTS tenant_insert ON dr_failback_step;
DROP POLICY IF EXISTS tenant_isolation ON dr_failback_step;

DROP POLICY IF EXISTS tenant_delete ON dr_failback_run;
DROP POLICY IF EXISTS tenant_update ON dr_failback_run;
DROP POLICY IF EXISTS tenant_insert ON dr_failback_run;
DROP POLICY IF EXISTS tenant_isolation ON dr_failback_run;

DROP TABLE IF EXISTS dr_failback_step;
DROP TABLE IF EXISTS dr_failback_run;
