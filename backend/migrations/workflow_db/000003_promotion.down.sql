-- Reverse of 000003_promotion.up.sql. Drops the lineage index, the stage CHECK
-- constraint, and the five promotion columns. The pgcrypto extension is left in
-- place (other objects depend on it). Each statement uses IF EXISTS so the
-- rollback is a safe no-op on a database that never applied the up migration.

DROP INDEX IF EXISTS idx_workflow_definitions_tenant_key;

ALTER TABLE workflow_definitions
    DROP CONSTRAINT IF EXISTS workflow_definitions_stage_check;

ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS promoted_by;
ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS promoted_at;
ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS immutable;
ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS stage;
ALTER TABLE workflow_definitions DROP COLUMN IF EXISTS definition_key;
