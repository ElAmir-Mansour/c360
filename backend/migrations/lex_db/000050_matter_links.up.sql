-- FEATURE 9: cross-domain related-items links.
-- A generic edge connecting a matter to a sibling lex entity. Link rows (like
-- comments and document links) are hard-deletable and are NOT WORM-protected.
--
-- Target integrity: target_id is deliberately NOT a foreign key, because it may
-- point at any one of several heterogeneous tables depending on target_type.
-- Existence + same-tenant validation is enforced in the service layer
-- (MatterLinkRepository.ResolveTarget), which maps each target_type to its
-- physical table:
--   consultation  -> legal_consultations
--   investigation -> legal_investigations
--   legal_case    -> legal_cases
--   litigation    -> legal_cases   (litigation is a legal_cases category)
--   settlement    -> legal_settlement
--   contract      -> contracts
-- Dangling links are rejected with a 4xx before insert.

CREATE TABLE IF NOT EXISTS matter_links (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    matter_id     UUID        NOT NULL REFERENCES legal_matters(id) ON DELETE CASCADE,
    target_type   TEXT        NOT NULL CHECK (target_type IN (
        'consultation', 'investigation', 'legal_case', 'settlement', 'litigation', 'contract'
    )),
    target_id     UUID        NOT NULL,
    relationship  TEXT        NOT NULL DEFAULT '',
    created_by    UUID        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matter_links_matter
    ON matter_links (tenant_id, matter_id, created_at ASC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_links_unique
    ON matter_links (matter_id, target_type, target_id);

ALTER TABLE matter_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE matter_links FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON matter_links
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON matter_links
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON matter_links
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON matter_links
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
