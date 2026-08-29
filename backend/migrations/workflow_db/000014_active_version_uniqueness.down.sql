-- Reverse of 000014_active_version_uniqueness.up.sql. Drops only the two indexes
-- the up migration added. Idempotent.

DROP INDEX IF EXISTS idx_workflow_definitions_lineage_active;
DROP INDEX IF EXISTS uq_workflow_definitions_one_prod_active;
