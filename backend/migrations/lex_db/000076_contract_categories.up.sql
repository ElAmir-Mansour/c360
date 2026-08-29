-- =============================================================================
-- CAP-123 — manual contract classification / categorization.
--
-- A per-tenant CATEGORY CATALOG that feeds the manual "categorize" multi-select
-- on the contract detail / review-desk. This is DISTINCT from the AI
-- ClassificationResult path (contract.go ContractClassificationResult, the
-- `/contracts/{id}/classify` route): categorize is a human-curated vocabulary
-- written into contracts.tags + metadata{categorized_at, categorized_by}, never
-- an inferred recommended_type.
--
-- A small DEFAULT catalog is seeded for the Watheeq demo tenant (Abdullah Al
-- Othaim Investment Company, tenant id aaaaaaaa-...-01) following the loop-style
-- idempotent seed used elsewhere (000061 esign seed): ON CONFLICT DO NOTHING so a
-- re-run never collides. Other tenants build their own catalog through the API.
-- =============================================================================

CREATE TABLE IF NOT EXISTS contract_categories (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id  UUID        NOT NULL,
    name       TEXT        NOT NULL,
    slug       TEXT        NOT NULL,
    sort_order INTEGER     NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ
);

-- One catalog entry per slug per tenant (a tenant's vocabulary has no duplicates).
CREATE UNIQUE INDEX IF NOT EXISTS uq_contract_categories_tenant_slug
    ON contract_categories (tenant_id, slug)
    WHERE deleted_at IS NULL;

-- Catalog read ordering: tenant-scoped, by sort_order then name.
CREATE INDEX IF NOT EXISTS idx_contract_categories_tenant
    ON contract_categories (tenant_id, sort_order ASC, name ASC)
    WHERE deleted_at IS NULL;

ALTER TABLE contract_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_categories FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_categories
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_categories
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_categories
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_categories
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- Default catalog for the Watheeq demo tenant (Abdullah Al Othaim Investment
-- Company). Idempotent: ON CONFLICT DO NOTHING so a re-run / an operator-added
-- category with the same slug is never disturbed.
INSERT INTO contract_categories (tenant_id, name, slug, sort_order)
SELECT 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, c.name, c.slug, c.sort_order
FROM (
    VALUES
        ('Strategic', 'strategic', 10),
        ('Commercial', 'commercial', 20),
        ('Procurement', 'procurement', 30),
        ('Real Estate', 'real-estate', 40),
        ('Employment', 'employment', 50),
        ('Confidentiality', 'confidentiality', 60),
        ('Regulatory', 'regulatory', 70),
        ('Intercompany', 'intercompany', 80)
) AS c(name, slug, sort_order)
ON CONFLICT (tenant_id, slug) WHERE deleted_at IS NULL DO NOTHING;
