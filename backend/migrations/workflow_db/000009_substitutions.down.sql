-- Reverse of 000009_substitutions.up.sql. Drops the OOO/substitute (deputy)
-- registry table and its RLS policies. Idempotent; removes only what the up
-- migration added.

DROP POLICY IF EXISTS tenant_isolation ON workflow_substitutions;
DROP POLICY IF EXISTS tenant_insert ON workflow_substitutions;
DROP POLICY IF EXISTS tenant_update ON workflow_substitutions;
DROP POLICY IF EXISTS tenant_delete ON workflow_substitutions;

DROP INDEX IF EXISTS uq_workflow_substitutions_active_user;
DROP INDEX IF EXISTS idx_workflow_substitutions_window;
DROP INDEX IF EXISTS idx_workflow_substitutions_lookup;

DROP TABLE IF EXISTS workflow_substitutions;
