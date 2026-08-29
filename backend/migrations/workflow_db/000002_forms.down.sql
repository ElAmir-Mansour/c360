-- Reverse of 000002_forms.up.sql. Drop the policies, then the table.
DROP POLICY IF EXISTS tenant_delete ON workflow_forms;
DROP POLICY IF EXISTS tenant_update ON workflow_forms;
DROP POLICY IF EXISTS tenant_insert ON workflow_forms;
DROP POLICY IF EXISTS tenant_isolation ON workflow_forms;

DROP TABLE IF EXISTS workflow_forms;
