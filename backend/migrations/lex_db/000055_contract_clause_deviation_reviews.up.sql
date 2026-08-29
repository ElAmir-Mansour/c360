-- WTQ-RSK-02 #3: deviation triage status. Records a reviewer's disposition of a
-- per-clause-type deviation surfaced by the clause-deviation report so the team can
-- triage (accept the deviation, request a fix, reject, or mark open). One row per
-- (tenant, contract, clause_type): the latest disposition is upserted in place.
CREATE TABLE IF NOT EXISTS contract_clause_deviation_reviews (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL,
    contract_id UUID        NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
    clause_type TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'accepted', 'rejected', 'needs_fix')),
    note        TEXT        NOT NULL DEFAULT '',
    reviewed_by UUID,
    reviewed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (btrim(clause_type) <> ''),
    UNIQUE (tenant_id, contract_id, clause_type)
);

CREATE INDEX IF NOT EXISTS idx_clause_deviation_reviews_contract
    ON contract_clause_deviation_reviews (tenant_id, contract_id, clause_type);

ALTER TABLE contract_clause_deviation_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clause_deviation_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_clause_deviation_reviews
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_clause_deviation_reviews
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_clause_deviation_reviews
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_clause_deviation_reviews
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
