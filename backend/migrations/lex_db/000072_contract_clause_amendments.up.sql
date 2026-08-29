-- CAP-111: proposed clause amendments. A reviewer proposes a redlined revision of
-- a clause's text (original_text → proposed_text) with a reason; a decider then
-- accepts or rejects it. Accepted amendments are surfaceable in the contract's
-- final review-desk recommendation (CAP-118). Mirrors the tenant_id-first scoping,
-- gen_random_uuid() PK, timestamp, index, and RLS style of legal_matter_comments
-- (000048). clause_id FKs the contract_clauses row; contract_id is denormalized so
-- the list/recommendation read can scope by contract without a clause join.

CREATE TABLE IF NOT EXISTS contract_clause_amendments (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    clause_id     UUID        NOT NULL REFERENCES contract_clauses(id) ON DELETE CASCADE,
    contract_id   UUID        NOT NULL,
    original_text TEXT        NOT NULL DEFAULT '',
    proposed_text TEXT        NOT NULL,
    reason        TEXT        NOT NULL DEFAULT '',
    status        TEXT        NOT NULL DEFAULT 'proposed',
    proposed_by   UUID        NOT NULL,
    decided_by    UUID,
    decided_at    TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contract_clause_amendments_clause
    ON contract_clause_amendments (tenant_id, clause_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contract_clause_amendments_contract
    ON contract_clause_amendments (tenant_id, contract_id, status);

ALTER TABLE contract_clause_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_clause_amendments FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contract_clause_amendments
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON contract_clause_amendments
    FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON contract_clause_amendments
    FOR UPDATE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON contract_clause_amendments
    FOR DELETE USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
