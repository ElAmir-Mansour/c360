-- Reverse of 000008_core_rls.up.sql. Drops the per-operation RLS policies and
-- turns OFF force/enable row-level security on the 5 core tables, restoring the
-- pre-migration behaviour (app-level WHERE tenant_id isolation only). The tables
-- themselves are NOT dropped (they predate this migration in 000001). Idempotent.

-- workflow_step_executions
DROP POLICY IF EXISTS tenant_isolation ON workflow_step_executions;
DROP POLICY IF EXISTS tenant_insert ON workflow_step_executions;
DROP POLICY IF EXISTS tenant_update ON workflow_step_executions;
DROP POLICY IF EXISTS tenant_delete ON workflow_step_executions;
ALTER TABLE workflow_step_executions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_step_executions DISABLE ROW LEVEL SECURITY;

-- workflow_trigger_executions
DROP POLICY IF EXISTS tenant_isolation ON workflow_trigger_executions;
DROP POLICY IF EXISTS tenant_insert ON workflow_trigger_executions;
DROP POLICY IF EXISTS tenant_update ON workflow_trigger_executions;
DROP POLICY IF EXISTS tenant_delete ON workflow_trigger_executions;
ALTER TABLE workflow_trigger_executions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_trigger_executions DISABLE ROW LEVEL SECURITY;

-- workflow_tasks
DROP POLICY IF EXISTS tenant_isolation ON workflow_tasks;
DROP POLICY IF EXISTS tenant_insert ON workflow_tasks;
DROP POLICY IF EXISTS tenant_update ON workflow_tasks;
DROP POLICY IF EXISTS tenant_delete ON workflow_tasks;
ALTER TABLE workflow_tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_tasks DISABLE ROW LEVEL SECURITY;

-- workflow_instances
DROP POLICY IF EXISTS tenant_isolation ON workflow_instances;
DROP POLICY IF EXISTS tenant_insert ON workflow_instances;
DROP POLICY IF EXISTS tenant_update ON workflow_instances;
DROP POLICY IF EXISTS tenant_delete ON workflow_instances;
ALTER TABLE workflow_instances NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_instances DISABLE ROW LEVEL SECURITY;

-- workflow_definitions
DROP POLICY IF EXISTS tenant_isolation ON workflow_definitions;
DROP POLICY IF EXISTS tenant_insert ON workflow_definitions;
DROP POLICY IF EXISTS tenant_update ON workflow_definitions;
DROP POLICY IF EXISTS tenant_delete ON workflow_definitions;
ALTER TABLE workflow_definitions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE workflow_definitions DISABLE ROW LEVEL SECURITY;
