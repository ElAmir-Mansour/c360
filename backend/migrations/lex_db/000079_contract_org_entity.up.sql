-- Contract <-> Org-Entity link (contracts list workspace, feature #11).
-- Adds an OPTIONAL master-data reference from contracts to the legal-org
-- registry (legal_org_entities, migration 000019). The party_a_* / party_b_*
-- free-text columns are deliberately untouched: org_entity_id is an additive,
-- nullable projection used for list filtering and per-entity roll-ups. No FK is
-- declared so imported/legacy contracts can link lazily and org-entity
-- soft-deletes never block contract writes; dangling references simply resolve
-- to a NULL entity_name on read.

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS org_entity_id UUID;

CREATE INDEX IF NOT EXISTS idx_contracts_org_entity
    ON contracts (tenant_id, org_entity_id)
    WHERE org_entity_id IS NOT NULL AND deleted_at IS NULL;
