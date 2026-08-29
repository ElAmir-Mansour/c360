-- WTQ-RSK-02: clause playbooks — a named set of approved/standard clauses per
-- contract type, used to detect clause-level deviations (missing required,
-- materially altered, and extra non-standard clauses) in a contract.
CREATE TABLE IF NOT EXISTS lex_clause_playbooks (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID        NOT NULL,
    name          TEXT        NOT NULL,
    description   TEXT        NOT NULL DEFAULT '',
    contract_type TEXT        NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'archived')),
    -- clauses is an array of standard clause objects:
    --   { clause_type, title, standard_text, required, risk_weight, similarity_threshold }
    clauses       JSONB       NOT NULL DEFAULT '[]'::jsonb,
    metadata      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by    UUID        NOT NULL,
    updated_by    UUID,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at    TIMESTAMPTZ,
    CHECK (btrim(name) <> ''),
    CHECK (btrim(contract_type) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_clause_playbooks_name
    ON lex_clause_playbooks (tenant_id, lower(name))
    WHERE deleted_at IS NULL;

-- At most one active playbook per (tenant, contract_type): the applicable
-- playbook for a contract is deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_clause_playbooks_active_type
    ON lex_clause_playbooks (tenant_id, contract_type)
    WHERE deleted_at IS NULL AND status = 'active';

CREATE INDEX IF NOT EXISTS idx_lex_clause_playbooks_match
    ON lex_clause_playbooks (tenant_id, status, contract_type)
    WHERE deleted_at IS NULL;

ALTER TABLE lex_clause_playbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_clause_playbooks FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_clause_playbooks
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_clause_playbooks
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_clause_playbooks
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_clause_playbooks
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
