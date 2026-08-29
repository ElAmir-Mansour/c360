-- CAP-109: per-issue regulatory-compliance review state.
--
-- The contract's AI-populated compliance flags (contract_analyses.compliance_flags,
-- a JSONB array of {code,title,description,severity,clause_reference}) are joined,
-- read-side, to the tenant's compliance_rules to enrich each flag with rule text,
-- severity, remediation and source clause. This table records the reviewer's
-- triage of a single matched flag so the team can mark a regulatory issue
-- resolved. One open/resolved row per (tenant, contract, flag_ref): the latest
-- disposition is upserted in place. flag_ref is the stable compliance-flag code.
CREATE TABLE IF NOT EXISTS contract_compliance_reviews (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    flag_ref    TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'resolved')),
    note        TEXT        NOT NULL DEFAULT '',
    resolved_by UUID,
    resolved_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(flag_ref) <> ''),
    UNIQUE (tenant_id, contract_id, flag_ref)
);

CREATE INDEX IF NOT EXISTS idx_compliance_reviews_contract
    ON contract_compliance_reviews (tenant_id, contract_id, flag_ref);

ALTER TABLE contract_compliance_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_compliance_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_compliance_reviews
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_compliance_reviews
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_compliance_reviews
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_compliance_reviews
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
