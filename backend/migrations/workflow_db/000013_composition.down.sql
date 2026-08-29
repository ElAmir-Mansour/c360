-- Reverse of 000013_composition.up.sql. Drops the multi-instance fan-in ledger
-- (and its RLS policies) and the parent-link columns on workflow_instances.
-- Idempotent; removes only what the up migration added.

DROP POLICY IF EXISTS tenant_isolation ON workflow_mi_children;
DROP POLICY IF EXISTS tenant_insert ON workflow_mi_children;
DROP POLICY IF EXISTS tenant_update ON workflow_mi_children;
DROP POLICY IF EXISTS tenant_delete ON workflow_mi_children;

DROP INDEX IF EXISTS idx_workflow_mi_children_child;
DROP INDEX IF EXISTS idx_workflow_mi_children_parent;

DROP TABLE IF EXISTS workflow_mi_children;

DROP INDEX IF EXISTS idx_workflow_instances_parent;

ALTER TABLE workflow_instances DROP COLUMN IF EXISTS parent_step_id;
ALTER TABLE workflow_instances DROP COLUMN IF EXISTS parent_instance_id;
