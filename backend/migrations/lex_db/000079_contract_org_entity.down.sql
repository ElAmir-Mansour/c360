DROP INDEX IF EXISTS idx_contracts_org_entity;
ALTER TABLE contracts DROP COLUMN IF EXISTS org_entity_id;
