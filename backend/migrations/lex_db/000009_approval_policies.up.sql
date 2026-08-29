CREATE TABLE IF NOT EXISTS lex_approval_policies (
    id                         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id                  UUID        NOT NULL,
    name                       TEXT        NOT NULL,
    description                TEXT        NOT NULL DEFAULT '',
    status                     TEXT        NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'archived')),
    priority                   INT         NOT NULL DEFAULT 0,
    contract_type              TEXT,
    department                 TEXT,
    min_value                  DECIMAL(18,2),
    max_value                  DECIMAL(18,2),
    currency                   TEXT        NOT NULL DEFAULT 'SAR',
    mode                       TEXT        NOT NULL DEFAULT 'parallel'
        CHECK (mode IN ('sequential', 'parallel')),
    quorum                     TEXT        NOT NULL DEFAULT 'all'
        CHECK (quorum IN ('all', 'any', 'n_of_m')),
    quorum_n                   INT,
    approvers                  JSONB       NOT NULL DEFAULT '[]'::jsonb,
    form_fields                JSONB       NOT NULL DEFAULT '[]'::jsonb,
    require_authority_evidence BOOLEAN     NOT NULL DEFAULT true,
    required_role              TEXT,
    required_authority_amount  DECIMAL(18,2),
    metadata                   JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_by                 UUID        NOT NULL,
    updated_by                 UUID,
    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at                 TIMESTAMPTZ,
    CHECK (btrim(name) <> ''),
    CHECK (min_value IS NULL OR min_value >= 0),
    CHECK (max_value IS NULL OR max_value >= 0),
    CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
    CHECK (required_authority_amount IS NULL OR required_authority_amount >= 0),
    CHECK ((quorum = 'n_of_m' AND quorum_n IS NOT NULL AND quorum_n > 0) OR (quorum <> 'n_of_m' AND quorum_n IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lex_approval_policies_name
    ON lex_approval_policies (tenant_id, lower(name))
    WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lex_approval_policies_match
    ON lex_approval_policies (tenant_id, status, priority DESC, contract_type, department, currency)
    WHERE deleted_at IS NULL;

ALTER TABLE lex_approval_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE lex_approval_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON lex_approval_policies
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_insert ON lex_approval_policies
    FOR INSERT
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_update ON lex_approval_policies
    FOR UPDATE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
CREATE POLICY tenant_delete ON lex_approval_policies
    FOR DELETE
    USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
